// Longues listes : les tâches et les semaines archivées s'affichent par paquets, la page reste rapide avec des centaines d'éléments.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { Task } from './cal'
import { btn, iso, mount, stored } from './testkit'

afterEach(() => { cleanup() })

const task = (i: number, extra: Partial<Task> = {}): Task => ({ id: 't' + i, t: 'Tâche ' + i, imp: false, due: null, done: false, p: 2, ...extra })
const rows = () => screen.queryAllByRole('checkbox', { name: /^Tâche \d+$/ })
const more = (re: RegExp) => screen.queryByRole('button', { name: re })

describe('Rubrique 9 : longues listes de tâches', () => {
  it('chaque quadrant montre 20 tâches puis « Afficher plus » par paquets de 20, avec le nombre restant ; rien n’est perdu en route', async () => {
    await mount('#/9', s => { s.tasks = Array.from({ length: 45 }, (_, i) => task(i)) })
    expect(rows()).toHaveLength(20); expect(rows()[0].closest('label')!.textContent).toContain('Tâche 0'); expect(screen.queryByText('Tâche 20')).toBeNull()
    fireEvent.click(btn('Afficher plus (25 restantes)')); expect(rows()).toHaveLength(40)
    expect(more(/Afficher plus \(5 restantes\)/)).toBeTruthy(); expect(more(/25 restantes/)).toBeNull()
    fireEvent.click(btn('Afficher plus (5 restantes)')); expect(rows()).toHaveLength(45)
    expect(screen.queryByRole('button', { name: /Afficher plus/ })).toBeNull(); expect(screen.getByText('Tâche 44')).toBeTruthy()
    expect(stored().tasks).toHaveLength(45)
  })

  it('une liste de 20 tâches ou moins est montrée en entier, sans bouton', async () => {
    await mount('#/9', s => { s.tasks = Array.from({ length: 20 }, (_, i) => task(i)) })
    expect(rows()).toHaveLength(20); expect(screen.queryByRole('button', { name: /Afficher plus/ })).toBeNull()
  })

  it('chaque liste a son propre compteur : P1, P2, P3, P4 et « Terminées » se déplient séparément', async () => {
    await mount('#/9', s => {
      s.tasks = [
        ...Array.from({ length: 22 }, (_, i) => task(i, { p: 1 })),
        ...Array.from({ length: 23 }, (_, i) => task(100 + i, { p: 2 })),
        ...Array.from({ length: 24 }, (_, i) => task(200 + i, { p: 3 })),
        ...Array.from({ length: 25 }, (_, i) => task(300 + i, { p: 4 })),
        ...Array.from({ length: 26 }, (_, i) => task(400 + i, { p: 4, done: true }))
      ]
    })
    expect(screen.getByRole('heading', { name: 'Terminées (26)' })).toBeTruthy()
    expect(rows()).toHaveLength(100) // 5 listes de 20
    for (const [n, left] of [[22, 2], [23, 3], [24, 4], [25, 5], [26, 6]]) expect(more(new RegExp('\\(' + left + ' restantes\\)')), n + ' → ' + left).toBeTruthy()
    fireEvent.click(btn('Afficher plus (3 restantes)')) // la liste P2 seulement
    expect(rows()).toHaveLength(103); expect(more(/\(3 restantes\)/)).toBeNull(); expect(more(/\(2 restantes\)/)).toBeTruthy(); expect(more(/\(6 restantes\)/)).toBeTruthy()
    fireEvent.click(btn('Afficher plus (6 restantes)')) // « Terminées » seulement
    expect(rows()).toHaveLength(109); expect(screen.getByRole('heading', { name: 'Terminées (26)' })).toBeTruthy()
    expect(more(/\(2 restantes\)/)).toBeTruthy(); expect(more(/\(4 restantes\)/)).toBeTruthy(); expect(more(/\(5 restantes\)/)).toBeTruthy()
  })

  it('cocher une tâche garde les listes dépliées ; une tâche cochée passe dans « Terminées » et le reste des listes avance', async () => {
    await mount('#/9', s => { s.tasks = Array.from({ length: 30 }, (_, i) => task(i)) })
    fireEvent.click(btn('Afficher plus (10 restantes)')); expect(rows()).toHaveLength(30)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tâche 3' }))
    expect(stored().tasks.find((t: Task) => t.id === 't3').done).toBe(true)
    expect(screen.getByRole('heading', { name: 'Terminées (1)' })).toBeTruthy(); expect(rows()).toHaveLength(30) // 29 en cours + 1 terminée : toutes visibles
    expect(screen.queryByRole('button', { name: /Afficher plus/ })).toBeNull()
  })

  it('l’échéance est écrite comme avant : jour, mois abrégé, heure et minutes en français', async () => {
    const due = '2026-10-30T09:05'
    await mount('#/9', s => { s.tasks = [task(1, { due, p: null }), task(2)] })
    const expected = new Date(due).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    expect(expected).toMatch(/30 oct\./)
    expect(screen.getByText(new RegExp('^Échéance : ' + expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))), expected).toBeTruthy()
    expect(screen.getByText(/^Sans échéance/)).toBeTruthy()
  })

  it('cinq cents tâches : la page n’affiche que 100 lignes au plus au départ (5 listes de 20) au lieu de 500', async () => {
    await mount('#/9', s => { s.tasks = Array.from({ length: 500 }, (_, i) => task(i, { p: ((i % 4) + 1) as 1 | 2 | 3 | 4, done: i % 5 === 0 })) })
    expect(rows().length).toBeLessThanOrEqual(100); expect(rows().length).toBeGreaterThan(80)
  })
})

describe('Rubrique 6 : historique des semaines', () => {
  const archives = (n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(2026, 9, 12 - 7 * i); return { week: '2026-S' + String(42 - i).padStart(2, '0'), start: iso(d), rate: 40 + (i % 50), n: 10, per: {} } })
  const shown = () => screen.queryAllByText(/\(début le /)

  it('douze semaines d’abord, puis « Afficher plus » par paquets de douze avec le nombre restant', async () => {
    await mount('#/6', s => { s.archives = archives(30) })
    expect(shown()).toHaveLength(12); expect(shown()[0].textContent).toContain('2026-S42'); expect(screen.queryByText(/2026-S30 \(début/)).toBeNull()
    fireEvent.click(btn('Afficher plus (18 restantes)')); expect(shown()).toHaveLength(24)
    fireEvent.click(btn('Afficher plus (6 restantes)')); expect(shown()).toHaveLength(30)
    expect(screen.queryByRole('button', { name: /Afficher plus/ })).toBeNull()
    expect(within(shown()[29]).getByText('2026-S13')).toBeTruthy()
  })

  it('douze semaines ou moins : toutes sont montrées sans bouton ; aucune semaine : le message habituel', async () => {
    await mount('#/6', s => { s.archives = archives(12) })
    expect(shown()).toHaveLength(12); expect(screen.queryByRole('button', { name: /Afficher plus/ })).toBeNull()
    cleanup(); await mount('#/6', s => { s.archives = [] })
    expect(shown()).toHaveLength(0); expect(screen.getByText(/Aucune semaine archivée pour l’instant/)).toBeTruthy()
  })
})
