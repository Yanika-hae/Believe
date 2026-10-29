import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { btn, go, iso, mount, ready, stored, tick } from './testkit'

const vib = vi.fn()
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); vib.mockClear(); Reflect.deleteProperty(navigator, 'vibrate') })

const main = () => document.querySelector('main') as HTMLElement
/** Geste tactile : appui puis relâchement sur `el` avec un déplacement (dx, dy) en `ms` millisecondes (horloge simulée). */
function swipe(el: Element, dx: number, dy = 4, ms = 200, type = 'touch') {
  const now = vi.spyOn(Date, 'now'); let t = 1_000_000; now.mockImplementation(() => t)
  fireEvent.pointerDown(el, { clientX: 300, clientY: 300, pointerType: type }); t += ms; fireEvent.pointerUp(el, { clientX: 300 + dx, clientY: 300 + dy, pointerType: type }); now.mockRestore()
}
const view = () => document.querySelector('.view') as HTMLElement
/** Laisse la page demandée se charger (les rubriques sont chargées à la demande). */
const settle = async () => { await tick(10); await ready() }
const withVibrate = () => Object.defineProperty(navigator, 'vibrate', { value: vib, configurable: true, writable: true })

describe('Rubrique 2 : balayage entre les sections principales', () => {
  it('un balayage vers la gauche passe à la section suivante, vers la droite à la précédente ; aux extrémités, rien ne se passe', async () => {
    await mount('#/4')
    swipe(main(), 200); expect(location.hash).toBe('#/4') // accueil : pas de section avant
    swipe(main(), -200); await settle(); expect(location.hash).toBe('#/6'); expect(screen.getByRole('heading', { level: 1, name: /Habitudes/ })).toBeTruthy()
    swipe(main(), -200); await settle(); expect(location.hash).toBe('#/3')
    swipe(main(), -200); await settle(); expect(location.hash).toBe('#/menu'); expect(screen.getByRole('heading', { level: 1, name: 'Rubriques' })).toBeTruthy()
    swipe(main(), -200); await settle(); expect(location.hash).toBe('#/menu') // dernière section
    swipe(main(), 200); await settle(); expect(location.hash).toBe('#/3'); swipe(main(), 200); await settle(); expect(location.hash).toBe('#/6'); swipe(main(), 200); await settle(); expect(location.hash).toBe('#/4')
  })

  it('geste trop court, trop lent, trop vertical, à la souris ou sans mouvement : ignoré', async () => {
    await mount('#/4')
    swipe(main(), -60); expect(location.hash).toBe('#/4') // moins de 70 px
    swipe(main(), -200, 4, 1200); expect(location.hash).toBe('#/4') // plus de 900 ms
    swipe(main(), -200, 150); expect(location.hash).toBe('#/4') // plutôt vertical (défilement)
    swipe(main(), -200, 4, 200, 'mouse'); expect(location.hash).toBe('#/4') // souris : on utilise les boutons
    fireEvent.pointerDown(main(), { clientX: 300, clientY: 300, pointerType: 'touch' }); fireEvent.pointerCancel(main()); fireEvent.pointerUp(main(), { clientX: 50, clientY: 300, pointerType: 'touch' }); expect(location.hash).toBe('#/4') // geste annulé par le système
    swipe(main(), -200); await settle(); expect(location.hash).toBe('#/6') // le même geste, bien fait, passe
  })

  it('un geste qui démarre dans un champ, un curseur ou une zone qui défile en largeur est laissé à ce champ', async () => {
    await mount('#/4/prieres')
    swipe(document.getElementById('pnew')!, -200); expect(location.hash).toBe('#/4/prieres') // zone de saisie
    swipe(document.querySelector('.story')!, -200); expect(location.hash).toBe('#/4/prieres') // indicateurs qui défilent
    swipe(document.querySelector('.story a')!, -200); expect(location.hash).toBe('#/4/prieres') // même sur un de leurs liens
    swipe(screen.getByRole('radio', { name: 'Prière' }), -200); expect(location.hash).toBe('#/4/prieres')
    swipe(screen.getByText('Mur de prières et gratitudes'), -200); await settle(); expect(location.hash).toBe('#/6') // sur du texte : le geste compte
  })

  it('hors des quatre sections principales (une rubrique du menu), le balayage ne change pas de page', async () => {
    await mount('#/11/audio')
    swipe(main(), -200); swipe(main(), 200); await settle(); expect(location.hash).toBe('#/11/audio')
    await mount('#/13'); swipe(main(), -200); expect(location.hash).toBe('#/13')
  })

  it('l’animation suit le sens du geste (entrée par la droite en avançant, par la gauche en reculant) ; une page hors section principale garde l’animation d’origine', async () => {
    await mount('#/4')
    expect(view().className).not.toMatch(/fwd|back/)
    swipe(main(), -200); await settle(); expect(view().classList.contains('fwd')).toBe(true)
    swipe(main(), 200); await settle(); expect(view().classList.contains('back')).toBe(true)
    await go('#/menu'); expect(view().classList.contains('fwd')).toBe(true) // le bouton de la barre du bas anime aussi dans le bon sens (accueil → rubriques)
    await go('#/11'); expect(view().className).not.toMatch(/fwd|back/)
  })

  it('une vibration légère accompagne le balayage réussi, sauf si elle est désactivée ou si le mouvement est réduit', async () => {
    withVibrate()
    await mount('#/4'); swipe(main(), 200); expect(vib).not.toHaveBeenCalled() // geste sans effet : pas de vibration
    swipe(main(), -200); expect(vib).toHaveBeenCalledTimes(1); expect(vib).toHaveBeenCalledWith(10)
    cleanup(); vib.mockClear(); await mount('#/4', s => { s.settings.haptics = false }); swipe(main(), -200); await settle(); expect(location.hash).toBe('#/6'); expect(vib).not.toHaveBeenCalled()
    cleanup(); await mount('#/4', s => { s.settings.motion = 'reduced' }); swipe(main(), -200); await settle(); expect(location.hash).toBe('#/6'); expect(vib).not.toHaveBeenCalled()
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduced')
  })

  it('sans API de vibration (iPhone), le balayage fonctionne sans erreur', async () => {
    await mount('#/4'); expect('vibrate' in navigator).toBe(false); swipe(main(), -200); await settle(); expect(location.hash).toBe('#/6')
  })
})

describe('Rubrique 2 : fluidité des transitions', () => {
  it('« will-change » n’est posé que le temps de l’animation d’entrée : retiré à sa fin, pas par celle d’un élément intérieur, et par un repli si aucune animation n’a lieu', async () => {
    await mount('#/4')
    expect(view().classList.contains('wc')).toBe(true) // posé pendant l’entrée de la page
    fireEvent.animationEnd(screen.getByRole('heading', { level: 1 })); expect(view().classList.contains('wc')).toBe(true) // fin d’animation d’un enfant : sans effet
    fireEvent.animationEnd(view()); expect(view().classList.contains('wc')).toBe(false)
    await go('#/6'); expect(view().classList.contains('wc')).toBe(true) // nouvelle page, nouvelle entrée
    await tick(900); expect(view().classList.contains('wc')).toBe(false) // mouvement réduit : aucun événement de fin, le repli retire quand même la propriété
  })

  it('feuille d’actions rapides : le bouton + l’ouvre, elle liste les actions, Échap la ferme et rend le focus au bouton', async () => {
    await mount('#/4')
    const plus = btn('Actions rapides'); expect(plus.getAttribute('aria-haspopup')).toBe('dialog'); plus.focus(); fireEvent.click(plus) // jsdom ne donne pas le focus au clic : comme un doigt ou le clavier, on le donne d’abord
    const sh = screen.getByRole('dialog', { name: 'Actions rapides' }); expect(sh.className).toBe('sheet')
    expect([...sh.querySelectorAll('.qa a, .qa button')].map(e => e.textContent)).toEqual(['Cocher une habitude', 'Nouvelle note', 'Enregistrer un audio', 'Nouvelle tâche', 'Ajouter une prière', 'Démarrer une séance', 'Demander à Believe AI', 'Eau et sommeil'])
    expect([...sh.querySelectorAll('.qa a')].map(a => a.getAttribute('href'))).toEqual(['#/6', '#/11/notes', '#/11/audio', '#/9', '#/4/prieres', '#/7', '#/3', '#/8/eau'])
    expect(sh.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog', { name: 'Actions rapides' })).toBeNull(); expect(document.activeElement).toBe(plus)
    fireEvent.click(plus); fireEvent.click(within(screen.getByRole('dialog', { name: 'Actions rapides' })).getByRole('button', { name: 'Fermer' })); expect(screen.queryByRole('dialog', { name: 'Actions rapides' })).toBeNull()
  })

  it('une action rapide ferme la feuille et ouvre la bonne page ; avec l’accord « Santé », « Boire + 250 ml » ajoute l’eau sans quitter la page', async () => {
    await mount('#/4', s => { s.consents.health = true })
    fireEvent.click(btn('Actions rapides')); fireEvent.click(screen.getByRole('link', { name: /Nouvelle tâche/ })); await settle()
    expect(screen.queryByRole('dialog', { name: 'Actions rapides' })).toBeNull(); expect(location.hash).toBe('#/9')
    fireEvent.click(btn('Actions rapides')); expect(screen.queryByRole('link', { name: /Eau et sommeil/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Boire \+ 250 ml/ })); fireEvent.click(btn('Actions rapides')); fireEvent.click(screen.getByRole('button', { name: /Boire \+ 250 ml/ }))
    expect(stored().water[iso(new Date())]).toBe(500); expect(location.hash).toBe('#/9'); expect(screen.getAllByText('Eau : + 250 ml.').length).toBeGreaterThan(0); expect(screen.queryByRole('dialog', { name: 'Actions rapides' })).toBeNull()
  })

  it('la bulle IA est présente partout sauf sur la page IA ; la navigation du bas marque la section courante', async () => {
    await mount('#/4'); expect(screen.getByRole('link', { name: 'IA : ouvrir Believe AI' }).getAttribute('href')).toBe('#/3')
    const nav = within(screen.getByRole('navigation', { name: 'Navigation principale' }))
    expect(nav.getByRole('link', { name: /Accueil/ }).getAttribute('aria-current')).toBe('page'); expect(nav.getByRole('link', { name: /Habitudes/ }).getAttribute('aria-current')).toBeNull()
    await go('#/6'); expect(nav.getByRole('link', { name: /Habitudes/ }).getAttribute('aria-current')).toBe('page'); expect(nav.getByRole('link', { name: /Accueil/ }).getAttribute('aria-current')).toBeNull()
    await go('#/3'); expect(screen.queryByRole('link', { name: 'IA : ouvrir Believe AI' })).toBeNull(); expect(nav.getByRole('link', { name: 'IA' }).getAttribute('aria-current')).toBe('page')
    await go('#/11'); for (const l of nav.getAllByRole('link')) expect(l.getAttribute('aria-current')).toBeNull() // rubrique hors barre du bas : aucun faux repère
  })
})
