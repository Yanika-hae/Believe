// Cercles d'amis (compte en ligne FACULTATIF) : client des fonctions « bl_circle_* » et « bl_invite_* » de supabase/schema.sql.
// Règles, appliquées ici ET par la base de données :
//  • rien n'est partagé par défaut : créer un cercle ou y entrer ne dépose aucune carte ; le partage se choisit cercle par cercle, après un aperçu exact ;
//  • la carte déposée est celle de `buildShare` (src/share.ts), et d'elle seule, vérifiée en liste blanche avant l'envoi ; sans l'accord « Partage », aucune carte n'est faite ;
//  • tout ce qui vient du service (noms, cartes des autres membres) est vérifié avant d'être affiché et n'est jamais interprété comme du code ;
//  • arrêter le partage, quitter un cercle, retirer un accord ou supprimer le compte efface les cartes côté service.
// Rien n'est écrit dans les journaux. Le code d'une invitation n'est jamais écrit dans le stockage local persistant (seulement dans la mémoire de l'onglet : voir `stashInvite`).
import { CloudError, getSession, rpc } from './cloud'
import { load } from './lib'
import { buildShare, hasContent, whyBad } from './share'
import type { SharePayload } from './share'
import * as V from './schema'

// ---------------------------------------------------------------- types
export interface Circle { id: string; name: string; owner: boolean; members: number; me: string; display: string; sharing: boolean; at: string }
/** `card` : la carte (vérifiée) d'un membre qui partage ; `badCard` : le service en a renvoyé une que cet appareil refuse (jamais affichée). */
export interface Member { id: string; display: string; you: boolean; owner: boolean; sharing: boolean; card: SharePayload | null; badCard: boolean; cardAt: string | null; at: string }
export interface Invite { id: string; until: string; at: string }
export interface Peek { name: string; by: string; members: number; full: boolean; already: boolean }

export const MAX_CIRCLES = 5, MAX_MEMBERS = 12, MAX_INVITES = 10, NAME_MAX = 40, DISPLAY_MAX = 30

// ---------------------------------------------------------------- noms
/** Caractères invisibles ou de sens d'écriture (espaces de largeur nulle, inversion du sens du texte…) : refusés dans les noms écrits ici, retirés de ceux qui viennent des autres (ils servent à falsifier un affichage). */
const HIDDEN = '\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180E\\u200B\\u200C\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFEFF\\uFFA0'
const HIDDEN_ANY = new RegExp('[' + HIDDEN + ']'), HIDDEN_ALL = new RegExp('[' + HIDDEN + ']', 'g'), CTRL = /[\u0000-\u001F\u007F-\u009F]/
/** Nom reçu du service, prêt à être affiché (texte seulement). */
export const cleanName = (s: string): string => s.replace(HIDDEN_ALL, '').replace(/\s+/g, ' ').trim()
/** Nom que j'écris : espaces normalisés, 1 à `max` caractères, ni commande ni caractère invisible ; sinon null. */
export function okName(t: string, max: number): string | null {
  const s = t.replace(/\s+/g, ' ').trim()
  return s && [...s].length <= max && !CTRL.test(s) && !HIDDEN_ANY.test(s) ? s : null
}

// ---------------------------------------------------------------- code d'invitation
export const CODE_RE = /^[0-9A-F]{6}(-[0-9A-F]{6}){3}$/
/** Code saisi ou reçu par lien : majuscules, sans tirets ni espaces. Renvoie « XXXXXX-XXXXXX-XXXXXX-XXXXXX », ou null si ce n'est pas 24 chiffres hexadécimaux. */
export function normCode(t: string): string | null {
  const c = t.toUpperCase().replace(/[^0-9A-Z]/g, '')
  return /^[0-9A-F]{24}$/.test(c) ? c.match(/.{6}/g)!.join('-') : null
}
/** Adresse à envoyer à la personne invitée : elle ouvre l'onglet Amis avec le code, sans le garder dans la barre d'adresse (voir CirclesPage). */
export const inviteLink = (code: string, origin: string = location.origin): string => origin + '/#/5/amis/' + code

const INV = 'believe:invite', INV_MS = 24 * 3600_000
/** Garde le code reçu par lien le temps de la session de l'onglet (il survit à la connexion Google, qui quitte la page puis y revient), jamais dans le stockage persistant. */
export function stashInvite(code: string): void { try { sessionStorage.setItem(INV, JSON.stringify({ c: code, t: Date.now() })) } catch { /* mémoire de l'onglet indisponible : le code reste dans le lien */ } }
export function pendingInvite(): string | null {
  try {
    const o = JSON.parse(sessionStorage.getItem(INV) ?? 'null') as { c?: unknown; t?: unknown } | null
    if (o && typeof o.c === 'string' && typeof o.t === 'number' && Date.now() - o.t < INV_MS) return normCode(o.c)
  } catch { /* illisible : ignoré */ }
  return null
}
export function dropInvite(): void { try { sessionStorage.removeItem(INV) } catch { /* ignoré */ } }

// ---------------------------------------------------------------- repères locaux (aucune donnée personnelle)
const PREF = 'believe:circles'
/** `on` : au moins un cercle où ma carte est partagée (il faut donc la mettre à jour) ; `retract` : un retrait de mes cartes est demandé mais pas encore confirmé par le service. */
interface Pref { on: boolean; retract: boolean }
function readPref(): Pref {
  try { const o = JSON.parse(localStorage.getItem(PREF) ?? 'null') as Partial<Pref> | null; return { on: o?.on === true, retract: o?.retract === true } } catch { return { on: false, retract: false } }
}
function writePref(p: Pref): void {
  try { if (!p.on && !p.retract) localStorage.removeItem(PREF); else localStorage.setItem(PREF, JSON.stringify(p)) } catch { /* ignoré : au pire un envoi ou un retrait sera retenté plus tard */ }
}
/** Vrai si un retrait de mes cartes attend sa confirmation. */
export const retractPending = (): boolean => readPref().retract

// ---------------------------------------------------------------- vérification de ce que dit le service
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = V.pat(UUID, 36)
// Le service compte en caractères Unicode ; JavaScript en unités UTF-16 (jusqu'à deux par caractère).
const txt = (n: number) => V.str(n * 2, 1)
const CIRCLE = V.obj({ id: uuid, name: txt(NAME_MAX), owner: V.bool, members: V.int(1, 1000), me: uuid, display: txt(DISPLAY_MAX), sharing: V.bool, at: V.stamp })
const MEMBER = V.obj({ id: uuid, display: txt(DISPLAY_MAX), you: V.bool, owner: V.bool, sharing: V.bool, cardAt: V.nul(V.stamp), at: V.stamp })
const INVITE = V.obj({ id: uuid, until: V.stamp, at: V.stamp })
const MADE = V.obj({ id: uuid, code: V.pat(CODE_RE, 30), until: V.stamp })
const PEEK = V.obj({ name: txt(NAME_MAX), by: txt(DISPLAY_MAX), members: V.int(1, 1000), full: V.bool, already: V.bool })
const JOINED = V.obj({ circle: uuid, me: uuid })
const CREATED = V.obj({ id: uuid, me: uuid })
const TRUE: V.V = (x, p) => (x === true ? null : p + ' : vrai attendu')
const CARDED = V.obj({ ok: TRUE, at: V.stamp })
const DONE = V.obj({ ok: TRUE })
const server = () => new CloudError('server')
/** Appelle une fonction du service et vérifie la forme de la réponse : une réponse inattendue est une erreur « server », jamais une donnée affichée. */
async function call<T>(fn: string, args: Record<string, unknown>, check: V.V | null, pick?: (o: Record<string, unknown>) => T): Promise<T> {
  const j = await rpc<unknown>(fn, args)
  if (!check) return undefined as T
  if (check(j, fn) !== null || !V.isObj(j)) throw server()
  return pick ? pick(j) : (undefined as T)
}
const str = (o: Record<string, unknown>, k: string) => cleanName(o[k] as string)
const listOf = (j: unknown, max: number): unknown[] => { if (!Array.isArray(j) || j.length > max) throw server(); return j }

// ---------------------------------------------------------------- lecture
export async function list(): Promise<Circle[]> {
  const out: Circle[] = []
  for (const e of listOf(await rpc<unknown>('bl_circles'), 50)) {
    if (CIRCLE(e, 'cercle') !== null) throw server()
    const o = e as Record<string, unknown>
    out.push({ id: o.id as string, name: str(o, 'name') || '—', owner: o.owner as boolean, members: o.members as number, me: o.me as string, display: str(o, 'display') || '—', sharing: o.sharing as boolean, at: o.at as string })
  }
  return out
}
export async function members(circle: string): Promise<Member[]> {
  const out: Member[] = []
  for (const e of listOf(await rpc<unknown>('bl_circle_members', { p_circle: circle }), 100)) {
    if (MEMBER(e, 'membre') !== null) throw server()
    const o = e as Record<string, unknown>, sharing = o.sharing as boolean
    // La carte d'un autre membre vient d'un autre appareil : même vérification en liste blanche que pour une carte à envoyer. Refusée = jamais affichée.
    const raw = sharing ? o.card : null, hasCard = raw !== null && raw !== undefined, bad = hasCard && whyBad(raw) !== null
    out.push({ id: o.id as string, display: str(o, 'display') || '—', you: o.you as boolean, owner: o.owner as boolean, sharing, card: hasCard && !bad ? (raw as SharePayload) : null, badCard: bad, cardAt: (o.cardAt as string | null) ?? null, at: o.at as string })
  }
  return out
}
export async function invites(circle: string): Promise<Invite[]> {
  return listOf(await rpc<unknown>('bl_invite_list', { p_circle: circle }), 50).map(e => {
    if (INVITE(e, 'invitation') !== null) throw server()
    const o = e as Record<string, unknown>
    return { id: o.id as string, until: o.until as string, at: o.at as string }
  })
}

// ---------------------------------------------------------------- écriture
const need = (t: string, max: number, code: 'name' | 'display'): string => { const s = okName(t, max); if (!s) throw new CloudError(code); return s }
export async function create(name: string, display: string): Promise<{ id: string; me: string }> {
  const n = need(name, NAME_MAX, 'name'), d = need(display, DISPLAY_MAX, 'display')
  return call('bl_circle_create', { p_name: n, p_display: d }, CREATED, o => ({ id: o.id as string, me: o.me as string }))
}
export async function rename(circle: string, name: string): Promise<void> { await call('bl_circle_rename', { p_circle: circle, p_name: need(name, NAME_MAX, 'name') }, DONE) }
export async function setDisplay(circle: string, display: string): Promise<void> { await call('bl_circle_display', { p_circle: circle, p_display: need(display, DISPLAY_MAX, 'display') }, DONE) }
export async function remove(circle: string): Promise<void> { await call('bl_circle_delete', { p_circle: circle }, DONE); forget(circle) }
export async function leave(circle: string): Promise<void> { await call('bl_circle_leave', { p_circle: circle }, DONE); forget(circle) }
export async function kick(circle: string, member: string): Promise<void> { await call('bl_circle_kick', { p_circle: circle, p_member: member }, DONE) }

/** Crée une invitation (réservé au créateur du cercle). Le code n'est montré qu'une fois : le service n'en garde que l'empreinte. */
export async function invite(circle: string): Promise<{ id: string; code: string; until: string }> {
  return call('bl_invite_create', { p_circle: circle }, MADE, o => ({ id: o.id as string, code: o.code as string, until: o.until as string }))
}
export async function revoke(circle: string, inviteId: string): Promise<void> { await call('bl_invite_revoke', { p_circle: circle, p_invite: inviteId }, DONE) }
/** Ce que dit une invitation (nom du cercle, qui l'a créé, nombre de membres), sans y entrer. */
export async function peek(code: string): Promise<Peek> {
  const c = normCode(code); if (!c) throw new CloudError('code')
  return call('bl_invite_peek', { p_code: c }, PEEK, o => ({ name: str(o, 'name') || '—', by: str(o, 'by') || '—', members: o.members as number, full: o.full as boolean, already: o.already as boolean }))
}
/** Entre dans le cercle de l'invitation (usage unique). N'active aucun partage. */
export async function accept(code: string, display: string): Promise<{ circle: string; me: string }> {
  const c = normCode(code); if (!c) throw new CloudError('code')
  const r = await call('bl_invite_accept', { p_code: c, p_display: need(display, DISPLAY_MAX, 'display') }, JOINED, o => ({ circle: o.circle as string, me: o.me as string }))
  dropInvite()
  return r
}

// ---------------------------------------------------------------- ma carte
/** Mémoire de la page : ce qui a été déposé (pour ne rien renvoyer d'identique) et les cercles où je partage (pour savoir où mettre la carte à jour). */
const last = new Map<string, string>()
let known: Map<string, boolean> | null = null, knownAt = 0
const REFRESH_MS = 10 * 60_000
const forget = (circle: string) => { last.delete(circle); known?.delete(circle) }

export type CardWhy = 'locked' | 'data' | 'consent' | 'noshare' | 'empty' | 'card'
/** La carte que cet appareil déposerait maintenant, ou la raison pour laquelle il n'y en a pas. Une seule source : `buildShare`. */
export function currentCard(): { ok: true; card: SharePayload } | { ok: false; why: CardWhy } {
  const cur = load()
  if (cur.locked) return { ok: false, why: 'locked' }
  if (cur.err) return { ok: false, why: 'data' }
  if (!cur.s.consents.cloud) return { ok: false, why: 'consent' }
  const card = buildShare(cur.s)
  if (!card) return { ok: false, why: 'noshare' }
  if (whyBad(card) !== null) return { ok: false, why: 'card' }
  if (!hasContent(card)) return { ok: false, why: 'empty' }
  return { ok: true, card }
}

/** Actualise la liste des cercles où je partage (une seule question au service). */
export async function refresh(): Promise<Circle[]> {
  const cs = await list()
  known = new Map(cs.map(c => [c.id, c.sharing])); knownAt = Date.now()
  for (const id of [...last.keys()]) if (!known.get(id)) last.delete(id)
  writePref({ ...readPref(), on: cs.some(c => c.sharing) })
  return cs
}

/**
 * Active le partage de ma carte dans ce cercle, puis dépose la carte. Si le dépôt échoue, le partage est aussitôt recoupé (jamais « actif » sans carte vérifiée).
 * Renvoie l'heure de dépôt donnée par le service : le message de réussite ne s'affiche qu'après.
 */
export async function startSharing(circle: string): Promise<string> {
  const c = currentCard()
  if (!c.ok) throw new CloudError(c.why)
  await call('bl_circle_sharing', { p_circle: circle, p_on: true }, V.obj({ sharing: V.bool }))
  try {
    const at = await call('bl_circle_card', { p_circle: circle, p_card: c.card }, CARDED, o => o.at as string)
    last.set(circle, JSON.stringify(c.card)); known?.set(circle, true)
    writePref({ ...readPref(), on: true })
    return at
  } catch (e) {
    try { await rpc('bl_circle_sharing', { p_circle: circle, p_on: false }) } catch { /* le prochain envoi ou « Arrêter » réglera la situation */ }
    throw e
  }
}
/** Coupe le partage dans ce cercle : le service efface aussitôt la carte conservée. */
export async function stopSharing(circle: string): Promise<void> {
  await call('bl_circle_sharing', { p_circle: circle, p_on: false }, V.obj({ sharing: V.bool }))
  last.delete(circle); known?.set(circle, false)
  try { await refresh() } catch { /* sans importance : le prochain envoi relira la liste et le repère local */ }
}
/**
 * Retire mes cartes de TOUS mes cercles (accord « Partage » ou « Compte en ligne » retiré). Le retrait est mémorisé tant que le service ne l'a pas confirmé :
 * hors ligne, il reprend à la prochaine ouverture avec connexion. Renvoie le nombre de cartes retirées ; lève une erreur si le service n'a pas pu être joint.
 */
export async function retractAll(): Promise<number> {
  writePref({ ...readPref(), retract: true })
  const cs = await list()
  let n = 0
  for (const c of cs) if (c.sharing) { await call('bl_circle_sharing', { p_circle: c.id, p_on: false }, V.obj({ sharing: V.bool })); n++ }
  last.clear(); known = new Map(cs.map(c => [c.id, false])); knownAt = Date.now()
  writePref({ on: false, retract: false })
  return n
}

export type Pub = { ok: true; pushed: number } | { ok: false; why: string }
let chain: Promise<unknown> = Promise.resolve()
/** Met à jour ma carte dans les cercles où je la partage (seulement si elle a changé), après avoir terminé un retrait en attente. Un seul tour à la fois. */
export function publish(force = false): Promise<Pub> {
  const p = chain.then(() => run(force), () => run(force))
  chain = p.catch(() => undefined)
  return p
}
async function run(force: boolean): Promise<Pub> {
  const cur = load()
  if (cur.locked) return { ok: false, why: 'locked' }
  if (cur.err) return { ok: false, why: 'data' }
  if (!cur.s.consents.cloud) return { ok: false, why: 'consent' }
  if (!getSession()) return { ok: false, why: 'signin' }
  try {
    if (readPref().retract) await retractAll()
    if (force || known === null || Date.now() - knownAt > REFRESH_MS) await refresh()
    const card = buildShare(cur.s) // null sans l'accord « Partage » : rien n'est déposé (le retrait, lui, se fait quand l'accord est retiré : voir retractAll)
    if (!card) return { ok: true, pushed: 0 }
    if (whyBad(card) !== null) return { ok: false, why: 'card' }
    const json = JSON.stringify(card)
    let pushed = 0
    for (const [id, on] of [...known!.entries()]) {
      if (!on || (!force && last.get(id) === json)) continue
      try { await call('bl_circle_card', { p_circle: id, p_card: card }, CARDED); last.set(id, json); pushed++ } catch (e) {
        if (e instanceof CloudError && (e.code === 'share' || e.code === 'circle')) { await refresh(); continue } // coupé depuis un autre appareil, ou cercle disparu
        throw e
      }
    }
    return { ok: true, pushed }
  } catch (e) { return { ok: false, why: e instanceof CloudError ? e.code : 'server' } }
}

// ---------------------------------------------------------------- déclencheurs automatiques (appelés par cloudhook.ts)
const TOUCH_MS = 10_000
let timer: ReturnType<typeof setTimeout> | null = null, started = false
const onVis = () => { if (!document.hidden) touch() }
/** À appeler après chaque enregistrement local : met la carte à jour une fois la saisie calme. */
export function touch(delay = TOUCH_MS): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void publish() }, delay)
}
/** Démarre les déclencheurs (retour au premier plan, réseau retrouvé) et un premier tour peu après l'ouverture. */
export function start(): void {
  if (started) return
  started = true
  document.addEventListener('visibilitychange', onVis); addEventListener('online', onVis)
  touch(3000)
}
export function stop(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (started) { document.removeEventListener('visibilitychange', onVis); removeEventListener('online', onVis); started = false }
  last.clear(); known = null // la prochaine reprise redemande tout au service
}
/** Oublie tout ce que cet appareil sait des cercles (compte supprimé) : repères locaux, mémoire de la page, code d'invitation en attente. */
export function clearLocal(): void {
  stop()
  try { localStorage.removeItem(PREF) } catch { /* ignoré */ }
  dropInvite()
}
