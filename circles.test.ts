// Cercles d'amis : le client (src/circles.ts) face à l'imitation du service en ligne (FakeCloud : authentification Google simulée + vrai PostgreSQL qui a reçu supabase/schema.sql).
// Chaque personne est un « appareil » : son propre stockage local et ses propres copies des modules. Rien n'est vérifié sur du faux : ce que le service garde est relu dans la base.
import { webcrypto } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCloud } from './fakecloud'
import type { State } from './lib'

let fake: FakeCloud
beforeAll(async () => { fake = await FakeCloud.create() }, 120_000)
afterAll(async () => { await fake.db.close() })

interface Dev { id: string; C: typeof import('./circles'); cloud: typeof import('./cloud'); lib: typeof import('./lib'); acc: typeof import('./account'); hook: typeof import('./cloudhook'); store: Record<string, string> }
let cur: Dev | null = null
const all: Dev[] = []
const dump = () => { const o: Record<string, string> = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; o[k] = localStorage.getItem(k)! } return o }
/** Passe sur cet appareil : le stockage de l'appareil précédent est mis de côté, celui de cet appareil est remis en place. */
function on(d: Dev): Dev {
  if (cur === d) return d
  if (cur) cur.store = dump()
  localStorage.clear(); for (const [k, v] of Object.entries(d.store)) localStorage.setItem(k, v)
  cur = d; return d
}
async function device(id: string): Promise<Dev> {
  vi.resetModules()
  const d: Dev = { id, store: {}, C: await import('./circles'), cloud: await import('./cloud'), lib: await import('./lib'), acc: await import('./account'), hook: await import('./cloudhook') }
  all.push(d)
  return on(d)
}
beforeEach(async () => {
  await fake.reset(); localStorage.clear(); sessionStorage.clear(); cur = null; all.length = 0
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fake.fetch); history.replaceState(null, '', '/')
})
afterEach(() => {
  vi.useRealTimers(); for (const d of all) d.C.stop()
  vi.unstubAllGlobals(); vi.restoreAllMocks()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})

/** Lit (et modifie, puis enregistre) l'état de cet appareil. */
function st(d: Dev, f?: (s: State) => void): State {
  on(d)
  const r = d.lib.load()
  if (f) { f(r.s); expect(d.lib.save(r.s)).toBe(true) }
  return r.s
}
async function signIn(d: Dev, email: string) {
  on(d); let url = ''; d.cloud.nav.assign = u => { url = u }
  expect(await d.cloud.startGoogle()).toEqual({ ok: true })
  const back = new URL(await fake.google(url, email)); history.replaceState(null, '', back.pathname + back.search + back.hash)
  expect((await d.cloud.completeFromUrl()).kind).toBe('ok')
}
/** Ce que la personne coche pour ses amis dans l'onglet Partage (accord donné, deux catégories sans danger). */
const SHARE = (s: State) => { s.consents.share = true; s.share.vis = { name: true, habits: true } }
/** Une personne prête : accord « Compte en ligne » donné, profil, connectée à Google. */
async function person(email: string, data?: (s: State) => void, id = email): Promise<Dev> {
  const d = await device(id)
  const name = email.split('@')[0][0].toUpperCase() + email.split('@')[0].slice(1)
  st(d, s => { s.consents.cloud = true; s.ui.onboard = true; s.profile = { g: 'F', name, age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' }; data?.(s) })
  await signIn(d, email)
  return d
}
const ADA = 'ada@example.org', BEA = 'bea@example.org', CLEO = 'cleo@example.org'
const calls = (fn: string) => fake.calls.filter(c => c.fn === fn)
const rows = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await fake.db.query<T>(q, p)).rows
const code = async (d: Dev, circle: string) => { on(d); return (await d.C.invite(circle)).code }
/** Ada crée « Famille » et Bea la rejoint. */
async function famille() {
  const a = await person(ADA), b = await person(BEA)
  on(a); const c = await a.C.create('Famille', 'Ada')
  const k = await code(a, c.id)
  on(b); const j = await b.C.accept(k, 'Bea')
  return { a, b, circle: c.id, aMe: c.me, bMe: j.me }
}
/** Coche des habitudes aujourd'hui : la carte « habitudes » change. */
const tick = (d: Dev, ids: string[]) => st(d, s => { s.checks[d.lib.today()] = ids })
const err = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as { code?: string }).code ?? String(e) } return 'aucune erreur' }

describe('Cercles : noms, codes et invitation gardée en mémoire', () => {
  it('nom écrit : espaces normalisés, 1 à n caractères, ni commande ni caractère invisible ; émojis permis', async () => {
    const { C } = await device('A')
    expect(C.okName('  Ma   famille ', 40)).toBe('Ma famille'); expect(C.okName('', 40)).toBeNull(); expect(C.okName('   ', 40)).toBeNull()
    expect(C.okName('x'.repeat(40), 40)).toBe('x'.repeat(40)); expect(C.okName('x'.repeat(41), 40)).toBeNull()
    expect(C.okName('😀'.repeat(30), 30)).not.toBeNull(); expect(C.okName('😀'.repeat(31), 30)).toBeNull() // des caractères, pas des unités UTF-16
    for (const bad of ['a\u0000b', 'a\u001fb', 'a\u007fb', 'a\u0085b', 'a‮b', 'a​b', 'a⁦b', 'a­b', 'a‏b', 'a⁠b']) expect(C.okName(bad, 40), JSON.stringify(bad)).toBeNull()
    expect(C.okName('Zoé ❤️ 👨‍👩‍👧', 40)).not.toBeNull(); expect(C.okName('a﻿b', 40)).toBe('a b') // l'espace insécable de largeur nulle est une espace ordinaire pour JavaScript
  })
  it('nom reçu du service : caractères invisibles et de sens d’écriture retirés, espaces normalisés', async () => {
    const { C } = await device('A')
    expect(C.cleanName('Léa‮')).toBe('Léa'); expect(C.cleanName('A​d​a')).toBe('Ada'); expect(C.cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace'); expect(C.cleanName('⁦Bob⁩')).toBe('Bob')
  })
  it('code d’invitation : majuscules, sans tirets ni espaces ; 24 chiffres hexadécimaux exactement', async () => {
    const { C } = await device('A')
    expect(C.normCode('1a2b3c4d5e6f1a2b3c4d5e6f')).toBe('1A2B3C-4D5E6F-1A2B3C-4D5E6F'); expect(C.normCode(' 1a2b3c-4d5e6f 1a2b3c-4d5e6f ')).toBe('1A2B3C-4D5E6F-1A2B3C-4D5E6F')
    for (const bad of ['', '1A2B3C', '1A2B3C-4D5E6F-1A2B3C-4D5E6', '1A2B3C-4D5E6F-1A2B3C-4D5E6F0', 'ZZZZZZ-4D5E6F-1A2B3C-4D5E6F', '<script>']) expect(C.normCode(bad), bad).toBeNull()
    expect(C.CODE_RE.test('1A2B3C-4D5E6F-1A2B3C-4D5E6F')).toBe(true); expect(C.CODE_RE.test('1a2b3c-4d5e6f-1a2b3c-4d5e6f')).toBe(false)
    expect(C.inviteLink('1A2B3C-4D5E6F-1A2B3C-4D5E6F', 'https://believe.example')).toBe('https://believe.example/#/5/amis/1A2B3C-4D5E6F-1A2B3C-4D5E6F')
  })
  it('invitation reçue par lien : gardée dans la mémoire de l’onglet seulement (jamais dans le stockage persistant), 24 heures, effaçable', async () => {
    const { C } = await device('A'), K = '1A2B3C-4D5E6F-1A2B3C-4D5E6F'
    expect(C.pendingInvite()).toBeNull(); C.stashInvite(K); expect(C.pendingInvite()).toBe(K)
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)!.includes('1A2B3C'), localStorage.key(i)!).toBe(false)
    expect(Object.keys(sessionStorage)).toEqual(['believe:invite'])
    C.dropInvite(); expect(C.pendingInvite()).toBeNull()
    C.stashInvite(K); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 23 * 3600_000); expect(C.pendingInvite()).toBe(K); vi.setSystemTime(Date.now() + 2 * 3600_000); expect(C.pendingInvite()).toBeNull()
    vi.useRealTimers(); sessionStorage.setItem('believe:invite', '{oups'); expect(C.pendingInvite()).toBeNull(); sessionStorage.setItem('believe:invite', JSON.stringify({ c: '<script>', t: Date.now() })); expect(C.pendingInvite()).toBeNull()
  })
})

describe('Cercles : créer, inviter, rejoindre, quitter', () => {
  it('créer un cercle ne partage rien : aucune carte, partage coupé, le créateur est seul membre', async () => {
    const a = await person(ADA)
    const c = await a.C.create('  Ma   famille ', '  Ada ')
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/)
    const l = await a.C.list(); expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ id: c.id, name: 'Ma famille', owner: true, members: 1, display: 'Ada', sharing: false })
    expect(await rows('select sharing, card is null as nocard from bl.members')).toEqual([{ sharing: false, nocard: true }])
    expect(await a.C.members(c.id)).toEqual([expect.objectContaining({ display: 'Ada', you: true, owner: true, sharing: false, card: null, badCard: false, cardAt: null })])
    expect(a.C.retractPending()).toBe(false); expect(localStorage.getItem('believe:circles')).toBeNull() // rien de retenu : je ne partage nulle part
  })
  it('des noms invalides sont refusés sur l’appareil, sans aucune requête', async () => {
    const a = await person(ADA); const n = fake.calls.length
    expect(await err(a.C.create('', 'Ada'))).toBe('name'); expect(await err(a.C.create('x'.repeat(41), 'Ada'))).toBe('name'); expect(await err(a.C.create('Ok‮', 'Ada'))).toBe('name')
    expect(await err(a.C.create('Famille', ''))).toBe('display'); expect(await err(a.C.create('Famille', 'y'.repeat(31)))).toBe('display'); expect(await err(a.C.create('Famille', 'A​da'))).toBe('display')
    expect(await err(a.C.peek('pas un code'))).toBe('code'); expect(await err(a.C.accept('1234', 'Ada'))).toBe('code')
    expect(fake.calls.length).toBe(n)
  })
  it('invitation : code de 24 chiffres hexadécimaux que le service ne garde pas (seulement son empreinte), usage unique', async () => {
    const { a, b, circle } = await famille()
    on(a); const inv = await a.C.invite(circle); expect(inv.code).toMatch(a.C.CODE_RE); expect(Date.parse(inv.until) - Date.now()).toBeGreaterThan(6.9 * 86400_000)
    const stored = await rows<{ hash: string }>('select hash from bl.invites'); expect(stored).toHaveLength(1)
    expect(stored[0].hash).not.toContain(inv.code.replace(/-/g, '')); expect(JSON.stringify(await rows('select * from bl.invites'))).not.toContain(inv.code.replace(/-/g, ''))
    const c = await person(CLEO)
    on(c); expect(await c.C.peek(inv.code.toLowerCase().replace(/-/g, ' '))).toMatchObject({ name: 'Famille', by: 'Ada', members: 2, full: false, already: false })
    expect((await c.C.accept(inv.code, 'Cléo')).circle).toBe(circle)
    const d = await person('dan@example.org'); on(d); expect(await err(d.C.peek(inv.code))).toBe('invite'); expect(await err(d.C.accept(inv.code, 'Dan'))).toBe('invite') // déjà utilisée
    on(b); expect(await err(b.C.invite(circle))).toBe('circle') // seul le créateur invite
  })
  it('entrer dans un cercle ne partage rien ; chacun voit les noms, personne ne voit de carte', async () => {
    const { a, b, circle } = await famille()
    for (const d of [a, b]) { on(d); const m = await d.C.members(circle); expect(m.map(x => x.display).sort()).toEqual(['Ada', 'Bea']); expect(m.every(x => !x.sharing && x.card === null)).toBe(true); expect((await d.C.list())[0].sharing).toBe(false) }
    expect(await rows('select count(*)::int as n from bl.members where card is not null or sharing')).toEqual([{ n: 0 }])
  })
  it('invitation : « déjà membre » signalé avant et refusé ensuite ; cercle complet signalé ; invitation révoquée ou expirée inutilisable', async () => {
    const { a, circle } = await famille()
    on(a); const k = await code(a, circle)
    expect(await a.C.peek(k)).toMatchObject({ already: true }); expect(await err(a.C.accept(k, 'Ada bis'))).toBe('member')
    const k2 = await code(a, circle), list = await a.C.invites(circle); expect(list.length).toBe(2); await a.C.revoke(circle, list[0].id)
    expect((await a.C.invites(circle)).length).toBe(1)
    for (let i = 0; i < 10; i++) { const u = await fake.user('m' + i + '@example.org'); await fake.db.query("insert into bl.members (circle, uid, display) values ($1, $2, $3)", [circle, u, 'M' + i]) }
    const z = await person('zed@example.org'); on(z); expect(await z.C.peek(k2)).toMatchObject({ members: 12, full: true }); expect(await err(z.C.accept(k2, 'Zed'))).toBe('full')
    await fake.db.query("update bl.invites set until = now() - interval '1 minute'"); on(z); expect(await err(z.C.peek(k2))).toBe('invite')
  })
  it('invitation expirée : ni aperçu ni entrée dans le cercle', async () => {
    const { a, circle } = await famille()
    on(a); const k = await code(a, circle); const z = await person('zed@example.org')
    on(z); expect(await z.C.peek(k)).toMatchObject({ name: 'Famille' })
    await fake.db.query("update bl.invites set until = now() - interval '1 minute'")
    expect(await err(z.C.peek(k))).toBe('invite'); expect(await err(z.C.accept(k, 'Zed'))).toBe('invite'); expect(await z.C.list()).toEqual([])
    expect(await rows('select count(*)::int as n from bl.members')).toEqual([{ n: 2 }])
  })
  it('code reçu par lien : gardé jusqu’à l’entrée dans le cercle, qui l’efface ; une panne de réseau le garde pour réessayer', async () => {
    const { a, circle } = await famille()
    on(a); const k = await code(a, circle); const z = await person('zed@example.org')
    on(z); z.C.stashInvite(k); expect(z.C.pendingInvite()).toBe(k)
    fake.offline = true; expect(await err(z.C.accept(k, 'Zed'))).toBe('net'); expect(z.C.pendingInvite()).toBe(k); fake.offline = false // rien n'est entré : le code reste utilisable
    await z.C.accept(k, 'Zed'); expect(z.C.pendingInvite()).toBeNull(); expect(sessionStorage.getItem('believe:invite')).toBeNull()
  })
  it('renommer (créateur), changer son nom (membre), retirer un membre, quitter, supprimer', async () => {
    const { a, b, circle, bMe } = await famille()
    on(a); await a.C.rename(circle, '  Les   Dupont '); expect((await a.C.list())[0].name).toBe('Les Dupont')
    on(b); expect(await err(b.C.rename(circle, 'Pirate'))).toBe('circle'); await b.C.setDisplay(circle, 'Béa'); expect((await b.C.members(circle)).find(m => m.you)!.display).toBe('Béa')
    expect(await err(b.C.kick(circle, bMe))).toBe('circle'); expect(await err(b.C.remove(circle))).toBe('circle')
    on(a); const aMember = (await a.C.members(circle)).find(m => m.you)!; expect(await err(a.C.kick(circle, aMember.id))).toBe('member') // le créateur ne se retire pas
    expect(await err(a.C.leave(circle))).toBe('owner')
    await a.C.kick(circle, bMe); expect((await a.C.list())[0].members).toBe(1); on(b); expect(await b.C.list()).toEqual([]); expect(await err(b.C.members(circle))).toBe('circle')
    on(a); const k = await code(a, circle); on(b); await b.C.accept(k, 'Béa'); expect(await b.C.list()).toHaveLength(1); await b.C.leave(circle); expect(await b.C.list()).toEqual([])
    on(a); await a.C.remove(circle); expect(await a.C.list()).toEqual([]); expect(await rows('select count(*)::int as n from bl.circles')).toEqual([{ n: 0 }])
  })
  it('limite de 5 cercles par personne', async () => {
    const a = await person(ADA)
    for (let i = 0; i < 5; i++) await a.C.create('Cercle ' + i, 'Ada')
    expect(await err(a.C.create('Sixième', 'Ada'))).toBe('limit'); expect((await a.C.list()).map(c => c.name)).toEqual(['Cercle 0', 'Cercle 1', 'Cercle 2', 'Cercle 3', 'Cercle 4'])
  })
})

describe('Cercles : ce que dit le service est vérifié avant d’être montré', () => {
  it('une réponse de forme inattendue est une erreur « server », jamais une donnée affichée', async () => {
    const a = await person(ADA); const c = await a.C.create('Famille', 'Ada')
    for (const body of [[{ id: 'x' }], { id: 'x' }, 'texte', null, [{ id: c.id, name: 1 }]]) { fake.failNext = { match: 'bl_circles', status: 200, body }; expect(await err(a.C.list()), JSON.stringify(body)).toBe('server') }
    fake.failNext = { match: 'bl_circle_members', status: 200, body: { oups: true } }; expect(await err(a.C.members(c.id))).toBe('server')
    fake.failNext = { match: 'bl_invite_list', status: 200, body: [{ id: 'pas-un-uuid' }] }; expect(await err(a.C.invites(c.id))).toBe('server')
    fake.failNext = { match: 'bl_invite_create', status: 200, body: { id: c.id, code: '<img src=x onerror=alert(1)>', until: new Date().toISOString() } }; expect(await err(a.C.invite(c.id))).toBe('server')
    fake.failNext = { match: 'bl_circle_leave', status: 200, body: { ok: false } }; expect(await err(a.C.leave(c.id))).toBe('server') // une confirmation doit dire « ok: true » : sinon on ne croit pas que c'est fait
    expect(await a.C.list()).toHaveLength(1) // et le cercle est toujours là
  })
  it('noms de cercle et d’affichage reçus : caractères de sens d’écriture retirés', async () => {
    const { a, b, circle } = await famille()
    await fake.db.query("update bl.circles set name = $1", ['Fam‮ille']); await fake.db.query("update bl.members set display = display || $1", ['​⁦'])
    on(b); expect((await b.C.list())[0]).toMatchObject({ name: 'Famille', display: 'Bea' }); expect((await b.C.members(circle)).map(m => m.display).sort()).toEqual(['Ada', 'Bea'])
    on(a); expect((await a.C.peek(await code(a, circle)))).toMatchObject({ name: 'Famille', by: 'Ada' })
  })
  it('une carte reçue qui ne passe pas la liste blanche n’est jamais montrée (même si le service l’a laissée entrer)', async () => {
    const { a, b, circle } = await famille()
    on(a); st(a, SHARE); await a.C.startSharing(circle)
    const bad: unknown[] = [
      { v: 1, d: '2026-10-25', evil: '<img src=x onerror=alert(1)>' }, { v: 1, d: '2026-10-25', who: 'x'.repeat(41) }, { v: 2, d: '2026-10-25' }, { v: 1, d: '2026-02-30' },
      { v: 1, d: '2026-10-25', habits: { rate: 101, best: 1 } }, { v: 1, d: '2026-10-25', notes: [{ cat: 'Titre secret', n: 1 }] }, { v: 1, d: '2026-10-25', gps: [[48.85, 2.35]] }, 'une chaîne', [1, 2], 42
    ]
    for (const card of bad) {
      await fake.db.query('update bl.members set card = $1::jsonb where uid = (select id from auth.users where email = $2)', [JSON.stringify(card), ADA])
      on(b); const m = (await b.C.members(circle)).find(x => x.display === 'Ada')!
      expect(m, JSON.stringify(card)).toMatchObject({ sharing: true, card: null, badCard: true })
    }
  })
  it('la carte d’un membre qui ne partage pas n’est jamais montrée, même si le service en renvoie une (valide ou non) ; celle d’un membre qui partage l’est', async () => {
    const { a, b, circle } = await famille()
    on(a); st(a, SHARE); await a.C.startSharing(circle)
    on(b); const ada = (await b.C.members(circle)).find(m => m.display === 'Ada')!; expect(ada.card).not.toBeNull()
    const row = (card: unknown, sharing: boolean) => ({ id: ada.id, display: 'Ada', you: false, owner: true, sharing, card, cardAt: ada.cardAt, at: ada.at })
    fake.failNext = { match: 'bl_circle_members', status: 200, body: [row(ada.card, false)] }
    expect((await b.C.members(circle))[0]).toMatchObject({ sharing: false, card: null, badCard: false })
    fake.failNext = { match: 'bl_circle_members', status: 200, body: [row({ v: 1, d: '2026-10-25', evil: 1 }, false)] }
    expect((await b.C.members(circle))[0]).toMatchObject({ sharing: false, card: null, badCard: false }) // ignorée, et non signalée comme « refusée »
    fake.failNext = { match: 'bl_circle_members', status: 200, body: [row(ada.card, true)] }
    expect((await b.C.members(circle))[0]).toMatchObject({ sharing: true, card: ada.card, badCard: false })
  })
  it('longueur des listes envoyées par le service : 50 cercles, 100 membres, 50 invitations au plus ; une de plus est une erreur « server », jamais affichée', async () => {
    const a = await person(ADA); const c = await a.C.create('Famille', 'Ada'); await a.C.invite(c.id)
    const circle = (await a.C.list())[0], member = (await a.C.members(c.id))[0], invite = (await a.C.invites(c.id))[0]
    const lists: [string, () => Promise<unknown[]>, unknown, number][] = [['bl_circles', () => a.C.list(), circle, 50], ['bl_circle_members', () => a.C.members(c.id), member, 100], ['bl_invite_list', () => a.C.invites(c.id), invite, 50]]
    for (const [fn, read, one, max] of lists) {
      fake.failNext = { match: fn, status: 200, body: Array.from({ length: max }, () => one) }; expect((await read()).length, fn + ' : ' + max).toBe(max)
      fake.failNext = { match: fn, status: 200, body: Array.from({ length: max + 1 }, () => one) }; expect(await err(read()), fn + ' : ' + (max + 1)).toBe('server')
    }
  })
})

describe('Cercles : ma carte', () => {
  it('pas de carte sans les accords, ni sans élément coché, ni refusée par la vérification : la raison est dite et rien ne part', async () => {
    const a = await person(ADA); on(a); const c = await a.C.create('Famille', 'Ada'); const n = calls('bl_circle_card').length + calls('bl_circle_sharing').length
    expect(a.C.currentCard()).toEqual({ ok: false, why: 'noshare' }); expect(await err(a.C.startSharing(c.id))).toBe('noshare')
    st(a, s => { s.consents.share = true }); expect(a.C.currentCard()).toEqual({ ok: false, why: 'empty' }); expect(await err(a.C.startSharing(c.id))).toBe('empty')
    st(a, s => { s.share.vis = { habits: true }; s.consents.cloud = false }); expect(a.C.currentCard()).toEqual({ ok: false, why: 'consent' }); expect(await err(a.C.startSharing(c.id))).toBe('consent')
    expect(calls('bl_circle_card').length + calls('bl_circle_sharing').length).toBe(n)
    st(a, s => { s.consents.cloud = true }); const ok = a.C.currentCard(); expect(ok.ok).toBe(true)
    expect((await a.C.list())[0].sharing).toBe(false)
  })
  it('partager : le service montre la carte aux autres membres, avec exactement ce qui est coché', async () => {
    const { a, b, circle } = await famille()
    on(a); st(a, SHARE); const card = a.C.currentCard(); if (!card.ok) throw new Error(card.why)
    const at = await a.C.startSharing(circle); expect(Date.parse(at)).toBeGreaterThan(Date.now() - 60_000)
    expect((await a.C.list())[0].sharing).toBe(true)
    on(b); const seen = (await b.C.members(circle)).find(m => m.display === 'Ada')!
    expect(seen).toMatchObject({ sharing: true, badCard: false }); expect(seen.card).toEqual(card.card); expect(Object.keys(seen.card!).sort()).toEqual(['d', 'habits', 'v', 'who']); expect(Date.parse(seen.cardAt!)).toBe(Date.parse(at))
    expect((await b.C.members(circle)).find(m => m.display === 'Bea')).toMatchObject({ sharing: false, card: null }) // Bea n’a rien décidé
  })
  it('ce qui n’est pas coché, et ce qui n’est jamais partageable, n’arrive jamais au service (cases cochées une à une, puis toutes)', async () => {
    const a = await person(ADA)
    st(a, s => {
      s.consents.share = true; s.consents.health = true
      s.notes.push({ id: 'n1', cat: 'Rêves', t: 'TITRE-SECRET-N1', b: 'TEXTE-SECRET-N1', c: '2026-03-01T08:00:00.000Z', u: '2026-03-01T08:00:00.000Z' })
      s.prayers.push({ id: 'g1', k: 'g', t: 'GRATITUDE-SECRETE', c: '2026-10-20', a: null } as never, { id: 'p1', t: 'Prière-partageable', c: '2026-10-20', a: null } as never)
      s.habits[0].n = 'HABITUDE-SECRETE'; s.weights.push({ d: '2026-10-20', kg: 61.5 }); s.meals.push({ id: 'm1', d: a.lib.today(), n: 'Soupe', kcal: 250, p: 10, g: 30, l: 8, src: 'IA' } as never)
      s.books.push({ id: 'b1', t: 'Livre en cours', a: 'Auteur', src: 'ol', ref: 'OL1W', cover: null, url: null, total: 300, page: 12, st: 'cours' } as never)
    })
    const c = await a.C.create('Famille', 'Ada'); const NEVER = ['TITRE-SECRET-N1', 'TEXTE-SECRET-N1', 'GRATITUDE-SECRETE', 'HABITUDE-SECRETE']
    const stored = async () => JSON.stringify((await rows<{ card: unknown }>('select card from bl.members where card is not null')).map(r => r.card))
    st(a, s => { s.share.vis = { habits: true } }); await a.C.startSharing(c.id)
    let t = await stored(); for (const w of [...NEVER, 'weight', 'food', 'Soupe', 'Prière-partageable', 'Livre en cours', 'notes', 'prayers', 'books']) expect(t.includes(w), 'seulement « habitudes » coché : ' + w).toBe(false)
    expect(t).toContain('"habits"')
    st(a, s => { s.share.vis = { habits: true, weight: true, weightPct: true, food: true, prayers: true, notes: true, books: true, badges: true, steps: true, quiz: true, cycle: true, name: true } }); expect((await a.C.publish()).ok).toBe(true)
    t = await stored(); for (const w of NEVER) expect(t.includes(w), 'tout coché : ' + w).toBe(false)
    for (const w of ['"weight"', '"food"', 'Soupe', 'Prière-partageable', 'Livre en cours', '"notes"']) expect(t.includes(w), 'tout coché : ' + w).toBe(true) // ce qui est coché part bien
    expect(t).toContain('"cat":"Rêves"'); expect(t).toContain('"n":1')
  })
  it('mise à jour : rien n’est renvoyé si la carte n’a pas changé ; un changement est déposé ; décocher une catégorie la retire AUSSITÔT du service', async () => {
    const { a, b, circle } = await famille()
    on(a); st(a, SHARE); await a.C.startSharing(circle)
    const sent = () => calls('bl_circle_card').length, seenCard = async () => { on(b); const m = (await b.C.members(circle)).find(x => x.display === 'Ada')!; on(a); return m.card }
    let n = sent(); expect(await a.C.publish()).toEqual({ ok: true, pushed: 0 }); expect(sent()).toBe(n) // identique : aucun envoi
    tick(a, ['h1', 'h2']); expect(await a.C.publish()).toEqual({ ok: true, pushed: 1 }); expect(sent()).toBe(n + 1)
    expect((await seenCard())!.habits!.rate).toBeGreaterThan(0)
    st(a, s => { s.share.vis = { name: true } }); n = sent(); expect(await a.C.publish()).toEqual({ ok: true, pushed: 1 })
    const c2 = (await seenCard())!; expect(c2.habits).toBeUndefined(); expect(Object.keys(c2).sort()).toEqual(['d', 'v', 'who'])
    st(a, s => { s.share.vis = {} }); expect(await a.C.publish()).toEqual({ ok: true, pushed: 1 }); const c3 = (await seenCard())!; expect(Object.keys(c3).sort()).toEqual(['d', 'v']) // carte vide : plus rien d’ancien sur le service
    expect(JSON.stringify(await rows('select card from bl.members'))).not.toContain('habits')
    expect(await a.C.publish(true)).toEqual({ ok: true, pushed: 1 }) // « forcer » renvoie même sans changement
  })
  it('l’accord « Partage » retiré : plus aucune mise à jour n’est envoyée (la carte, elle, est retirée par retractAll)', async () => {
    const { a, b, circle } = await famille()
    on(a); st(a, SHARE); await a.C.startSharing(circle); const n = calls('bl_circle_card').length
    st(a, s => { s.consents.share = false; s.share.vis = {} }); expect(await a.C.publish()).toEqual({ ok: true, pushed: 0 }); expect(calls('bl_circle_card').length).toBe(n)
    expect(await a.C.retractAll()).toBe(1); on(b); expect((await b.C.members(circle)).find(m => m.display === 'Ada')).toMatchObject({ sharing: false, card: null })
    expect(await rows('select sharing, card is null as nocard from bl.members where display = $1', ['Ada'])).toEqual([{ sharing: false, nocard: true }])
  })
  it('publier sans l’accord « Compte en ligne » ou sans session : rien n’est envoyé', async () => {
    const a = await person(ADA); on(a); st(a, SHARE); const c = await a.C.create('Famille', 'Ada'); await a.C.startSharing(c.id); const n = fake.calls.length
    st(a, s => { s.consents.cloud = false }); expect(await a.C.publish()).toEqual({ ok: false, why: 'consent' })
    st(a, s => { s.consents.cloud = true }); a.cloud.dropSession(); expect(await a.C.publish()).toEqual({ ok: false, why: 'signin' })
    expect(fake.calls.length).toBe(n)
  })
  it('« Arrêter de partager » efface la carte du service ; couper depuis un autre appareil arrête les mises à jour de celui-ci', async () => {
    const { a, b, circle } = await famille()
    on(a); st(a, SHARE); await a.C.startSharing(circle); await a.C.stopSharing(circle)
    expect(await rows('select sharing, card is null as nocard, card_at is null as noat from bl.members where display = $1', ['Ada'])).toEqual([{ sharing: false, nocard: true, noat: true }])
    expect((await a.C.list())[0].sharing).toBe(false); expect(localStorage.getItem('believe:circles')).toBeNull(); on(b); expect((await b.C.members(circle)).find(m => m.display === 'Ada')).toMatchObject({ sharing: false, card: null })
    // deux appareils de la même personne : le second coupe, le premier s'en aperçoit au prochain envoi et ne redépose rien
    const a2 = await person(ADA, SHARE, 'ada-2'); on(a); await a.C.startSharing(circle); expect((await a.C.publish()).ok).toBe(true) // ce premier appareil sait désormais qu'il partage
    on(a2); await a2.C.stopSharing(circle)
    on(a); tick(a, ['h1']); const n = calls('bl_circle_card').length; expect(await a.C.publish()).toEqual({ ok: true, pushed: 0 }); expect(calls('bl_circle_card').length).toBe(n + 1) // une tentative, refusée par le service (partage coupé), puis plus rien
    expect(await rows('select sharing, card is null as nocard from bl.members where display = $1', ['Ada'])).toEqual([{ sharing: false, nocard: true }])
    expect(await a.C.publish()).toEqual({ ok: true, pushed: 0 }); expect(calls('bl_circle_card').length).toBe(n + 1) // et il ne redépose rien
  })
  it('si le dépôt de la carte échoue, le partage est aussitôt recoupé : jamais « actif » sans carte déposée', async () => {
    const { a, circle } = await famille()
    on(a); st(a, SHARE); fake.failNext = { match: 'bl_circle_card', status: 500 }
    expect(await err(a.C.startSharing(circle))).toBe('server')
    expect(await rows('select sharing, card is null as nocard from bl.members where display = $1', ['Ada'])).toEqual([{ sharing: false, nocard: true }]); expect((await a.C.list())[0].sharing).toBe(false)
    await a.C.startSharing(circle); expect((await a.C.list())[0].sharing).toBe(true) // et la reprise fonctionne
  })
  it('quitter un cercle efface la carte ; le supprimer l’efface chez tous ses membres', async () => {
    const { a, b, circle } = await famille()
    on(b); st(b, SHARE); await b.C.startSharing(circle); expect(await rows('select count(*)::int as n from bl.members where card is not null')).toEqual([{ n: 1 }])
    await b.C.leave(circle); expect(await rows('select count(*)::int as n from bl.members where card is not null')).toEqual([{ n: 0 }])
    on(a); st(a, SHARE); await a.C.startSharing(circle); await a.C.remove(circle); expect(await rows('select count(*)::int as n from bl.members')).toEqual([{ n: 0 }])
  })
  it('une carte fabriquée avec une valeur hors bornes (repas de 25 000 kcal saisi par erreur) est refusée sur l’appareil : aucune requête ne part', async () => {
    const a = await person(ADA); on(a); const c = await a.C.create('Famille', 'Ada')
    st(a, s => { s.consents.share = true; s.share.vis = { food: true }; s.meals.push({ id: 'm1', d: a.lib.today(), n: 'Banquet', kcal: 25000, p: 1, g: 1, l: 1, src: 'manuel' }) })
    const n = fake.calls.length
    expect(a.C.currentCard()).toEqual({ ok: false, why: 'card' }); expect(await err(a.C.startSharing(c.id))).toBe('card'); expect(fake.calls.length).toBe(n)
    st(a, s => { s.meals[0].kcal = 2500 }); expect(a.C.currentCard().ok).toBe(true) // corrigée, elle passe
  })
  it('stop : la mémoire des cartes déposées et des cercles connus est vidée, la reprise redemande tout au service et redépose la carte', async () => {
    const { a, circle } = await famille()
    on(a); st(a, SHARE); await a.C.startSharing(circle); expect((await a.C.publish()).ok).toBe(true)
    const lists = calls('bl_circles').length, cards = calls('bl_circle_card').length
    expect(await a.C.publish()).toEqual({ ok: true, pushed: 0 }); expect(calls('bl_circles').length).toBe(lists); expect(calls('bl_circle_card').length).toBe(cards) // la mémoire sert : ni question ni envoi
    a.C.stop()
    expect(await a.C.publish()).toEqual({ ok: true, pushed: 1 }); expect(calls('bl_circles').length).toBe(lists + 1); expect(calls('bl_circle_card').length).toBe(cards + 1)
  })
  it('après « stop », un partage coupé entre-temps depuis un autre appareil n’est pas ignoré : aucun dépôt n’est tenté', async () => {
    const { a, circle } = await famille()
    on(a); st(a, SHARE); await a.C.startSharing(circle); expect((await a.C.publish()).ok).toBe(true); a.C.stop()
    const a2 = await person(ADA, undefined, 'ada-2'); await a2.C.stopSharing(circle)
    on(a); tick(a, ['h1']); const n = calls('bl_circle_card').length
    expect(await a.C.publish()).toEqual({ ok: true, pushed: 0 }); expect(calls('bl_circle_card').length).toBe(n)
  })
  it('quitter un cercle : l’appareil n’essaie plus d’y déposer ma carte', async () => {
    const { b, circle } = await famille()
    on(b); st(b, SHARE); await b.C.startSharing(circle); expect((await b.C.publish()).ok).toBe(true)
    await b.C.leave(circle); const n = calls('bl_circle_card').length
    tick(b, ['h1', 'h2']); expect(await b.C.publish()).toEqual({ ok: true, pushed: 0 }); expect(calls('bl_circle_card').length).toBe(n)
  })
  it('supprimer un cercle : l’appareil n’essaie plus d’y déposer ma carte', async () => {
    const a = await person(ADA); on(a); st(a, SHARE); const c = await a.C.create('Famille', 'Ada'); await a.C.startSharing(c.id); expect((await a.C.publish()).ok).toBe(true)
    await a.C.remove(c.id); const n = calls('bl_circle_card').length
    tick(a, ['h1', 'h2']); expect(await a.C.publish()).toEqual({ ok: true, pushed: 0 }); expect(calls('bl_circle_card').length).toBe(n)
  })
})

describe('Cercles : retrait des cartes (accord retiré, déconnexion, compte supprimé)', () => {
  const twoCircles = async () => {
    const a = await person(ADA); on(a); st(a, SHARE)
    const c1 = await a.C.create('Famille', 'Ada'), c2 = await a.C.create('Église', 'Ada'), c3 = await a.C.create('Club', 'Ada')
    await a.C.startSharing(c1.id); await a.C.startSharing(c2.id)
    return { a, c1, c2, c3 }
  }
  it('retractAll : toutes les cartes sont retirées, le repère local est effacé, un second appel ne trouve rien', async () => {
    const { a } = await twoCircles(); expect(JSON.parse(localStorage.getItem('believe:circles')!)).toEqual({ on: true, retract: false })
    expect(await a.C.retractAll()).toBe(2); expect(await rows('select count(*)::int as n from bl.members where sharing or card is not null')).toEqual([{ n: 0 }])
    expect(localStorage.getItem('believe:circles')).toBeNull(); expect(a.C.retractPending()).toBe(false); expect(await a.C.retractAll()).toBe(0)
  })
  it('retractAll retire aussi les cartes déposées dans les cercles que je n’ai pas créés', async () => {
    const { b, circle } = await famille()
    on(b); st(b, SHARE); await b.C.startSharing(circle); const mine = await b.C.create('Club', 'Bea'); await b.C.startSharing(mine.id)
    expect(await rows('select count(*)::int as n from bl.members where sharing and card is not null')).toEqual([{ n: 2 }])
    expect(await b.C.retractAll()).toBe(2)
    expect(await rows('select count(*)::int as n from bl.members where sharing or card is not null')).toEqual([{ n: 0 }])
  })
  it('hors ligne : le retrait est mémorisé et se termine tout seul à la reprise ; l’indicateur reste visible d’ici là', async () => {
    const { a } = await twoCircles(); fake.offline = true
    expect(await err(a.C.retractAll())).toBe('net'); expect(a.C.retractPending()).toBe(true); expect(a.hook.circOn()).toBe(true)
    expect(await rows('select count(*)::int as n from bl.members where sharing')).toEqual([{ n: 2 }]) // rien n’a bougé : on ne dit pas « retiré »
    fake.offline = false; st(a, s => { s.consents.share = false }); expect(await a.C.publish()).toEqual({ ok: true, pushed: 0 })
    expect(await rows('select count(*)::int as n from bl.members where sharing or card is not null')).toEqual([{ n: 0 }]); expect(a.C.retractPending()).toBe(false); expect(localStorage.getItem('believe:circles')).toBeNull()
  })
  it('retractCards (accord « Partage » retiré) : « removed », « none » ou « failed » selon ce que le service a confirmé', async () => {
    const { a } = await twoCircles(); expect(await a.hook.retractCards()).toBe('removed'); expect(await a.hook.retractCards()).toBe('none')
    const b = await person(BEA, undefined, 'b'); on(b); expect(await b.hook.retractCards()).toBe('none') // aucun partage connu, mais session : une question au service, rien à retirer
    const c = await device('c'); expect(await c.hook.retractCards()).toBe('none') // ni session ni partage : aucune requête
    const n = fake.calls.length; expect(await c.hook.retractCards()).toBe('none'); expect(fake.calls.length).toBe(n)
    const d = await person(CLEO, SHARE, 'd'); on(d); const k = await d.C.create('Z', 'Cléo'); await d.C.startSharing(k.id); fake.offline = true; expect(await d.hook.retractCards()).toBe('failed'); expect(d.C.retractPending()).toBe(true)
  })
  it('leaveCloud({ cards }) : retire les cartes puis déconnecte ; hors ligne, déconnecte quand même et dit « failed » ; sans « cards », ne touche pas aux cartes', async () => {
    const { a, c1 } = await twoCircles()
    expect(await a.acc.leaveCloud({})).toEqual({ cards: 'none' }); expect(a.cloud.getSession()).toBeNull(); expect(await rows('select count(*)::int as n from bl.members where sharing')).toEqual([{ n: 2 }]) // simple déconnexion de cet appareil
    expect(calls('bl_circle_sharing').filter(c => (c.body as { p_on: boolean }).p_on === false)).toHaveLength(0)
    await signIn(a, ADA); expect(await a.acc.leaveCloud({ cards: true })).toEqual({ cards: 'removed' }); expect(a.cloud.getSession()).toBeNull()
    expect(await rows('select count(*)::int as n from bl.members where sharing or card is not null')).toEqual([{ n: 0 }])
    await signIn(a, ADA); await a.C.startSharing(c1.id); fake.offline = true
    expect(await a.acc.leaveCloud({ cards: true })).toEqual({ cards: 'failed' }); expect(a.cloud.getSession()).toBeNull(); expect(a.C.retractPending()).toBe(true) // déconnecté, mais le retrait reste dû
    fake.offline = false; expect(await rows('select count(*)::int as n from bl.members where sharing')).toEqual([{ n: 1 }])
    await signIn(a, ADA); expect((await a.C.publish()).ok).toBe(true); expect(await rows('select count(*)::int as n from bl.members where sharing or card is not null')).toEqual([{ n: 0 }]) // à la reconnexion, le retrait se termine
  })
  it('leaveCloud({ cards }) sans session : « none », sauf si un retrait déjà dû attend', async () => {
    const d = await device('x'); expect(await d.acc.leaveCloud({ cards: true })).toEqual({ cards: 'none' })
    localStorage.setItem('believe:circles', JSON.stringify({ on: false, retract: true })); expect(await d.acc.leaveCloud({ cards: true })).toEqual({ cards: 'failed' })
  })
  it('se déconnecter alors que le service ne répond pas : au bout de 6 secondes la session locale disparaît quand même', async () => {
    const a = await person(ADA)
    vi.stubGlobal('fetch', (i: RequestInfo | URL, init?: RequestInit) => String(i).includes('/auth/v1/logout') ? new Promise<Response>(() => undefined) : fake.fetch(i, init))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = a.acc.leaveCloud({}); await vi.advanceTimersByTimeAsync(6100)
    expect(await p).toEqual({ cards: 'none' }); expect(a.cloud.getSession()).toBeNull()
  })
  it('supprimer le compte : « vérifié » seulement si le service ne garde plus rien ; un service qui répond « fait » sans rien supprimer n’est pas cru', async () => {
    const { a } = await twoCircles()
    vi.stubGlobal('fetch', (i: RequestInfo | URL, init?: RequestInit) => String(i).includes('bl_account_delete') ? Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })) : fake.fetch(i, init))
    expect(await a.acc.deleteAccount()).toEqual({ ok: true, verified: false })
    expect(a.cloud.getSession()).toBeNull(); expect(await rows('select count(*)::int as n from bl.members')).toEqual([{ n: 3 }]) // rien n'avait été supprimé (trois cercles), l'appareil est quand même déconnecté
  })
  it('relevé du compte : une réponse du service qui n’a pas la bonne forme est refusée (« server »), une bonne est acceptée', async () => {
    const a = await person(ADA)
    const reply = (body: string) => vi.stubGlobal('fetch', (i: RequestInfo | URL, init?: RequestInit) => String(i).includes('bl_account_info') ? Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })) : fake.fetch(i, init))
    for (const bad of ['{"snap":null,"circles":"3","owned":0,"subs":0,"reminders":0,"cards":0}', '{"snap":null,"circles":0,"owned":-1,"subs":0,"reminders":0,"cards":0}', '{"snap":{"rev":"x","size":1,"at":"t","dev":null},"circles":0,"owned":0,"subs":0,"reminders":0,"cards":0}', '[]', 'null']) {
      reply(bad); expect(await a.acc.accountInfo(), bad).toEqual({ ok: false, code: 'server' })
    }
    reply('{"snap":null,"circles":0,"owned":0,"subs":1,"reminders":2,"cards":0}'); expect(await a.acc.accountInfo()).toEqual({ ok: true, info: { snap: null, circles: 0, owned: 0, subs: 1, reminders: 2, cards: 0 } })
  })
  it('supprimer le compte efface tout côté service, et l’appareil oublie les cercles', async () => {
    const { a } = await twoCircles(); const r = await a.acc.deleteAccount(); expect(r).toEqual({ ok: true, verified: true })
    expect(await rows('select count(*)::int as n from bl.members')).toEqual([{ n: 0 }]); expect(await rows('select count(*)::int as n from bl.circles')).toEqual([{ n: 0 }]); expect(localStorage.getItem('believe:circles')).toBeNull(); expect(a.C.pendingInvite()).toBeNull()
  })
})

describe('Cercles : déclencheurs automatiques', () => {
  const adv = (ms: number) => vi.advanceTimersByTimeAsync(ms)
  it('touch : plusieurs enregistrements rapprochés = un seul envoi, après 10 secondes de calme ; rien si la carte n’a pas changé', async () => {
    const { a, circle } = await famille()
    on(a); st(a, SHARE); await a.C.startSharing(circle); const n = calls('bl_circle_card').length
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    tick(a, ['h1']); a.C.touch(); await adv(6000); a.C.touch(); await adv(9000); expect(calls('bl_circle_card').length).toBe(n)
    await adv(1500); vi.useRealTimers(); await a.C.publish() /* attend la fin du tour déclenché par le minuteur */; expect(calls('bl_circle_card').length).toBe(n + 1)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); a.C.touch(); await adv(11_000); vi.useRealTimers(); await a.C.publish(); expect(calls('bl_circle_card').length).toBe(n + 1) // carte identique : pas de nouvel envoi
  })
  it('cloudhook : sans partage connu rien n’est chargé ni demandé ; avec partage, touchCircles planifie l’envoi', async () => {
    const a = await person(ADA); on(a); st(a, SHARE); const c = await a.C.create('Famille', 'Ada'); expect(a.hook.circOn()).toBe(false)
    const n = fake.calls.length; a.hook.touchCircles(); a.hook.startCircles(); await new Promise(r => setTimeout(r, 50)); expect(fake.calls.length).toBe(n)
    await a.C.startSharing(c.id); expect(a.hook.circOn()).toBe(true)
    tick(a, ['h1', 'h3']); const m = calls('bl_circle_card').length
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); a.hook.touchCircles()
    await vi.waitFor(() => { expect(vi.getTimerCount()).toBeGreaterThan(0) }, { timeout: 3000, interval: 20 }) // le module se charge, l'envoi est planifié
    await adv(10_500); vi.useRealTimers(); await a.C.publish(); expect(calls('bl_circle_card').length).toBe(m + 1)
    a.hook.stopCircles()
  })
  it('start : un premier tour peu après l’ouverture, puis au retour au premier plan ; stop arrête tout', async () => {
    const { a, circle } = await famille()
    on(a); st(a, SHARE); await a.C.startSharing(circle); a.C.stop(); const n = calls('bl_circle_card').length
    tick(a, ['h1'])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); a.C.start(); a.C.start(); await adv(2900); expect(calls('bl_circle_card').length).toBe(n); await adv(200)
    vi.useRealTimers(); await a.C.publish(); expect(calls('bl_circle_card').length).toBe(n + 1) // premier tour peu après l'ouverture
    tick(a, ['h1', 'h4']); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); document.dispatchEvent(new Event('visibilitychange')); await adv(10_500)
    vi.useRealTimers(); await a.C.publish(); expect(calls('bl_circle_card').length).toBe(n + 2) // retour au premier plan : carte mise à jour
    a.C.stop(); tick(a, ['h1', 'h5']); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); document.dispatchEvent(new Event('visibilitychange')); await adv(20_000)
    vi.useRealTimers(); await new Promise(r => setTimeout(r, 100)); expect(calls('bl_circle_card').length).toBe(n + 2) // arrêté : rien ne part
  })
})
