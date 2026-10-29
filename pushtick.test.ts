// @vitest-environment node
// Fonction serveur d'envoi des rappels (api/push-tick.ts) : vraie base PostgreSQL (supabase/schema.sql), faux services de notification, signature VAPID vérifiée avec la clé publique.
import { createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { allowedEndpoint, checkEnv, diag, isSecretKey, loadVapid, readEnv, tick } from '../api/push-tick'
import type { Env } from '../api/push-tick'
import { FakeCloud, KEY, ORIGIN, SECRET } from './fakecloud'
import { rpc as sqlRpc } from './testsql'
import { b64uDec, b64uEnc, encryptPush } from './webpush'

const te = new TextEncoder()
let fake: FakeCloud
beforeAll(async () => { fake = await FakeCloud.create() }, 90_000)
afterAll(async () => { await fake.db.close() })
beforeEach(async () => { await fake.reset() }, 30_000)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

/** Paire de clés VAPID du déploiement, au format des variables d'environnement. */
function vapidEnv(): { env: Env; pub: ReturnType<typeof createPublicKey> } {
  const kp = generateKeyPairSync('ec', { namedCurve: 'P-256' }), j = kp.privateKey.export({ format: 'jwk' }) as { d: string; x: string; y: string }
  const pubRaw = new Uint8Array([4, ...b64uDec(j.x), ...b64uDec(j.y)])
  return { pub: kp.publicKey, env: { SUPABASE_URL: ORIGIN, SUPABASE_SECRET_KEY: SECRET, VAPID_PUBLIC_KEY: b64uEnc(pubRaw), VAPID_PRIVATE_KEY: j.d, VAPID_SUBJECT: 'mailto:contact@exemple.test', CRON_SECRET: 'cron-' + 'x'.repeat(30) } }
}
/** Un abonnement de navigateur imité (les clés servent à fabriquer de vrais messages chiffrés). */
async function message(text: string) {
  const { createECDH } = await import('node:crypto'); const e = createECDH('prime256v1'); e.generateKeys(); const auth = new Uint8Array(randomBytes(16))
  return b64uEnc(await encryptPush(te.encode(text), new Uint8Array(e.getPublicKey()), auth))
}
const sql = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await fake.db.query<T>(q, p)).rows
const as = (sub: string) => ({ role: 'authenticated' as const, sub })
const call = (sub: string, fn: string, args: Record<string, unknown> = {}) => sqlRpc(fake.db, fn, args, as(sub))
/** Un compte avec ses abonnements et ses rappels échus (à l'instant moins une minute). `later` : rappels pas encore échus. */
async function arm(email: string, eps: string[], later = false) {
  const uid = await fake.user(email), refs: Record<string, string> = {}
  for (const ep of eps) {
    expect((await call(uid, 'bl_push_register', { p_ep: ep })).status).toBe(200)
    const body = await message('rappel ' + ep); refs[ep] = body
    expect((await call(uid, 'bl_push_set', { p_ep: ep, p_items: [{ ref: 'r-' + eps.indexOf(ep), at: new Date(Date.now() + (later ? 3600e3 : -60e3)).toISOString(), body }] })).status).toBe(200)
  }
  return { uid, bodies: refs }
}

interface Sent { url: string; headers: Record<string, string>; body: Uint8Array; redirect?: string }
/** Faux service de notification + vrai (faux) Supabase : route chaque requête selon son adresse, dit ce qui a été envoyé. `status` donne la réponse par adresse. */
function world(status: Record<string, number | 'net'> = {}) {
  const sent: Sent[] = []
  const f = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(ORIGIN)) return fake.fetch(url, init)
    const h: Record<string, string> = {}; new Headers(init.headers).forEach((v, k) => { h[k] = v })
    sent.push({ url, headers: h, body: new Uint8Array(init.body as Buffer), redirect: init.redirect })
    const s = status[url] ?? 201
    if (s === 'net') throw new TypeError('fetch failed')
    return new Response(s === 201 ? null : 'x', { status: s })
  }) as unknown as typeof fetch & { mock: unknown }
  return { f: f as typeof fetch, sent }
}
const FCM = (n: string) => 'https://fcm.googleapis.com/fcm/send/' + n
/** Même monde, mais ce que la base remet à la fonction pour « bl_push_claim » est remplacé par `items` : des valeurs que la base ne produit jamais, que la fonction doit pourtant savoir refuser ou borner. */
function claimed(items: unknown, w = world()) {
  const f = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, r = await w.f(input, init)
    return url.endsWith('/rpc/bl_push_claim') ? new Response(JSON.stringify(items), { status: 200, headers: { 'content-type': 'application/json' } }) : r
  }) as unknown as typeof fetch
  return { f, sent: w.sent }
}
/** Même monde, mais la base répond `status` (avec un corps qui aurait l'air d'une réponse valide) à l'appel de la fonction `fn`. */
function failing(fn: string, status: number, w = world()) {
  const f = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return url.endsWith('/rpc/' + fn) ? new Response(fn === 'bl_push_claim' ? '[]' : '{"ok":true}', { status, headers: { 'content-type': 'application/json' } }) : w.f(input, init)
  }) as unknown as typeof fetch
  return { f, sent: w.sent }
}

describe('Configuration', () => {
  it('variables : manquantes, invalides, valides (les noms seulement, jamais les valeurs)', () => {
    const { env } = vapidEnv()
    expect(checkEnv(env)).toEqual({ missing: [], invalid: [] })
    expect(checkEnv(readEnv({}))).toEqual({ missing: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'CRON_SECRET'], invalid: [] })
    const bad = checkEnv({ ...env, SUPABASE_URL: 'http://x.supabase.co', SUPABASE_SECRET_KEY: KEY, VAPID_PUBLIC_KEY: 'AAAA', VAPID_PRIVATE_KEY: b64uEnc(new Uint8Array(31)), VAPID_SUBJECT: 'ada@exemple.test', CRON_SECRET: 'court' })
    expect(bad).toEqual({ missing: [], invalid: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'CRON_SECRET'] })
    expect(checkEnv({ ...env, VAPID_SUBJECT: 'https://exemple.test/contact' })).toEqual({ missing: [], invalid: [] })
    for (const s of ['mailto:', 'mailto:a b@c.d', 'http://exemple.test', 'javascript:alert(1)', 'mailto:@x.y']) expect(checkEnv({ ...env, VAPID_SUBJECT: s }).invalid, s).toEqual(['VAPID_SUBJECT'])
    const r = readEnv({ SUPABASE_URL: ' https://abcdefgh.supabase.co/// ', SUPABASE_SERVICE_ROLE_KEY: ' k ', CRON_SECRET: ' s ' }); expect([r.SUPABASE_URL, r.SUPABASE_SECRET_KEY, r.CRON_SECRET]).toEqual(['https://abcdefgh.supabase.co', 'k', 's'])
  })
  it('la clé du serveur doit être une clé secrète : une clé publique (publishable, anon) est refusée', () => {
    const jwt = (role: string) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.c2ln'
    expect([isSecretKey(SECRET), isSecretKey(KEY), isSecretKey(jwt('service_role')), isSecretKey(jwt('anon')), isSecretKey(jwt('authenticated')), isSecretKey('sb_secret_court'), isSecretKey(''), isSecretKey('a.b.c')]).toEqual([true, false, true, false, false, false, false, false])
  })
})

describe('Configuration : clé publique VAPID', () => {
  it('65 octets exactement, le premier valant 4 (point non compressé) : toute autre forme est refusée, pour la vérification de la configuration comme pour le chargement', async () => {
    const { env } = vapidEnv(), raw = b64uDec(env.VAPID_PUBLIC_KEY!)
    const invalid = (bytes: Uint8Array) => checkEnv({ ...env, VAPID_PUBLIC_KEY: b64uEnc(bytes) }).invalid
    expect(invalid(raw)).toEqual([])
    const wrong: [string, Uint8Array][] = [['66 octets', new Uint8Array([...raw, 1])], ['130 octets', new Uint8Array([...raw, ...raw])], ['64 octets', raw.slice(0, 64)], ['premier octet 2', new Uint8Array([2, ...raw.slice(1)])], ['premier octet 0', new Uint8Array([0, ...raw.slice(1)])], ['premier octet 5', new Uint8Array([5, ...raw.slice(1)])]]
    for (const [why, bytes] of wrong) { expect(invalid(bytes), why).toEqual(['VAPID_PUBLIC_KEY']); await expect(loadVapid({ ...env, VAPID_PUBLIC_KEY: b64uEnc(bytes) }), why).rejects.toThrow('vapid') }
  })
})

describe('Adresses d’abonnement autorisées', () => {
  it('seuls les services de notification des navigateurs, en HTTPS, sans identifiant ni port', () => {
    for (const ok of [FCM('abc'), 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Q', 'https://api.push.apple.com/3/device/x', 'https://par02p.notify.windows.com/w/?token=x', 'https://autopush.push.services.mozilla.com/a']) expect(allowedEndpoint(ok)?.href, ok).toBe(ok)
    for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x', 'https://evil.example/fcm.googleapis.com', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://notfcm.googleapis.com/x', 'https://push.apple.com.evil.example/x', 'https://xpush.apple.com/x', 'https://updates.push.services.mozilla.com.evil.example/x', 'https://autopush.push.services.mozilla.com.evil.example/x', 'https://evil.example/updates.push.services.mozilla.com', 'https://x.notify.windows.com.evil.example/x', 'https://evilnotify.windows.com/x', 'https://evil.example/x.notify.windows.com', 'ftp://fcm.googleapis.com/x', 'fcm.googleapis.com/x', '', 'https://fcm.googleapis.com/' + 'a'.repeat(1000), 'https://fcm.googleapis.com/x#frag']) expect(allowedEndpoint(bad), bad.slice(0, 60)).toBeNull()
  })
})

describe('Clés VAPID', () => {
  it('le jeton signé est vérifiable avec la clé publique : audience, expiration, contact ; une clé privée qui ne correspond pas est refusée', async () => {
    const { env, pub } = vapidEnv(), v = await loadVapid(env), exp = Math.floor(Date.now() / 1000) + 12 * 3600
    const jwt = await v.sign('https://fcm.googleapis.com', exp), [h, c, s] = jwt.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' }); expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp, sub: 'mailto:contact@exemple.test' })
    expect(Buffer.from(s, 'base64url').length).toBe(64); expect(verify('sha256', Buffer.from(h + '.' + c), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true)
    expect(verify('sha256', Buffer.from(h + '.' + c + 'x'), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(false)
    expect(v.pub).toBe(env.VAPID_PUBLIC_KEY)
    await expect(loadVapid({ ...env, VAPID_PRIVATE_KEY: vapidEnv().env.VAPID_PRIVATE_KEY })).rejects.toThrow('vapid')
    await expect(loadVapid({ ...env, VAPID_PUBLIC_KEY: 'AAAA' })).rejects.toThrow('vapid'); await expect(loadVapid({ ...env, VAPID_PRIVATE_KEY: '' })).rejects.toThrow('vapid')
  })
})

describe('Clés VAPID : essai de signature', () => {
  it('même si le moteur de chiffrement ne vérifiait pas, à l’import, que les deux clés vont ensemble, une clé privée étrangère est refusée (signature d’essai vérifiée avec la clé publique)', async () => {
    const { env } = vapidEnv(), real = crypto.subtle.importKey.bind(crypto.subtle) as (...a: unknown[]) => Promise<CryptoKey>
    const stranger = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) as CryptoKeyPair
    const spy = vi.spyOn(crypto.subtle, 'importKey').mockImplementation(((fmt: string, ...rest: unknown[]) => fmt === 'jwk' ? Promise.resolve(stranger.privateKey) : real(fmt, ...rest)) as never)
    await expect(loadVapid(env)).rejects.toThrow('vapid')
    expect(spy.mock.calls.map(c => c[0])).toEqual(['jwk', 'raw'])      // les deux clés ont bien été importées : seul l'essai de signature les a départagées
    spy.mockRestore()
    expect((await loadVapid(env)).pub).toBe(env.VAPID_PUBLIC_KEY)        // le même environnement, avec un moteur normal, est accepté
  })
})

describe('Envoi des rappels échus', () => {
  it('chaque rappel échu part vers son service, tel qu’il a été chiffré, avec une signature valide ; les rappels envoyés disparaissent, les autres restent', async () => {
    const { env, pub } = vapidEnv(), { f, sent } = world()
    const a = await arm('a@exemple.test', [FCM('un'), 'https://updates.push.services.mozilla.com/wpush/v2/deux', 'https://web.push.apple.com/trois'])
    const b = await arm('b@exemple.test', [FCM('quatre')], true) // pas encore échu
    const r = await tick(env, { fetch: f })
    expect(r).toEqual({ claimed: 3, sent: 3, gone: 0, dropped: 0, retry: 0 })
    expect(sent.map(s => s.url).sort()).toEqual([FCM('un'), 'https://updates.push.services.mozilla.com/wpush/v2/deux', 'https://web.push.apple.com/trois'].sort())
    for (const s of sent) {
      expect(Buffer.from(s.body).toString('base64url')).toBe(a.bodies[s.url]); expect(s.redirect).toBe('manual')
      expect(s.headers['content-encoding']).toBe('aes128gcm'); expect(s.headers['content-type']).toBe('application/octet-stream'); expect(s.headers.urgency).toBe('high'); expect(+s.headers.ttl).toBeGreaterThanOrEqual(60); expect(+s.headers.ttl).toBeLessThanOrEqual(86400)
      const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(s.headers.authorization)!; expect(m, s.headers.authorization).toBeTruthy(); expect(m[4]).toBe(env.VAPID_PUBLIC_KEY)
      expect(verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'))).toBe(true)
      const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString()) as { aud: string; exp: number; sub: string }
      expect(claims.aud).toBe(new URL(s.url).origin); expect(claims.exp).toBeGreaterThan(Date.now() / 1000 + 3600); expect(claims.exp).toBeLessThanOrEqual(Date.now() / 1000 + 24 * 3600); expect(claims.sub).toBe('mailto:contact@exemple.test')
      expect(JSON.stringify(s.headers)).not.toMatch(/sb_secret|sb_publishable|a@exemple|b@exemple|bearer|apikey/i) // rien du compte ni de la clé du service ne part vers le service de notification
    }
    expect((await sql('select ref from bl.reminders')).length).toBe(1) // seul le rappel de b, pas échu, reste
    expect((await sql<{ uid: string }>('select uid from bl.reminders'))[0].uid).toBe(b.uid)
    expect((await sql<{ v: string }>("select v from bl.meta where k = 'tick'")).length).toBe(1) // le service sait que le planificateur est passé
    expect(await tick(env, { fetch: f })).toEqual({ claimed: 0, sent: 0, gone: 0, dropped: 0, retry: 0 }); expect(sent.length).toBe(3) // rien n'est renvoyé
  })

  it('les jetons de signature sont réutilisés pour un même service dans un même passage', async () => {
    const { env } = vapidEnv(), { f, sent } = world()
    await arm('a@exemple.test', [FCM('1'), FCM('2'), FCM('3')])
    await tick(env, { fetch: f })
    expect(new Set(sent.map(s => s.headers.authorization)).size).toBe(1)
  })

  it('abonnement disparu (404, 410) : l’abonnement et ses rappels sont supprimés ; refus définitif (400, 403, 413) : rappel supprimé, abonnement gardé', async () => {
    const { env } = vapidEnv(), g = FCM('gone'), n = FCM('notfound'), d4 = FCM('bad'), d3 = FCM('forbidden'), big = FCM('big'), fine = FCM('fine')
    const { f } = world({ [g]: 410, [n]: 404, [d4]: 400, [d3]: 403, [big]: 413 })
    const a = await arm('a@exemple.test', [g, n, d4, d3, big]); await arm('b@exemple.test', [fine])
    expect(await tick(env, { fetch: f })).toEqual({ claimed: 6, sent: 1, gone: 2, dropped: 3, retry: 0 })
    expect((await sql<{ ep: string }>('select ep from bl.pushsubs order by ep')).map(x => x.ep)).toEqual([big, d3, d4, fine].sort())
    expect(await sql('select * from bl.reminders')).toEqual([]); expect(a.uid).toBeTruthy()
  })

  it('pannes passagères (429, 500, 503, redirection, réseau coupé) : le rappel reste, retenté plus tard, quatre essais au plus', async () => {
    const { env } = vapidEnv(), urls = [FCM('429'), FCM('500'), FCM('503'), FCM('302'), FCM('net'), FCM('408')]
    const st: Record<string, number | 'net'> = { [urls[0]]: 429, [urls[1]]: 500, [urls[2]]: 503, [urls[3]]: 302, [urls[4]]: 'net', [urls[5]]: 408 }
    const w = world(st); await arm('a@exemple.test', urls.slice(0, 3)); await arm('b@exemple.test', urls.slice(3))
    expect(await tick(env, { fetch: w.f })).toEqual({ claimed: 6, sent: 0, gone: 0, dropped: 0, retry: 6 })
    expect((await sql<{ tries: number }>('select tries from bl.reminders')).map(x => x.tries)).toEqual([1, 1, 1, 1, 1, 1]); expect((await sql('select * from bl.pushsubs')).length).toBe(6)
    expect(await tick(env, { fetch: w.f })).toEqual({ claimed: 0, sent: 0, gone: 0, dropped: 0, retry: 0 }) // 90 secondes d'attente avant un nouvel essai
    for (let i = 2; i <= 4; i++) { await fake.db.exec("update bl.reminders set nxt = now() - interval '1 second'"); expect((await tick(env, { fetch: w.f })).claimed, 'essai ' + i).toBe(6) }
    await fake.db.exec("update bl.reminders set nxt = now() - interval '1 second'"); expect((await tick(env, { fetch: w.f })).claimed).toBe(0) // quatre essais : abandonné
    expect(w.sent.length).toBe(24)
    st[urls[1]] = 201; await fake.db.exec("update bl.reminders set tries = 1, nxt = now() - interval '1 second'") // le service revient
    expect(await tick(env, { fetch: w.f })).toMatchObject({ claimed: 6, sent: 1, retry: 5 }); expect((await sql('select * from bl.reminders')).length).toBe(5)
  })

  it('adresse inconnue, message illisible ou trop court : jamais envoyés, rappel supprimé', async () => {
    const { env } = vapidEnv(), { f, sent } = world(), uid = await fake.user('a@exemple.test')
    const good = await message('ok')
    for (const [ep, body] of [['https://evil.example/push', good], [FCM('court'), 'QUJD'], [FCM('ok'), good]] as const) {
      await call(uid, 'bl_push_register', { p_ep: ep }); await call(uid, 'bl_push_set', { p_ep: ep, p_items: [{ ref: 'r', at: new Date(Date.now() - 60e3).toISOString(), body }] })
    }
    expect(await tick(env, { fetch: f })).toEqual({ claimed: 3, sent: 1, gone: 0, dropped: 2, retry: 0 }); expect(sent.map(s => s.url)).toEqual([FCM('ok')])
    expect(await sql('select * from bl.reminders')).toEqual([])
  })

  it('taille du message : 103 à 4 096 octets sont envoyés, en dessous ou au-dessus le rappel est supprimé sans envoi', async () => {
    const { env } = vapidEnv(), { f, sent } = world(), uid = await fake.user('a@exemple.test')
    const sized = (n: number) => Buffer.alloc(n, 7).toString('base64url')
    for (const [name, n] of [['max', 4096], ['trop', 4097], ['min', 103], ['sous', 102]] as const) {
      const ep = FCM(name); expect((await call(uid, 'bl_push_register', { p_ep: ep })).status).toBe(200)
      expect((await call(uid, 'bl_push_set', { p_ep: ep, p_items: [{ ref: 'r', at: new Date(Date.now() - 60e3).toISOString(), body: sized(n) }] })).status, name).toBe(200)
    }
    expect(await tick(env, { fetch: f })).toEqual({ claimed: 4, sent: 2, gone: 0, dropped: 2, retry: 0 })
    expect(sent.map(s => s.url).sort()).toEqual([FCM('max'), FCM('min')].sort()); expect(sent.find(s => s.url === FCM('max'))!.body.length).toBe(4096)
    expect(await sql('select * from bl.reminders')).toEqual([])
  })

  it('durée de vie annoncée au service de notification : de 60 secondes à un jour, quelle que soit la valeur reçue', async () => {
    const { env } = vapidEnv(), body = await message('x')
    const cases: [number, string][] = [[-5, '60'], [0, '60'], [5, '60'], [59, '60'], [60, '60'], [61, '61'], [3600, '3600'], [86399, '86399'], [86400, '86400'], [86401, '86400'], [10_000_000, '86400']]
    const { f, sent } = claimed(cases.map(([ttl], i) => ({ id: i + 1, ep: FCM('t' + i), body, ttl })))
    expect(await tick(env, { fetch: f })).toEqual({ claimed: cases.length, sent: cases.length, gone: 0, dropped: 0, retry: 0 })
    for (const [i, [ttl, header]] of cases.entries()) expect(sent.find(s => s.url === FCM('t' + i))!.headers.ttl, 'reçu ' + ttl).toBe(header)
  })

  it('durée de vie venant de la base : douze heures après l’heure prévue, jamais moins de 60 secondes', async () => {
    const { env } = vapidEnv(), { f, sent } = world(), uid = await fake.user('a@exemple.test'), body = await message('x')
    for (const [name, ago] of [['recent', 60], ['vieux', 23 * 3600]] as const) {
      const ep = FCM(name); await call(uid, 'bl_push_register', { p_ep: ep }); await call(uid, 'bl_push_set', { p_ep: ep, p_items: [{ ref: 'r', at: new Date(Date.now() - 5e3).toISOString(), body }] })
      await fake.db.query("update bl.reminders set at = now() - ($1 || ' seconds')::interval where ep = $2", [String(ago), ep])
    }
    expect((await tick(env, { fetch: f })).sent).toBe(2)
    const ttl = (n: string) => +sent.find(s => s.url === FCM(n))!.headers.ttl
    expect(ttl('recent')).toBeGreaterThan(43_000); expect(ttl('recent')).toBeLessThanOrEqual(43_200 - 59)   // 12 h moins la minute écoulée
    expect(ttl('vieux')).toBe(60)                                                                               // échéance dépassée depuis 23 h : le minimum
  })

  it('un rappel de plus d’un jour n’est jamais envoyé : supprimé au passage suivant du planificateur', async () => {
    const { env } = vapidEnv(), { f, sent } = world(); await arm('a@exemple.test', [FCM('1'), FCM('2')])
    await fake.db.exec("update bl.reminders set at = now() - interval '25 hours' where ep = '" + FCM('1') + "'")
    expect(await tick(env, { fetch: f })).toEqual({ claimed: 1, sent: 1, gone: 0, dropped: 0, retry: 0 }); expect(sent.map(s => s.url)).toEqual([FCM('2')])
    expect(await sql('select * from bl.reminders')).toEqual([]); expect((await sql('select * from bl.pushsubs')).length).toBe(2)   // l'abonnement, lui, reste
  })

  it('seuls des abonnements disparus (aucun envoi réussi) : ils sont tout de même supprimés, avec leurs rappels', async () => {
    const { env } = vapidEnv(), g = FCM('gone'), { f } = world({ [g]: 410 })
    await arm('a@exemple.test', [g])
    expect(await tick(env, { fetch: f })).toEqual({ claimed: 1, sent: 0, gone: 1, dropped: 0, retry: 0 })
    expect(await sql('select * from bl.pushsubs')).toEqual([]); expect(await sql('select * from bl.reminders')).toEqual([])
    expect(fake.calls.filter(c => c.fn === 'bl_push_done').map(c => c.body)).toEqual([{ p_ok: [], p_gone: [g] }])
  })

  it('éléments mal formés remis par la base : jamais envoyés ni supprimés, comptés parmi les envois à retenter ; les bons partent', async () => {
    const { env } = vapidEnv(), body = await message('x'), good = { id: 1, ep: FCM('bon'), body, ttl: 3600 }
    const bad: unknown[] = [null, 42, 'texte', [], {}, { ...good, id: 1.5 }, { ...good, id: '7' }, { ...good, ep: 5 }, { ...good, body: 7 }, { ...good, ttl: '60' }, { ...good, ttl: 1e300 }, { id: 8, ep: FCM('x') }]
    const { f, sent } = claimed([...bad.slice(0, 6), good, ...bad.slice(6)])
    expect(await tick(env, { fetch: f })).toEqual({ claimed: bad.length + 1, sent: 1, gone: 0, dropped: 0, retry: bad.length })
    expect(sent.map(s => s.url)).toEqual([FCM('bon')])
    expect(fake.calls.filter(c => c.fn === 'bl_push_done').map(c => c.body)).toEqual([{ p_ok: [1], p_gone: [] }])      // seul le bon est déclaré envoyé
  })

  it('la base répond par une erreur, même avec un corps qui aurait l’air valide : l’appel échoue (prise des rappels comme clôture)', async () => {
    const { env } = vapidEnv(); await arm('a@exemple.test', [FCM('1')])
    await expect(tick(env, { fetch: failing('bl_push_claim', 500).f })).rejects.toThrow('service')
    await expect(tick(env, { fetch: failing('bl_push_claim', 401).f })).rejects.toThrow('service')
    expect((await sql<{ tries: number }>('select tries from bl.reminders'))[0].tries).toBe(0)                           // rien n'a été pris
    await expect(tick(env, { fetch: failing('bl_push_done', 503).f })).rejects.toThrow('service')                    // clôture refusée : le planificateur doit le savoir
  })

  it('beaucoup de rappels : 40 au plus par passage, le reste au passage suivant ; temps écoulé : le reste est retenté plus tard', async () => {
    const { env } = vapidEnv(), { f, sent } = world(), body = await message('x')
    // le service ne garde que 5 abonnements par compte : 45 rappels sont répartis sur 9 comptes
    for (let u = 0; u < 9; u++) { const id = await fake.user('u' + u + '@exemple.test'); for (let i = 0; i < 5; i++) { const ep = FCM('u' + u + 'n' + i); await call(id, 'bl_push_register', { p_ep: ep }); await call(id, 'bl_push_set', { p_ep: ep, p_items: [{ ref: 'r', at: new Date(Date.now() - 60e3).toISOString(), body }] }) } }
    expect((await tick(env, { fetch: f })).claimed).toBe(40); expect(sent.length).toBe(40); expect((await tick(env, { fetch: f })).claimed).toBe(5)
    await fake.reset(); const id = await fake.user('z@exemple.test'); for (let i = 0; i < 3; i++) { const ep = FCM('z' + i); await call(id, 'bl_push_register', { p_ep: ep }); await call(id, 'bl_push_set', { p_ep: ep, p_items: [{ ref: 'r', at: new Date(Date.now() - 60e3).toISOString(), body }] }) }
    let t = 0; const n0 = sent.length
    expect(await tick(env, { fetch: f, now: () => (t += 30_000) })).toEqual({ claimed: 3, sent: 0, gone: 0, dropped: 0, retry: 3 }); expect(sent.length).toBe(n0)
    expect((await sql<{ tries: number }>('select tries from bl.reminders')).map(x => x.tries)).toEqual([1, 1, 1])
  })

  it('le service ne répond pas, ou répond n’importe quoi : erreur sans effet sur les rappels ; clé VAPID incohérente : rien n’est réservé', async () => {
    const { env } = vapidEnv(), { f } = world(); await arm('a@exemple.test', [FCM('1')])
    await expect(tick({ ...env, VAPID_PRIVATE_KEY: vapidEnv().env.VAPID_PRIVATE_KEY }, { fetch: f })).rejects.toThrow('vapid'); expect((await sql<{ tries: number }>('select tries from bl.reminders'))[0].tries).toBe(0)
    await expect(tick(env, { fetch: vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch })).rejects.toThrow('service')
    await expect(tick(env, { fetch: vi.fn(async () => new Response('{"a":1}', { status: 200 })) as unknown as typeof fetch })).rejects.toThrow('service')
    await expect(tick({ ...env, SUPABASE_SECRET_KEY: KEY }, { fetch: f })).rejects.toThrow() // clé publique : le service refuse
    expect(await tick(env, { fetch: f })).toMatchObject({ claimed: 1, sent: 1 })
  })

  it('le service utilise la clé secrète dans l’en-tête « apikey » seulement (pas de « Authorization » avec une clé sb_secret)', async () => {
    const { env } = vapidEnv(), { f } = world(); await tick(env, { fetch: f })
    const c = fake.calls.filter(x => x.fn === 'bl_push_claim'); expect(c.length).toBe(1); expect([c[0].apikey, c[0].auth]).toEqual([SECRET, null])
  })
})

describe('Fonction HTTP', () => {
  const res = () => { const r = { code: 0, body: undefined as unknown, headers: {} as Record<string, string>, setHeader(k: string, v: string) { r.headers[k] = v }, status(c: number) { r.code = c; return r }, json(b: unknown) { r.body = b; return r } }; return r }
  const run = async (req: { method: string; headers?: Record<string, string> }) => { const r = res(); await handler(req, r); return r }
  const stub = (env: Env, w = world()) => { vi.stubGlobal('fetch', w.f); for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); return w }

  it('méthode, mot de passe du planificateur, configuration : refus sans rien révéler', async () => {
    const { env } = vapidEnv(); stub(env)
    expect((await run({ method: 'PUT' })).code).toBe(405); expect((await run({ method: 'DELETE' })).code).toBe(405)
    expect((await run({ method: 'POST' })).code).toBe(401); expect((await run({ method: 'POST', headers: { authorization: 'Bearer faux' } })).code).toBe(401)
    expect((await run({ method: 'POST', headers: { authorization: env.CRON_SECRET! } })).code).toBe(401) // sans « Bearer »
    expect((await run({ method: 'POST', headers: { authorization: 'Bearer ' + env.CRON_SECRET + 'x' } })).code).toBe(401)
    const sec = env.CRON_SECRET!                                      // même longueur, caractères différents : refusé aussi
    for (const wrong of [sec.slice(0, -1) + 'y', 'y' + sec.slice(1), sec.toUpperCase()]) expect((await run({ method: 'POST', headers: { authorization: 'Bearer ' + wrong } })).code, wrong).toBe(401)
    expect((await run({ method: 'POST', headers: { authorization: 'Bearer ' + sec } })).code).toBe(200)   // contrôle : le bon mot de passe passe
    vi.stubEnv('CRON_SECRET', ''); const a = await run({ method: 'POST' }); expect([a.code, a.body]).toEqual([503, { error: 'config', missing: ['CRON_SECRET'], invalid: [] }])
    vi.stubEnv('CRON_SECRET', 'court'); const b = await run({ method: 'POST', headers: { authorization: 'Bearer court' } }); expect([b.code, b.body]).toEqual([503, { error: 'config', missing: [], invalid: ['CRON_SECRET'] }])
    for (const h of [undefined, { authorization: 'Bearer autre' }, { authorization: 'Bearer cour' }]) { const x = await run({ method: 'POST', headers: h }); expect([x.code, x.body], JSON.stringify(h)).toEqual([503, { error: 'config', missing: [], invalid: ['CRON_SECRET'] }]) }   // trop court : la fonction refuse de travailler, avec ou sans mot de passe
    vi.stubEnv('CRON_SECRET', 'x'.repeat(23)); expect((await run({ method: 'POST' })).code).toBe(503)
    vi.stubEnv('CRON_SECRET', 'x'.repeat(24)); expect((await run({ method: 'POST' })).code).toBe(401)    // assez long : le mot de passe est alors exigé
    vi.stubEnv('CRON_SECRET', env.CRON_SECRET!); vi.stubEnv('VAPID_SUBJECT', ''); vi.stubEnv('SUPABASE_URL', 'http://x')
    const c = await run({ method: 'GET', headers: { authorization: 'Bearer ' + env.CRON_SECRET } }); expect([c.code, c.body]).toEqual([503, { error: 'config', missing: ['VAPID_SUBJECT'], invalid: ['SUPABASE_URL'] }])
    for (const r of [a, b, c]) expect(r.headers['Cache-Control']).toBe('no-store')
  })

  it('appel du planificateur : envoie les rappels échus et répond par des nombres seulement (GET comme POST) ; aucune trace dans la console', async () => {
    const { env } = vapidEnv(), w = stub(env), log = vi.spyOn(console, 'log'), err = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn')
    const a = await arm('a@exemple.test', [FCM('un')])
    const r = await run({ method: 'POST', headers: { authorization: 'Bearer ' + env.CRON_SECRET } })
    expect([r.code, r.body]).toEqual([200, { ok: true, claimed: 1, sent: 1, gone: 0, dropped: 0, retry: 0 }]); expect(w.sent.length).toBe(1)
    const all = JSON.stringify(r.body); expect(all).not.toContain('fcm'); expect(all).not.toContain(a.bodies[FCM('un')])
    const r2 = await run({ method: 'GET', headers: { authorization: 'Bearer ' + env.CRON_SECRET } }); expect([r2.code, r2.body]).toEqual([200, { ok: true, claimed: 0, sent: 0, gone: 0, dropped: 0, retry: 0 }])
    expect([log, err, warn].map(s => s.mock.calls.length)).toEqual([0, 0, 0])
  })

  it('clé privée incohérente : 503 avec le nom de la variable ; service injoignable : 502 sans détail', async () => {
    const { env } = vapidEnv(); stub({ ...env, VAPID_PRIVATE_KEY: vapidEnv().env.VAPID_PRIVATE_KEY })
    const a = await run({ method: 'POST', headers: { authorization: 'Bearer ' + env.CRON_SECRET } }); expect([a.code, a.body]).toEqual([503, { error: 'config', missing: [], invalid: ['VAPID_PRIVATE_KEY (ne correspond pas à VAPID_PUBLIC_KEY)'] }])
    stub(env, { f: vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch, sent: [] })
    const b = await run({ method: 'POST', headers: { authorization: 'Bearer ' + env.CRON_SECRET } }); expect([b.code, b.body]).toEqual([502, { error: 'service' }])
  })
})

describe('État du déploiement (diag, lecture seule)', () => {
  const res = () => { const r = { code: 0, body: undefined as unknown, headers: {} as Record<string, string>, setHeader(k: string, v: string) { r.headers[k] = v }, status(c: number) { r.code = c; return r }, json(b: unknown) { r.body = b; return r } }; return r }
  const run = async (req: { method: string; query?: Record<string, string>; headers?: Record<string, string> }) => { const r = res(); await handler(req, r); return r }
  const canned = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch & ReturnType<typeof vi.fn>

  it('déploiement sain : tout est confirmé, avec le dernier passage du planificateur (jamais passé = null)', async () => {
    const { env } = vapidEnv(), w = world()
    expect(await diag(env, { fetch: w.f })).toEqual({ ok: true, missing: [], invalid: [], vapid: true, db: 'ok', tick: null })
    expect(w.sent).toEqual([])                                           // la vérification ne s'adresse qu'à la base, jamais à un service de notification
    await tick(env, { fetch: w.f })
    const d = await diag(env, { fetch: w.f }); expect(d.ok).toBe(true); expect(d.tick).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); expect(Math.abs(Date.now() - Date.parse(d.tick!))).toBeLessThan(15_000)
  })

  it('variables manquantes ou invalides : leurs noms seulement, et aucune requête réseau tant que la configuration est incomplète', async () => {
    const f = vi.fn(async () => { throw new Error('ne doit pas être appelé') }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
    const none = await diag(readEnv({}), { fetch: f })
    expect(none).toEqual({ ok: false, missing: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'CRON_SECRET'], invalid: [], vapid: null, db: null, tick: null })
    const { env } = vapidEnv()
    expect(await diag({ ...env, SUPABASE_URL: 'http://x.supabase.co', VAPID_PUBLIC_KEY: 'AAAA' }, { fetch: f })).toEqual({ ok: false, missing: [], invalid: ['SUPABASE_URL', 'VAPID_PUBLIC_KEY'], vapid: null, db: null, tick: null })
    expect(await diag({ ...env, SUPABASE_SECRET_KEY: KEY }, { fetch: f })).toMatchObject({ ok: false, invalid: ['SUPABASE_SECRET_KEY'], vapid: true, db: null })  // une clé publique à la place de la clé secrète
    expect((await diag({ ...env, VAPID_SUBJECT: '', CRON_SECRET: 'court' }, { fetch: world().f }))).toMatchObject({ ok: false, missing: ['VAPID_SUBJECT'], invalid: ['CRON_SECRET'], vapid: true, db: 'ok' })
    expect(f.mock.calls.length).toBe(0)
  })

  it('clé privée qui ne va pas avec la clé publique : détecté, sans rien envoyer', async () => {
    const { env } = vapidEnv(), other = vapidEnv().env
    const d = await diag({ ...env, VAPID_PRIVATE_KEY: other.VAPID_PRIVATE_KEY }, { fetch: world().f })
    expect(d).toMatchObject({ ok: false, vapid: false, db: 'ok', missing: [], invalid: [] })
  })

  it('base : clé secrète refusée, script SQL absent ou d’une autre version, base en panne ou injoignable', async () => {
    const { env } = vapidEnv()
    expect((await diag({ ...env, SUPABASE_SECRET_KEY: 'sb_secret_' + 'Q'.repeat(30) }, { fetch: world().f })).db).toBe('key')       // clé inconnue du projet : 401 du service
    for (const [status, body, why] of [[403, { message: 'x' }, 'key'], [404, { message: 'x' }, 'schema'], [400, { code: 'PGRST202' }, 'schema'], [200, { v: 2 }, 'schema'], [200, {}, 'schema'], [200, null, 'schema'], [500, { message: 'x' }, 'down'], [503, null, 'down'], [429, null, 'down']] as [number, unknown, string][]) {
      const d = await diag(env, { fetch: canned(status, body) }); expect(d.db, status + ' ' + JSON.stringify(body)).toBe(why); expect(d.ok).toBe(false)
    }
    expect((await diag(env, { fetch: (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch })).db).toBe('down')
    expect((await diag(env, { fetch: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch })).db).toBe('schema')      // réponse qui n'est pas du JSON
    expect((await diag(env, { fetch: canned(200, { v: 1, tick: 'pas une date' }) })).tick).toBeNull()
    expect((await diag(env, { fetch: canned(200, { v: 1, tick: '2026-10-25T10:00:00+02:00' }) })).tick).toBe('2026-10-25T08:00:00.000Z')
  })

  it('la clé secrète part dans « apikey » (et dans « Authorization » seulement pour une ancienne clé service_role) ; appel unique, vers la fonction de vérification', async () => {
    const { env } = vapidEnv(), f = canned(200, { v: 1, tick: null })
    await diag(env, { fetch: f })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]; const h = new Headers(init.headers)
    expect([f.mock.calls.length, url, init.method, h.get('apikey'), h.get('authorization')]).toEqual([1, ORIGIN + '/rest/v1/rpc/bl_push_ping', 'POST', SECRET, null])
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', b64uEnc(te.encode(JSON.stringify({ role: 'service_role' }))), 'c2ln'].join('.'), g = canned(200, { v: 1, tick: null })
    await diag({ ...env, SUPABASE_SECRET_KEY: jwt }, { fetch: g })
    const h2 = new Headers((g.mock.calls[0] as unknown as [string, RequestInit])[1].headers); expect([h2.get('apikey'), h2.get('authorization')]).toEqual([jwt, 'Bearer ' + jwt])
  })

  it('la vérification ne change rien dans la base et ne compte pas comme un passage du planificateur', async () => {
    const { env } = vapidEnv(), w = world(), a = await arm('a@exemple.test', [FCM('un')])
    const state = async () => JSON.stringify([await sql('select * from bl.meta order by k'), await sql('select id, tries, nxt from bl.reminders order by id'), await sql('select ep, seen from bl.pushsubs order by ep')])
    const before = await state()
    for (let i = 0; i < 3; i++) expect((await diag(env, { fetch: w.f })).tick).toBeNull()
    expect(await state()).toBe(before); expect(w.sent).toEqual([]); expect(a.uid).toBeTruthy()
    expect((await call(a.uid, 'bl_push_status')).body).toMatchObject({ pending: 1, tick: null })
  })

  it('fonction HTTP : « ?diag=1 » répond sans mot de passe, en lecture seule ; toute autre demande exige toujours le mot de passe', async () => {
    const { env } = vapidEnv(); stubAll(env, world())
    const r = await run({ method: 'GET', query: { diag: '1' } })
    expect([r.code, r.body, r.headers['Cache-Control']]).toEqual([200, { ok: true, missing: [], invalid: [], vapid: true, db: 'ok', tick: null }, 'no-store'])
    const all = JSON.stringify(r.body)
    for (const secret of [env.SUPABASE_SECRET_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY, env.CRON_SECRET, env.SUPABASE_URL, env.VAPID_SUBJECT]) expect(all).not.toContain(secret as string)
    for (const q of [undefined, {}, { diag: '0' }, { diag: '2' }, { diag: 'true' }, { diag: '' }] as (Record<string, string> | undefined)[]) expect((await run({ method: 'GET', query: q })).code, JSON.stringify(q)).toBe(401)
    expect((await run({ method: 'POST', query: { diag: '1' } })).code).toBe(401)           // seule la lecture GET est ouverte
    expect((await run({ method: 'PUT', query: { diag: '1' } })).code).toBe(405)
    vi.stubEnv('CRON_SECRET', ''); const c = await run({ method: 'GET', query: { diag: '1' } })   // mot de passe du planificateur absent : l'état est quand même montré, pour qu'on voie ce qui manque
    expect([c.code, c.body]).toMatchObject([200, { ok: false, missing: ['CRON_SECRET'] }])
  })

  it('fonction HTTP : aucune trace dans la console, même quand la base est injoignable', async () => {
    const { env } = vapidEnv(), log = vi.spyOn(console, 'log'), err = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn')
    stubAll(env, { f: (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch })
    const r = await run({ method: 'GET', query: { diag: '1' } }); expect([r.code, r.body]).toEqual([200, { ok: false, missing: [], invalid: [], vapid: true, db: 'down', tick: null }])
    expect([log, err, warn].map(x => x.mock.calls.length)).toEqual([0, 0, 0])
  })
})
const stubAll = (env: Env, w: { f: typeof fetch }) => { vi.stubGlobal('fetch', w.f); for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v) }
