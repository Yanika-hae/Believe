// @vitest-environment node
// La carte « Vue Ami » est vérifiée deux fois : sur l'appareil (whyBad) et par la base de données (bl.valid_card). Les deux doivent dire la même chose.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { SCHEMA, addUser, freshDb } from './testsql'
import { buildShare, whyBad } from './share'
import type { SharePayload } from './share'
import { DEF, SHARE_KEYS, NOTE_CATS } from './lib'
import type { State } from './lib'

let db: PGlite
beforeAll(async () => { db = await freshDb() }, 90_000)
afterAll(async () => { await db.close() })

const DAY = '2026-10-22', STAMP = DAY + 'T08:00:00.000Z'
const book = (id: string, t: string, a: string, st: 'lire' | 'cours' | 'fini') => ({ id, t, a, src: 'perso' as const, ref: '', cover: null, url: null, total: 200, page: 0, st })
/** Un état très rempli, tous les partages cochés ; `big` : des textes aux longueurs maximales et des listes pleines. */
function rich(big: boolean): State {
  const s = DEF(), L = (n: number, c = 'é') => c.repeat(n)
  s.consents.share = true; for (const k of SHARE_KEYS) s.share.vis[k] = true
  s.profile = { g: 'F', name: big ? L(60, '漢') : 'Ada', age: 37, h: 171, w: 66.6, t: 59.4, ws: 73.3, lv: 'I', sx: 'F' }
  s.checks = { '2026-10-19': ['h1', 'h2'], '2026-10-20': ['h1'], '2026-10-21': ['h1'], [DAY]: ['h1'] }
  s.steps = { '2026-10-20': 12000 }
  s.weights = [{ d: '2026-10-15', kg: 68 }, { d: '2026-10-21', kg: 66.6 }]
  s.cycle = { mode: 'recup', starts: [], rec: { [DAY]: [4, 3, 5] }, en: {} }
  s.quiz.hist = [{ d: '2026-10-20', n: 5, ok: 4, cats: [] }]
  const n = big ? 12 : 2
  s.books = Array.from({ length: n }, (_, i) => book('b' + i, big ? L(100, '漢') : 'Les Pensées ' + i, big ? L(80) : 'Pascal', 'cours'))
  s.meals = Array.from({ length: n }, (_, i) => ({ id: 'm' + i, d: DAY, n: big ? L(60, '漢') : 'Soupe ' + i, kcal: 300, p: 1, g: 1, l: 1, src: 'manuel' as const }))
  s.prayers = Array.from({ length: n + 4 }, (_, i) => ({ id: 'p' + i, t: big ? L(120, '漢') : 'Sujet ' + i, c: DAY, a: i % 2 ? DAY : null }))
  s.notes = NOTE_CATS.map((c, i) => ({ id: 'n' + i, cat: c, t: 't', b: 'b', c: STAMP, u: STAMP }))
  return s
}
const valid = async (p: unknown) => (await db.query<{ v: boolean }>('select bl.valid_card($1::jsonb) as v', [JSON.stringify(p)])).rows[0].v
const validRaw = async (json: string) => (await db.query<{ v: boolean }>('select bl.valid_card($1::jsonb) as v', [json])).rows[0].v

const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
type J = unknown
const walk = (x: J, path: (string | number)[] = [], out: (string | number)[][] = []) => { out.push(path); if (x && typeof x === 'object') for (const k of Object.keys(x)) walk((x as Record<string, J>)[k], [...path, Array.isArray(x) ? +k : k], out); return out }
const getAt = (x: J, path: (string | number)[]) => path.reduce((a: J, k) => (a as Record<string | number, J>)[k], x)
function setAt(root: J, path: (string | number)[], v: J): J {
  if (!path.length) return v
  const c = JSON.parse(JSON.stringify(root)); let o = c; for (const k of path.slice(0, -1)) o = o[k]; const last = path[path.length - 1]
  if (v === undefined) { if (Array.isArray(o)) o.splice(+last, 1); else delete o[last] } else o[last] = v
  return c
}
const MUT: ((v: J, r: () => number) => J)[] = [
  () => null, () => 'x', () => 12, () => true, () => [], () => ({}), () => undefined,
  v => (typeof v === 'number' ? v + 1000000 : v), v => (typeof v === 'number' ? -v - 1 : v), v => (typeof v === 'number' ? v + 0.5 : v),
  v => (typeof v === 'string' ? '' : v), v => (typeof v === 'string' ? v + 'x'.repeat(130) : v),
  v => (typeof v === 'string' ? 'é'.repeat(v.length + 1) : v),
  v => (Array.isArray(v) ? [...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v] : v),
  v => (Array.isArray(v) ? [...v, 5] : v), v => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v, gps: [48.85, 2.35] } : v),
  v => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v, uid: 'abc' } : v), () => '2026-02-30', () => '2026-10-23T00:00', () => '23/10/2026', () => 2, () => '1', () => 'Secret'
]

describe('Carte : la base de données et l’appareil disent la même chose', () => {
  it('toute carte fabriquée par l’application est acceptée par la base — tous les partages cochés, textes aux longueurs maximales, listes pleines', async () => {
    for (const big of [false, true]) {
      const p = buildShare(rich(big), DAY)!
      expect(whyBad(p), 'appareil').toBeNull(); expect(await valid(p), 'base de données').toBe(true)
      expect(Object.keys(p).sort()).toEqual(['badges', 'books', 'cycle', 'd', 'food', 'habits', 'notes', 'prayers', 'quiz', 'steps', 'v', 'weight', 'weightPct', 'who'].sort().filter(k => k in p))
    }
    const full = buildShare(rich(true), DAY)!; expect(full.books).toHaveLength(5); expect(full.prayers).toHaveLength(8); expect(full.food!.meals).toHaveLength(6); expect(full.notes).toHaveLength(5)
    expect(new TextEncoder().encode(JSON.stringify(full)).length).toBeLessThan(20000)   // la limite de taille de la base laisse de la marge au pire cas
    expect(await valid({ v: 1, d: DAY })).toBe(true)                                     // carte minimale
  })

  it('cartes minimales et vides, cases une par une', async () => {
    for (const k of SHARE_KEYS) { const s = rich(false); s.share.vis = { [k]: true }; const p = buildShare(s, DAY)!; expect(await valid(p), k).toBe(whyBad(p) === null) }
    const s = rich(false); s.share.vis = {}; const p = buildShare(s, DAY)!; expect(p).toEqual({ v: 1, d: DAY }); expect(await valid(p)).toBe(true)
  })

  it('cartes abîmées au hasard (2 000) : même verdict des deux côtés, jamais acceptée à tort par la base', async () => {
    const base = [buildShare(rich(false), DAY)!, buildShare(rich(true), DAY)!], r = rng(20261023)
    let refused = 0, accepted = 0
    for (let i = 0; i < 2000; i++) {
      let p: J = base[i % 2]; const steps = 1 + Math.floor(r() * 2)
      for (let k = 0; k < steps; k++) { const paths = walk(p); const path = paths[Math.floor(r() * paths.length)]; const cur = path.length ? getAt(p, path) : p; p = setAt(p, path, MUT[Math.floor(r() * MUT.length)](cur, r)) }
      const dev = p === undefined ? 'refus' : whyBad(p) === null ? 'ok' : 'refus', srv = p === undefined ? false : await valid(p)
      if (dev === 'ok') accepted++; else refused++
      expect(srv ? 'ok' : 'refus', 'carte ' + i + ' : ' + String(JSON.stringify(p)).slice(0, 300)).toBe(dev)
    }
    expect(refused).toBeGreaterThan(1200); expect(accepted).toBeGreaterThan(20)   // le corpus contient bien des deux sortes
  }, 120_000)

  it('cas particuliers écrits à la main', async () => {
    const ok: string[] = ['{"v":1,"d":"2026-10-23"}', '{"v":1.0,"d":"2026-10-23"}', '{"v":1,"d":"2024-02-29"}', '{"v":1,"d":"2026-10-23","quiz":{"n":3,"avg":50,"last":null}}', '{"v":1,"d":"2026-10-23","steps":{"days":7}}', '{"v":1,"d":"2026-10-23","weight":{"from":20,"now":400,"goal":20.5}}', '{"v":1,"d":"2026-10-23","habits":{"rate":5e1,"best":3.0}}', '{"v":1,"d":"2026-10-23","books":[{"t":"Titre","a":""}]}']
    const ko: string[] = ['{}', '[]', 'null', '"x"', '{"v":1}', '{"d":"2026-10-23"}', '{"v":1,"d":"2025-02-29"}', '{"v":1,"d":"2026-10-23","who":null}', '{"v":1,"d":"2026-10-23","who":""}', '{"v":1,"d":"2026-10-23","weightPct":null}', '{"v":1,"d":"2026-10-23","quiz":{"n":3,"avg":50}}',
      '{"v":1,"d":"2026-10-23","steps":{"days":1,"km":2}}', '{"v":1,"d":"2026-10-23","steps":{"days":8}}', '{"v":1,"d":"2026-10-23","steps":{}}', '{"v":1,"d":"2026-10-23","weight":{"from":19.9,"now":70,"goal":60}}', '{"v":1,"d":"2026-10-23","cycle":{"kind":"autre","txt":"x"}}', '{"v":1,"d":"2026-10-23","habits":{"rate":50.5,"best":3}}',
      '{"v":1,"d":"2026-10-23","books":[{"t":"Titre"}]}', '{"v":1,"d":"2026-10-23","notes":[{"cat":"Rêves","n":0}]}', '{"v":1,"d":"2026-10-23","__proto__":{"x":1}}', '{"v":1,"d":"2026-10-23","constructor":1}', '{"v":1,"d":" 2026-10-23"}', '{"v":1,"d":"2026-10-23","badges":"x"}']
    for (const j of ok) { expect(whyBad(JSON.parse(j)), j).toBeNull(); expect(await validRaw(j), j).toBe(true) }
    for (const j of ko) { expect(whyBad(JSON.parse(j)), j).not.toBeNull(); expect(await validRaw(j), j).toBe(false) }
  })

  it('taille : la base refuse une carte de plus de 20 000 octets, même quand chaque valeur est dans les bornes (entiers écrits avec des milliers de zéros décimaux) ; 20 000 pile est accepté', async () => {
    // PostgreSQL garde au plus 16 383 décimales par nombre : deux nombres « larges » (50,000… en pourcentage) suffisent à dépasser la limite sans qu'aucune valeur sorte de ses bornes.
    const wide = (zeros: number) => { const a = Math.min(zeros - 1, 16000); return `{"v":1,"d":"2026-10-23","weightPct":50.${'0'.repeat(a)},"habits":{"rate":50.${'0'.repeat(zeros - a)},"best":3}}` }
    const size = async (json: string) => (await db.query<{ n: number }>('select octet_length($1::jsonb::text) as n', [json])).rows[0].n   // la taille du texte tel que la base le conserve
    const base = await size(wide(2)), exact = wide(2 + 20000 - base), over = wide(2 + 20001 - base)
    expect(await size(exact)).toBe(20000); expect(await size(over)).toBe(20001)
    expect(await validRaw(wide(2)), 'petite').toBe(true); expect(await validRaw(exact), '20 000 octets').toBe(true)
    expect(await validRaw(over), '20 001 octets').toBe(false); expect(await validRaw(wide(32000)), '32 000 zéros').toBe(false)
  })

  it('un texte avec des caractères hors du plan de base (émojis) : accepté par l’appareil ⇒ accepté par la base', async () => {
    const p: SharePayload = { v: 1, d: DAY, who: '😀'.repeat(20), prayers: [{ t: '🙏'.repeat(40), ok: false }] }
    expect(whyBad(p)).toBeNull(); expect(await valid(p)).toBe(true)
  })

  it('carte déposée par une version antérieure (avec la distance des séances) : relancer le script retire cette distance, le reste de la carte est intact, un second passage ne change rien', async () => {
    const u = await addUser(db), c = (await db.query<{ id: string }>("insert into bl.circles (name, owner) values ('Famille', $1) returning id", [u])).rows[0].id
    const old = { v: 1, d: DAY, habits: { rate: 50, best: 2 }, steps: { days: 3, km: 12.5 } }
    await db.query("insert into bl.members (circle, uid, display, sharing, card) values ($1, $2, 'Ada', true, $3::jsonb)", [c, u, JSON.stringify(old)])
    expect(await validRaw(JSON.stringify(old)), 'une carte avec distance n’est plus acceptée en dépôt').toBe(false)
    const row = async () => (await db.query<{ card: unknown }>('select card from bl.members where circle = $1', [c])).rows[0].card, want = { v: 1, d: DAY, habits: { rate: 50, best: 2 }, steps: { days: 3 } }
    await db.exec(SCHEMA); expect(await row()).toEqual(want); expect(whyBad(await row())).toBeNull(); expect(await valid(await row())).toBe(true)
    await db.exec(SCHEMA); expect(await row()).toEqual(want)
  })
})
