// Imitation (TESTS SEULEMENT, jamais dans l'application) du service en ligne :
//   • passerelle d'authentification : Google simulé, flux PKCE vérifié (empreinte SHA-256), codes à usage unique, jetons qui expirent, renouvellement à usage unique, déconnexion ;
//   • API de fonctions (« /rest/v1/rpc/<nom> ») sur une VRAIE base PostgreSQL (PGlite) qui a reçu supabase/schema.sql ;
//   • /api/cloud-config comme le ferait la fonction du serveur.
// Elle refuse ce que le vrai service refuse : clé absente, clé publique envoyée comme jeton « Bearer », jeton expiré ou inconnu.
import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, freshDb, reset, rpc as sqlRpc } from './testsql'
import type { Role } from './testsql'

export const REF = 'testprojectref12345'
export const ORIGIN = 'https://' + REF + '.supabase.co'
export const KEY = 'sb_publishable_A1b2C3d4E5f6G7h8I9j0K1l2M3n4'
export const SECRET = 'sb_secret_Z9y8X7w6V5u4T3s2R1q0P9o8N7m6'
export const VAPID = 'B' + 'A'.repeat(86)
const b64u = (b: Buffer) => b.toString('base64url')

export interface Call { method: string; path: string; fn?: string; auth: string | null; apikey: string | null; body: unknown }
interface Tok { uid: string; sid: string; exp: number }

export class FakeCloud {
  /** Valeur renvoyée par /api/cloud-config ; modifiable (ex. { ok: false, missing: [...] }). */
  config: Record<string, unknown> = FakeCloud.defaultConfig()
  static defaultConfig(): Record<string, unknown> { return { ok: true, url: ORIGIN, key: KEY, vapid: VAPID, warn: [] } }
  /** Hors ligne : toute requête échoue comme un réseau coupé. */
  offline = false
  /** Pannes à injecter : la prochaine requête dont le chemin contient `match` reçoit ce statut. */
  failNext: { match: string; status: number; body?: unknown } | null = null
  readonly calls: Call[] = []
  readonly users = new Map<string, string>()
  private codes = new Map<string, { ch: string; uid: string; until: number }>()
  private refresh = new Map<string, { uid: string; sid: string; used: boolean }>()
  private access = new Map<string, Tok>()
  private sessions = new Set<string>()
  /** Durée de vie d'un jeton d'accès (secondes). */
  ttl = 3600

  constructor(readonly db: PGlite) {}
  static async create() { return new FakeCloud(await freshDb()) }
  async reset() { await reset(this.db); this.users.clear(); this.codes.clear(); this.refresh.clear(); this.access.clear(); this.sessions.clear(); this.calls.length = 0; this.offline = false; this.failNext = null; this.ttl = 3600; this.config = FakeCloud.defaultConfig() }

  /** Identifiant du compte pour cette adresse (créé à la première connexion). */
  async user(email: string): Promise<string> {
    let id = this.users.get(email)
    if (!id) { id = await addUser(this.db, email); this.users.set(email, id) }
    return id
  }
  /** Google simulé : la personne `email` accepte la connexion ; renvoie l'adresse de retour de l'application (avec le code à usage unique). */
  async google(authorizeUrl: string, email = 'ada@example.org'): Promise<string> {
    const u = new URL(authorizeUrl)
    if (u.origin + u.pathname !== ORIGIN + '/auth/v1/authorize') throw new Error('adresse de connexion inattendue : ' + u.origin + u.pathname)
    if (u.searchParams.get('provider') !== 'google') throw new Error('fournisseur inattendu')
    if (u.searchParams.get('code_challenge_method') !== 's256') throw new Error('méthode PKCE inattendue : ' + u.searchParams.get('code_challenge_method'))
    const ch = u.searchParams.get('code_challenge') ?? '', back = u.searchParams.get('redirect_to') ?? ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(ch)) throw new Error('code_challenge invalide : ' + ch)
    const r = new URL(back)
    const code = randomBytes(18).toString('base64url')
    this.codes.set(code, { ch, uid: await this.user(email), until: Date.now() + 5 * 60_000 })
    r.searchParams.set('code', code)
    return r.href
  }
  /** Expire immédiatement tous les jetons d'accès émis (les jetons de renouvellement restent valables). */
  expireAccess() { for (const t of this.access.values()) t.exp = Date.now() - 1000 }
  /** Révoque la session de cet utilisateur (comme un « se déconnecter partout » fait ailleurs). */
  revokeAll() { this.sessions.clear() }

  private issue(uid: string, sid: string) {
    const exp = Date.now() + this.ttl * 1000, at = 'eyJhbGciOiJIUzI1NiJ9.' + b64u(Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', sid }))) + '.' + randomBytes(12).toString('base64url')
    const rt = randomBytes(9).toString('base64url')
    this.access.set(at, { uid, sid, exp }); this.refresh.set(rt, { uid, sid, used: false })
    const email = [...this.users.entries()].find(([, id]) => id === uid)?.[0] ?? null
    return { access_token: at, token_type: 'bearer', expires_in: this.ttl, expires_at: Math.floor(exp / 1000), refresh_token: rt, user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'google', providers: ['google'] } } }
  }
  private json(status: number, body: unknown): Response {
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
  }

  /** Le « fetch » à installer dans l'application de test. */
  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, 'https://app.example.org')
    const h = new Headers(init.headers), method = (init.method ?? 'GET').toUpperCase()
    let body: unknown = null
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body) } catch { body = init.body } }
    const call: Call = { method, path: url.pathname + url.search, auth: h.get('authorization'), apikey: h.get('apikey'), body }
    if (url.pathname.startsWith('/rest/v1/rpc/')) call.fn = url.pathname.slice('/rest/v1/rpc/'.length)
    this.calls.push(call)
    if (this.offline) throw new TypeError('Failed to fetch')
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (this.failNext && call.path.includes(this.failNext.match)) { const f = this.failNext; this.failNext = null; return this.json(f.status, f.body ?? { message: 'panne simulée' }) }

    if (url.origin === 'https://app.example.org' || url.pathname === '/api/cloud-config') {
      if (url.pathname === '/api/cloud-config' && method === 'GET') return this.json(200, this.config)
      return this.json(404, { error: 'not_found' })
    }
    if (url.origin !== ORIGIN) throw new TypeError('Failed to fetch') // domaine inconnu : la politique de sécurité du site l'aurait bloqué
    const key = h.get('apikey')
    if (key !== KEY && key !== SECRET) return this.json(401, { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' })

    if (url.pathname === '/auth/v1/settings' && method === 'GET') return this.json(200, { external: { google: true, email: false }, disable_signup: false })
    if (url.pathname === '/auth/v1/token' && method === 'POST') {
      const grant = url.searchParams.get('grant_type'), b = (body ?? {}) as Record<string, unknown>
      if (grant === 'pkce') {
        const c = typeof b.auth_code === 'string' ? this.codes.get(b.auth_code) : undefined
        if (!c) return this.json(400, { code: 400, error_code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found' })
        this.codes.delete(String(b.auth_code))
        if (c.until < Date.now()) return this.json(400, { code: 400, error_code: 'flow_state_expired', msg: 'invalid flow state, flow state has expired' })
        const v = typeof b.code_verifier === 'string' ? b.code_verifier : ''
        if (v.length < 43 || v.length > 128 || b64u(createHash('sha256').update(v).digest()) !== c.ch) return this.json(400, { code: 400, error_code: 'bad_code_verifier', msg: 'code challenge does not match previously saved code verifier' })
        const sid = randomBytes(6).toString('hex'); this.sessions.add(sid)
        return this.json(200, this.issue(c.uid, sid))
      }
      if (grant === 'refresh_token') {
        const r = typeof b.refresh_token === 'string' ? this.refresh.get(b.refresh_token) : undefined
        if (!r) return this.json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' })
        if (r.used) return this.json(400, { code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' })
        if (!this.sessions.has(r.sid)) return this.json(400, { code: 400, error_code: 'session_not_found', msg: 'Invalid Refresh Token: Session Not Found' })
        r.used = true
        return this.json(200, this.issue(r.uid, r.sid))
      }
      return this.json(400, { code: 400, error_code: 'validation_failed', msg: 'unsupported grant_type' })
    }
    if (url.pathname === '/auth/v1/logout' && method === 'POST') {
      const t = this.access.get((h.get('authorization') ?? '').replace(/^Bearer /, ''))
      if (!t) return this.json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })
      this.sessions.delete(t.sid); return this.json(204, null)
    }
    if (call.fn && method === 'POST') {
      let role: Role = 'anon', sub: string | undefined
      const bearer = (h.get('authorization') ?? '').replace(/^Bearer /i, '')
      if (key === SECRET) role = 'service_role'
      else if (bearer) {
        const t = this.access.get(bearer)
        if (!t) return this.json(401, { code: 'PGRST301', message: 'JWT could not be decoded', details: null, hint: null })
        if (t.exp < Date.now()) return this.json(401, { code: 'PGRST303', message: 'JWT expired', details: null, hint: null })
        if (!this.sessions.has(t.sid)) return this.json(401, { code: 'PGRST301', message: 'session revoked', details: null, hint: null })
        role = 'authenticated'; sub = t.uid
      }
      const r = await sqlRpc(this.db, call.fn, (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>, { role, sub })
      return this.json(r.status, r.body)
    }
    return this.json(404, { message: 'not found' })
  }
}
