import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { KEY } from './lib'
import type { State } from './lib'
import { DN, btn, iso, mount, stored, tick, type } from './testkit'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

const SPORT = 'Sport : marche, course ou salle'
const dlg = () => screen.getByRole('dialog', { name: /^Modifier l’habitude : / })
const names = () => stored().habits.map((h: { n: string }) => h.n)
const todayName = () => DN[(new Date().getDay() + 6) % 7]

describe('Rubrique 6 : renommer une habitude', () => {
  it('ouvre une fenêtre « Modifier l’habitude » (focus sur le nom, Échap et Annuler sans effet, focus rendu au bouton) ; rien n’est enregistré tant qu’on n’a pas validé', async () => {
    await mount('#/6')
    const open = btn('Renommer ' + SPORT); open.focus(); fireEvent.click(open)
    const d = within(dlg()); expect(d.getByRole('heading', { level: 2, name: 'Modifier l’habitude' })).toBeTruthy()
    expect((d.getByLabelText('Nom') as HTMLInputElement).value).toBe(SPORT); expect(document.activeElement).toBe(d.getByLabelText('Nom')); expect((d.getByLabelText('Catégorie') as HTMLSelectElement).value).toBe('Sport')
    type('Nom', 'Autre nom'); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(names()).toContain(SPORT); expect(names()).not.toContain('Autre nom'); expect(document.activeElement).toBe(open)
    fireEvent.click(open); type('Nom', 'Autre nom'); fireEvent.click(btn('Annuler')); expect(screen.queryByRole('dialog')).toBeNull(); expect(names()).not.toContain('Autre nom')
    fireEvent.click(open); fireEvent.click(document.querySelector('.scrim')!); expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renomme et change la catégorie : le message n’apparaît qu’après l’enregistrement ; identifiant, rôle, cases cochées et séries sont conservés', async () => {
    await mount('#/6', (st: State) => { st.checks[iso(new Date())] = ['h1'] })
    const before = stored().habits.find((h: { n: string }) => h.n === SPORT)
    expect(btn(SPORT + ', ' + todayName()).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(btn('Renommer ' + SPORT)); type('Nom', '  Courir le matin  '); fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Catégorie'), { target: { value: 'Santé' } })
    expect(screen.queryByText(/Habitude modifiée/)).toBeNull(); expect(names()).toContain(SPORT) // rien avant le clic
    fireEvent.click(btn('Enregistrer'))
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByText('Habitude modifiée : Courir le matin.')).toBeTruthy()
    const after = stored().habits.find((h: { id: string }) => h.id === before.id)
    expect(after).toEqual({ ...before, n: 'Courir le matin', c: 'Santé' }); expect(stored().habits.length).toBe(8)
    expect(btn('Courir le matin, ' + todayName()).getAttribute('aria-pressed')).toBe('true'); expect(stored().checks[iso(new Date())]).toEqual(['h1'])
    expect(screen.getByText('Santé, série 1 j', { exact: false })).toBeTruthy()
    fireEvent.click(btn('Esprit')); expect(screen.queryByRole('button', { name: 'Renommer Courir le matin' })).toBeNull(); fireEvent.click(btn('Santé')); expect(screen.getByRole('button', { name: 'Renommer Courir le matin' })).toBeTruthy()
  })

  it('refuse un nom vide ou déjà pris (majuscules ignorées) et reste ouvert avec le message ; le même nom avec une autre casse est accepté pour la même habitude', async () => {
    await mount('#/6')
    fireEvent.click(btn('Renommer ' + SPORT)); type('Nom', '   '); fireEvent.click(btn('Enregistrer'))
    expect(within(dlg()).getByRole('alert').textContent).toBe('Saisissez un nom d’habitude.'); expect(names()).toContain(SPORT)
    type('Nom', '10 000 PAS'); fireEvent.click(btn('Enregistrer')); expect(within(dlg()).getByRole('alert').textContent).toBe('Cette habitude existe déjà.'); expect(names()).toContain(SPORT)
    type('Nom', 'Autre'); expect(within(dlg()).queryByRole('alert')).toBeNull() // le message disparaît dès qu’on corrige
    type('Nom', SPORT.toUpperCase()); fireEvent.click(btn('Enregistrer')); expect(screen.queryByRole('dialog')).toBeNull(); expect(names()).toContain(SPORT.toUpperCase()); expect(names()).not.toContain(SPORT)
  })

  it('aucun changement : la fenêtre se ferme sans rien écrire ni annoncer', async () => {
    await mount('#/6'); const raw = localStorage.getItem(KEY)
    fireEvent.click(btn('Renommer ' + SPORT)); fireEvent.click(btn('Enregistrer')); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText(/Habitude modifiée/)).toBeNull(); expect(localStorage.getItem(KEY)).toBe(raw)
  })

  it('nom limité à 60 caractères', async () => {
    await mount('#/6'); fireEvent.click(btn('Renommer ' + SPORT)); type('Nom', 'x'.repeat(80)); fireEvent.click(btn('Enregistrer')); expect(names().find((n: string) => n.startsWith('xxx'))).toBe('x'.repeat(60))
  })

  it('enregistrement impossible : la fenêtre reste ouverte, le nom n’est pas changé ; une fois le stockage rétabli, le même formulaire aboutit', async () => {
    await mount('#/6'); fireEvent.click(btn('Renommer ' + SPORT)); type('Nom', 'Nouveau nom')
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    fireEvent.click(btn('Enregistrer')); expect(screen.getByRole('dialog', { name: /^Modifier l’habitude/ })).toBeTruthy(); expect(screen.queryByText(/Habitude modifiée/)).toBeNull(); expect(names()).toContain(SPORT)
    set.mockRestore(); fireEvent.click(btn('Enregistrer')); expect(screen.queryByRole('dialog')).toBeNull(); expect(names()).toContain('Nouveau nom')
  })

  it('l’habitude retirée entre-temps (autre onglet) n’est pas recréée : message clair, rien d’écrit', async () => {
    await mount('#/6'); fireEvent.click(btn('Renommer ' + SPORT)); type('Nom', 'Nouveau nom')
    const s = stored(); s.habits = s.habits.filter((h: { n: string }) => h.n !== SPORT); localStorage.setItem(KEY, JSON.stringify(s))
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })) }); await tick(10)
    fireEvent.click(btn('Enregistrer')); expect(within(dlg()).getByRole('alert').textContent).toBe('Cette habitude n’existe plus.'); expect(names()).not.toContain('Nouveau nom')
  })

  it('le rôle survit au renommage : « 10 000 pas » renommée reste liée au podomètre et « 20 pages de mon livre » garde son marque-page, sous son nouveau nom', async () => {
    await mount('#/6')
    fireEvent.click(btn('Renommer 10 000 pas')); type('Nom', 'Marcher beaucoup'); fireEvent.click(btn('Enregistrer'))
    fireEvent.click(btn('Renommer 20 pages de mon livre')); type('Nom', 'Lecture du soir'); fireEvent.click(btn('Enregistrer'))
    const hs = stored().habits; expect(hs.find((h: { k?: string }) => h.k === 'pas').n).toBe('Marcher beaucoup'); expect(hs.find((h: { k?: string }) => h.k === 'livre').n).toBe('Lecture du soir')
    expect(screen.getByRole('heading', { level: 2, name: 'Marque-page : Lecture du soir' })).toBeTruthy()
    const { markHabit } = await import('./lib'); const s = stored() as State; expect(markHabit(s, 'pas', '2026-01-05')).toBe(true); expect(s.checks['2026-01-05']).toEqual([hs.find((h: { k?: string }) => h.k === 'pas').id])
  })

  it('le nom changé est conservé après réouverture et l’accessibilité reste correcte (champ et liste étiquetés)', async () => {
    await mount('#/6'); fireEvent.click(btn('Renommer ' + SPORT)); type('Nom', 'Courir'); fireEvent.click(btn('Enregistrer'))
    cleanup(); const { reopen } = await import('./testkit'); await reopen('#/6'); expect(screen.getByRole('button', { name: 'Renommer Courir' })).toBeTruthy(); expect(btn('Courir, Lun')).toBeTruthy()
  })
})
