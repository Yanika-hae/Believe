// Rappels quand l'application est FERMÉE (compte en ligne FACULTATIF) : abonnement aux notifications de CET appareil, et programmation des rappels à venir sur le service.
// Principe : chaque rappel à venir est chiffré ICI (RFC 8291, src/webpush.ts) avec les clés de l'abonnement de cet appareil, puis déposé sur le service avec son heure d'envoi.
// À l'heure dite, la fonction api/push-tick.ts le transmet au service de notification du navigateur (Google, Apple, Mozilla ou Microsoft) : ni elle, ni la base de données, ni ce service ne peuvent
// le lire ; seul le navigateur de cet appareil le déchiffre, puis le remet au service worker (public/sw-notify.js) qui l'affiche.
// Le service ne voit donc que : l'adresse de l'abonnement, l'heure d'envoi de chaque rappel et un identifiant de tâche aléatoire. Jamais le titre d'une tâche, ni aucune autre donnée.
// Soumis aux accords « Notifications » ET « Compte en ligne » : si l'un des deux est retiré (où que ce soit), la fonction s'arrête et ce qu'elle avait déposé est effacé.
// Rien n'est écrit dans les journaux. Les erreurs sont rendues sous forme de codes (type `Why`), jamais avec du contenu.
import { CloudError, getConfig, getSession, rpc } from './cloud'
import { load } from './lib'
import type { State } from './lib'
import * as V from './schema'
import { permission, remindAt } from './remind'
import { b64uDec, b64uEnc, encryptPush, keysOf } from './webpush'

// ---------------------------------------------------------------- repère local (aucune donnée personnelle)
const PREF = 'believe:push'
/** `on` : activé sur cet appareil ; `title` : le titre de la tâche figure dans la notification ; `test` : heure (ms) d'un rappel de test en attente, ou 0. */
export interface Pref { on: boolean; title: boolean; test: number }
const NONE: Pref = { on: false, title: false, test: 0 }
function readPref(): Pref {
  try {
    const o = JSON.parse(localStorage.getItem(PREF) ?? 'null') as Partial<Pref> | null
    return { on: o?.on === true, title: o?.title === true, test: typeof o?.test === 'number' && Number.isFinite(o.test) ? o.test : 0 }
  } catch { return { ...NONE } }
}
function writePref(p: Pref): void {
  try { if (!p.on) localStorage.removeItem(PREF); else localStorage.setItem(PREF, JSON.stringify(p)) } catch { /* ignoré : au pire la programmation sera refaite au prochain lancement */ }
}
/** Activé sur cet appareil ? */
export const isOn = (): boolean => readPref().on
/** Le titre des tâches figure-t-il dans les notifications ? (réglage de cet appareil) */
export const titleOn = (): boolean => readPref().title
/** Heure (ms) du rappel de test en attente, ou 0. */
export const testAt = (): number => { const t = readPref().test; return t > Date.now() - TEST_KEEP_MS ? t : 0 }

// ---------------------------------------------------------------- ce que le navigateur sait faire
export type Support = 'ok' | 'ios-install' | 'unsupported'
/** 'ok' : service worker, notifications et Web Push présents ; 'ios-install' : iPhone/iPad hors de l'écran d'accueil (Web Push n'y existe que pour une application installée) ; sinon 'unsupported'. */
export function support(): Support {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'unsupported'
  if ('serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined') return 'ok'
  const ua = navigator.userAgent ?? ''
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
  let standalone = (navigator as { standalone?: boolean }).standalone === true
  try { standalone ||= typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches } catch { /* ignoré */ }
  return ios && !standalone ? 'ios-install' : 'unsupported'
}

/**
 * Raisons pour lesquelles les rappels application fermée ne sont pas (ou plus) actifs ou programmés.
 * consent-notif / consent-cloud : accord retiré ; permission : notifications du système non autorisées ; signin : pas de connexion (ou refusée) ; config : service non configuré ; vapid : clés d'envoi
 * non configurées sur le déploiement ; schema : script SQL absent ou ancien ; worker : service worker indisponible (application non installée, ou page jamais chargée hors du mode développement) ;
 * subscribe : le navigateur a refusé l'abonnement ; offline : hors ligne ; server : le service répond mal ; locked : application verrouillée ; data : données illisibles ; off : pas activé.
 */
export type Why = 'unsupported' | 'ios-install' | 'consent-notif' | 'consent-cloud' | 'permission' | 'signin' | 'config' | 'vapid' | 'schema' | 'worker' | 'subscribe' | 'offline' | 'server' | 'locked' | 'data' | 'off'
const fromCloud = (e: unknown): Why => {
  if (!(e instanceof CloudError)) return 'server'
  return e.code === 'auth' ? 'signin' : e.code === 'net' ? 'offline' : e.code === 'config' ? 'config' : e.code === 'schema' ? 'schema' : 'server'
}

// ---------------------------------------------------------------- messages (ce que le service worker affiche)
/**
 * Message chiffré envoyé au service worker. `g` : étiquette de la notification (identifiant de la tâche : elle remplace la notification locale de la même tâche) ;
 * `t` : titre ; `b` : texte (null : le service worker écrit « Échéance <jour> à <heure> » à partir de `d`, au moment de l'affichage) ; `d` : échéance (ms) ou null.
 */
export interface Msg { v: 1; g: string; t: string; b: string | null; d: number | null }
export interface Planned { ref: string; at: number; msg: Msg }
/** Un seul « rappel » par tâche ; au plus 100 en attente (limite du service), les plus proches d'abord ; jamais plus de 39 jours à l'avance (le service en accepte 40). */
export const MAX_ITEMS = 100, HORIZON_MS = 39 * 86400e3, TITLE_MAX = 120, TEST_LEAD_MS = 45_000, TEST_KEEP_MS = 60_000
export const GENERIC = { t: 'Believe : rappel', b: 'Une tâche arrive à échéance.' }
export const TEST = { t: 'Believe : test', b: 'Les rappels application fermée fonctionnent.' }
const cut = (s: string, n: number) => [...s].slice(0, n).join('')

/**
 * Rappels à programmer maintenant : tâches non terminées, avec une échéance valide, dont le moment de rappel est encore à venir (après : l'application ouverte s'en charge, voir src/Reminders.tsx)
 * et dont le rappel n'a pas déjà été donné. Le titre n'est inclus que si la personne l'a demandé ET que le mode discret est éteint. Fonction pure : l'heure est passée en argument.
 */
export function plan(s: State, now: number, o: { title: boolean; test?: number }): Planned[] {
  const out: Planned[] = [], titled = o.title && !s.discret
  for (const t of s.tasks) {
    if (t.done || !t.due || t.r === t.due) continue
    const due = Date.parse(t.due), at = remindAt(t, s.settings.remind)
    if (!Number.isFinite(due) || !Number.isFinite(at) || at <= now + 5000 || at > now + HORIZON_MS) continue
    const g = t.id.slice(0, 100)
    out.push({ ref: g, at, msg: titled ? { v: 1, g, t: cut(t.t.replace(/\s+/g, ' ').trim(), TITLE_MAX) || GENERIC.t, b: null, d: due } : { v: 1, g, t: GENERIC.t, b: GENERIC.b, d: null } })
  }
  if (o.test && o.test > now - TEST_KEEP_MS && o.test < now + 3600e3) out.push({ ref: 'test', at: o.test, msg: { v: 1, g: 'test', t: TEST.t, b: TEST.b, d: null } })
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_ITEMS)
}
const te = new TextEncoder()
const seal = async (m: Msg, k: { uaPublic: Uint8Array; auth: Uint8Array }): Promise<string> => b64uEnc(await encryptPush(te.encode(JSON.stringify(m)), k.uaPublic, k.auth))

// ---------------------------------------------------------------- abonnement du navigateur
const same = (a: ArrayBuffer | null | undefined, b: Uint8Array) => { if (!a) return false; const x = new Uint8Array(a); return x.length === b.length && x.every((v, i) => v === b[i]) }
/** Service worker actif de l'application (attente limitée : en mode développement ou sans installation, il n'existe pas). */
async function worker(ms = 8000): Promise<ServiceWorkerRegistration | null> {
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(() => r(null), ms))]) } catch { return null }
}
/** Abonnement actuel ou nouvel abonnement. Un abonnement fait avec une autre clé d'envoi (clés du déploiement changées) est remplacé. */
async function subscription(reg: ServiceWorkerRegistration, vapid: string): Promise<{ sub: PushSubscription; created: boolean }> {
  const key = b64uDec(vapid)
  let sub = await reg.pushManager.getSubscription(), created = false
  const old = sub?.options?.applicationServerKey
  if (sub && old && !same(old, key)) { await sub.unsubscribe(); sub = null }
  if (!sub) { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as unknown as BufferSource }); created = true }
  return { sub, created }
}

/** Ce qui est exigé pour agir, dans l'ordre où la personne peut y remédier : l'état lu (accords, connexion, autorisation du navigateur), ou la raison de l'empêchement. */
function check(): { ok: true; s: State } | { ok: false; why: Why } {
  const cur = load()
  if (cur.locked) return { ok: false, why: 'locked' }
  if (cur.err) return { ok: false, why: 'data' }
  if (!cur.s.consents.notif) return { ok: false, why: 'consent-notif' }
  if (!cur.s.consents.cloud) return { ok: false, why: 'consent-cloud' }
  const sp = support(); if (sp !== 'ok') return { ok: false, why: sp }
  if (permission() !== 'granted') return { ok: false, why: 'permission' }
  if (!getSession()) return { ok: false, why: 'signin' }
  return { ok: true, s: cur.s }
}

// ---------------------------------------------------------------- programmation
export type Run = { ok: true; armed: number; at: number } | { ok: false; why: Why }
const ARMED = V.obj({ armed: V.int(0, 1000) })
const REFRESH_MS = 12 * 3600e3
let lastKey = '', lastAt = 0, registered: string | null = null, chain: Promise<unknown> = Promise.resolve()

/**
 * Le rappel de test dont l'heure est passée est-il encore à envoyer ? Il est parti dès que le planificateur du serveur est passé après son heure (il l'a pris à ce passage) : le reprogrammer
 * le ferait arriver une seconde fois (typiquement en rouvrant Believe en touchant la notification). Il n'est de toute façon gardé que 60 secondes après son heure, y compris quand l'état du service
 * n'est pas lisible. Renvoie l'heure du test s'il reste à envoyer, 0 sinon.
 */
async function testPending(test: number, now: number): Promise<number> {
  if (test <= now - TEST_KEEP_MS) return 0
  const st = await status()
  return st.ok && st.tick !== null && st.tick >= test + st.skew ? 0 : test // l'heure de l'appareil est ramenée à celle du service avant la comparaison
}

/** Programme sur le service les rappels à venir (remplace ceux déjà programmés pour cet appareil). Un seul tour à la fois ; ne fait rien de plus si rien n'a changé depuis le dernier envoi. Ne lève jamais d'erreur. */
export function arm(force = false): Promise<Run> {
  const p = chain.then(() => run(force), () => run(force))
  chain = p.catch(() => undefined)
  return p
}
async function run(force: boolean): Promise<Run> {
  const pref = readPref()
  if (!pref.on) return { ok: false, why: 'off' }
  const c = check()
  if (!c.ok) {
    if (c.why === 'consent-notif' || c.why === 'consent-cloud') void disable() // accord retiré (ici, dans un autre onglet, par une importation…) : tout s'arrête et ce qui était déposé est effacé
    return c
  }
  const s = c.s
  try {
    const cfg = await getConfig()
    if (!cfg.ok) return { ok: false, why: 'config' }
    if (!cfg.cfg.vapid) return { ok: false, why: 'vapid' }
    const reg = await worker(); if (!reg) return { ok: false, why: 'worker' }
    let got: Awaited<ReturnType<typeof subscription>>
    try { got = await subscription(reg, cfg.cfg.vapid) } catch { return { ok: false, why: 'subscribe' } }
    const keys = keysOf(got.sub); if (!keys) return { ok: false, why: 'subscribe' }
    const ep = got.sub.endpoint, now = Date.now()
    const test = pref.test && pref.test <= now ? await testPending(pref.test, now) : pref.test
    const items = plan(s, now, { title: pref.title, test })
    const key = JSON.stringify([ep, items.map(i => [i.ref, i.at, i.msg])])
    if (!force && key === lastKey && now - lastAt < REFRESH_MS) return { ok: true, armed: items.length, at: lastAt }
    if (!readPref().on) return { ok: false, why: 'off' } // désactivé pendant les attentes ci-dessus : rien n'est (re)créé sur le service
    if (registered !== ep) { await rpc('bl_push_register', { p_ep: ep }); registered = ep }
    const sealed = await Promise.all(items.map(async i => ({ ref: i.ref, at: new Date(i.at).toISOString(), body: await seal(i.msg, keys) })))
    const set = async () => rpc<unknown>('bl_push_set', { p_ep: ep, p_items: sealed })
    let r: unknown
    try { r = await set() } catch (e) {
      if (!(e instanceof CloudError) || e.code !== 'ep') throw e
      if (!readPref().on) return { ok: false, why: 'off' } // désactivé pendant l'envoi : l'abonnement que la personne vient de faire supprimer n'est pas recréé
      await rpc('bl_push_register', { p_ep: ep }); r = await set() // abonnement oublié par le service (supprimé ailleurs, ou changé de compte) : on le réenregistre une fois
    }
    if (ARMED(r, 'bl_push_set') !== null) return { ok: false, why: 'server' }
    lastKey = key; lastAt = Date.now()
    if (pref.test && !test) { const p = readPref(); if (p.on && p.test) writePref({ ...p, test: 0 }) } // le rappel de test est passé : il n'est plus reprogrammé
    return { ok: true, armed: (r as { armed: number }).armed, at: lastAt }
  } catch (e) { return { ok: false, why: fromCloud(e) } }
}

// ---------------------------------------------------------------- activer, tester, désactiver
/**
 * Active les rappels application fermée sur cet appareil : abonnement du navigateur, enregistrement auprès du service, première programmation. À appeler depuis un geste de la personne,
 * après l'autorisation des notifications du système (l'accord « Notifications » et « Compte en ligne » doivent être donnés). Le repère « activé » n'est écrit qu'une fois l'abonnement enregistré par le service.
 */
export async function enable(title: boolean): Promise<Run> {
  const c = check()
  if (!c.ok) return c
  let created: PushSubscription | null = null
  try {
    const cfg = await getConfig()
    if (!cfg.ok) return { ok: false, why: 'config' }
    if (!cfg.cfg.vapid) return { ok: false, why: 'vapid' }
    const reg = await worker(); if (!reg) return { ok: false, why: 'worker' }
    let got: Awaited<ReturnType<typeof subscription>>
    try { got = await subscription(reg, cfg.cfg.vapid) } catch { return { ok: false, why: 'subscribe' } }
    if (got.created) created = got.sub
    if (!keysOf(got.sub)) { await got.sub.unsubscribe().catch(() => false); return { ok: false, why: 'subscribe' } }
    await rpc('bl_push_register', { p_ep: got.sub.endpoint })
    registered = got.sub.endpoint
    created = null // enregistré : l'abonnement est gardé
  } catch (e) {
    if (created) await created.unsubscribe().catch(() => false) // le service n'a pas été prévenu : on ne garde pas d'abonnement orphelin
    return { ok: false, why: fromCloud(e) }
  }
  writePref({ on: true, title, test: 0 })
  lastKey = ''
  const r = await arm(true)
  start()
  return r
}
/** Change l'affichage du titre (réglage de cet appareil) et reprogramme les rappels aussitôt. */
export async function setTitle(on: boolean): Promise<Run> {
  const p = readPref()
  if (!p.on) return { ok: false, why: 'off' }
  writePref({ ...p, title: on })
  return arm(true)
}
/** Programme une notification de test dans 45 secondes environ (elle part au prochain passage du planificateur du serveur). */
export async function sendTest(): Promise<Run & { when?: number }> {
  const p = readPref()
  if (!p.on) return { ok: false, why: 'off' }
  const when = Date.now() + TEST_LEAD_MS
  writePref({ ...p, test: when })
  const r = await arm(true)
  if (!r.ok) writePref({ ...readPref(), test: 0 })
  return r.ok ? { ...r, when } : r
}

/** Sort de la désactivation : 'none' (rien n'était activé), 'removed' (le service a confirmé la suppression de l'abonnement et des rappels), 'failed' (non confirmé : l'abonnement est supprimé ici, le service le constatera de lui-même). */
export type Off = 'none' | 'removed' | 'failed'
/**
 * Désactive les rappels application fermée sur cet appareil : le repère local est effacé tout de suite, puis le service est prévenu (avant que la session soit retirée), puis l'abonnement du navigateur est supprimé.
 * Hors ligne ou déconnecté, le service ne peut pas être prévenu : ses rappels en attente sont alors supprimés par lui dès que le service de notification du navigateur dit que l'abonnement n'existe plus.
 */
export async function disable(): Promise<Off> {
  const was = readPref().on
  stop(); writePref({ ...NONE })
  let sub: PushSubscription | null = null
  try { const reg = await navigator.serviceWorker?.getRegistration(); sub = (await reg?.pushManager.getSubscription()) ?? null } catch { /* pas d'abonnement lisible */ }
  if (!was && !sub) return 'none'
  let res: Off = 'removed'
  if (sub) {
    if (getSession()) { try { await rpc('bl_push_unregister', { p_ep: sub.endpoint }) } catch { res = 'failed' } } else res = 'failed'
    try { await sub.unsubscribe() } catch { res = 'failed' }
  } else if (was) res = 'failed' // activé mais plus d'abonnement lisible ici : le service garde peut-être un reste que cet appareil ne sait plus nommer (ou ne peut pas joindre sans connexion)
  return res
}
/** Efface tout ce que cet appareil sait des rappels application fermée, sans prévenir le service (compte supprimé : le service a tout effacé de son côté). */
export async function clearLocal(): Promise<void> {
  stop(); writePref({ ...NONE })
  try { const reg = await navigator.serviceWorker?.getRegistration(); await (await reg?.pushManager.getSubscription())?.unsubscribe() } catch { /* ignoré */ }
}

// ---------------------------------------------------------------- état affiché dans l'application
/** Ce que le service garde pour cet appareil : abonnements du compte, rappels en attente, dernier passage du planificateur (ms, ou null s'il n'a jamais tourné) et écart d'horloge appareil/service (ms). */
export type Status = { ok: true; subs: number; pending: number; tick: number | null; skew: number } | { ok: false; why: Why }
const STATUS = V.obj({ subs: V.int(0, 1000), pending: V.int(0, 100000), tick: V.nul(V.stamp), now: V.stamp })
export async function status(): Promise<Status> {
  if (!getSession()) return { ok: false, why: 'signin' }
  try {
    const t0 = Date.now(), j = await rpc<unknown>('bl_push_status')
    if (STATUS(j, 'bl_push_status') !== null) return { ok: false, why: 'server' }
    const o = j as { subs: number; pending: number; tick: string | null; now: string }
    return { ok: true, subs: o.subs, pending: o.pending, tick: o.tick === null ? null : Date.parse(o.tick), skew: Date.parse(o.now) - (t0 + Date.now()) / 2 }
  } catch (e) { return { ok: false, why: fromCloud(e) } }
}
/** L'abonnement du navigateur existe-t-il encore ? null si cela ne peut pas être lu. */
export async function subscribed(): Promise<boolean | null> {
  try { const reg = await navigator.serviceWorker?.getRegistration(); return reg ? (await reg.pushManager.getSubscription()) !== null : false } catch { return null }
}

// ---------------------------------------------------------------- déclencheurs automatiques (appelés par cloudhook.ts)
const TOUCH_MS = 2000
let timer: ReturnType<typeof setTimeout> | null = null, started = false
const onVis = () => { if (!document.hidden) touch() }
const onNet = () => touch()
/** À appeler après chaque enregistrement local : reprogramme les rappels une fois la saisie calme (rien n'est envoyé si la liste des rappels n'a pas changé). */
export function touch(delay = TOUCH_MS): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void arm() }, delay)
}
/** Démarre les déclencheurs (retour au premier plan, réseau retrouvé, données remplacées par la synchronisation) et un premier tour peu après l'ouverture. */
export function start(): void {
  if (started) return
  started = true
  document.addEventListener('visibilitychange', onVis); addEventListener('online', onNet); addEventListener('believe:reload', onNet)
  touch(3000)
}
export function stop(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (started) { document.removeEventListener('visibilitychange', onVis); removeEventListener('online', onNet); removeEventListener('believe:reload', onNet); started = false }
  lastKey = ''; lastAt = 0; registered = null
}
