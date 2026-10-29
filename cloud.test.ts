import { webcrypto } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoTrueClient } from '@supabase/auth-js'
import { FakeCloud, KEY, ORIGIN, SECRET, VAPID } from './fakecloud'

let fake: FakeCloud
beforeAll(async () => { fake = await FakeCloud.create() }, 120_000)
afterAll(async () => { await fake.db.close() })
beforeEach(async () => {
  await fake.reset(); localStorage.clear(); vi.resetModules(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fake.fetch); history.replaceState(null, '', '/')
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const mod = () => import('./cloud')
type Cloud = Awaited<ReturnType<typeof mod>>
/** Parcours complet de connexion : bouton → Google (simulé) → retour avec le code → session. */
async function signIn(cloud: Cloud, email = 'ada@example.org') {
  let url = ''; cloud.nav.assign = u => { url = u }
  expect(await cloud.startGoogle()).toEqual({ ok: true })
  const back = new URL(await fake.google(url, email)); history.replaceState(null, '', back.pathname + back.search + back.hash)
  return cloud.completeFromUrl()
}
const refreshes = () => fake.calls.filter(c => c.path.includes('grant_type=refresh_token')).length
const later = (ms: number) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + ms) }

describe('Compte en ligne : configuration du serveur', () => {
  it('lue une fois, revérifiée, gardée ; relue sur demande', async () => {
    const c = await mod(); const r = await c.getConfig()
    expect(r).toEqual({ ok: true, cfg: { url: ORIGIN, key: KEY, vapid: VAPID } })
    const n = fake.calls.length; await c.getConfig(); expect(fake.calls.length).toBe(n) // gardée
    fake.config = { ok: true, url: ORIGIN, key: KEY, vapid: null, warn: [] }; expect(await c.getConfig(true)).toEqual({ ok: true, cfg: { url: ORIGIN, key: KEY, vapid: null } })
  })
  it('service non configuré, invalide, hors ligne ou fonction absente : des raisons distinctes, jamais « configuré » à tort', async () => {
    const c = await mod()
    fake.config = { ok: false, missing: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'], invalid: [] }; expect(await c.getConfig(true)).toEqual({ ok: false, why: 'missing', list: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] })
    fake.config = { ok: false, missing: [], invalid: ['SUPABASE_URL'] }; expect(await c.getConfig(true)).toEqual({ ok: false, why: 'invalid', list: ['SUPABASE_URL'] })
    fake.offline = true; expect(await c.getConfig(true)).toEqual({ ok: false, why: 'offline', list: [] }); fake.offline = false
    fake.failNext = { match: '/api/cloud-config', status: 404 }; expect(await c.getConfig(true)).toMatchObject({ ok: false, why: 'unavailable' })
    vi.stubGlobal('fetch', async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })); expect(await c.getConfig(true)).toMatchObject({ ok: false, why: 'unavailable' }) // serveur de développement : la page d'accueil répond à la place
  })
  it('refuse une clé secrète, une clé inconnue ou une adresse qui n’est pas un projet Supabase, même si le serveur les donne', async () => {
    const c = await mod()
    for (const bad of [{ key: SECRET }, { key: 'sb_publishable_court' }, { key: 'n’importe quoi' }, { url: 'https://evil.example.org' }, { url: 'http://' + 'abc.supabase.co' }, { url: ORIGIN + '/auth' }, { url: 'https://abc.supabase.co.evil.org' }, { url: 'https://a.b.supabase.co' }]) {
      fake.config = { ok: true, url: ORIGIN, key: KEY, vapid: null, ...bad }; expect(await c.getConfig(true), JSON.stringify(bad)).toMatchObject({ ok: false, why: 'invalid' })
    }
    const jwt = (role: string) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.sig'
    expect(c.keyKind(jwt('anon'))).toBe('ok'); expect(c.keyKind(jwt('service_role'))).toBe('secret'); expect(c.keyKind(jwt('authenticated'))).toBe('bad'); expect(c.keyKind('sb_secret_abcdefghijklmnop')).toBe('secret'); expect(c.keyKind(KEY)).toBe('ok')
    fake.config = { ok: true, url: ORIGIN, key: jwt('anon'), vapid: 'pas-une-clé' }; expect(await c.getConfig(true)).toMatchObject({ ok: true, cfg: { vapid: null } }) // clé de rappels illisible : ignorée
  })
})

describe('Compte en ligne : connexion Google (PKCE)', () => {
  it('chaque connexion tire un secret neuf, jamais constant', async () => {
    const c = await mod(); c.nav.assign = () => undefined
    await c.startGoogle(); const v1 = JSON.parse(localStorage.getItem('believe:auth-pending')!).v as string
    await c.startGoogle(); const v2 = JSON.parse(localStorage.getItem('believe:auth-pending')!).v as string
    expect(v1).not.toBe(v2); expect(v1).not.toMatch(/^A+$/); expect(v2).not.toMatch(/^A+$/)
  })
  it('l’adresse de connexion porte l’empreinte du secret gardé sur l’appareil ; après Google, le code est échangé et la session enregistrée', async () => {
    const c = await mod(); let url = ''; c.nav.assign = u => { url = u }
    expect(await c.startGoogle()).toEqual({ ok: true })
    const u = new URL(url); expect(u.origin + u.pathname).toBe(ORIGIN + '/auth/v1/authorize')
    expect([...u.searchParams.keys()].sort()).toEqual(['code_challenge', 'code_challenge_method', 'provider', 'redirect_to'])
    expect(u.searchParams.get('provider')).toBe('google'); expect(u.searchParams.get('code_challenge_method')).toBe('s256'); expect(u.searchParams.get('redirect_to')).toBe(location.origin + '/')
    const pending = JSON.parse(localStorage.getItem('believe:auth-pending')!); expect(pending.v).toMatch(/^[A-Za-z0-9_-]{64}$/) // 48 octets aléatoires
    expect(u.searchParams.get('code_challenge')).toBe(createHashB64(pending.v)); expect(url).not.toContain(pending.v) // le secret ne part jamais dans l'adresse
    const back = new URL(await fake.google(url)); history.replaceState(null, '', back.pathname + back.search)
    const r = await c.completeFromUrl(); expect(r.kind).toBe('ok')
    const s = c.getSession()!; expect(s.email).toBe('ada@example.org'); expect(s.uid).toBe(fake.users.get('ada@example.org')); expect(s.exp).toBeGreaterThan(Date.now() + 3000_000)
    expect(location.search).toBe(''); expect(location.hash).toBe('#/2/compte'); expect(localStorage.getItem('believe:auth-pending')).toBeNull() // adresse nettoyée, secret détruit
    expect(JSON.parse(localStorage.getItem('believe:auth')!).rt).toBe(s.rt); expect(c.signedIn()).toBe(true)
    const ex = fake.calls.find(x => x.path.includes('grant_type=pkce'))!; expect(Object.keys(ex.body as object).sort()).toEqual(['auth_code', 'code_verifier']); expect(ex.apikey).toBe(KEY); expect(ex.auth).toBeNull() // la clé publique n'est jamais un jeton
  })
  it('un code rejoué, un secret modifié, un secret absent ou périmé : refusés sans créer de session', async () => {
    const c = await mod(); let url = ''; c.nav.assign = u => { url = u }
    await c.startGoogle(); const back = new URL(await fake.google(url)); const code = back.searchParams.get('code')!
    const p = JSON.parse(localStorage.getItem('believe:auth-pending')!); localStorage.setItem('believe:auth-pending', JSON.stringify({ ...p, v: p.v.slice(1) + 'x' }))
    expect(await c.finishSignIn(code)).toEqual({ ok: false, why: 'denied' }); expect(c.signedIn()).toBe(false); expect(localStorage.getItem('believe:auth-pending')).toBeNull() // secret détruit même après un échec
    expect(await c.finishSignIn(code)).toEqual({ ok: false, why: 'nopending' })
    await c.startGoogle(); const code2 = new URL(await fake.google(url)).searchParams.get('code')!
    expect((await c.finishSignIn(code2)).ok).toBe(true); await c.startGoogle(); const again = await c.finishSignIn(code2); expect(again).toEqual({ ok: false, why: 'denied' }) // code déjà utilisé
    localStorage.clear(); await c.startGoogle(); const code3 = new URL(await fake.google(url)).searchParams.get('code')!; later(16 * 60_000); expect(await c.finishSignIn(code3)).toEqual({ ok: false, why: 'expired' })
  })
  it('retours d’erreur de Google ou du service (dans la requête ou le fragment) : message clair, adresse nettoyée ; une route ordinaire n’est pas prise pour un retour', async () => {
    const c = await mod()
    history.replaceState(null, '', '/?error=access_denied&error_code=bad_oauth_callback&error_description=Unable+to+exchange+external+code#/2/compte'); const r = await c.completeFromUrl()
    expect(r).toEqual({ kind: 'fail', why: 'refused', msg: 'Unable to exchange external code' }); expect(location.search).toBe('')
    history.replaceState(null, '', '/#error=access_denied&error_description=Refus'); expect(c.readBack(location.href)).toEqual({ kind: 'error', msg: 'Refus' })
    for (const h of ['/', '/#/4', '/#/5/amis/ABCDEF-123456', '/?utm_source=x#/6', '/?code=court', '/?code=' + 'x'.repeat(400)]) expect(c.readBack('http://localhost:3000' + h).kind, h).toBe('none')
    expect(c.readBack('pas une adresse').kind).toBe('none')
    history.replaceState(null, '', '/?code=ABCDEFGHIJKLMN'); const n = fake.calls.length; c.discardBack(); expect(location.search).toBe(''); expect(fake.calls.length).toBe(n) // accord non donné : rien n'est échangé
  })
  it('service non configuré ou hors ligne au départ : pas de départ vers Google, aucun secret laissé', async () => {
    const c = await mod(); c.nav.assign = () => { throw new Error('ne devrait pas partir') }
    fake.config = { ok: false, missing: ['SUPABASE_URL'], invalid: [] }; expect(await c.startGoogle()).toMatchObject({ ok: false, why: 'missing' }); expect(localStorage.getItem('believe:auth-pending')).toBeNull()
    fake.config = { ok: true, url: ORIGIN, key: KEY, vapid: null }; c.forgetConfig(); fake.offline = true; expect(await c.startGoogle()).toMatchObject({ ok: false, why: 'offline' })
  })
  it('réseau coupé pendant l’échange : échec franc (« net »), pas de session, pas de secret conservé', async () => {
    const c = await mod(); let url = ''; c.nav.assign = u => { url = u }
    await c.startGoogle(); const code = new URL(await fake.google(url)).searchParams.get('code')!; fake.offline = true
    expect(await c.finishSignIn(code)).toEqual({ ok: false, why: 'net' }); expect(c.signedIn()).toBe(false); expect(localStorage.getItem('believe:auth-pending')).toBeNull()
  })
  it('même façon de parler que la bibliothèque officielle (auth-js) : mêmes paramètres, même échange, même renouvellement', async () => {
    const mem = new Map<string, string>(), storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
    const gt = new GoTrueClient({ url: ORIGIN + '/auth/v1', headers: { apikey: KEY }, storageKey: 'oracle', storage, flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, fetch: fake.fetch as typeof fetch })
    const redirectTo = location.origin + '/'
    const o = await gt.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } }); expect(o.error).toBeNull()
    const theirs = new URL(o.data.url!)
    const c = await mod(); const mine = await c.beginSignIn(redirectTo); if (!mine.ok) throw new Error('départ'); const ours = new URL(mine.url)
    expect(ours.origin + ours.pathname).toBe(theirs.origin + theirs.pathname); expect([...ours.searchParams.keys()].sort()).toEqual([...theirs.searchParams.keys()].sort())
    for (const k of ['provider', 'redirect_to', 'code_challenge_method']) expect(ours.searchParams.get(k), k).toBe(theirs.searchParams.get(k))
    expect(ours.searchParams.get('code_challenge')!.length).toBe(theirs.searchParams.get('code_challenge')!.length)
    // l'échange officiel marche avec le service simulé, et les deux appels se ressemblent
    const code = new URL(await fake.google(o.data.url!, 'oracle@example.org')).searchParams.get('code')!
    const x = await gt.exchangeCodeForSession(code); expect(x.error).toBeNull(); const theirEx = fake.calls.filter(k => k.path.includes('grant_type=pkce')).pop()!
    const code2 = new URL(await fake.google(mine.url, 'ada@example.org')).searchParams.get('code')!; expect((await c.finishSignIn(code2)).ok).toBe(true); const myEx = fake.calls.filter(k => k.path.includes('grant_type=pkce')).pop()!
    expect(Object.keys(myEx.body as object).sort()).toEqual(Object.keys(theirEx.body as object).sort()); expect(myEx.path).toBe(theirEx.path); expect(myEx.apikey).toBe(theirEx.apikey)
    const r = await gt.refreshSession({ refresh_token: x.data.session!.refresh_token }); expect(r.error).toBeNull(); const theirRf = fake.calls.filter(k => k.path.includes('grant_type=refresh_token')).pop()!
    later(2 * 3600_000); await c.accessToken(); const myRf = fake.calls.filter(k => k.path.includes('grant_type=refresh_token')).pop()!
    expect(Object.keys(myRf.body as object)).toEqual(Object.keys(theirRf.body as object)); expect(myRf.path).toBe(theirRf.path); expect(myRf.apikey).toBe(theirRf.apikey)
  })
})

describe('Compte en ligne : jeton d’accès, renouvellement et appels', () => {
  it('un jeton expiré est renouvelé une seule fois même si deux appels partent ensemble ; le jeton de renouvellement change', async () => {
    const c = await mod(); await signIn(c); const before = c.getSession()!
    later(2 * 3600_000)
    const [a, b] = await Promise.all([c.rpc<{ rev: number }>('bl_snap_meta'), c.rpc<{ rev: number }>('bl_snap_meta')])
    expect([a.rev, b.rev]).toEqual([0, 0]); expect(refreshes()).toBe(1)
    const now = c.getSession()!; expect(now.rt).not.toBe(before.rt); expect(now.at).not.toBe(before.at); expect(now.exp).toBeGreaterThan(Date.now() + 3000_000)
  })
  it('jeton refusé par le service (alors que l’appareil le croit valable) : un renouvellement forcé puis un seul nouvel essai', async () => {
    const c = await mod(); await signIn(c); fake.expireAccess()
    expect((await c.rpc<{ rev: number }>('bl_snap_meta')).rev).toBe(0); expect(refreshes()).toBe(1)
    const rpcs = fake.calls.filter(k => k.fn === 'bl_snap_meta'); expect(rpcs).toHaveLength(2)
    fake.expireAccess(); fake.failNext = null; fake.revokeAll() // session révoquée ailleurs : plus de renouvellement possible
    await expect(c.rpc('bl_snap_meta')).rejects.toMatchObject({ code: 'auth' }); expect(c.signedIn()).toBe(false) // et l'appareil s'en aperçoit
  })
  it('session révoquée : demande de se reconnecter, session effacée ; réseau coupé : la session est gardée', async () => {
    const c = await mod(); await signIn(c); later(2 * 3600_000)
    fake.offline = true; await expect(c.rpc('bl_snap_meta')).rejects.toMatchObject({ code: 'net' }); expect(c.signedIn()).toBe(true)
    fake.offline = false; fake.revokeAll(); await expect(c.rpc('bl_snap_meta')).rejects.toMatchObject({ code: 'auth' }); expect(c.signedIn()).toBe(false); expect(localStorage.getItem('believe:auth')).toBeNull()
    await expect(c.rpc('bl_snap_meta')).rejects.toMatchObject({ code: 'auth' }) // sans session : refus immédiat, aucun appel réseau
  })
  it('erreur du service pendant le renouvellement : la session est gardée pour un autre essai', async () => {
    const c = await mod(); await signIn(c); later(2 * 3600_000); fake.failNext = { match: 'grant_type=refresh_token', status: 503 }
    await expect(c.rpc('bl_snap_meta')).rejects.toMatchObject({ code: 'server' }); expect(c.signedIn()).toBe(true); expect((await c.rpc<{ rev: number }>('bl_snap_meta')).rev).toBe(0)
  })
  it('les appels portent la clé publique dans « apikey » et le jeton de la personne en « Bearer » (jamais la clé publique) ; bl_ping marche sans session', async () => {
    const c = await mod(); expect(await c.ping()).toMatchObject({ v: 1, auth: false }); await signIn(c); await c.rpc('bl_snap_meta')
    for (const k of fake.calls.filter(x => x.fn)) { expect(k.apikey).toBe(KEY); if (k.fn === 'bl_ping') expect(k.auth).toBeNull(); else { expect(k.auth).toMatch(/^Bearer eyJ/); expect(k.auth).not.toContain(KEY) } }
    expect(await c.ping()).toMatchObject({ auth: false }) // ping reste anonyme même connecté
  })
  it('erreurs de la base : règle nommée ; fonction absente : « schema » ; nom de fonction hors liste : refusé avant tout appel', async () => {
    const c = await mod(); await signIn(c); const n = fake.calls.length
    await expect(c.rpc('bl_snap_put', { p_expected: 5, p_blob: 'BLS1.abc' })).rejects.toMatchObject({ code: 'rev', status: 400 })
    await expect(c.rpc('bl_circle_create', { p_name: '', p_display: 'x' })).rejects.toMatchObject({ code: 'name' })
    await expect(c.rpc('bl_pas_installee')).rejects.toMatchObject({ code: 'schema' })
    for (const bad of ['drop table x', 'bl_', 'BL_PING', '../auth', 'bl_a/b', 'bl_ping?x=1']) await expect(c.rpc(bad)).rejects.toMatchObject({ code: 'arg' })
    expect(fake.calls.length).toBe(n + 3)
    fake.failNext = { match: 'bl_snap_meta', status: 500, body: { message: 'boum' } }; await expect(c.rpc('bl_snap_meta')).rejects.toMatchObject({ code: 'server', status: 500 })
    fake.failNext = { match: 'bl_snap_meta', status: 429, body: {} }; await expect(c.rpc('bl_snap_meta')).rejects.toMatchObject({ code: 'rate' })
  })
  it('les appels réservés au serveur (rappels) sont refusés à l’application', async () => {
    const c = await mod(); await signIn(c)
    await expect(c.rpc('bl_push_claim', { p_limit: 5 })).rejects.toMatchObject({ code: 'auth' }); await expect(c.rpc('bl_push_done', { p_ok: [], p_gone: [] })).rejects.toBeTruthy()
  })
})

describe('Compte en ligne : session et déconnexion', () => {
  it('se déconnecter : le service est prévenu pour cet appareil seulement, la session locale disparaît, l’ancien jeton de renouvellement ne sert plus', async () => {
    const c = await mod(); await signIn(c); const old = c.getSession()!
    await c.signOut(); const lo = fake.calls.find(k => k.path === '/auth/v1/logout?scope=local')!; expect(lo.auth).toBe('Bearer ' + old.at); expect(c.signedIn()).toBe(false); expect(localStorage.getItem('believe:auth')).toBeNull()
    const r = await fake.fetch(ORIGIN + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: KEY }, body: JSON.stringify({ refresh_token: old.rt }) }); expect(r.status).toBe(400)
  })
  it('se déconnecter hors ligne efface quand même la session locale ; dropSession n’appelle personne', async () => {
    const c = await mod(); await signIn(c); fake.offline = true; await c.signOut(); expect(c.signedIn()).toBe(false)
    fake.offline = false; await signIn(c); const n = fake.calls.length; c.dropSession(); expect(c.signedIn()).toBe(false); expect(fake.calls.length).toBe(n)
  })
  it('session illisible ou incomplète : comme pas de session', async () => {
    const c = await mod()
    for (const bad of ['pas du json', '{}', JSON.stringify({ at: 'a', rt: 'b', exp: 1, uid: 'pas-un-uuid', email: null }), JSON.stringify({ at: '', rt: 'b', exp: 1, uid: '00000000-0000-0000-0000-000000000000', email: null })]) { localStorage.setItem('believe:auth', bad); expect(c.getSession(), bad).toBeNull() }
    expect(await c.accessToken()).toBeNull()
  })
  it('chiffrement par le PIN actif : la session est chiffrée, illisible verrouillé, et revient avec le PIN', async () => {
    const c = await mod(); await signIn(c); const ops = await import('./vaultops'), lib = await import('./lib'); lib.save(lib.DEF())
    expect((await ops.enableVault('4821', 1, 1000)).ok).toBe(true); const raw = localStorage.getItem('believe:auth')!; expect(raw.startsWith('BLV1.')).toBe(true); expect(raw).not.toContain(c.getSession()!.rt)
    expect(c.signedIn()).toBe(true)
    vi.resetModules(); const c2 = await mod(), pin = await import('./pin'); expect(c2.signedIn()).toBe(false); await expect(c2.rpc('bl_snap_meta')).rejects.toMatchObject({ code: 'auth' }) // verrouillé : rien de lisible, rien d'envoyé
    await pin.verifyPin('4821'); expect(c2.signedIn()).toBe(true); expect((await c2.rpc<{ rev: number }>('bl_snap_meta')).rev).toBe(0)
    later(2 * 3600_000); const before = localStorage.getItem('believe:auth'); await c2.accessToken(); expect(localStorage.getItem('believe:auth')).not.toBe(before); expect(localStorage.getItem('believe:auth')!.startsWith('BLV1.')).toBe(true) // renouvelée : toujours chiffrée
  })
  it('le stockage refuse d’enregistrer le jeton renouvelé : la page garde le nouveau jeton en mémoire (l’ancien est déjà périmé), qui s’efface au verrouillage', async () => {
    const c = await mod(); await signIn(c); later(2 * 3600_000)
    const real = Storage.prototype.setItem; vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) { if (k === 'believe:auth') throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v) })
    const t = await c.accessToken(); expect(t).toBeTruthy(); expect(c.getSession()!.at).toBe(t); expect((await c.rpc<{ rev: number }>('bl_snap_meta')).rev).toBe(0)
    c.forgetMemory(); vi.restoreAllMocks(); expect(c.getSession()!.at).not.toBe(t) // seule la copie du stockage (ancienne) reste
  })
})

function createHashB64(v: string): string { return Buffer.from(require('node:crypto').createHash('sha256').update(v).digest()).toString('base64url') }
