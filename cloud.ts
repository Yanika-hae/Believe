// Compte en ligne (Supabase) — client minimal, sans bibliothèque : configuration, connexion Google (flux PKCE), session, appels des fonctions « bl_* » de supabase/schema.sql.
// Tout ici est FACULTATIF et soumis à l'accord « Compte en ligne » (consents.cloud) : ce module ne le lit pas, ce sont les écrans, la synchronisation et les cercles qui l'exigent.
// Aucune donnée personnelle n'est écrite dans les journaux ; la session (jeton) est chiffrée avec les autres données quand le chiffrement par le PIN est actif (secret.ts).
import { b64u } from './b64'
import { AUTH, getSecret, setSecret } from './secret'

// ---------------------------------------------------------------- configuration publique (fournie par /api/cloud-config)
export interface Cfg { url: string; key: string; vapid: string | null }
export type CfgFail = 'missing' | 'invalid' | 'offline' | 'unavailable'
export type CfgRes = { ok: true; cfg: Cfg } | { ok: false; why: CfgFail; list: string[] }

/** Adresse d'un projet Supabase (la seule que la politique de sécurité du site autorise). */
export const URL_RE = /^https:\/\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$/
const PUBLISHABLE_RE = /^sb_publishable_[A-Za-z0-9_-]{16,}$/
const VAPID_RE = /^[A-Za-z0-9_-]{87}$/
/** 'ok' : clé faite pour être publique ; 'secret' : clé secrète ; 'bad' : forme inconnue. Même règle que api/cloud-config.ts (contrôlée par un test). */
export const keyKind = (k: string): 'ok' | 'secret' | 'bad' => {
  if (/^sb_secret_/i.test(k)) return 'secret'
  if (PUBLISHABLE_RE.test(k)) return 'ok'
  const p = k.split('.')
  if (p.length === 3 && p.every(x => /^[A-Za-z0-9_-]+$/.test(x))) {
    try {
      const t = p[1].replace(/-/g, '+').replace(/_/g, '/'), r = JSON.parse(atob(t + '='.repeat((4 - (t.length % 4)) % 4)))?.role
      if (r === 'anon') return 'ok'
      if (r === 'service_role' || r === 'supabase_admin' || r === 'postgres') return 'secret'
    } catch { /* pas un JWT lisible */ }
  }
  return 'bad'
}

/** Délai maximal d'une requête. */
const timer = (ms: number) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) } }
let cfgCache: Cfg | null = null
export const forgetConfig = () => { cfgCache = null }
/** Lit la configuration du serveur (une fois par session de page). Ne dit jamais « configuré » sans avoir revérifié la forme de l'adresse et de la clé. */
export async function getConfig(force = false): Promise<CfgRes> {
  if (cfgCache && !force) return { ok: true, cfg: cfgCache }
  const t = timer(8000)
  let r: Response
  try { r = await fetch('/api/cloud-config', { cache: 'no-store', signal: t.signal }) } catch { return { ok: false, why: 'offline', list: [] } } finally { t.done() }
  let j: Record<string, unknown> | null = null
  if (r.ok && /json/i.test(r.headers.get('content-type') ?? '')) { try { j = (await r.json()) as Record<string, unknown> } catch { j = null } }
  if (!j || typeof j !== 'object') return { ok: false, why: 'unavailable', list: [] }
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 6) : [])
  if (j.ok !== true) { const miss = strs(j.missing), bad = strs(j.invalid); return { ok: false, why: bad.length ? 'invalid' : 'missing', list: [...miss, ...bad] } }
  const url = typeof j.url === 'string' ? j.url : '', key = typeof j.key === 'string' ? j.key : ''
  if (!URL_RE.test(url) || keyKind(key) !== 'ok') return { ok: false, why: 'invalid', list: ['réponse de /api/cloud-config'] }
  cfgCache = { url, key, vapid: typeof j.vapid === 'string' && VAPID_RE.test(j.vapid) ? j.vapid : null }
  return { ok: true, cfg: cfgCache }
}

// ---------------------------------------------------------------- erreurs
/**
 * Erreur d'un appel au service en ligne. `code` : 'auth' (session absente ou refusée), 'net' (hors ligne / délai), 'server' (erreur du service), 'config' (service non configuré),
 * 'schema' (le script supabase/schema.sql n'est pas (ou plus) installé), 'rate' (trop d'appels), ou le code d'une règle de la base : rev, blob, big, name, display, limit,
 * circle, member, owner, share, card, invite, full, ep, items, arg.
 */
export class CloudError extends Error {
  constructor(public code: string, public status = 0) { super(code) }
}

// ---------------------------------------------------------------- session
export interface Session { at: string; rt: string; exp: number; uid: string; email: string | null }
const okSession = (o: unknown): o is Session => {
  const s = o as Session
  return !!s && typeof s === 'object' && typeof s.at === 'string' && s.at.length > 0 && typeof s.rt === 'string' && s.rt.length > 0 && Number.isFinite(s.exp)
    && typeof s.uid === 'string' && /^[0-9a-f-]{36}$/i.test(s.uid) && (s.email === null || typeof s.email === 'string')
}
/** Session gardée en mémoire quand le stockage refuse l'écriture (le jeton renouvelé ne doit jamais être perdu pendant que la page reste ouverte). */
let mem: Session | null = null
/** Session enregistrée, ou null (absente, illisible, ou chiffrée pendant que l'application est verrouillée). */
export function getSession(): Session | null {
  if (mem) return mem // plus récente que celle du stockage (voir putSession)
  const r = getSecret(AUTH)
  if (r) { try { const o = JSON.parse(r); if (okSession(o)) return o } catch { /* illisible */ } }
  return null
}
export const signedIn = () => getSession() !== null
function putSession(s: Session | null): boolean {
  mem = s
  const ok = setSecret(AUTH, s ? JSON.stringify(s) : '')
  if (!s || ok) mem = null // enregistré (ou effacé) : plus besoin de la copie en mémoire
  return ok
}
/** Efface de la mémoire de la page toute session non enregistrée (à appeler au verrouillage). */
export const forgetMemory = () => { mem = null }

// ---------------------------------------------------------------- appels d'authentification
const HDR = { 'Content-Type': 'application/json;charset=UTF-8', 'X-Supabase-Api-Version': '2024-01-01' }
type AuthRes = { ok: true; j: Record<string, unknown> } | { ok: false; kind: 'net' | 'denied' | 'server'; status: number }
/** Appel d'authentification : seule la clé publique est envoyée (en-tête « apikey »), jamais comme jeton « Bearer ». */
async function authCall(cfg: Cfg, path: string, body: object | null, bearer?: string): Promise<AuthRes> {
  const t = timer(15000)
  let r: Response
  try {
    r = await fetch(cfg.url + path, { method: 'POST', headers: { apikey: cfg.key, ...HDR, ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: t.signal })
  } catch { return { ok: false, kind: 'net', status: 0 } } finally { t.done() }
  let j: Record<string, unknown> = {}
  try { j = (await r.json()) as Record<string, unknown> } catch { /* corps vide */ }
  if (r.ok) return { ok: true, j }
  return { ok: false, kind: r.status >= 500 || r.status === 429 ? 'server' : 'denied', status: r.status }
}
function toSession(j: Record<string, unknown>): Session | null {
  const u = j.user as { id?: unknown; email?: unknown } | undefined, exp = Number(j.expires_in)
  if (typeof j.access_token !== 'string' || typeof j.refresh_token !== 'string' || !Number.isFinite(exp) || typeof u?.id !== 'string') return null
  const s: Session = { at: j.access_token, rt: j.refresh_token, exp: Date.now() + exp * 1000, uid: u.id, email: typeof u.email === 'string' ? u.email.slice(0, 200) : null }
  return okSession(s) ? s : null
}

// ---------------------------------------------------------------- connexion Google (PKCE)
export const PENDING = 'believe:auth-pending'
const PENDING_MS = 15 * 60_000
/**
 * Prépare la connexion Google : tire un secret à usage unique (code_verifier, gardé sur l'appareil), en publie l'empreinte (code_challenge) et renvoie l'adresse où envoyer la personne.
 * Le service d'authentification la renvoie ensuite vers `redirectTo` avec un code à usage unique, qui ne vaut rien sans ce secret.
 */
export async function beginSignIn(redirectTo: string): Promise<{ ok: true; url: string } | { ok: false; why: CfgFail | 'store' | 'crypto' }> {
  const c = await getConfig()
  if (!c.ok) return { ok: false, why: c.why }
  let v: string, ch: string
  try {
    v = b64u(crypto.getRandomValues(new Uint8Array(48)))
    ch = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))
  } catch { return { ok: false, why: 'crypto' } }
  try { localStorage.setItem(PENDING, JSON.stringify({ v, t: Date.now() })) } catch { return { ok: false, why: 'store' } }
  const u = new URL(c.cfg.url + '/auth/v1/authorize')
  u.searchParams.set('provider', 'google'); u.searchParams.set('redirect_to', redirectTo); u.searchParams.set('code_challenge', ch); u.searchParams.set('code_challenge_method', 's256')
  return { ok: true, url: u.href }
}

export type Back = { kind: 'none' } | { kind: 'code'; code: string } | { kind: 'error'; msg: string }
/** Ce que l'adresse de la page dit d'un retour de connexion : un code (succès), une erreur du service, ou rien. Lit la requête et le fragment (selon le flux, l'erreur est dans l'un ou l'autre). */
export function readBack(href: string): Back {
  let u: URL
  try { u = new URL(href) } catch { return { kind: 'none' } }
  const frag = /^#[^/]*=/.test(u.hash) ? new URLSearchParams(u.hash.slice(1)) : null
  for (const p of [u.searchParams, frag]) {
    if (!p) continue
    const err = p.get('error_description') ?? p.get('error')
    if (p.get('error') || p.get('error_code')) return { kind: 'error', msg: (err ?? 'refusé').replace(/\+/g, ' ').slice(0, 200) }
    const code = p.get('code')
    if (code && /^[A-Za-z0-9._~-]{8,300}$/.test(code)) return { kind: 'code', code }
  }
  return { kind: 'none' }
}
/** Retire le code / l'erreur de la barre d'adresse (ils ne doivent ni rester visibles ni être rejoués) et ouvre la page voulue. */
export function cleanBack(hash: string): void {
  try { history.replaceState(null, '', location.pathname + hash) } catch { /* barre d'adresse inchangée */ }
}

/** Navigation vers une autre page (remplaçable dans les tests : le faux navigateur ne sait pas quitter la page). */
export const nav = { assign: (u: string) => { location.assign(u) } }
/** Envoie la personne vers la connexion Google (accord « Compte en ligne » déjà donné par l'écran qui appelle). */
export async function startGoogle(): Promise<{ ok: true } | { ok: false; why: CfgFail | 'store' | 'crypto' }> {
  const r = await beginSignIn(location.origin + '/')
  if (!r.ok) return r
  nav.assign(r.url)
  return { ok: true }
}

export type SignInFail = 'nopending' | 'expired' | 'denied' | 'net' | 'server' | 'config' | 'store'
/** Échange le code reçu contre une session (le secret gardé à l'aller prouve que c'est bien cet appareil qui a demandé la connexion). */
export async function finishSignIn(code: string): Promise<{ ok: true; session: Session } | { ok: false; why: SignInFail }> {
  let p: { v?: unknown; t?: unknown } | null = null
  try { p = JSON.parse(localStorage.getItem(PENDING) ?? 'null') } catch { p = null }
  if (!p || typeof p.v !== 'string' || typeof p.t !== 'number') return { ok: false, why: 'nopending' }
  if (Date.now() - p.t > PENDING_MS) { try { localStorage.removeItem(PENDING) } catch { /* ignoré */ } return { ok: false, why: 'expired' } }
  const c = await getConfig()
  if (!c.ok) return { ok: false, why: 'config' }
  const r = await authCall(c.cfg, '/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: p.v })
  try { localStorage.removeItem(PENDING) } catch { /* ignoré */ } // le code est à usage unique : le secret ne sert plus, réussite ou non
  if (!r.ok) return { ok: false, why: r.kind === 'net' ? 'net' : r.kind === 'server' ? 'server' : 'denied' }
  const s = toSession(r.j)
  if (!s) return { ok: false, why: 'denied' }
  if (!putSession(s)) return { ok: false, why: 'store' }
  return { ok: true, session: s }
}

// ---------------------------------------------------------------- jeton d'accès (renouvelé avant son expiration)
let chain: Promise<unknown> = Promise.resolve()
/** Un seul renouvellement à la fois, même entre plusieurs onglets (un jeton de renouvellement ne sert qu'une fois). */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const L = (typeof navigator !== 'undefined' ? (navigator as unknown as { locks?: { request: (n: string, f: () => Promise<T>) => Promise<T> } }).locks : undefined)
  if (L?.request) return L.request('believe-auth', fn)
  const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p
}
const SKEW = 60_000
/** Jeton d'accès valable (renouvelé s'il expire dans moins d'une minute, ou si `force`) ; null s'il n'y a pas de session. Lève CloudError si le renouvellement échoue. */
export async function accessToken(force = false): Promise<string | null> {
  const first = getSession()
  if (!first) return null
  if (!force && first.exp - Date.now() > SKEW) return first.at
  return exclusive(async () => {
    const cur = getSession()
    if (!cur) return null
    if (!force && cur.exp - Date.now() > SKEW) return cur.at // un autre onglet vient de le renouveler
    if (force && cur.at !== first.at && cur.exp - Date.now() > SKEW) return cur.at
    const c = await getConfig()
    if (!c.ok) throw new CloudError('config')
    const r = await authCall(c.cfg, '/auth/v1/token?grant_type=refresh_token', { refresh_token: cur.rt })
    if (!r.ok) {
      if (r.kind === 'denied') { putSession(null); throw new CloudError('auth', r.status) } // session révoquée ou trop ancienne : il faut se reconnecter
      throw new CloudError(r.kind, r.status)
    }
    const s = toSession(r.j)
    if (!s) throw new CloudError('server')
    putSession(s)
    return s.at
  })
}

// ---------------------------------------------------------------- appels des fonctions du service (supabase/schema.sql)
/**
 * Appelle la fonction `fn` (nom « bl_… ») avec des paramètres nommés « p_… ». `anon` : sans session (seule bl_ping l'autorise).
 * Une réponse 401 déclenche UN renouvellement forcé du jeton puis UN seul nouvel essai. Les erreurs de la base arrivent sous la forme CloudError('<règle>').
 */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}, anon = false): Promise<T> {
  if (!/^bl_[a-z_]+$/.test(fn)) throw new CloudError('arg')
  const c = await getConfig()
  if (!c.ok) throw new CloudError('config')
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = anon ? null : await accessToken(attempt > 0)
    if (!anon && !tok) throw new CloudError('auth')
    const t = timer(20000)
    let r: Response
    try {
      r = await fetch(c.cfg.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: c.cfg.key, 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(args), signal: t.signal })
    } catch { throw new CloudError('net') } finally { t.done() }
    if (r.status === 401 && attempt === 0 && !anon) continue
    let j: unknown = null
    try { j = await r.json() } catch { /* corps vide ou illisible */ }
    if (r.ok) return j as T
    const o = (j && typeof j === 'object' ? j : {}) as { message?: unknown; code?: unknown }, msg = typeof o.message === 'string' ? o.message : ''
    if (msg.startsWith('bl:')) throw new CloudError(msg.slice(3), r.status)
    if (o.code === 'PGRST202' || r.status === 404) throw new CloudError('schema', r.status)
    if (r.status === 401 || r.status === 403) throw new CloudError('auth', r.status)
    if (r.status === 429) throw new CloudError('rate', r.status)
    throw new CloudError('server', r.status)
  }
  throw new CloudError('auth', 401)
}

/** État de l'installation du script SQL (sans session). */
export const ping = () => rpc<{ v: number; now: string; auth: boolean }>('bl_ping', {}, true)

/** Déconnexion de cet appareil : le service est prévenu si possible (sans effet sur les autres appareils), la session locale est effacée dans tous les cas. */
export async function signOut(): Promise<void> {
  const s = getSession()
  if (s) {
    const c = await getConfig()
    if (c.ok) await authCall(c.cfg, '/auth/v1/logout?scope=local', null, s.at)
  }
  putSession(null)
  try { localStorage.removeItem(PENDING) } catch { /* ignoré */ }
}
/** Efface la session sans prévenir le service (compte supprimé, ou accord retiré hors ligne). */
export function dropSession(): void {
  putSession(null)
  try { localStorage.removeItem(PENDING) } catch { /* ignoré */ }
}

/**
 * Au retour de Google : si l'adresse de la page porte un code ou une erreur, l'échange et la nettoie. À appeler une fois l'application déverrouillée et SEULEMENT si l'accord « Compte en ligne »
 * est donné (sinon l'adresse est simplement nettoyée, voir `discardBack`).
 */
export async function completeFromUrl(): Promise<{ kind: 'none' } | { kind: 'ok'; session: Session } | { kind: 'fail'; why: SignInFail | 'refused'; msg: string }> {
  const b = readBack(location.href)
  if (b.kind === 'none') return b
  cleanBack('#/2/compte')
  if (b.kind === 'error') { try { localStorage.removeItem(PENDING) } catch { /* ignoré */ } return { kind: 'fail', why: 'refused', msg: b.msg } }
  const r = await finishSignIn(b.code)
  return r.ok ? { kind: 'ok', session: r.session } : { kind: 'fail', why: r.why, msg: '' }
}
/** Retour de connexion alors que l'accord n'est pas donné : rien n'est échangé, l'adresse et le secret gardé sont effacés. */
export function discardBack(): void {
  if (readBack(location.href).kind === 'none') return
  cleanBack('#/2/compte')
  try { localStorage.removeItem(PENDING) } catch { /* ignoré */ }
}
