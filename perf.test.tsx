// Enregistrement d'une action : seules les rubriques touchées sont recopiées (pas les notes, les repas ou les livres d'un gros historique).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { DN, btn, iso, mount, stored } from './testkit'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const NOTES = 'MARQUE-NOTES', MEALS = 'MARQUE-REPAS', BOOKS = 'MARQUE-LIVRES'
const stamp = '2026-10-01T08:00:00.000Z'
const big = (s: import('./lib').State) => {
  s.notes = Array.from({ length: 30 }, (_, i) => ({ id: 'n' + i, cat: 'Rêves' as const, t: NOTES + i, b: 'x'.repeat(200), c: stamp, u: stamp }))
  s.meals = Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i, d: iso(new Date()), n: MEALS + i, kcal: 100, p: 1, g: 1, l: 1, src: 'manuel' as const }))
  s.books = [{ id: 'b1', t: BOOKS, a: 'A', src: 'perso' as const, ref: '', cover: null, url: null, total: 100, page: 3, st: 'cours' as const }]
}
const todayName = () => DN[(new Date().getDay() + 6) % 7]
/** Textes décodés par JSON.parse pendant l'action : une recopie complète d'une rubrique en fait apparaître le contenu. */
const parsed = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(c => String(c[0]))

describe('Une action ne recopie que ce qu’elle touche', () => {
  it('cocher une habitude : les cases cochées sont recopiées, pas les notes, les repas ni les livres ; rien n’est perdu à l’enregistrement', async () => {
    await mount('#/6', big)
    const spy = vi.spyOn(JSON, 'parse')
    fireEvent.click(btn('Sport : marche, course ou salle, ' + todayName()))
    const t = parsed(spy)
    expect(t.length).toBeGreaterThan(0) // la rubrique des cases cochées a bien été recopiée
    for (const m of [NOTES, MEALS, BOOKS]) expect(t.filter(x => x.includes(m)), m).toEqual([])
    const st = stored()
    expect(st.checks[iso(new Date())]).toEqual(['h1']); expect(st.notes).toHaveLength(30); expect(st.notes[29].t).toBe(NOTES + 29)
    expect(st.meals).toHaveLength(40); expect(st.meals[0].n).toBe(MEALS + 0); expect(st.books[0].t).toBe(BOOKS)
  })

  it('l’action suivante part de l’état précédent : deux cases cochées de suite, puis une décochée', async () => {
    await mount('#/6', big)
    fireEvent.click(btn('Sport : marche, course ou salle, ' + todayName())); fireEvent.click(btn('10 000 pas, ' + todayName()))
    expect(stored().checks[iso(new Date())]).toEqual(['h1', 'h2'])
    fireEvent.click(btn('Sport : marche, course ou salle, ' + todayName()))
    expect(stored().checks[iso(new Date())]).toEqual(['h2']); expect(stored().notes).toHaveLength(30)
    expect(screen.getByRole('button', { name: '10 000 pas, ' + todayName() }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Sport : marche, course ou salle, ' + todayName() }).getAttribute('aria-pressed')).toBe('false')
  })

  it('une action sur les notes recopie les notes (et seulement elles) : la note ajoutée est en tête, les autres rubriques sont intactes', async () => {
    await mount('#/11/notes', big)
    const spy = vi.spyOn(JSON, 'parse')
    fireEvent.change(screen.getByLabelText('Votre note'), { target: { value: 'Nouvelle' } }); fireEvent.click(btn('Enregistrer la note'))
    const t = parsed(spy)
    expect(t.some(x => x.includes(NOTES))).toBe(true)
    for (const m of [MEALS, BOOKS]) expect(t.filter(x => x.includes(m)), m).toEqual([])
    expect(stored().notes).toHaveLength(31); expect(stored().notes[0].b).toBe('Nouvelle'); expect(stored().notes[1].t).toBe(NOTES + 0)
    expect(stored().meals).toHaveLength(40); expect(stored().books).toHaveLength(1)
  })
})
