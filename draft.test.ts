// @vitest-environment node
// Copie de travail de l'état : seules les rubriques touchées sont recopiées, l'état de départ n'est jamais modifié.
import { describe, expect, it } from 'vitest'
import { DEF } from './lib'
import type { State } from './lib'
import { copie } from './draft'

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
/** Un état avec un peu de tout, pour que chaque rubrique ait un contenu à protéger. */
const rich = (): State => {
  const s = DEF()
  s.profile = { g: 'F', name: 'Ada', age: 34, h: 168, w: 64, t: 60, ws: 70, lv: 'I', sx: 'F' }
  s.checks['2026-10-01'] = ['h1', 'h2']; s.checks['2026-10-02'] = ['h3']
  s.weights.push({ d: '2026-10-01', kg: 64.5 }, { d: '2026-10-08', kg: 64 })
  s.notes.push({ id: 'n1', cat: 'Rêves', t: 'Un rêve', b: 'Corps', c: '2026-10-01T08:00:00.000Z', u: '2026-10-01T08:00:00.000Z' })
  s.prayers.push({ id: 'p1', t: 'Pour ma famille', c: '2026-10-01', a: null })
  s.tasks.push({ id: 't1', t: 'Appeler', imp: true, due: null, done: false, p: null })
  s.settings.theme = 'dark'; s.consents.ai = true
  return s
}
const run = (base: State, f: (s: State) => void) => { const c = copie(base); f(c.s); return c.fin() }
/** Ce que faisait l'application avant : copie complète de l'état, puis modification de la copie. */
const full = (base: State, f: (s: State) => void) => { const n: State = clone(base); f(n); return n }

const UPDATERS: [string, (s: State) => void][] = [
  ['cocher une habitude', s => { (s.checks['2026-10-03'] ??= []).push('h1') }],
  ['décocher et retirer le jour vide', s => { const a = s.checks['2026-10-02']; a.splice(0, 1); if (!a.length) delete s.checks['2026-10-02'] }],
  ['ajouter une note en tête', s => { s.notes.unshift({ id: 'n2', cat: 'Chants', t: 'Chant', b: '', c: '2026-10-02T08:00:00.000Z', u: '2026-10-02T08:00:00.000Z' }) }],
  ['modifier un champ imbriqué', s => { s.settings.theme = 'oled'; s.consents.mic = true }],
  ['remplacer une rubrique entière', s => { s.tasks = s.tasks.filter(t => t.id !== 't1') }],
  ['affecter une rubrique sans la lire', s => { s.weights = [] }],
  ['modifier un élément d’une liste', s => { const t = s.tasks.find(x => x.id === 't1'); if (t) t.done = true }],
  ['lire sans modifier', s => { void s.notes.length; void s.profile?.name }],
  ['ne rien faire', () => {}],
  ['changer un champ simple', s => { s.discret = true; s.weekStart = '2026-10-26' }],
  ['mettre le profil à null', s => { s.profile = null }],
  ['plusieurs rubriques à la fois', s => { s.prayers[0].a = '2026-10-05'; s.weights.push({ d: '2026-10-15', kg: 63.5 }); s.ui.verseDay = '2026-10-15' }]
]

describe('Copie de travail : le résultat est celui d’une copie complète', () => {
  for (const [nom, f] of UPDATERS) {
    it(nom, () => {
      const base = rich()
      expect(JSON.stringify(run(base, f))).toBe(JSON.stringify(full(rich(), f))) // mêmes données ET même ordre des clés
    })
  }

  it('deux modifications successives : la seconde part du résultat de la première, et rien ne se mélange', () => {
    const a = rich(), b = run(a, s => { s.notes.push({ id: 'n9', cat: 'Poèmes', t: 'P', b: '', c: '2026-10-02T08:00:00.000Z', u: '2026-10-02T08:00:00.000Z' }) })
    const snap = JSON.stringify(b), c = run(b, s => { s.notes[0].t = 'Changé'; s.notes.pop() })
    expect(JSON.stringify(b)).toBe(snap)
    expect(b.notes.map(n => n.t)).toEqual(['Un rêve', 'P']); expect(c.notes.map(n => n.t)).toEqual(['Changé'])
    expect(a.notes).toHaveLength(1)
  })
})

describe('Copie de travail : l’état de départ n’est jamais modifié', () => {
  for (const [nom, f] of UPDATERS) {
    it(nom, () => {
      const base = rich(), before = JSON.stringify(base)
      run(base, f)
      expect(JSON.stringify(base)).toBe(before)
    })
  }

  it('une modification d’un élément profond ne touche pas l’original, même sans avoir écrit sur la rubrique elle-même', () => {
    const base = rich(), note = base.notes[0], habit = base.habits[0], profile = base.profile!
    const out = run(base, s => { s.notes[0].b = 'Modifié'; s.habits[0].n = 'Autre'; s.profile!.name = 'Eve' })
    expect([note.b, habit.n, profile.name]).toEqual(['Corps', base.habits[0].n, 'Ada']); expect(habit.n).not.toBe('Autre')
    expect([out.notes[0].b, out.habits[0].n, out.profile!.name]).toEqual(['Modifié', 'Autre', 'Eve'])
  })

  it('une modification qui échoue en cours de route laisse l’état de départ intact', () => {
    const base = rich(), before = JSON.stringify(base)
    expect(() => run(base, s => { s.notes[0].t = 'à moitié'; s.settings.theme = 'light'; throw new Error('échec') })).toThrow('échec')
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('Copie de travail : seules les rubriques touchées sont recopiées', () => {
  it('les rubriques jamais lues sont partagées telles quelles ; celles qui sont lues ou écrites sont de nouveaux objets', () => {
    const base = rich()
    const out = run(base, s => { s.checks['2026-10-03'] = ['h1']; void s.tasks.length; s.weights = [{ d: '2026-10-20', kg: 63 }] })
    for (const k of ['notes', 'prayers', 'habits', 'meals', 'archives', 'settings', 'consents', 'profile', 'quiz', 'cycle'] as const) expect(out[k], k).toBe(base[k])
    expect(out.checks).not.toBe(base.checks); expect(out.tasks).not.toBe(base.tasks); expect(out.tasks).toEqual(base.tasks) // lue : recopiée à l'identique
    expect(out.weights).toEqual([{ d: '2026-10-20', kg: 63 }])
  })

  it('lire une rubrique suffit à la recopier : on ne peut pas modifier l’original par cet objet', () => {
    const base = rich(), c = copie(base)
    const notes = c.s.notes; notes.push({ id: 'x', cat: 'Chants', t: '', b: '', c: '2026-10-02T08:00:00.000Z', u: '2026-10-02T08:00:00.000Z' })
    expect(base.notes).toHaveLength(1); expect(c.fin().notes).toHaveLength(2)
    expect(c.s.notes).toBe(notes) // les lectures suivantes rendent la même copie, pas une nouvelle à chaque fois
  })

  it('affecter une rubrique remplace sa valeur sans la recopier : l’objet donné est celui du résultat', () => {
    const base = rich(), neuf: State['tasks'] = [{ id: 'z', t: 'Z', imp: false, due: null, done: false, p: null }]
    const out = run(base, s => { s.tasks = neuf })
    expect(out.tasks).toBe(neuf); expect(base.tasks).toHaveLength(1); expect(base.tasks[0].id).toBe('t1')
  })

  it('affecter puis relire une rubrique rend l’objet affecté (pas une copie) : ce qu’on y ajoute ensuite s’y trouve', () => {
    const base = rich(), neuf: State['tasks'] = [{ id: 'z', t: 'Z', imp: false, due: null, done: false, p: null }]
    const out = run(base, s => { s.tasks = neuf; s.tasks.push({ id: 'y', t: 'Y', imp: false, due: null, done: false, p: null }) })
    expect(out.tasks).toBe(neuf); expect(neuf.map(t => t.id)).toEqual(['z', 'y']); expect(base.tasks.map(t => t.id)).toEqual(['t1'])
  })

  it('les valeurs simples (nombre, texte, booléen, null) se lisent et s’écrivent sans copie', () => {
    const base = rich(), c = copie(base)
    expect(c.s.v).toBe(2); expect(c.s.discret).toBe(false); expect(c.s.weekStart).toBeNull(); expect(c.s.profile).toEqual(base.profile)
    c.s.discret = true; expect(c.s.discret).toBe(true); expect(base.discret).toBe(false)
  })
})

describe('Copie de travail : l’état rendu est un état ordinaire', () => {
  it('ses rubriques sont de simples valeurs (aucun accesseur) : les relire ne recopie plus rien', () => {
    const out = run(rich(), s => { s.notes.push({ id: 'n3', cat: 'Chants', t: '', b: '', c: '2026-10-02T08:00:00.000Z', u: '2026-10-02T08:00:00.000Z' }) })
    for (const k of Object.keys(out)) { const d = Object.getOwnPropertyDescriptor(out, k)!; expect(d.get, k).toBeUndefined(); expect(d.set, k).toBeUndefined(); expect(d.enumerable, k).toBe(true); expect(d.writable, k).toBe(true) }
    expect(out.notes).toBe(out.notes); expect(out.prayers).toBe(out.prayers)
  })

  it('les clés gardent leur ordre ; une clé supprimée disparaît, une clé ajoutée apparaît', () => {
    const base = rich()
    expect(Object.keys(run(base, () => {}))).toEqual(Object.keys(base))
    const out = run(base, s => { delete (s as unknown as Record<string, unknown>).pomos; (s as unknown as Record<string, unknown>).extra = { a: 1 } }) as unknown as Record<string, unknown>
    expect('pomos' in out).toBe(false); expect(out.extra).toEqual({ a: 1 })
    expect(Object.keys(out)).toEqual([...Object.keys(base).filter(k => k !== 'pomos'), 'extra'])
  })

  it('sérialiser le résultat donne le même texte que sérialiser une copie complète', () => {
    const base = rich(), out = run(base, s => { s.settings.theme = 'light' })
    expect(JSON.stringify(out)).toBe(JSON.stringify({ ...clone(base), settings: { ...base.settings, theme: 'light' } }))
  })
})
