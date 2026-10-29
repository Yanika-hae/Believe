// Rappels application fermée : le client (src/push.ts) face à un faux navigateur (abonnement Web Push avec de VRAIES clés P-256) et à l'imitation du service en ligne (FakeCloud : authentification Google
// simulée + vraie base PostgreSQL qui a reçu supabase/schema.sql). Ce que le service garde est relu dans la base, et les messages sont déchiffrés comme le ferait le navigateur, avec une bibliothèque indépendante.
import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCloud, VAPID } from './fakecloud'
import type { State } from './lib'
import { b64uDec } from './webpush'
import { browser } from './testpush'
import type { Br } from './testpush'

let fake: FakeCloud
beforeAll(async () => { fake = await FakeCloud.create() }, 120_000)
afterAll(async () => { await fake.db.close() })

/** Vendredi 23 octobre 2026, 12 h (heure locale). L'horloge est figée (seule `Date` est simulée) et avancée à la main. */
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime()
const MIN = 60_000, DAY = 86_400_000
const p2 = (n: number) => String(n).padStart(2, '0')
/** Échéance « AAAA-MM-JJTHH:mm » (heure locale) située `ms` après midi. */
const at = (ms: number) => { const d = new Date(NOW + ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) }
const task = (id: string, t: string, due: string | null, o: Record<string, unknown> = {}) => ({ id, t, imp: false, due, done: false, p: null, ...o })

interface Dev { P: typeof import('./push'); cloud: typeof import('./cloud'); lib: typeof import('./lib'); hook: typeof import('./cloudhook'); acc: typeof import('./account'); keys: typeof import('./keys'); ops: typeof import('./vaultops') }


let dev: Dev
const dump = (k: string) => localStorage.getItem(k)
async function device(): Promise<Dev> {
  vi.resetModules()
  dev = { P: await import('./push'), cloud: await import('./cloud'), lib: await import('./lib'), hook: await import('./cloudhook'), acc: await import('./account'), keys: await import('./keys'), ops: await import('./vaultops') }
  return dev
}
beforeEach(async () => {
  await fake.reset(); localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/')
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fake.fetch)
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})
afterEach(() => {
  dev?.P.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'serviceWorker')
})

/** Lit (et modifie, puis enregistre) l'état de l'appareil. */
function st(f?: (s: State) => void): State {
  const r = dev.lib.load()
  if (f) { f(r.s); expect(dev.lib.save(r.s)).toBe(true) }
  return r.s
}
async function signIn(email: string) {
  let url = ''; dev.cloud.nav.assign = u => { url = u }
  expect(await dev.cloud.startGoogle()).toEqual({ ok: true })
  history.replaceState(null, '', (u => u.pathname + u.search + u.hash)(new URL(await fake.google(url, email))))
  expect((await dev.cloud.completeFromUrl()).kind).toBe('ok')
}
/** Une personne prête : accords « Notifications » et « Compte en ligne » donnés, connectée, une tâche dans une heure (rappel 30 minutes avant). */
async function ready(o: { email?: string; tasks?: ReturnType<typeof task>[]; br?: Br | false } = {}) {
  const d = await device(); const br = o.br === false ? null : (o.br ?? browser()).install()
  st(s => { s.consents.notif = true; s.consents.cloud = true; s.ui.onboard = true; s.tasks = (o.tasks ?? [task('t1', 'Appeler Paul', at(60 * MIN))]) as State['tasks'] })
  await signIn(o.email ?? 'ada@example.org')
  return { d, br: br as Br }
}
const rows = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await fake.db.query<T>(q, p)).rows
const reminders = () => rows<{ ref: string; at: Date; body: string; ep: string }>('select ref, at, body, ep from bl.reminders order by at, ref')
const calls = (fn: string) => fake.calls.filter(c => c.fn === fn)
const pref = () => JSON.parse(dump('believe:push') ?? 'null')

describe('plan : quels rappels sont programmés (fonction pure)', () => {
  const P = async () => (await device()).P
  const S = (f: (s: State) => void) => { const s = dev.lib.DEF(); f(s); return s }
  const items = (s: State, o: { title: boolean; test?: number } = { title: false }, now = NOW) => dev.P.plan(s, now, o)

  it('programme les tâches non terminées avec une échéance valide dont le moment de rappel est à venir, dans l’ordre des heures', async () => {
    await P()
    const s = S(s => { s.tasks = [task('b', 'B', at(90 * MIN)), task('a', 'A', at(40 * MIN)), task('c', 'C', at(5 * 60 * MIN))] as State['tasks'] }) // rappel 30 min avant
    const r = items(s)
    expect(r.map(i => [i.ref, i.at - NOW])).toEqual([['a', 10 * MIN], ['b', 60 * MIN], ['c', 270 * MIN]])
    expect(r.every(i => i.msg.v === 1 && i.msg.g === i.ref)).toBe(true)
  })

  it('exclut : terminée, sans échéance, échéance illisible, rappel déjà donné, moment de rappel passé ou dans les 5 prochaines secondes, plus de 39 jours', async () => {
    await P()
    const due = at(60 * MIN)
    const s = S(s => {
      s.tasks = [
        task('ok', 'Ok', due), task('done', 'Fait', due, { done: true }), task('nodue', 'Sans', null), task('bad', 'Mauvaise', 'pas une date'), task('rem', 'Rappelée', due, { r: due }),
        task('past', 'Passé', at(20 * MIN)), // rappel 30 min avant = déjà passé
        task('far', 'Lointaine', at(40 * DAY)), task('near', 'Presque', at(30 * MIN + 4000)), task('edge', 'Limite', at(38 * DAY))
      ] as State['tasks']
    })
    expect(items(s).map(i => i.ref).sort()).toEqual(['edge', 'ok'])
    expect(items(S(s => { s.tasks = [task('x', 'X', at(30 * MIN + 6000))] as State['tasks'] }), { title: false }, NOW).length).toBe(0) // l'échéance est à la minute près : 12:30 → rappel 12:00, passé
  })

  it('délai de rappel : 0, 10, 30, 60 et 120 minutes avant', async () => {
    await P()
    for (const lead of [0, 10, 30, 60, 120] as const) {
      const s = S(s => { s.settings.remind = lead; s.tasks = [task('t', 'T', at(3 * 60 * MIN))] as State['tasks'] })
      expect(items(s)[0].at, 'avance ' + lead).toBe(NOW + 3 * 60 * MIN - lead * MIN)
    }
  })

  it('texte neutre par défaut ; titre seulement si demandé ET mode discret éteint ; titre nettoyé, borné à 120 caractères (émojis entiers), jamais vide', async () => {
    await P()
    const due = at(2 * 60 * MIN), dueMs = Date.parse(due)
    const s = S(s => { s.tasks = [task('t', '  Appeler\n  Paul  ', due)] as State['tasks'] })
    expect(items(s)[0].msg).toEqual({ v: 1, g: 't', t: 'Believe : rappel', b: 'Une tâche arrive à échéance.', d: null })
    expect(items(s, { title: true })[0].msg).toEqual({ v: 1, g: 't', t: 'Appeler Paul', b: null, d: dueMs })
    s.discret = true; expect(items(s, { title: true })[0].msg).toEqual({ v: 1, g: 't', t: 'Believe : rappel', b: 'Une tâche arrive à échéance.', d: null }); s.discret = false
    s.tasks[0].t = '😀'.repeat(150); const long = items(s, { title: true })[0].msg.t; expect([...long].length).toBe(120); expect(long).toBe('😀'.repeat(120))
    s.tasks[0].t = '   '; expect(items(s, { title: true })[0].msg.t).toBe('Believe : rappel')
    expect(JSON.stringify(items(S(s => { s.tasks = [task('t', 'Secret médical', due)] as State['tasks'] })))).not.toContain('Secret') // sans demande, le titre ne figure même pas dans le message
  })

  it('identifiant de tâche borné à 100 caractères ; au plus 100 rappels, les plus proches d’abord', async () => {
    await P()
    expect(items(S(s => { s.tasks = [task('x'.repeat(150), 'T', at(2 * 60 * MIN))] as State['tasks'] }))[0].ref).toBe('x'.repeat(100))
    const many = S(s => { s.tasks = Array.from({ length: 150 }, (_, i) => task('t' + i, 'T' + i, at((200 + i) * MIN))) as State['tasks'] })
    const r = items(many); expect(r.length).toBe(100); expect(r[0].ref).toBe('t0'); expect(r[99].ref).toBe('t99')
  })

  it('rappel de test : inclus tant qu’il est à venir ou passé depuis moins d’une minute, avec un texte à lui', async () => {
    await P()
    const s = S(s => { s.tasks = [task('t', 'T', at(2 * 60 * MIN))] as State['tasks'] })
    expect(items(s, { title: true, test: NOW + 45_000 }).map(i => i.ref)).toEqual(['test', 't'])
    expect(items(s, { title: true, test: NOW + 45_000 })[0].msg).toEqual({ v: 1, g: 'test', t: 'Believe : test', b: 'Les rappels application fermée fonctionnent.', d: null })
    expect(items(s, { title: false, test: NOW - 59_000 }).map(i => i.ref)).toContain('test')
    expect(items(s, { title: false, test: NOW - 61_000 }).map(i => i.ref)).toEqual(['t'])
    expect(items(s, { title: false, test: NOW + 2 * 3600e3 }).map(i => i.ref)).toEqual(['t']); expect(items(s, { title: false, test: 0 }).map(i => i.ref)).toEqual(['t'])
  })
})

describe('Navigateur : ce qui est vérifié avant d’activer', () => {
  it('support : notifications + Push + service worker = ok ; iPhone hors de l’écran d’accueil = ios-install ; sinon unsupported', async () => {
    const d = await device(); browser().install(); expect(d.P.support()).toBe('ok')
    browser({ noPush: true }).install(); expect(d.P.support()).toBe('unsupported')
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')
    expect(d.P.support()).toBe('ios-install')
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }); expect(d.P.support()).toBe('unsupported') // installée, mais pas de Push (iOS < 16.4) : rien à proposer
    Reflect.deleteProperty(navigator, 'standalone'); ua.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'); expect(d.P.support()).toBe('unsupported')
  })

  it('support : sans l’API Notification, rien n’est proposé ; un iPad récent (qui se présente comme un Mac tactile) est traité comme un iPhone', async () => {
    const d = await device(); browser().install(); expect(d.P.support()).toBe('ok')
    vi.stubGlobal('Notification', undefined); expect(d.P.support()).toBe('unsupported') // Push et service worker présents, mais aucune notification possible
    browser({ noPush: true }).install()
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')
    try {
      expect(d.P.support()).toBe('unsupported') // un vrai Mac : écran non tactile
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
      expect(d.P.support()).toBe('ios-install') // iPadOS : « Macintosh » avec écran tactile, hors de l'écran d'accueil
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }); expect(d.P.support()).toBe('unsupported') // installé, mais pas de Push
    } finally { Reflect.deleteProperty(navigator, 'maxTouchPoints'); Reflect.deleteProperty(navigator, 'standalone') }
  })

  it('refus dans l’ordre, sans rien écrire ni appeler le service : verrouillé, accord Notifications, accord Compte en ligne, navigateur, autorisation, connexion', async () => {
    const d = await device(); const br = browser({ perm: 'default' }).install()
    st(s => { s.ui.onboard = true })
    expect(await d.P.enable(false)).toEqual({ ok: false, why: 'consent-notif' })
    st(s => { s.consents.notif = true }); expect(await d.P.enable(false)).toEqual({ ok: false, why: 'consent-cloud' })
    st(s => { s.consents.cloud = true }); browser({ noPush: true }).install(); expect(await d.P.enable(false)).toEqual({ ok: false, why: 'unsupported' })
    br.install(); expect(await d.P.enable(false)).toEqual({ ok: false, why: 'permission' })
    br.perm = 'denied'; expect(await d.P.enable(false)).toEqual({ ok: false, why: 'permission' })
    br.perm = 'granted'; expect(await d.P.enable(false)).toEqual({ ok: false, why: 'signin' })
    expect(br.subscribe).not.toHaveBeenCalled(); expect(fake.calls).toEqual([]); expect(pref()).toBeNull(); expect(d.P.isOn()).toBe(false)
    expect(await d.P.arm()).toEqual({ ok: false, why: 'off' }); expect(await d.P.sendTest()).toEqual({ ok: false, why: 'off' }); expect(await d.P.setTitle(true)).toEqual({ ok: false, why: 'off' })
  })

  it('application verrouillée par le PIN : rien n’est fait, ni abonnement ni appel au service', async () => {
    const { d, br } = await ready()
    expect((await d.ops.enableVault('1234', 0, 1000)).ok).toBe(true); d.keys.closeKeys()
    expect(d.lib.load().locked).toBe(true)
    expect(await d.P.enable(false)).toEqual({ ok: false, why: 'locked' }); expect(br.subscribe).not.toHaveBeenCalled(); expect(fake.calls.filter(c => c.fn?.startsWith('bl_push'))).toEqual([])
  })

  it('données locales illisibles : rien n’est fait', async () => {
    const { d, br } = await ready()
    localStorage.setItem('believe:v2', '{pas du json'); expect(d.lib.load().err).toBeTruthy()
    expect(await d.P.enable(false)).toEqual({ ok: false, why: 'data' }); expect(br.subscribe).not.toHaveBeenCalled(); expect(fake.calls.filter(c => c.fn?.startsWith('bl_push'))).toEqual([])
  })

  it('service non configuré, clés d’envoi absentes, script SQL absent, service worker absent, abonnement refusé : un code précis chacun, et rien n’est activé', async () => {
    const { d, br } = await ready()
    fake.config = { ok: false, missing: ['SUPABASE_URL'], invalid: [] }; d.cloud.forgetConfig(); expect(await d.P.enable(false)).toEqual({ ok: false, why: 'config' })
    fake.config = { ...FakeCloud.defaultConfig(), vapid: null }; d.cloud.forgetConfig(); expect(await d.P.enable(false)).toEqual({ ok: false, why: 'vapid' })
    fake.config = FakeCloud.defaultConfig(); d.cloud.forgetConfig()
    fake.failNext = { match: 'bl_push_register', status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } }; expect(await d.P.enable(false)).toEqual({ ok: false, why: 'schema' })
    expect(br.sub).toBeNull() // l'abonnement créé pour rien a été retiré : le service n'a pas été prévenu
    fake.offline = true; expect(await d.P.enable(false)).toEqual({ ok: false, why: 'offline' }); fake.offline = false
    const refus = browser({ refuse: true }).install(); expect(await d.P.enable(false)).toEqual({ ok: false, why: 'subscribe' }); expect(refus.sub).toBeNull()
    expect(pref()).toBeNull(); expect(await rows('select * from bl.pushsubs')).toEqual([]); expect(await rows('select * from bl.reminders')).toEqual([])
  })
})

describe('Activer : abonnement, enregistrement, programmation chiffrée', () => {
  it('abonnement créé par le navigateur mais sans clés de chiffrement : refusé (« subscribe ») et retiré, rien n’est enregistré', async () => {
    const { d, br } = await ready(); const real = br.subscribe.getMockImplementation()!
    br.subscribe.mockImplementationOnce(async opt => { const s = await real(opt); (s as unknown as { getKey: () => null }).getKey = () => null; return s })
    expect(await d.P.enable(false)).toEqual({ ok: false, why: 'subscribe' })
    expect(br.sub).toBeNull(); expect(calls('bl_push_register')).toEqual([]); expect(pref()).toBeNull() // l'abonnement inutilisable n'est pas gardé
  })
  it('crée l’abonnement avec la clé d’envoi du déploiement (userVisibleOnly), l’enregistre, programme chaque rappel chiffré pour CET abonnement ; le service ne garde ni titre ni texte', async () => {
    const { d, br } = await ready({ tasks: [task('t1', 'Rendez-vous médical secret', at(60 * MIN)), task('t2', 'Autre', at(3 * 60 * MIN))] })
    const r = await d.P.enable(true)
    expect(r.ok && r.armed).toBe(2)
    expect(br.subscribe).toHaveBeenCalledTimes(1); const o = br.subscribe.mock.calls[0][0]; expect(o.userVisibleOnly).toBe(true); expect([...(o.applicationServerKey as Uint8Array)]).toEqual([...b64uDec(VAPID)])
    expect(pref()).toEqual({ on: true, title: true, test: 0 })
    const sub = await rows<{ ep: string }>('select ep from bl.pushsubs'); expect(sub).toEqual([{ ep: br.sub!.endpoint }])
    const rem = await reminders()
    expect(rem.map(x => [x.ref, x.at.getTime() - NOW])).toEqual([['t1', 30 * MIN], ['t2', 150 * MIN]]); expect(rem.every(x => x.ep === br.sub!.endpoint)).toBe(true)
    // le navigateur (seul à détenir la clé privée) déchiffre : titre et échéance, à l'identique
    expect(br.open(rem[0].body)).toEqual({ v: 1, g: 't1', t: 'Rendez-vous médical secret', b: null, d: Date.parse(at(60 * MIN)) })
    // ce que le service garde : rien de lisible
    const dumpAll = JSON.stringify(await rows('select * from bl.reminders')) + JSON.stringify(calls('bl_push_set'))
    expect(dumpAll).not.toContain('médical'); expect(dumpAll).not.toContain('Rendez-vous'); expect(dumpAll).not.toContain('Autre')
    // tous les messages ont la même taille chiffrée : la longueur du titre ne se devine pas
    expect(new Set(rem.map(x => x.body.length)).size).toBe(1)
  })

  it('sans demande de titre : le message dit seulement « Une tâche arrive à échéance. », le titre n’existe nulle part dans ce qui part', async () => {
    const { d, br } = await ready({ tasks: [task('t1', 'Rendez-vous médical secret', at(60 * MIN))] })
    expect((await d.P.enable(false)).ok).toBe(true)
    const rem = await reminders(); expect(br.open(rem[0].body)).toEqual({ v: 1, g: 't1', t: 'Believe : rappel', b: 'Une tâche arrive à échéance.', d: null })
    expect(JSON.stringify(calls('bl_push_set'))).not.toContain('médical')
  })

  it('un seul appel au service quand rien n’a changé ; une tâche ajoutée, terminée ou rappelée reprogramme ; le délai de rappel aussi', async () => {
    const { d } = await ready(); await d.P.enable(false)
    const n = () => calls('bl_push_set').length; expect(n()).toBe(1)
    expect(await d.P.arm()).toMatchObject({ ok: true, armed: 1 }); expect(n()).toBe(1) // rien n'a changé : aucun appel
    st(s => { s.checks['2026-10-23'] = ['h1'] }); await d.P.arm(); expect(n()).toBe(1) // un changement qui ne touche pas les tâches : aucun appel
    st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) }); await d.P.arm(); expect(n()).toBe(2); expect((await reminders()).map(x => x.ref)).toEqual(['t1', 't2'])
    st(s => { s.tasks[0].done = true }); await d.P.arm(); expect((await reminders()).map(x => x.ref)).toEqual(['t2'])
    st(s => { s.tasks[1].r = s.tasks[1].due as string }); await d.P.arm(); expect(await reminders()).toEqual([]) // rappel déjà donné dans l'application ouverte : plus programmé
    st(s => { s.tasks[1].r = undefined; s.settings.remind = 60 }); await d.P.arm(); expect((await reminders())[0].at.getTime() - NOW).toBe(60 * MIN)
    const before = n(); expect(await d.P.arm(true)).toMatchObject({ ok: true }); expect(n()).toBe(before + 1) // « Reprogrammer maintenant » : rejoué même sans changement
  })

  it('un envoi plus vieux de 12 h est renouvelé même sans changement (le service garde l’abonnement « vu » : il oublie ceux restés 90 jours sans signe)', async () => {
    const { d } = await ready({ tasks: [task('t1', 'Lointaine', at(30 * DAY))] }); await d.P.enable(false)
    const n = () => calls('bl_push_set').length; expect(n()).toBe(1)
    vi.setSystemTime(NOW + 11 * 3600e3); await d.P.arm(); expect(n()).toBe(1)
    vi.setSystemTime(NOW + 12 * 3600e3 + 1000); await d.P.arm(); expect(n()).toBe(2)
    await d.P.arm(); expect(n()).toBe(2)
  })

  it('l’abonnement n’est enregistré qu’une fois par ouverture ; oublié par le service (supprimé ailleurs), il est réenregistré UNE fois puis la programmation réussit', async () => {
    const { d, br } = await ready(); await d.P.enable(false)
    expect(calls('bl_push_register').length).toBe(1); st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) }); await d.P.arm(); expect(calls('bl_push_register').length).toBe(1)
    await fake.db.query('delete from bl.pushsubs') // supprimé côté service
    st(s => { s.tasks.push(task('t3', 'Trois', at(3 * 60 * MIN)) as State['tasks'][0]) })
    expect(await d.P.arm()).toMatchObject({ ok: true, armed: 3 }); expect(calls('bl_push_register').length).toBe(2); expect((await rows('select ep from bl.pushsubs'))[0]).toEqual({ ep: br.sub!.endpoint })
    expect((await reminders()).length).toBe(3)
  })

  it('abonnement du navigateur disparu : recréé sans geste de la personne et réenregistré ; abonnement fait avec une autre clé d’envoi : remplacé', async () => {
    const { d, br } = await ready(); await d.P.enable(false); const first = br.sub!.endpoint
    br.sub = null; st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) })
    expect(await d.P.arm()).toMatchObject({ ok: true, armed: 2 }); expect(br.sub!.endpoint).not.toBe(first); expect((await rows('select ep from bl.pushsubs')).map(r => r.ep)).toContain(br.sub!.endpoint)
    const old = br.sub!; old.options.applicationServerKey = new Uint8Array(65).fill(9).buffer // le déploiement a changé ses clés
    st(s => { s.tasks.push(task('t3', 'Trois', at(3 * 60 * MIN)) as State['tasks'][0]) })
    expect(await d.P.arm()).toMatchObject({ ok: true, armed: 3 }); expect(old.unsubscribe).toHaveBeenCalledTimes(1); expect(br.sub).not.toBe(old); expect([...new Uint8Array(br.sub!.options.applicationServerKey!)]).toEqual([...b64uDec(VAPID)])
  })

  it('pannes : hors ligne, session refusée, service en erreur, script SQL absent — un code, rien de faux affiché, et le repère « activé » reste pour réessayer', async () => {
    const { d } = await ready(); await d.P.enable(false)
    st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) })
    fake.offline = true; expect(await d.P.arm()).toEqual({ ok: false, why: 'offline' }); fake.offline = false
    fake.failNext = { match: 'bl_push_set', status: 500, body: { message: 'boom' } }; expect(await d.P.arm()).toEqual({ ok: false, why: 'server' })
    fake.failNext = { match: 'bl_push_set', status: 404, body: { code: 'PGRST202', message: 'x' } }; expect(await d.P.arm()).toEqual({ ok: false, why: 'schema' })
    expect(d.P.isOn()).toBe(true); expect(await d.P.arm()).toMatchObject({ ok: true, armed: 2 }) // le réseau est revenu : la programmation est refaite
    fake.revokeAll(); fake.expireAccess(); expect(await d.P.arm(true)).toEqual({ ok: false, why: 'signin' })
  })

  it('un empêchement passager n’éteint pas les rappels : seul le retrait d’un accord les arrête', async () => {
    const { d, br } = await ready(); await d.P.enable(false)
    br.perm = 'denied'; expect(await d.P.arm(true)).toEqual({ ok: false, why: 'permission' }); expect(d.P.isOn()).toBe(true); expect(br.sub).not.toBeNull()
    expect((await rows('select ep from bl.pushsubs')).length).toBe(1); expect(calls('bl_push_unregister')).toEqual([]) // le service n'a rien effacé
    br.perm = 'granted'; expect(await d.P.arm(true)).toMatchObject({ ok: true, armed: 1 })
    st(s => { s.consents.notif = false }); expect(await d.P.arm(true)).toEqual({ ok: false, why: 'consent-notif' }); expect(d.P.isOn()).toBe(false) // l'accord retiré arrête tout
  })

  it('programmation après l’activation : service non configuré, clés d’envoi retirées, service worker disparu, abonnement sans clés : un code précis chacun, le repère « activé » reste', async () => {
    const { d, br } = await ready(); await d.P.enable(false)
    fake.config = { ok: false, missing: ['SUPABASE_URL'], invalid: [] }; d.cloud.forgetConfig(); expect(await d.P.arm(true)).toEqual({ ok: false, why: 'config' })
    fake.config = { ...FakeCloud.defaultConfig(), vapid: null }; d.cloud.forgetConfig(); expect(await d.P.arm(true)).toEqual({ ok: false, why: 'vapid' })
    fake.config = FakeCloud.defaultConfig(); d.cloud.forgetConfig()
    const sw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')!
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { get ready() { return Promise.reject(new Error('indisponible')) }, getRegistration: async () => br.reg } })
    expect(await d.P.arm(true)).toEqual({ ok: false, why: 'worker' }); Object.defineProperty(navigator, 'serviceWorker', sw)
    const keys = br.sub!.getKey; br.sub!.getKey = () => null; expect(await d.P.arm(true)).toEqual({ ok: false, why: 'subscribe' }); br.sub!.getKey = keys
    expect(d.P.isOn()).toBe(true); expect(await d.P.arm(true)).toMatchObject({ ok: true, armed: 1 })
  })

  it('à chaque nouvelle ouverture de Believe, l’abonnement est enregistré une fois auprès du service (sa date de « vu » est rafraîchie)', async () => {
    const { d } = await ready(); await d.P.enable(false); expect(calls('bl_push_register').length).toBe(1)
    d.P.stop(); const d2 = await device() // page rechargée : modules neufs, même stockage local
    expect(await d2.P.arm()).toMatchObject({ ok: true, armed: 1 }); expect(calls('bl_push_register').length).toBe(2)
    st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) }); await d2.P.arm(); expect(calls('bl_push_register').length).toBe(2) // une seule fois par ouverture
  })

  it('refus du service d’une réponse inattendue : « server », jamais un nombre inventé', async () => {
    const { d } = await ready(); await d.P.enable(false)
    st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) })
    const real = fake.fetch; vi.stubGlobal('fetch', async (i: RequestInfo | URL, init?: RequestInit) => { const r = await real(i, init); const u = typeof i === 'string' ? i : i instanceof URL ? i.href : i.url; return u.includes('bl_push_set') ? new Response(JSON.stringify({ armed: 'beaucoup' }), { status: 200 }) : r })
    expect(await d.P.arm()).toEqual({ ok: false, why: 'server' })
  })

  it('deux appareils du même compte : chacun garde ses propres rappels, sans toucher à ceux de l’autre', async () => {
    const A = browser(), B = browser()
    const { d } = await ready({ br: A }); await d.P.enable(false); const epA = A.sub!.endpoint
    B.install(); d.P.stop(); localStorage.removeItem('believe:push'); vi.resetModules(); const d2 = await import('./push'); dev.P = d2
    expect((await d2.enable(true)).ok).toBe(true); const epB = B.sub!.endpoint
    const rem = await reminders(); expect(rem.length).toBe(2); expect(new Set(rem.map(x => x.ep))).toEqual(new Set([epA, epB]))
    // chacun ne peut ouvrir que son message
    const ofA = rem.find(x => x.ep === epA)!, ofB = rem.find(x => x.ep === epB)!
    expect(A.open(ofA.body).t).toBe('Believe : rappel'); expect(B.open(ofB.body).t).toBe('Appeler Paul')
    expect(() => B.open(ofA.body)).toThrow(); expect(() => A.open(ofB.body)).toThrow()
  })

  it('le rappel de test : programmé dans 45 s avec son texte, repris par les reprogrammations pendant 1 minute, puis oublié', async () => {
    const { d, br } = await ready(); await d.P.enable(false)
    const r = await d.P.sendTest(); expect(r.ok && r.when).toBe(NOW + 45_000)
    let rem = await reminders(); expect(rem.map(x => x.ref)).toEqual(['test', 't1']); expect(rem[0].at.getTime()).toBe(NOW + 45_000)
    expect(br.open(rem[0].body)).toEqual({ v: 1, g: 'test', t: 'Believe : test', b: 'Les rappels application fermée fonctionnent.', d: null })
    expect(d.P.testAt()).toBe(NOW + 45_000)
    vi.setSystemTime(NOW + 100_000); await d.P.arm(true); expect((await reminders()).map(x => x.ref)).toContain('test') // encore pour 1 minute après l'heure : le planificateur peut ne pas être passé
    vi.setSystemTime(NOW + 45_000 + 61_000); await d.P.arm(true); expect((await reminders()).map(x => x.ref)).toEqual(['t1']); expect(d.P.testAt()).toBe(0); expect(pref().test).toBe(0)
  })

  it('le rappel de test déjà parti n’est pas renvoyé : dès que le planificateur est passé après son heure, rouvrir Believe (en touchant la notification) ne le reprogramme pas', async () => {
    const { d } = await ready(); await d.P.enable(false)
    expect((await d.P.sendTest()).ok).toBe(true)
    // le planificateur passe après l'heure du test (il le prend, l'envoie, puis le supprime) ; l'application est rouverte 10 s plus tard
    vi.setSystemTime(NOW + 50_000)
    const got = (await rows<{ r: { id: number }[] }>('select public.bl_push_claim(50) as r'))[0].r; expect(got.length).toBe(1)
    await rows('select public.bl_push_done(array[' + got.map(x => x.id).join(',') + ']::bigint[], \'{}\'::text[])')
    expect((await reminders()).map(x => x.ref)).toEqual(['t1'])
    vi.setSystemTime(NOW + 60_000); expect((await d.P.arm()).ok).toBe(true)
    expect((await reminders()).map(x => x.ref)).toEqual(['t1']); expect(pref().test).toBe(0); expect(d.P.testAt()).toBe(0)
    expect(calls('bl_push_status').length).toBe(1) // un seul contrôle de l'état du service, fait parce que l'heure du test était passée
    vi.setSystemTime(NOW + 70_000); await d.P.arm(true); expect(calls('bl_push_status').length).toBe(1)
  })

  it('le rappel de test dont le planificateur n’est pas encore passé (ou était passé avant son heure) reste programmé ; sans état lisible, il n’est gardé que 60 s après son heure', async () => {
    const { d } = await ready(); await d.P.enable(false)
    vi.setSystemTime(NOW + 10_000); await d.P.sendTest() // heure du test : NOW + 55 s
    vi.setSystemTime(NOW + 30_000); await rows('select public.bl_push_claim(50)') // le planificateur est passé AVANT l'heure du test : il n'a rien pris
    expect((await reminders()).map(x => x.ref)).toContain('test')
    vi.setSystemTime(NOW + 70_000); expect((await d.P.arm(true)).ok).toBe(true); expect((await reminders()).map(x => x.ref)).toContain('test'); expect(pref().test).toBe(NOW + 55_000) // heure passée, planificateur pas repassé : gardé
    fake.failNext = { match: 'bl_push_status', status: 500 }; vi.setSystemTime(NOW + 80_000); expect((await d.P.arm(true)).ok).toBe(true)
    expect((await reminders()).map(x => x.ref)).toContain('test') // état illisible : la règle des 60 s s'applique (encore dans les 60 s)
    vi.setSystemTime(NOW + 55_000 + 61_000); expect((await d.P.arm(true)).ok).toBe(true) // plus de 60 s après l'heure : abandonné sans même consulter le service
    expect((await reminders()).map(x => x.ref)).toEqual(['t1']); expect(pref().test).toBe(0)
  })

  it('« Afficher le titre » : le réglage de cet appareil reprogramme aussitôt ; le mode discret l’emporte', async () => {
    const { d, br } = await ready(); await d.P.enable(false)
    expect(br.open((await reminders())[0].body).t).toBe('Believe : rappel')
    expect((await d.P.setTitle(true)).ok).toBe(true); expect(d.P.titleOn()).toBe(true); expect(br.open((await reminders())[0].body).t).toBe('Appeler Paul')
    st(s => { s.discret = true }); await d.P.arm(); expect(br.open((await reminders())[0].body).t).toBe('Believe : rappel')
    expect((await d.P.setTitle(false)).ok).toBe(true); expect(d.P.titleOn()).toBe(false)
  })
})

describe('Désactiver, retirer un accord, se déconnecter, supprimer le compte', () => {
  it('désactiver : repère effacé tout de suite, service prévenu (abonnement et rappels supprimés), abonnement du navigateur retiré, plus rien programmé ensuite', async () => {
    const { d, br } = await ready(); await d.P.enable(true); const sub = br.sub!
    expect(await d.P.disable()).toBe('removed')
    expect(pref()).toBeNull(); expect(sub.unsubscribe).toHaveBeenCalledTimes(1); expect(br.sub).toBeNull()
    expect(await rows('select * from bl.pushsubs')).toEqual([]); expect(await rows('select * from bl.reminders')).toEqual([])
    expect(await d.P.arm()).toEqual({ ok: false, why: 'off' }); expect(await d.P.disable()).toBe('none'); expect(calls('bl_push_set').length).toBe(1)
  })

  it('hors ligne : désactivé ici quand même (repère effacé, abonnement retiré), résultat « failed » : le service n’a pas confirmé', async () => {
    const { d, br } = await ready(); await d.P.enable(false)
    fake.offline = true; expect(await d.P.disable()).toBe('failed'); fake.offline = false
    expect(pref()).toBeNull(); expect(br.sub).toBeNull(); expect((await rows('select * from bl.reminders')).length).toBe(1) // reste côté service jusqu'à ce qu'il constate que l'abonnement n'existe plus
  })

  it('l’accord « Notifications » ou « Compte en ligne » retiré (ici, ailleurs, par une importation) : la programmation suivante arrête tout et efface ce qui était déposé', async () => {
    for (const k of ['notif', 'cloud'] as const) {
      await fake.reset(); localStorage.clear()
      const { d, br } = await ready(); await d.P.enable(false); expect((await reminders()).length).toBe(1)
      st(s => { s.consents[k] = false })
      const r = await d.P.arm(); expect(r).toEqual({ ok: false, why: k === 'notif' ? 'consent-notif' : 'consent-cloud' })
      await vi.waitFor(async () => { expect(await rows('select * from bl.reminders')).toEqual([]) })
      expect(pref()).toBeNull(); expect(br.sub).toBeNull(); expect(await rows('select * from bl.pushsubs')).toEqual([])
    }
  })

  it('se déconnecter (ou retirer « Compte en ligne ») : l’abonnement et les rappels sont supprimés AVANT la fin de la session, le repère local disparaît', async () => {
    const { d, br } = await ready(); await d.P.enable(false)
    const r = await d.acc.leaveCloud(); expect(r.cards).toBe('none')
    expect(pref()).toBeNull(); expect(br.sub).toBeNull(); expect(await rows('select * from bl.pushsubs')).toEqual([]); expect(await rows('select * from bl.reminders')).toEqual([])
    const order = fake.calls.map(c => c.fn ?? c.path.split('?')[0]); expect(order.indexOf('bl_push_unregister')).toBeGreaterThan(-1); expect(order.indexOf('bl_push_unregister')).toBeLessThan(order.findIndex(p => p.startsWith('/auth/v1/logout')))
    expect(d.cloud.getSession()).toBeNull()
  })

  it('supprimer le compte en ligne : le service efface tout, cet appareil retire son abonnement et son repère', async () => {
    const { d, br } = await ready(); await d.P.enable(false)
    const r = await d.acc.deleteAccount(); expect(r).toEqual({ ok: true, verified: true })
    expect(pref()).toBeNull(); expect(br.sub).toBeNull(); expect(await rows('select * from bl.reminders')).toEqual([])
  })

  it('le repère local compte comme une trace du compte (cloudUsed) : il est annoncé tant qu’il existe, et disparaît avec « Effacer mes données »', async () => {
    const { d } = await ready({ br: browser() }); await d.P.enable(false)
    expect(d.hook.pushOn()).toBe(true); expect(d.hook.cloudUsed()).toBe(true)
    expect(d.lib.wipeLocal()).toBe(true); expect(d.hook.pushOn()).toBe(false); expect(localStorage.length).toBe(0)
  })
})

describe('Déclencheurs automatiques et passerelle (cloudhook)', () => {
  it('touch : une seule programmation après un court délai de calme, même après plusieurs enregistrements', async () => {
    vi.useRealTimers(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    const { d } = await ready(); await d.P.enable(false); const n = () => calls('bl_push_set').length
    st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) })
    d.P.touch(); d.P.touch(); d.P.touch(); await vi.advanceTimersByTimeAsync(1900); expect(n()).toBe(1)
    await vi.advanceTimersByTimeAsync(200); await vi.waitFor(() => expect(n()).toBe(2))
  })

  it('start : un premier tour 3 s après l’ouverture, puis au retour au premier plan, au retour du réseau et quand la synchronisation remplace les données ; stop : plus rien', async () => {
    vi.useRealTimers(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    const { d } = await ready(); await d.P.enable(false); await vi.advanceTimersByTimeAsync(3100)
    const n = () => calls('bl_push_set').length, base = n()
    d.P.stop(); d.P.start()
    st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) }); await vi.advanceTimersByTimeAsync(3100); await vi.waitFor(() => expect(n()).toBe(base + 1))
    for (const [ev, target] of [['visibilitychange', document], ['online', window], ['believe:reload', window]] as const) {
      st(s => { s.tasks.push(task('x' + ev, 'X', at(5 * 60 * MIN + ev.length * MIN)) as State['tasks'][0]) }); const b = n()
      target.dispatchEvent(new Event(ev)); await vi.advanceTimersByTimeAsync(2100); await vi.waitFor(() => expect(n(), ev).toBe(b + 1))
    }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); st(s => { s.tasks.push(task('cache', 'C', at(9 * 60 * MIN)) as State['tasks'][0]) }); const h = n()
    document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(2100); expect(n()).toBe(h) // page cachée : pas de tour
    d.P.stop(); document.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(5000); expect(n()).toBe(h)
  })

  it('la passerelle ne charge rien tant que les rappels application fermée ne sont pas activés', async () => {
    const { d } = await ready({ br: browser() })
    expect(d.hook.pushOn()).toBe(false); d.hook.touchPush(); d.hook.startPush(); d.hook.stopPush(); expect(await d.hook.disablePush()).toBe('none')
    await d.P.enable(false); expect(d.hook.pushOn()).toBe(true)
    st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) })
    d.hook.touchPush(); await vi.waitFor(() => expect(calls('bl_push_set').length).toBe(2), { timeout: 6000 }) // (le délai de calme de 2 s s'écoule en temps réel ; seule la date est figée)
    expect(await d.hook.disablePush()).toBe('removed'); expect(d.hook.pushOn()).toBe(false)
  })

  it('status : abonnements, rappels en attente, dernier passage du planificateur (jamais, puis à l’heure du passage) et écart d’horloge', async () => {
    const { d } = await ready(); await d.P.enable(false)
    let s = await d.P.status(); expect(s).toMatchObject({ ok: true, subs: 1, pending: 1, tick: null }); expect(s.ok && Math.abs(s.skew)).toBeLessThan(5000)
    await fake.db.query("insert into bl.meta (k, v) values ('tick', $1) on conflict (k) do update set v = excluded.v", [new Date(NOW - 90_000).toISOString()])
    s = await d.P.status(); expect(s.ok && s.tick).toBe(NOW - 90_000)
    expect(await d.P.subscribed()).toBe(true)
    await d.P.disable(); expect(await d.P.subscribed()).toBe(false)
    fake.revokeAll(); fake.expireAccess(); expect(await d.P.status()).toEqual({ ok: false, why: 'signin' })
  })
})

describe('Rappels application fermée : déclencheurs, test, désactivation et état dans les cas limites', () => {
  const fakeTimers = () => { vi.useRealTimers(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW }) }
  const addTask = (id: string) => st(s => { s.tasks.push(task(id, 'Une autre tâche', at(2 * 60 * MIN)) as State['tasks'][0]) })

  it('activer démarre les déclencheurs : un changement suivi d’un retour du réseau reprogramme tout seul, sans autre appel à start()', async () => {
    fakeTimers(); const { d } = await ready(); await d.P.enable(false); await vi.advanceTimersByTimeAsync(3100)
    const n = () => calls('bl_push_set').length, base = n()
    addTask('t2'); window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(2100); await vi.waitFor(() => expect(n()).toBe(base + 1))
  })

  it('stop efface la mémoire : l’abonnement est de nouveau enregistré et tout est renvoyé à la prochaine programmation', async () => {
    fakeTimers(); const { d } = await ready(); await d.P.enable(false)
    expect(calls('bl_push_register').length).toBe(1); const sets = calls('bl_push_set').length
    d.P.stop(); expect(await d.P.arm()).toMatchObject({ ok: true, armed: 1 })
    expect(calls('bl_push_register').length).toBe(2); expect(calls('bl_push_set').length).toBe(sets + 1)
  })

  it('stop annule une programmation déjà en attente : rien ne part ensuite', async () => {
    fakeTimers(); const { d } = await ready(); await d.P.enable(false); await vi.advanceTimersByTimeAsync(3100)
    addTask('t2'); const n = () => calls('bl_push_set').length, base = n(), waiting = vi.getTimerCount()
    d.P.touch(); expect(vi.getTimerCount(), 'une programmation attend son délai de calme').toBe(waiting + 1)
    d.P.stop(); expect(vi.getTimerCount(), 'arrêter annule cette attente aussitôt (sans attendre de voir si quelque chose part)').toBe(waiting)
    await vi.advanceTimersByTimeAsync(10_000); expect(n()).toBe(base)
  })

  it('start appelé deux fois ne repousse pas le premier tour', async () => {
    fakeTimers(); const { d } = await ready(); await d.P.enable(false); await vi.advanceTimersByTimeAsync(3100)
    d.P.stop(); const n = () => calls('bl_push_set').length, base = n() // la mémoire est vidée : le premier tour renvoie tout
    d.P.start(); await vi.advanceTimersByTimeAsync(2900); d.P.start(); await vi.advanceTimersByTimeAsync(200)
    await vi.waitFor(() => expect(n()).toBe(base + 1))
  })

  it('rappel de test : si la programmation échoue, l’heure du test n’est pas gardée en attente', async () => {
    const { d } = await ready(); await d.P.enable(false)
    fake.offline = true; expect(await d.P.sendTest()).toEqual({ ok: false, why: 'offline' }); fake.offline = false
    expect(pref()).toEqual({ on: true, title: false, test: 0 }); expect(d.P.testAt()).toBe(0)
    expect((await d.P.sendTest()).ok).toBe(true); expect(d.P.testAt()).toBe(NOW + 45_000) // et le suivant, qui réussit, est bien gardé
  })

  it('désactiver sans connexion : l’abonnement du navigateur est retiré, mais le service n’a rien confirmé (« failed ») et aucun appel ne lui est fait', async () => {
    const { d, br } = await ready(); await d.P.enable(false); const sub = br.sub!
    d.cloud.dropSession(); const n = fake.calls.length
    expect(await d.P.disable()).toBe('failed'); expect(sub.unsubscribe).toHaveBeenCalledTimes(1); expect(br.sub).toBeNull(); expect(pref()).toBeNull()
    expect(calls('bl_push_unregister')).toEqual([]); expect(fake.calls.length).toBe(n)
    expect((await rows('select * from bl.pushsubs')).length).toBe(1) // le service garde l'abonnement jusqu'à ce qu'il constate qu'il n'existe plus
  })

  it('activé mais abonnement du navigateur introuvable : « failed » (le service garde peut-être un reste que cet appareil ne sait plus nommer), connecté ou non', async () => {
    for (const signedIn of [true, false]) {
      await fake.reset(); localStorage.clear()
      const { d, br } = await ready(); await d.P.enable(false); br.sub = null
      if (!signedIn) d.cloud.dropSession()
      expect(await d.P.disable(), signedIn ? 'connecté' : 'déconnecté').toBe('failed'); expect(pref()).toBeNull()
    }
  })

  it('état sans connexion : « signin » sans aucune requête, ni au service ni pour la configuration', async () => {
    const d = await device(); const f = vi.fn(fake.fetch); vi.stubGlobal('fetch', f)
    expect(await d.P.status()).toEqual({ ok: false, why: 'signin' }); expect(f).not.toHaveBeenCalled()
  })

  it('état : une réponse du service qui n’a pas la bonne forme est refusée (« server »), jamais affichée', async () => {
    const { d } = await ready(); await d.P.enable(false); const now = new Date(NOW).toISOString()
    for (const body of [{ subs: 'beaucoup', pending: 1, tick: null, now }, { subs: 1, pending: -1, tick: null, now }, { subs: 1, pending: 1, tick: 'hier', now }, { subs: 1, pending: 1, tick: null }, [], 'texte']) {
      fake.failNext = { match: 'bl_push_status', status: 200, body }; expect(await d.P.status(), JSON.stringify(body)).toEqual({ ok: false, why: 'server' })
    }
    fake.failNext = { match: 'bl_push_status', status: 200, body: { subs: 1, pending: 2, tick: null, now } }; expect(await d.P.status()).toMatchObject({ ok: true, subs: 1, pending: 2, tick: null })
  })

  it('abonnement du navigateur : illisible = « null » (inconnu), jamais « absent » ; sans service worker = « false »', async () => {
    const { d } = await ready(); await d.P.enable(false); expect(await d.P.subscribed()).toBe(true)
    const sw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')!
    const use = (value: unknown) => Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value })
    try {
      use({ getRegistration: async () => { throw new Error('illisible') } }); expect(await d.P.subscribed()).toBeNull()
      use({ getRegistration: async () => ({ pushManager: { getSubscription: async () => { throw new Error('illisible') } } }) }); expect(await d.P.subscribed()).toBeNull()
      use({ getRegistration: async () => undefined }); expect(await d.P.subscribed()).toBe(false)
    } finally { Object.defineProperty(navigator, 'serviceWorker', sw) }
  })
})

describe('Rappels application fermée : actions simultanées, horloge du service, service worker absent', () => {
  const fakeTimers = () => { vi.useRealTimers(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW }) }
  const urlOf = (i: RequestInfo | URL) => (typeof i === 'string' ? i : i instanceof URL ? i.href : i.url)
  /** Retient le prochain appel au service qui contient `fn` : `avant` = il n'atteint le service qu'à `release()` ; `apres` = le service le traite, mais la réponse n'arrive qu'à `release()`. */
  const hold = (fn: string, when: 'avant' | 'apres') => {
    const real = fake.fetch; let release!: () => void, reached!: () => void, once = true
    const gate = new Promise<void>(r => { release = r }), arrived = new Promise<void>(r => { reached = r })
    vi.stubGlobal('fetch', async (i: RequestInfo | URL, init?: RequestInit) => {
      if (!once || !urlOf(i).includes(fn)) return real(i, init)
      once = false
      if (when === 'avant') { reached(); await gate; return real(i, init) }
      const r = await real(i, init); reached(); await gate; return r
    })
    return { release, arrived }
  }
  /** Le service a `ms` d'avance (ou de retard, si négatif) sur l'appareil : son heure et celle de son dernier passage sont décalées d'autant. */
  const offset = (ms: number) => {
    const real = fake.fetch, shift = (t: string) => new Date(Date.parse(t) + ms).toISOString()
    vi.stubGlobal('fetch', async (i: RequestInfo | URL, init?: RequestInit) => {
      const r = await real(i, init); if (!urlOf(i).includes('bl_push_status')) return r
      const j = await r.json() as { tick: string | null; now: string }
      return new Response(JSON.stringify({ ...j, now: shift(j.now), tick: j.tick === null ? null : shift(j.tick) }), { status: 200 })
    })
  }

  it('le rappel de test passé est remis à zéro à la fin du tour SANS écraser un réglage changé pendant l’envoi : le titre coché entre-temps est conservé', async () => {
    const { d, br } = await ready(); await d.P.enable(false); expect((await d.P.sendTest()).ok).toBe(true)
    vi.setSystemTime(NOW + 200_000) // le rappel de test est passé depuis plus d'une minute : il n'est plus reprogrammé, et son repère est remis à zéro à la fin du tour
    const h = hold('bl_push_set', 'apres'), run = d.P.arm(true); await h.arrived
    const change = d.P.setTitle(true) // la personne coche « Afficher le titre » pendant l'envoi : la reprogrammation passe derrière
    expect(pref()).toMatchObject({ on: true, title: true }); h.release(); await run; await change
    expect(pref()).toEqual({ on: true, title: true, test: 0 }); expect(d.P.titleOn()).toBe(true)
    expect(br.open((await reminders())[0].body).t).toBe('Appeler Paul')
  })

  it('désactiver pendant qu’une programmation se termine : le repère « activé » ne revient pas à la fin du tour, et rien ne reste sur le service', async () => {
    const { d, br } = await ready(); await d.P.enable(false); expect((await d.P.sendTest()).ok).toBe(true); vi.setSystemTime(NOW + 200_000)
    const h = hold('bl_push_set', 'apres'), run = d.P.arm(true); await h.arrived // le service a pris la programmation, sa réponse n'est pas encore arrivée
    expect(await d.P.disable()).toBe('removed'); expect(pref()).toBeNull()
    h.release(); await run
    expect(pref(), 'le repère « activé » ne revient pas').toBeNull(); expect(d.P.isOn()).toBe(false); expect(br.sub).toBeNull()
    expect(await rows('select * from bl.pushsubs')).toEqual([]); expect(await rows('select * from bl.reminders')).toEqual([])
  })

  it('désactiver pendant que la programmation attend le service (état du rappel de test) : elle ne recrée ni l’abonnement ni les rappels', async () => {
    const { d, br } = await ready(); await d.P.enable(false); expect((await d.P.sendTest()).ok).toBe(true); vi.setSystemTime(NOW + 60_000) // l'heure du test est passée : l'état du service est consulté
    const h = hold('bl_push_status', 'avant'), run = d.P.arm(); await h.arrived
    expect(await d.P.disable()).toBe('removed')
    h.release(); expect(await run).toEqual({ ok: false, why: 'off' })
    expect(await rows('select * from bl.pushsubs')).toEqual([]); expect(await rows('select * from bl.reminders')).toEqual([])
    expect(calls('bl_push_register').length, 'aucun nouvel enregistrement').toBe(1); expect(pref()).toBeNull(); expect(br.sub).toBeNull()
  })

  it('désactiver pendant que la programmation est en route : le service la reçoit après la suppression, elle ne recrée PAS l’abonnement supprimé', async () => {
    const { d, br } = await ready(); await d.P.enable(false)
    st(s => { s.tasks.push(task('t2', 'Deux', at(2 * 60 * MIN)) as State['tasks'][0]) })
    const h = hold('bl_push_set', 'avant'), run = d.P.arm(); await h.arrived // l'envoi est parti, il n'a pas encore atteint le service
    expect(await d.P.disable()).toBe('removed'); expect(br.sub).toBeNull()
    h.release(); expect(await run).toEqual({ ok: false, why: 'off' })
    expect(await rows('select * from bl.pushsubs')).toEqual([]); expect(await rows('select * from bl.reminders')).toEqual([])
    expect(calls('bl_push_register').length, 'aucun nouvel enregistrement').toBe(1); expect(pref()).toBeNull()
  })

  it('horloge du service en avance : l’heure du dernier passage du planificateur est ramenée à celle de l’appareil, le rappel de test pas encore parti reste programmé', async () => {
    const { d } = await ready(); await d.P.enable(false); offset(5 * MIN)
    vi.setSystemTime(NOW + 10_000); expect((await d.P.sendTest()).ok).toBe(true) // heure du test (horloge de l'appareil) : NOW + 55 s
    vi.setSystemTime(NOW + 30_000); await rows('select public.bl_push_claim(50)') // le planificateur passe AVANT l'heure du test : il ne prend rien
    vi.setSystemTime(NOW + 70_000); expect((await d.P.arm(true)).ok).toBe(true)
    expect((await reminders()).map(x => x.ref)).toContain('test'); expect(pref().test).toBe(NOW + 55_000)
    const s = await d.P.status(); expect(s.ok && Math.round(s.skew / MIN)).toBe(5) // l'écart mesuré : 5 minutes
  })

  it('horloge du service en retard : le rappel de test déjà parti n’est pas renvoyé, même si l’heure brute de son dernier passage paraît antérieure à celle du test', async () => {
    const { d } = await ready(); await d.P.enable(false); offset(-5 * MIN)
    expect((await d.P.sendTest()).ok).toBe(true) // heure du test (horloge de l'appareil) : NOW + 45 s
    vi.setSystemTime(NOW + 50_000)
    const got = (await rows<{ r: { id: number }[] }>('select public.bl_push_claim(50) as r'))[0].r; expect(got.length).toBe(1) // le planificateur passe après l'heure du test : il le prend
    await rows('select public.bl_push_done(array[' + got.map(x => x.id).join(',') + ']::bigint[], \'{}\'::text[])')
    vi.setSystemTime(NOW + 60_000); expect((await d.P.arm()).ok).toBe(true)
    expect((await reminders()).map(x => x.ref)).toEqual(['t1']); expect(pref().test).toBe(0); expect(d.P.testAt()).toBe(0)
  })

  it('service worker qui ne devient jamais prêt : attente de 8 secondes au plus, puis « worker » ; le repère « activé » reste pour réessayer', async () => {
    fakeTimers(); const { d } = await ready(); await d.P.enable(false)
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: new Promise(() => undefined), getRegistration: async () => null } })
    let out: unknown = 'en attente'; const run = d.P.arm(true).then(r => { out = r })
    await vi.advanceTimersByTimeAsync(7900); expect(out).toBe('en attente')
    await vi.advanceTimersByTimeAsync(200); await vi.waitFor(() => expect(out).toEqual({ ok: false, why: 'worker' })); await run
    expect(d.P.isOn()).toBe(true)
  })
})
