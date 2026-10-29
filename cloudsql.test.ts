// @vitest-environment node
// Base de données du compte en ligne (supabase/schema.sql) éprouvée sur un vrai PostgreSQL : droits, isolation entre comptes, cercles, invitations, rappels, suppression.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { SCHEMA, addUser, freshDb, ok, refused, reset, rpc } from './testsql'
import type { Caller } from './testsql'

let db: PGlite
beforeAll(async () => { db = await freshDb() }, 90_000)
afterAll(async () => { await db.close() })
beforeEach(async () => { await reset(db) }, 30_000)

const as = (sub: string): Caller => ({ role: 'authenticated', sub })
const SERVER: Caller = { role: 'service_role' }
const call = (who: Caller, fn: string, args: Record<string, unknown> = {}) => rpc(db, fn, args, who)
const BLOB = 'BLS1.' + 'A'.repeat(100)
const users = async (n: number) => { const l: string[] = []; for (let i = 0; i < n; i++) l.push(await addUser(db, 'u' + i + '@exemple.test')); return l }
const make = async (u: string, name = 'Famille', display = 'Ada') => ok<{ id: string; me: string }>(await call(as(u), 'bl_circle_create', { p_name: name, p_display: display }))
/** Invitation créée par le propriétaire puis acceptée par `who`. */
const join = async (owner: string, circle: string, who: string, display = 'Léa') => {
  const inv = ok<{ code: string }>(await call(as(owner), 'bl_invite_create', { p_circle: circle }))
  return ok<{ circle: string; me: string }>(await call(as(who), 'bl_invite_accept', { p_code: inv.code, p_display: display }))
}
const sql = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await db.query<T>(q, p)).rows
const CARD = { v: 1, d: '2026-10-23', who: 'Ada', habits: { rate: 80, best: 4 } }

describe('Installation et droits', () => {
  it('le script se relance sans erreur ni perte de données', async () => {
    const [a] = await users(1)
    ok(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB, p_dev: 'Pixel' }))
    await db.exec(SCHEMA)
    expect(ok<{ rev: number }>(await call(as(a), 'bl_snap_meta')).rev).toBe(1)
    expect(ok<{ v: number }>(await call({ role: 'anon' }, 'bl_ping')).v).toBe(1)
  })

  it('« bl_ping » répond à tous ; toutes les autres fonctions exigent un compte connecté', async () => {
    expect(ok<{ auth: boolean }>(await call({ role: 'anon' }, 'bl_ping')).auth).toBe(false)
    const [a] = await users(1)
    expect(ok<{ auth: boolean }>(await call(as(a), 'bl_ping')).auth).toBe(true)
    for (const [fn, args] of [['bl_snap_meta', {}], ['bl_snap_get', {}], ['bl_circles', {}], ['bl_account_info', {}], ['bl_account_delete', {}], ['bl_push_status', {}], ['bl_invite_peek', { p_code: 'X' }]] as [string, Record<string, unknown>][]) {
      const r = await call({ role: 'anon' }, fn, args); expect(r.status, fn).toBe(401)
      expect(refused(await call({ role: 'authenticated' }, fn, args)), fn + ' sans identité').toBe('bl:auth') // jeton valide mais sans compte
    }
  })

  it('droits d’exécution exacts : anonyme = ping seulement ; connecté = tout sauf les fonctions du serveur ; serveur = les trois fonctions réservées au serveur (prendre, clore, vérifier)', async () => {
    const rows = await sql<{ f: string; a: boolean; c: boolean; s: boolean }>(`select p.proname as f, has_function_privilege('anon', p.oid, 'execute') as a, has_function_privilege('authenticated', p.oid, 'execute') as c, has_function_privilege('service_role', p.oid, 'execute') as s
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'bl\\_%' order by 1`)
    expect(rows.map(r => r.f)).toEqual(['bl_account_delete', 'bl_account_info', 'bl_circle_card', 'bl_circle_create', 'bl_circle_delete', 'bl_circle_display', 'bl_circle_kick', 'bl_circle_leave', 'bl_circle_members', 'bl_circle_rename', 'bl_circle_sharing',
      'bl_circles', 'bl_invite_accept', 'bl_invite_create', 'bl_invite_list', 'bl_invite_peek', 'bl_invite_revoke', 'bl_ping', 'bl_push_claim', 'bl_push_done', 'bl_push_ping', 'bl_push_register', 'bl_push_set', 'bl_push_status', 'bl_push_unregister',
      'bl_snap_delete', 'bl_snap_get', 'bl_snap_meta', 'bl_snap_put'])   // toute fonction ajoutée ou retirée doit être décidée ici, avec ses droits
    for (const r of rows) {
      const server = r.f === 'bl_push_claim' || r.f === 'bl_push_done' || r.f === 'bl_push_ping'
      expect({ f: r.f, anon: r.a, auth: r.c, srv: r.s }, r.f).toEqual({ f: r.f, anon: r.f === 'bl_ping', auth: r.f === 'bl_ping' || !server, srv: server })
    }
  })

  it('les tables ne sont lisibles ni écrivables par l’API ; même mal configurées, la sécurité par ligne ne montre rien', async () => {
    const [a] = await users(1); ok(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB }))
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expect(db.transaction(async tx => { await tx.exec('set local role ' + role); await tx.query('select * from bl.snaps') }), role).rejects.toThrow(/permission denied/)
      await expect(db.transaction(async tx => { await tx.exec('set local role ' + role); await tx.query("insert into bl.meta (k, v) values ('x', 'y')") }), role + ' écriture').rejects.toThrow(/permission denied/)
    }
    // erreur de configuration simulée : le schéma est exposé et les droits accordés → aucune règle, donc aucune ligne ; tout est annulé à la fin
    const seen = { n: -1, wrote: '' }
    await db.transaction(async tx => {
      await tx.exec('grant usage on schema bl to authenticated; grant select, insert, update, delete on all tables in schema bl to authenticated; set local role authenticated')
      seen.n = (await tx.query<{ n: number }>('select count(*)::int as n from bl.snaps')).rows[0].n
      await tx.exec('savepoint essai')
      try { await tx.exec("insert into bl.meta (k, v) values ('x', 'y')"); seen.wrote = 'accepté' } catch (e) { seen.wrote = (e as Error).message }
      throw new Error('annulation')
    }).catch(() => undefined)
    expect(seen.n).toBe(0); expect(seen.wrote).toMatch(/row-level security/)
    expect(await sql<{ n: number }>('select count(*)::int as n from bl.snaps')).toEqual([{ n: 1 }]) // la ligne existe bel et bien
  })

  it('toutes les tables ont la sécurité par ligne activée', async () => {
    const t = await sql<{ relname: string; relrowsecurity: boolean }>("select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'bl' and c.relkind = 'r' order by 1")
    expect(t.map(x => x.relname)).toEqual(['circles', 'invites', 'members', 'meta', 'pushsubs', 'reminders', 'snap_rev', 'snaps'])
    expect(t.every(x => x.relrowsecurity)).toBe(true)
  })
})

describe('Instantané chiffré', () => {
  it('écriture, lecture, versions : une version périmée est refusée', async () => {
    const [a] = await users(1)
    expect(ok(await call(as(a), 'bl_snap_meta'))).toEqual({ rev: 0 })
    const r1 = ok<{ rev: number }>(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB, p_dev: 'Pixel 8 · Chrome' })); expect(r1.rev).toBe(1)
    const g = ok<{ rev: number; blob: string; dev: string }>(await call(as(a), 'bl_snap_get')); expect([g.rev, g.blob, g.dev]).toEqual([1, BLOB, 'Pixel 8 · Chrome'])
    expect(ok<{ rev: number }>(await call(as(a), 'bl_snap_put', { p_expected: 1, p_blob: BLOB + 'B' })).rev).toBe(2)
    expect(refused(await call(as(a), 'bl_snap_put', { p_expected: 1, p_blob: BLOB + 'C' }))).toBe('bl:rev')   // un autre appareil est passé entre-temps
    expect(refused(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB + 'C' }))).toBe('bl:rev')   // « rien en ligne » alors qu’il y a déjà une version
    expect(ok<{ blob: string }>(await call(as(a), 'bl_snap_get')).blob).toBe(BLOB + 'B')
    const m = ok<{ rev: number; size: number }>(await call(as(a), 'bl_snap_meta')); expect([m.rev, m.size]).toEqual([2, BLOB.length + 1]); expect(m).not.toHaveProperty('blob')
  })

  it('deux écritures sur la même version : une seule gagne', async () => {
    const [a] = await users(1); ok(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB }))
    const r = await Promise.all([call(as(a), 'bl_snap_put', { p_expected: 1, p_blob: BLOB + 'X' }), call(as(a), 'bl_snap_put', { p_expected: 1, p_blob: BLOB + 'Y' })])
    expect(r.map(x => x.status).sort()).toEqual([200, 400]); expect((await call(as(a), 'bl_snap_meta')).body).toMatchObject({ rev: 2 })
  })

  it('format et taille : seul un texte « BLS1. » est accepté, 2 500 000 caractères au plus', async () => {
    const [a] = await users(1)
    for (const b of ['', 'hello', '{"profile":{"name":"Ada"}}', 'BLS1.', 'BLS1.a b', 'BLV1.AAAA', 'BLS1.é']) expect(refused(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: b })), b).toBe('bl:blob')
    expect(refused(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: 'BLS1.' + 'A'.repeat(2_500_000) }))).toBe('bl:big')
    expect(ok<{ rev: number }>(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: 'BLS1.' + 'A'.repeat(2_499_995) })).rev).toBe(1)
  })

  it('étiquette d’appareil : caractères de commande retirés, 60 caractères au plus ; vide = aucune', async () => {
    const [a] = await users(1)
    ok(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB, p_dev: 'Pixel\u0007 8\n' + 'x'.repeat(100) }))
    const d = ok<{ dev: string }>(await call(as(a), 'bl_snap_get')).dev; expect(d.length).toBe(60); expect(d).toMatch(/^Pixel 8x+$/)
    ok(await call(as(a), 'bl_snap_put', { p_expected: 1, p_blob: BLOB, p_dev: '   ' })); expect((await call(as(a), 'bl_snap_get')).body).toMatchObject({ dev: null })
  })

  it('chaque compte ne voit que le sien ; suppression', async () => {
    const [a, b] = await users(2)
    ok(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB + 'A' })); ok(await call(as(b), 'bl_snap_put', { p_expected: 0, p_blob: BLOB + 'B' }))
    expect((await call(as(a), 'bl_snap_get')).body).toMatchObject({ blob: BLOB + 'A' }); expect((await call(as(b), 'bl_snap_get')).body).toMatchObject({ blob: BLOB + 'B' })
    ok(await call(as(a), 'bl_snap_delete')); expect(ok(await call(as(a), 'bl_snap_meta'))).toEqual({ rev: 0 }); expect((await call(as(b), 'bl_snap_meta')).body).toMatchObject({ rev: 1 })
  })
  it('la numérotation ne revient jamais en arrière, même après une suppression : un appareil ne confond pas deux générations de données', async () => {
    const [a, b] = await users(2)
    ok(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB })); ok(await call(as(a), 'bl_snap_put', { p_expected: 1, p_blob: BLOB + 'B' })) // version 2
    ok(await call(as(a), 'bl_snap_delete'))
    expect(ok<{ rev: number }>(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB + 'C' })).rev).toBe(3)      // 3 et non 1 : un appareil resté à la version 1 ou 2 voit que ce n'est plus la sienne
    expect(refused(await call(as(a), 'bl_snap_put', { p_expected: 2, p_blob: BLOB + 'D' }))).toBe('bl:rev')                // l'ancien appareil ne peut pas écraser la nouvelle génération sans le savoir
    expect(ok<{ rev: number }>(await call(as(a), 'bl_snap_put', { p_expected: 3, p_blob: BLOB + 'D' })).rev).toBe(4)
    expect(ok<{ rev: number }>(await call(as(b), 'bl_snap_put', { p_expected: 0, p_blob: BLOB })).rev).toBe(1)             // autre compte : sa propre numérotation
    expect(await sql<{ top_rev: number }>('select top_rev::int from bl.snap_rev where uid = $1', [a])).toEqual([{ top_rev: 4 }])
    ok(await call(as(a), 'bl_account_delete')); expect(await sql('select * from bl.snap_rev where uid = $1', [a])).toEqual([])  // supprimé avec le compte
  })
  it('deux premières écritures simultanées : une seule passe, la numérotation reste juste', async () => {
    const [a] = await users(1)
    const r = await Promise.all([call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB + 'X' }), call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB + 'Y' })])
    expect(r.map(x => x.status).sort()).toEqual([200, 400]); expect((await call(as(a), 'bl_snap_meta')).body).toMatchObject({ rev: 1 })
    expect(await sql<{ top_rev: number }>('select top_rev::int from bl.snap_rev where uid = $1', [a])).toEqual([{ top_rev: 1 }])
  })
})

describe('Cercles', () => {
  it('création : noms nettoyés et contrôlés, cinq cercles au plus, liste personnelle', async () => {
    const [a, b] = await users(2)
    const c = await make(a, '  Ma   famille ', ' Ada  L. '); const l = ok<{ name: string; display: string; owner: boolean; members: number; sharing: boolean; id: string; me: string }[]>(await call(as(a), 'bl_circles'))
    expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ id: c.id, me: c.me, name: 'Ma famille', display: 'Ada L.', owner: true, members: 1, sharing: false })
    expect(ok(await call(as(b), 'bl_circles'))).toEqual([])
    for (const [n, d, e] of [['', 'Ada', 'bl:name'], ['x'.repeat(41), 'Ada', 'bl:name'], ['Ok', '', 'bl:display'], ['Ok', 'y'.repeat(31), 'bl:display'], ['Ok\u0001', 'Ada', 'bl:name'], ['Ok', 'A\u007fda', 'bl:display']]) expect(refused(await call(as(a), 'bl_circle_create', { p_name: n, p_display: d })), n + '/' + d).toBe(e)
    for (let i = 0; i < 4; i++) await make(a, 'C' + i)
    expect(refused(await call(as(a), 'bl_circle_create', { p_name: 'Sixième', p_display: 'Ada' }))).toBe('bl:limit')
  })

  it('un non-membre ne voit rien : ni membres, ni cartes, ni modification', async () => {
    const [a, b] = await users(2); const c = await make(a)
    for (const [fn, args] of [['bl_circle_members', {}], ['bl_circle_sharing', { p_on: true }], ['bl_circle_card', { p_card: CARD }], ['bl_circle_display', { p_display: 'Moi' }], ['bl_circle_leave', {}], ['bl_circle_rename', { p_name: 'Pris' }], ['bl_circle_delete', {}], ['bl_invite_create', {}], ['bl_invite_list', {}]] as [string, Record<string, unknown>][])
      expect(refused(await call(as(b), fn, { p_circle: c.id, ...args })), fn).toBe(fn === 'bl_circle_leave' ? 'bl:circle' : 'bl:circle')
    expect(refused(await call(as(b), 'bl_circle_kick', { p_circle: c.id, p_member: c.me }))).toBe('bl:circle')
    expect(refused(await call(as(b), 'bl_circle_members', { p_circle: '00000000-0000-0000-0000-000000000000' }))).toBe('bl:circle')
    expect((await sql<{ name: string }>('select name from bl.circles'))[0].name).toBe('Famille')
  })

  it('le partage est désactivé par défaut ; la carte n’est acceptée et visible qu’une fois le partage activé, cercle par cercle', async () => {
    const [a, b] = await users(2); const c1 = await make(a, 'Famille'), c2 = await make(a, 'Église'); await join(a, c1.id, b); await join(a, c2.id, b)
    expect(refused(await call(as(a), 'bl_circle_card', { p_circle: c1.id, p_card: CARD }))).toBe('bl:share')
    expect(ok(await call(as(a), 'bl_circle_sharing', { p_circle: c1.id, p_on: true }))).toEqual({ sharing: true })
    ok(await call(as(a), 'bl_circle_card', { p_circle: c1.id, p_card: CARD }))
    const seenBy = async (who: string, circle: string) => ok<{ display: string; you: boolean; owner: boolean; sharing: boolean; card: unknown }[]>(await call(as(who), 'bl_circle_members', { p_circle: circle }))
    const m1 = await seenBy(b, c1.id); expect(m1.map(x => [x.display, x.you, x.owner, x.sharing, x.card])).toEqual([['Ada', false, true, true, CARD], ['Léa', true, false, false, null]])
    const m2 = await seenBy(b, c2.id); expect(m2.find(x => x.display === 'Ada')).toMatchObject({ sharing: false, card: null, cardAt: null })   // autre cercle : rien
    expect(refused(await call(as(a), 'bl_circle_card', { p_circle: c2.id, p_card: CARD }))).toBe('bl:share')
  })

  it('couper le partage efface la carte conservée, côté serveur, aussitôt', async () => {
    const [a, b] = await users(2); const c = await make(a); await join(a, c.id, b)
    ok(await call(as(a), 'bl_circle_sharing', { p_circle: c.id, p_on: true })); ok(await call(as(a), 'bl_circle_card', { p_circle: c.id, p_card: CARD }))
    expect((await sql<{ card: unknown }>('select card from bl.members where card is not null')).length).toBe(1)
    ok(await call(as(a), 'bl_circle_sharing', { p_circle: c.id, p_on: false }))
    expect(await sql('select card, card_at from bl.members where card is not null or card_at is not null')).toEqual([])
    expect(ok<{ card: unknown; sharing: boolean }[]>(await call(as(b), 'bl_circle_members', { p_circle: c.id })).every(x => x.card === null)).toBe(true)
    expect(refused(await call(as(a), 'bl_circle_card', { p_circle: c.id, p_card: CARD }))).toBe('bl:share')
    expect(refused(await call(as(a), 'bl_circle_sharing', { p_circle: c.id, p_on: null }))).toBe('bl:arg')
  })

  it('un ami ne voit jamais l’identifiant de compte ni l’adresse d’un autre membre', async () => {
    const [a, b] = await users(2); const c = await make(a); await join(a, c.id, b); ok(await call(as(a), 'bl_circle_sharing', { p_circle: c.id, p_on: true })); ok(await call(as(a), 'bl_circle_card', { p_circle: c.id, p_card: CARD }))
    const out = JSON.stringify([(await call(as(b), 'bl_circle_members', { p_circle: c.id })).body, (await call(as(b), 'bl_circles')).body])
    expect(out).not.toContain(a); expect(out).not.toContain(b); expect(out).not.toContain('@exemple.test')
    const keys = Object.keys((ok<object[]>(await call(as(b), 'bl_circle_members', { p_circle: c.id })))[0]).sort(); expect(keys).toEqual(['at', 'card', 'cardAt', 'display', 'id', 'owner', 'sharing', 'you'])
  })

  it('carte refusée si elle n’est pas dans la liste blanche (clé en trop, mauvais type, valeur hors bornes) : rien n’est enregistré', async () => {
    const [a] = await users(1); const c = await make(a); ok(await call(as(a), 'bl_circle_sharing', { p_circle: c.id, p_on: true }))
    for (const bad of [{ ...CARD, gps: [1, 2] }, { ...CARD, v: 2 }, { ...CARD, d: '2026-02-30' }, { ...CARD, habits: { rate: 101, best: 1 } }, { ...CARD, habits: { rate: 5, best: 1, extra: 1 } }, { ...CARD, notes: [{ cat: 'Secret', n: 1 }] },
      { ...CARD, who: 'x'.repeat(41) }, { ...CARD, email: 'a@b.c' }, { v: 1 }, 'texte', [], null, { ...CARD, food: { kcal: 10, meals: new Array(7).fill('x') } }])
      expect(refused(await call(as(a), 'bl_circle_card', { p_circle: c.id, p_card: bad })), JSON.stringify(bad).slice(0, 60)).toBe('bl:card')
    expect(await sql('select card from bl.members where card is not null')).toEqual([])
    ok(await call(as(a), 'bl_circle_card', { p_circle: c.id, p_card: CARD }))
  })

  it('propriétaire : renommer, retirer un membre, supprimer le cercle ; membre : changer son nom, quitter ; le propriétaire ne peut pas quitter', async () => {
    const [a, b, d] = await users(3); const c = await make(a); const mb = await join(a, c.id, b, 'Léa'); await join(a, c.id, d, 'Sam')
    ok(await call(as(a), 'bl_circle_rename', { p_circle: c.id, p_name: 'Nouveau nom' })); expect((ok<{ name: string }[]>(await call(as(b), 'bl_circles')))[0].name).toBe('Nouveau nom')
    expect(refused(await call(as(b), 'bl_circle_rename', { p_circle: c.id, p_name: 'Pirate' }))).toBe('bl:circle')
    ok(await call(as(b), 'bl_circle_display', { p_circle: c.id, p_display: 'Léa B.' })); expect(ok<{ display: string; you: boolean }[]>(await call(as(a), 'bl_circle_members', { p_circle: c.id })).map(x => x.display)).toEqual(['Ada', 'Léa B.', 'Sam'])
    expect(refused(await call(as(b), 'bl_circle_kick', { p_circle: c.id, p_member: mb.me }))).toBe('bl:circle')   // un membre ne retire personne
    expect(refused(await call(as(a), 'bl_circle_kick', { p_circle: c.id, p_member: c.me }))).toBe('bl:member')   // le propriétaire ne se retire pas lui-même
    ok(await call(as(a), 'bl_circle_kick', { p_circle: c.id, p_member: mb.me }))
    expect(refused(await call(as(b), 'bl_circle_members', { p_circle: c.id }))).toBe('bl:circle')                  // retiré : plus d’accès
    expect(refused(await call(as(a), 'bl_circle_leave', { p_circle: c.id }))).toBe('bl:owner')
    ok(await call(as(d), 'bl_circle_leave', { p_circle: c.id })); expect(ok<unknown[]>(await call(as(a), 'bl_circle_members', { p_circle: c.id }))).toHaveLength(1)
    expect(refused(await call(as(d), 'bl_circle_leave', { p_circle: c.id }))).toBe('bl:circle')
    ok(await call(as(a), 'bl_circle_delete', { p_circle: c.id })); expect(ok(await call(as(a), 'bl_circles'))).toEqual([]); expect(await sql('select * from bl.members')).toEqual([])
  })

  it('quitter ou être retiré efface aussitôt la carte conservée', async () => {
    const [a, b] = await users(2); const c = await make(a); const mb = await join(a, c.id, b)
    ok(await call(as(b), 'bl_circle_sharing', { p_circle: c.id, p_on: true })); ok(await call(as(b), 'bl_circle_card', { p_circle: c.id, p_card: CARD }))
    ok(await call(as(a), 'bl_circle_kick', { p_circle: c.id, p_member: mb.me })); expect(await sql('select * from bl.members where card is not null')).toEqual([])
    await join(a, c.id, b); ok(await call(as(b), 'bl_circle_sharing', { p_circle: c.id, p_on: true })); expect((ok<{ you: boolean; card: unknown; sharing: boolean }[]>(await call(as(b), 'bl_circle_members', { p_circle: c.id }))).find(x => x.you)).toMatchObject({ sharing: true, card: null }) // revenir ne ressuscite pas l’ancienne carte
  })
})

describe('Invitations', () => {
  it('seul le propriétaire invite ; le code a la forme attendue et n’est jamais conservé (seule son empreinte l’est)', async () => {
    const [a, b] = await users(2); const c = await make(a)
    expect(refused(await call(as(b), 'bl_invite_create', { p_circle: c.id }))).toBe('bl:circle')
    const inv = ok<{ id: string; code: string; until: string }>(await call(as(a), 'bl_invite_create', { p_circle: c.id }))
    expect(inv.code).toMatch(/^[0-9A-F]{6}(-[0-9A-F]{6}){3}$/); expect(Date.parse(inv.until) - Date.now()).toBeGreaterThan(6.9 * 864e5); expect(Date.parse(inv.until) - Date.now()).toBeLessThan(7.1 * 864e5)
    const raw = inv.code.replace(/-/g, ''); const dump = JSON.stringify(await sql('select * from bl.invites'))
    expect(dump).not.toContain(raw); expect(dump).not.toContain(inv.code)
    const want = (await sql<{ h: string }>("select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [raw]))[0].h; expect(await sql<{ hash: string }>('select hash from bl.invites')).toEqual([{ hash: want }])
    const other = ok<{ code: string }>(await call(as(a), 'bl_invite_create', { p_circle: c.id })); expect(other.code).not.toBe(inv.code)
  })

  it('aperçu puis acceptation : le code se saisit en minuscules, avec ou sans tirets ; usage unique ; le nouveau membre ne partage rien au départ', async () => {
    const [a, b, d] = await users(3); const c = await make(a, 'Chorale', 'Ada')
    const inv = ok<{ code: string }>(await call(as(a), 'bl_invite_create', { p_circle: c.id }))
    expect(ok(await call(as(b), 'bl_invite_peek', { p_code: inv.code.toLowerCase().replace(/-/g, ' ') }))).toEqual({ name: 'Chorale', by: 'Ada', members: 1, full: false, already: false })
    expect(ok(await call(as(a), 'bl_invite_peek', { p_code: inv.code }))).toMatchObject({ already: true })
    const r = ok<{ circle: string; me: string }>(await call(as(b), 'bl_invite_accept', { p_code: inv.code.toLowerCase(), p_display: ' Léa ' })); expect(r.circle).toBe(c.id)
    expect((ok<{ sharing: boolean; display: string }[]>(await call(as(b), 'bl_circles')))[0]).toMatchObject({ sharing: false, display: 'Léa', owner: false, members: 2 })
    expect(refused(await call(as(d), 'bl_invite_accept', { p_code: inv.code, p_display: 'Sam' }))).toBe('bl:invite')   // déjà utilisé
    expect(refused(await call(as(d), 'bl_invite_peek', { p_code: inv.code }))).toBe('bl:invite')
  })

  it('code inconnu, mal recopié ou vide : toujours la même erreur, sans rien révéler', async () => {
    const [a, b] = await users(2); const c = await make(a); const inv = ok<{ code: string }>(await call(as(a), 'bl_invite_create', { p_circle: c.id }))
    const wrong = inv.code.slice(0, -1) + (inv.code.endsWith('0') ? '1' : '0')
    for (const code of [wrong, '', 'ZZZZ', '0'.repeat(24), inv.code.slice(0, 20)]) {
      expect(refused(await call(as(b), 'bl_invite_peek', { p_code: code })), code).toBe('bl:invite'); expect(refused(await call(as(b), 'bl_invite_accept', { p_code: code, p_display: 'Léa' })), code).toBe('bl:invite')
    }
  })

  it('invitation expirée refusée ; échec d’acceptation = invitation intacte', async () => {
    const [a, b] = await users(2); const c = await make(a); const inv = ok<{ code: string; id: string }>(await call(as(a), 'bl_invite_create', { p_circle: c.id }))
    expect(refused(await call(as(b), 'bl_invite_accept', { p_code: inv.code, p_display: '' }))).toBe('bl:display')
    expect(ok(await call(as(b), 'bl_invite_peek', { p_code: inv.code }))).toMatchObject({ name: 'Famille' })       // l’invitation n’a pas été consommée par l’échec
    await db.query("update bl.invites set until = now() - interval '1 minute' where id = $1", [inv.id])
    expect(refused(await call(as(b), 'bl_invite_peek', { p_code: inv.code }))).toBe('bl:invite')   // expirée : l’aperçu ne montre rien non plus (ni nom du cercle, ni créateur)
    expect(refused(await call(as(b), 'bl_invite_accept', { p_code: inv.code, p_display: 'Léa' }))).toBe('bl:invite')
    expect(await sql('select * from bl.members where circle = $1', [c.id])).toHaveLength(1)
    expect(ok<unknown[]>(await call(as(a), 'bl_invite_list', { p_circle: c.id }))).toEqual([])
    ok(await call(as(a), 'bl_invite_create', { p_circle: c.id })); expect(await sql('select * from bl.invites')).toHaveLength(1)   // l’expirée est purgée à la création suivante
  })

  it('déjà membre : refusé sans consommer l’invitation ; cercle plein (12) ; cinq cercles au plus par personne', async () => {
    const us = await users(14); const [a, b] = us; const c = await make(a)
    const inv = ok<{ code: string }>(await call(as(a), 'bl_invite_create', { p_circle: c.id })); ok(await call(as(b), 'bl_invite_accept', { p_code: inv.code, p_display: 'Léa' }))
    const inv2 = ok<{ code: string }>(await call(as(a), 'bl_invite_create', { p_circle: c.id }))
    expect(refused(await call(as(b), 'bl_invite_accept', { p_code: inv2.code, p_display: 'Léa' }))).toBe('bl:member'); expect(ok(await call(as(a), 'bl_invite_peek', { p_code: inv2.code }))).toMatchObject({ members: 2 })
    for (let i = 2; i < 12; i++) await join(a, c.id, us[i], 'M' + i)
    expect(ok(await call(as(a), 'bl_invite_peek', { p_code: inv2.code }))).toMatchObject({ members: 12, full: true })
    expect(refused(await call(as(us[12]), 'bl_invite_accept', { p_code: inv2.code, p_display: 'Trop' }))).toBe('bl:full'); expect(ok<unknown[]>(await call(as(a), 'bl_invite_list', { p_circle: c.id }))).toHaveLength(1)
    const z = us[13]; for (let i = 0; i < 5; i++) await make(z, 'Z' + i)
    expect(refused(await call(as(z), 'bl_invite_accept', { p_code: inv2.code, p_display: 'Zoé' }))).toBe('bl:full')     // plein : refusé pour cette raison d’abord
    const c2 = await make(a, 'Autre'), inv3 = ok<{ code: string }>(await call(as(a), 'bl_invite_create', { p_circle: c2.id }))
    expect(refused(await call(as(z), 'bl_invite_accept', { p_code: inv3.code, p_display: 'Zoé' }))).toBe('bl:limit')
  })

  it('dix invitations en attente au plus ; liste du propriétaire (sans les codes) ; révocation', async () => {
    const [a, b] = await users(2); const c = await make(a); const ids: string[] = []
    for (let i = 0; i < 10; i++) ids.push(ok<{ id: string }>(await call(as(a), 'bl_invite_create', { p_circle: c.id })).id)
    expect(refused(await call(as(a), 'bl_invite_create', { p_circle: c.id }))).toBe('bl:limit')
    const l = ok<Record<string, unknown>[]>(await call(as(a), 'bl_invite_list', { p_circle: c.id })); expect(l).toHaveLength(10); expect(Object.keys(l[0]).sort()).toEqual(['at', 'id', 'until'])
    expect(refused(await call(as(b), 'bl_invite_list', { p_circle: c.id }))).toBe('bl:circle')
    ok(await call(as(a), 'bl_invite_revoke', { p_circle: c.id, p_invite: ids[3] })); expect(ok<unknown[]>(await call(as(a), 'bl_invite_list', { p_circle: c.id }))).toHaveLength(9)
    expect(refused(await call(as(a), 'bl_invite_revoke', { p_circle: c.id, p_invite: ids[3] }))).toBe('bl:invite')
    expect(refused(await call(as(b), 'bl_invite_revoke', { p_circle: c.id, p_invite: ids[4] }))).toBe('bl:circle')
    ok(await call(as(a), 'bl_invite_create', { p_circle: c.id }))
  })

  it('supprimer le cercle supprime ses invitations', async () => {
    const [a] = await users(1); const c = await make(a); ok(await call(as(a), 'bl_invite_create', { p_circle: c.id })); ok(await call(as(a), 'bl_circle_delete', { p_circle: c.id }))
    expect(await sql('select * from bl.invites')).toEqual([])
  })
})

describe('Rappels application fermée', () => {
  const EP = 'https://fcm.googleapis.com/fcm/send/abc123', EP2 = 'https://updates.push.services.mozilla.com/wpush/v2/xyz'
  const item = (ref: string, inMs: number, body = 'QUJD') => ({ ref, at: new Date(Date.now() + inMs).toISOString(), body })

  it('enregistrement : adresse https exigée ; un abonnement n’appartient qu’à un compte (le dernier qui l’enregistre)', async () => {
    const [a, b] = await users(2)
    for (const ep of ['http://x.test/a', 'https://x.test', 'ftp://x/y', '', 'https://' + 'x'.repeat(1000) + '/y']) expect(refused(await call(as(a), 'bl_push_register', { p_ep: ep })), ep.slice(0, 30)).toBe('bl:ep')
    ok(await call(as(a), 'bl_push_register', { p_ep: EP })); ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [item('t1', 60_000)] }))
    ok(await call(as(b), 'bl_push_register', { p_ep: EP }))                         // même navigateur, autre compte
    expect(await sql('select * from bl.reminders')).toEqual([]); expect(await sql<{ uid: string }>('select uid from bl.pushsubs')).toEqual([{ uid: b }])
    expect(refused(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [] }))).toBe('bl:ep')
    ok(await call(as(a), 'bl_push_unregister', { p_ep: EP }))                       // l’abonnement est à b : sans effet, sans erreur
    expect(await sql<{ uid: string }>('select uid from bl.pushsubs')).toEqual([{ uid: b }])
    ok(await call(as(b), 'bl_push_unregister', { p_ep: EP })); expect(await sql('select * from bl.pushsubs')).toEqual([])
    ok(await call(as(a), 'bl_push_unregister', { p_ep: EP }))                       // sans effet, sans erreur
  })

  it('cinq abonnements au plus par compte (les plus récents sont gardés)', async () => {
    const [a] = await users(1)
    for (let i = 0; i < 7; i++) { ok(await call(as(a), 'bl_push_register', { p_ep: 'https://push.test/' + i })); await db.query("update bl.pushsubs set seen = now() - ($1 || ' seconds')::interval where ep = $2", [String(20 - i), 'https://push.test/' + i]) }
    ok(await call(as(a), 'bl_push_register', { p_ep: 'https://push.test/7' }))
    const eps = (await sql<{ ep: string }>('select ep from bl.pushsubs order by ep')).map(x => x.ep); expect(eps).toHaveLength(5); expect(eps).toContain('https://push.test/7')
  })

  it('armement : remplace tout, ignore le trop ancien ou trop lointain, refuse les éléments mal formés', async () => {
    const [a] = await users(1); ok(await call(as(a), 'bl_push_register', { p_ep: EP }))
    expect(ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [item('t1', 3600e3), item('t2', 7200e3), item('vieux', -3600e3), item('loin', 60 * 864e5)] }))).toEqual({ armed: 2 })
    expect((await sql<{ ref: string }>('select ref from bl.reminders order by ref')).map(x => x.ref)).toEqual(['t1', 't2'])
    expect(ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [item('t3', 60e3), item('t3', 120e3, 'REVG')] }))).toEqual({ armed: 2 })   // même référence : la dernière gagne
    expect(await sql<{ ref: string; body: string }>('select ref, body from bl.reminders')).toEqual([{ ref: 't3', body: 'REVG' }])
    for (const bad of [[{ ref: 'x', at: 'demain', body: 'QUJD' }], [{ ref: 'x', at: new Date().toISOString(), body: 'pas du base64 !' }], [{ ref: '', at: new Date().toISOString(), body: 'QUJD' }], [{ at: new Date().toISOString(), body: 'QUJD' }], ['texte'], new Array(101).fill(item('r', 60e3)), { ref: 'x' }])
      expect(refused(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: bad })), JSON.stringify(bad).slice(0, 50)).toBe('bl:items')
    expect(await sql('select * from bl.reminders')).toHaveLength(1)                 // un appel refusé ne touche à rien
    ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [] })); expect(await sql('select * from bl.reminders')).toEqual([])
    ok(await call(as(a), 'bl_push_register', { p_ep: EP2 })); ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [item('a', 60e3)] })); ok(await call(as(a), 'bl_push_set', { p_ep: EP2, p_items: [item('b', 60e3)] }))
    ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [] })); expect((await sql<{ ref: string }>('select ref from bl.reminders')).map(x => x.ref)).toEqual(['b'])    // un appareil ne touche pas aux rappels d’un autre
  })

  it('le serveur prend les rappels échus une seule fois, puis réessaie jusqu’à quatre fois ; « fait » les supprime, « disparu » supprime l’abonnement', async () => {
    const [a, b] = await users(2); ok(await call(as(a), 'bl_push_register', { p_ep: EP })); ok(await call(as(a), 'bl_push_register', { p_ep: EP2 }))
    ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [item('maintenant', 0, 'QUJD'), item('plus-tard', 3600e3)] })); ok(await call(as(a), 'bl_push_set', { p_ep: EP2, p_items: [item('autre', 0, 'REVG')] }))
    const EP3 = 'https://web.push.apple.com/autre-compte'; ok(await call(as(b), 'bl_push_register', { p_ep: EP3 })); ok(await call(as(b), 'bl_push_set', { p_ep: EP3, p_items: [item('b1', 3600e3), item('b2', 7200e3)] }))   // un autre compte, rappels pas encore échus
    expect(ok(await call(as(a), 'bl_push_status'))).toMatchObject({ subs: 2, pending: 3, tick: null })
    expect(ok(await call(as(b), 'bl_push_status'))).toMatchObject({ subs: 1, pending: 2, tick: null })       // chaque compte ne compte que les siens
    const got = ok<{ id: number; ep: string; body: string; ttl: number }[]>(await call(SERVER, 'bl_push_claim', { p_limit: 50 })); expect(got.map(x => x.body).sort()).toEqual(['QUJD', 'REVG']); expect(got.every(x => x.ttl > 12 * 3600 - 120 && x.ttl <= 12 * 3600)).toBe(true)      // douze heures après l'heure prévue (échue à l'instant)
    expect(ok<unknown[]>(await call(SERVER, 'bl_push_claim'))).toEqual([])         // pas deux fois de suite
    expect((await call(as(a), 'bl_push_status')).body).toMatchObject({ tick: expect.any(String) })
    ok(await call(SERVER, 'bl_push_done', { p_ok: [got.find(x => x.ep === EP)!.id], p_gone: [EP2] }))
    expect((await sql<{ ref: string }>('select ref from bl.reminders where uid = $1', [a])).map(x => x.ref)).toEqual(['plus-tard']); expect((await sql<{ ep: string }>('select ep from bl.pushsubs where uid = $1', [a])).map(x => x.ep)).toEqual([EP])
    expect((await sql<{ ref: string }>('select ref from bl.reminders where uid = $1 order by ref', [b])).map(x => x.ref)).toEqual(['b1', 'b2'])      // l'autre compte n'est pas touché
    // nouvel essai après le délai, quatre essais au plus
    for (let i = 0; i < 6; i++) { await db.query("update bl.reminders set nxt = now() - interval '1 second', at = now() - interval '1 minute' where uid = $1", [a]); const g = ok<unknown[]>(await call(SERVER, 'bl_push_claim')); expect(g.length, 'essai ' + (i + 1)).toBe(i < 4 ? 1 : 0) }
  })

  it('« bl_push_ping » (vérification du déploiement) : réservée au serveur, ne modifie rien, et montre le dernier passage du planificateur', async () => {
    const [a] = await users(1)
    expect((await call(as(a), 'bl_push_ping')).status).toBe(403); expect((await call({ role: 'anon' }, 'bl_push_ping')).status).toBe(401)
    const before = ok<{ v: number; tick: string | null; now: string }>(await call(SERVER, 'bl_push_ping'))
    expect(before).toMatchObject({ v: 1, tick: null, now: expect.any(String) })
    ok(await call(as(a), 'bl_push_register', { p_ep: EP })); ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [item('r', 0)] }))
    const state = async () => JSON.stringify([await sql('select * from bl.meta order by k'), await sql('select id, tries, nxt from bl.reminders order by id'), await sql('select ep, seen from bl.pushsubs order by ep')])
    const snap = await state()
    for (let i = 0; i < 3; i++) ok(await call(SERVER, 'bl_push_ping'))
    expect(await state(), 'trois vérifications ne changent aucune ligne (ni passage du planificateur, ni essai de rappel)').toBe(snap)
    expect(ok<{ tick: string | null }>(await call(SERVER, 'bl_push_ping')).tick).toBeNull()      // une vérification n'est pas un passage du planificateur
    ok(await call(SERVER, 'bl_push_claim'))
    expect(ok<{ tick: string | null }>(await call(SERVER, 'bl_push_ping')).tick).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('seul le serveur peut prendre ou clore des rappels', async () => {
    const [a] = await users(1); ok(await call(as(a), 'bl_push_register', { p_ep: EP }))
    expect((await call(as(a), 'bl_push_claim')).status).toBe(403); expect((await call({ role: 'anon' }, 'bl_push_claim')).status).toBe(401)
    expect((await call(as(a), 'bl_push_done', { p_ok: [1], p_gone: [] })).status).toBe(403); expect((await call({ role: 'anon' }, 'bl_push_done', { p_ok: [], p_gone: [] })).status).toBe(401)
  })

  it('nettoyage : un rappel vieux de plus d’un jour est supprimé sans être pris (23 heures : encore pris, durée de vie minimale) ; un abonnement oublié depuis 90 jours est supprimé avec ses rappels', async () => {
    const [a] = await users(1); ok(await call(as(a), 'bl_push_register', { p_ep: EP })); ok(await call(as(a), 'bl_push_register', { p_ep: EP2 }))
    ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [item('vieux', 0), item('hier', 0)] })); ok(await call(as(a), 'bl_push_set', { p_ep: EP2, p_items: [item('oublie', 0)] }))
    await db.exec("update bl.reminders set at = now() - interval '25 hours' where ref = 'vieux'; update bl.reminders set at = now() - interval '23 hours' where ref = 'hier'")
    const got = ok<{ id: number; ep: string; ttl: number }[]>(await call(SERVER, 'bl_push_claim'))
    expect(got.map(x => x.ep).sort()).toEqual([EP, EP2].sort())                          // « hier » (23 h) et « oublie » (à l'instant) ; pas « vieux » (25 h)
    expect(got.map(x => x.ttl).sort((x, y) => x - y)[0]).toBe(60)                      // 23 h de retard : la durée de vie est au minimum
    expect((await sql<{ ref: string }>('select ref from bl.reminders order by ref')).map(x => x.ref)).toEqual(['hier', 'oublie'])   // « vieux » a été supprimé, jamais pris
    await db.exec("update bl.pushsubs set seen = now() - interval '91 days' where ep = '" + EP2 + "'; update bl.reminders set nxt = now() - interval '1 second'")
    expect(ok<unknown[]>(await call(SERVER, 'bl_push_claim')).length).toBe(1)          // « hier » est repris ; « oublie » a disparu avec son abonnement
    expect((await sql<{ ep: string }>('select ep from bl.pushsubs')).map(x => x.ep)).toEqual([EP]); expect((await sql<{ ref: string }>('select ref from bl.reminders')).map(x => x.ref)).toEqual(['hier'])
    await db.exec("update bl.pushsubs set seen = now() - interval '91 days'; update bl.reminders set at = now() - interval '2 days'")
    expect(ok<unknown[]>(await call(SERVER, 'bl_push_claim'))).toEqual([]); expect(await sql('select * from bl.reminders')).toEqual([]); expect(await sql('select * from bl.pushsubs')).toEqual([])
  })

  it('nombre de rappels pris à chaque passage : 50 par défaut, au moins 1, au plus 200', async () => {
    const [a] = await users(1); ok(await call(as(a), 'bl_push_register', { p_ep: EP }))
    await db.query("insert into bl.reminders (uid, ep, ref, at, body) select $1, $2, 'r' || g, now() - interval '1 minute', 'QUJD' from generate_series(1, 250) g", [a, EP])
    const rearm = () => db.exec("update bl.reminders set tries = 0, nxt = now() - interval '1 second'")
    const take = async (args: Record<string, unknown>) => { await rearm(); return ok<unknown[]>(await call(SERVER, 'bl_push_claim', args)).length }
    const cases: [string, Record<string, unknown>, number][] = [['sans valeur', {}, 50], ['vide', { p_limit: null }, 50], ['7', { p_limit: 7 }, 7], ['200', { p_limit: 200 }, 200], ['201', { p_limit: 201 }, 200], ['1000', { p_limit: 1000 }, 200], ['1', { p_limit: 1 }, 1], ['0', { p_limit: 0 }, 1], ['-5', { p_limit: -5 }, 1]]
    for (const [why, args, n] of cases) expect(await take(args), why).toBe(n)
  })

  it('le contenu d’un rappel n’est jamais lu par le serveur : il est conservé tel que l’appareil l’a chiffré', async () => {
    const [a] = await users(1); ok(await call(as(a), 'bl_push_register', { p_ep: EP })); const body = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4'
    ok(await call(as(a), 'bl_push_set', { p_ep: EP, p_items: [item('t', 0, body)] })); expect((await sql<{ body: string }>('select body from bl.reminders'))[0].body).toBe(body)
  })
})

describe('Compte', () => {
  it('informations du compte : ce que le serveur conserve', async () => {
    const [a, b] = await users(2); const c = await make(a); await join(a, c.id, b); await make(b, 'Autre')
    ok(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB, p_dev: 'Pixel' })); ok(await call(as(a), 'bl_circle_sharing', { p_circle: c.id, p_on: true })); ok(await call(as(a), 'bl_circle_card', { p_circle: c.id, p_card: CARD }))
    ok(await call(as(a), 'bl_push_register', { p_ep: 'https://p.test/a' })); ok(await call(as(a), 'bl_push_set', { p_ep: 'https://p.test/a', p_items: [{ ref: 'r', at: new Date(Date.now() + 60e3).toISOString(), body: 'QUJD' }] }))
    expect(ok(await call(as(a), 'bl_account_info'))).toMatchObject({ snap: { rev: 1, size: BLOB.length, dev: 'Pixel' }, circles: 1, owned: 1, subs: 1, reminders: 1, cards: 1 })
    expect(ok(await call(as(b), 'bl_account_info'))).toMatchObject({ snap: null, circles: 2, owned: 1, subs: 0, reminders: 0, cards: 0 })
  })

  it('supprimer le compte efface tout ce qui s’y rattache et rien d’autre : instantané, cercles créés (avec leurs membres), appartenances et cartes, invitations, abonnements, rappels', async () => {
    const [a, b, d] = await users(3); const ca = await make(a, 'De A'), cb = await make(b, 'De B'); await join(a, ca.id, b); await join(b, cb.id, a); await join(a, ca.id, d)
    ok(await call(as(a), 'bl_invite_create', { p_circle: ca.id })); ok(await call(as(a), 'bl_circle_sharing', { p_circle: cb.id, p_on: true })); ok(await call(as(a), 'bl_circle_card', { p_circle: cb.id, p_card: CARD }))
    ok(await call(as(a), 'bl_snap_put', { p_expected: 0, p_blob: BLOB })); ok(await call(as(b), 'bl_snap_put', { p_expected: 0, p_blob: BLOB + 'B' }))
    ok(await call(as(a), 'bl_push_register', { p_ep: 'https://p.test/a' })); ok(await call(as(a), 'bl_push_set', { p_ep: 'https://p.test/a', p_items: [{ ref: 'r', at: new Date(Date.now() + 60e3).toISOString(), body: 'QUJD' }] }))
    expect(ok(await call(as(a), 'bl_account_delete'))).toEqual({ ok: true })
    expect(await sql('select * from auth.users where id = $1', [a])).toEqual([])
    expect(await sql('select * from bl.snaps where uid = $1', [a])).toEqual([]); expect(await sql('select * from bl.members where uid = $1', [a])).toEqual([]); expect(await sql('select * from bl.circles where owner = $1', [a])).toEqual([])
    expect(await sql('select * from bl.members where circle = $1', [ca.id])).toEqual([]); expect(await sql('select * from bl.invites')).toEqual([]); expect(await sql('select * from bl.pushsubs')).toEqual([]); expect(await sql('select * from bl.reminders')).toEqual([])
    // les autres comptes sont intacts : B garde son instantané et son cercle, sans la carte de A ; D n’a plus de cercle
    expect(ok(await call(as(b), 'bl_snap_meta'))).toMatchObject({ rev: 1 }); expect(ok<{ members: number }[]>(await call(as(b), 'bl_circles'))).toMatchObject([{ members: 1 }])
    expect(ok(await call(as(d), 'bl_circles'))).toEqual([]); expect(await sql('select * from bl.members where card is not null')).toEqual([])
  })
})
