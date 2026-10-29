import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import DishArt from './DishArt'
import { btn, mount, stored, type } from './testkit'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

const R = (titre: string, ing: string[]) => ({ titre, minutes: 15, kcal: 320, proteines: 20, glucides: 8, lipides: 22, ingredients: ing, etapes: ['Préparer les ingrédients.', 'Cuire doucement.'] })
const RECIPES = [R('Omelette aux courgettes', ['œufs', 'courgettes', 'feta']), R('Salade de pois chiches', ['pois chiches', 'concombre']), R('Soupe de potimarron', ['potimarron', 'oignon', 'bouillon'])]
const resp = (status: number, body: unknown) => ({ status, ok: status < 400, headers: { get: () => 'application/json' }, json: async () => body })

/** Serveur simulé : /api/ai renvoie les trois recettes ; toute autre adresse est refusée et notée (le dessin du plat ne doit jamais appeler le réseau). */
function server() {
  const calls: string[] = []
  const f = vi.fn((url: string) => { calls.push(url); return url === '/api/ai' ? Promise.resolve(resp(200, { data: RECIPES, model: 'test' })) : Promise.reject(new Error('adresse inattendue ' + url)) })
  vi.stubGlobal('fetch', f)
  return { calls, f }
}
const open = async () => {
  await mount('#/8/recettes', s => { s.consents.health = true; s.consents.ai = true })
  type('Ingrédients', 'courgettes, œufs, feta'); fireEvent.click(btn('Proposer 3 recettes')); await screen.findByRole('heading', { name: 'Omelette aux courgettes' })
}
const card = (titre: string) => screen.getByRole('heading', { name: titre }).closest('.card') as HTMLElement
const SHOW = 'Afficher l’image du plat', HIDE = 'Masquer l’image du plat'
const NOTE = 'Image du plat, facultative et gratuite : dessin schématique fait sur votre appareil d’après le titre et les ingrédients (ce n’est pas une photo, aucune IA n’intervient, rien n’est envoyé).'

describe('Rubrique 8 : image du plat des recettes (dessin gratuit fait sur l’appareil, à la demande)', () => {
  it('le bouton est proposé sur chaque recette avec sa note (gratuit, sans IA, rien n’est envoyé) ; aucun dessin tant qu’on ne le demande pas', async () => {
    const sv = server(); await open()
    expect(screen.getAllByRole('button', { name: SHOW })).toHaveLength(3); expect(sv.calls).toEqual(['/api/ai']); expect(document.querySelector('.dish')).toBeNull()
    expect(document.getElementById('dish-note')!.textContent).toBe(NOTE)
    for (const b of screen.getAllByRole('button', { name: SHOW })) expect(b.getAttribute('aria-describedby')).toBe('dish-note')
    expect(screen.getByText(/Chaque recette peut recevoir, sur demande, une image du plat \(dessin gratuit fait sur votre appareil\)\./)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/service payant|créée par l’IA|Générer l’image/)
  })

  it('un clic affiche le dessin de CE plat, avec son texte alternatif et sa mention ; aucun appel réseau ; « Masquer » l’enlève', async () => {
    const sv = server(); await open()
    const c = card('Salade de pois chiches'); fireEvent.click(within(c).getByRole('button', { name: SHOW }))
    const svg = within(c).getByRole('img', { name: 'Dessin du plat (schéma fait par l’application, pas une photo) : Salade de pois chiches' })
    expect(svg.tagName.toLowerCase()).toBe('svg'); expect(svg.getAttribute('viewBox')).toBe('0 0 240 180'); expect(svg.querySelectorAll('circle,ellipse,rect,path').length).toBeGreaterThan(20)
    expect(within(c).getByText('Dessin fait par l’application d’après les ingrédients (ni photo, ni image d’IA). La recette réelle peut différer.')).toBeTruthy(); expect(c.querySelector('[role="status"]')!.textContent).toBe('Image du plat affichée.')
    expect(c.querySelector('figure')!.nextElementSibling!.tagName).toBe('H2'); expect(document.querySelectorAll('.dish')).toHaveLength(1)
    expect(sv.calls).toEqual(['/api/ai']) // aucun envoi
    expect(within(card('Omelette aux courgettes')).getByRole('button', { name: SHOW })).toBeTruthy() // les autres recettes ne sont pas touchées
    expect(c.querySelector('img')).toBeNull(); expect(c.innerHTML).not.toMatch(/data:image|<script|onerror|href=/i) // dessin vectoriel interne, aucune adresse, aucun script
    fireEvent.click(within(c).getByRole('button', { name: HIDE })); expect(c.querySelector('.dish')).toBeNull(); expect(within(c).getByRole('button', { name: SHOW })).toBeTruthy(); expect(c.querySelector('[role="status"]')!.textContent).toBe('')
  })

  it('le dessin est toujours le même pour une même recette et diffère d’une recette à l’autre', async () => {
    server(); await open()
    const draw = (t: string) => { const c = card(t); fireEvent.click(within(c).getByRole('button', { name: SHOW })); const h = c.querySelector('svg.dishart')!.innerHTML; fireEvent.click(within(c).getByRole('button', { name: HIDE })); return h }
    const a1 = draw('Omelette aux courgettes'), a2 = draw('Omelette aux courgettes'), b = draw('Soupe de potimarron')
    expect(a1).toBe(a2); expect(a1).not.toBe(b); expect(a1.length).toBeGreaterThan(500)
  })

  it('le composant dessine d’après le titre ET les ingrédients : deux listes d’ingrédients différentes, deux dessins différents ; la même liste, le même dessin', () => {
    const html = (t: string, ing: string[]) => { const { container, unmount } = render(<DishArt title={t} ingredients={ing} />); const h = container.innerHTML; unmount(); return h }
    const inner = (t: string, ing: string[]) => { const { container, unmount } = render(<DishArt title={t} ingredients={ing} />); const h = container.querySelector('svg')!.innerHTML; unmount(); return h } // les formes seules, sans le texte alternatif (qui change avec le titre)
    const a = html('Plat du jour', ['œufs', 'courgettes']), b = html('Plat du jour', ['poulet', 'riz']), c = html('Autre plat', ['œufs', 'courgettes'])
    expect(a).toBe(html('Plat du jour', ['œufs', 'courgettes'])); expect(a).not.toBe(b); expect(a).not.toBe(c); expect(a).toContain('aria-label="Dessin du plat (schéma fait par l’application, pas une photo) : Plat du jour"')
    expect(inner('Plat du jour', ['œufs', 'courgettes'])).not.toBe(inner('Autre plat', ['œufs', 'courgettes'])) // le titre seul change aussi les formes
    expect(inner('Plat du jour', ['œufs', 'courgettes'])).not.toBe(inner('Plat du jour', ['poulet', 'riz']))
  })

  it('trois dessins possibles en même temps ; une nouvelle recherche de recettes les efface tous', async () => {
    server(); await open()
    for (const t of ['Omelette aux courgettes', 'Salade de pois chiches', 'Soupe de potimarron']) fireEvent.click(within(card(t)).getByRole('button', { name: SHOW }))
    expect(document.querySelectorAll('.dish')).toHaveLength(3); expect(screen.getAllByRole('button', { name: HIDE })).toHaveLength(3)
    fireEvent.click(btn('Proposer 3 recettes')); await screen.findByRole('heading', { name: 'Omelette aux courgettes' })
    expect(document.querySelectorAll('.dish')).toHaveLength(0); expect(screen.getAllByRole('button', { name: SHOW })).toHaveLength(3)
  })

  it('le dessin n’est jamais enregistré ; « Ajouter à l’alimentation » fonctionne comme avant, avec ou sans dessin', async () => {
    server(); await open()
    fireEvent.click(within(card('Omelette aux courgettes')).getByRole('button', { name: SHOW }))
    expect(JSON.stringify(stored())).not.toMatch(/svg|circle|dishart/i)
    fireEvent.click(within(card('Omelette aux courgettes')).getByRole('button', { name: 'Ajouter à l’alimentation' })); expect(stored().meals).toHaveLength(1); expect(stored().meals[0]).toMatchObject({ n: 'Omelette aux courgettes', kcal: 320, src: 'IA' })
    expect(JSON.stringify(stored())).not.toMatch(/svg|circle|dishart|data:image/i)
  })

  it('sans accord à l’IA, aucune recette n’est proposée ; l’accord annonce l’offre gratuite de Google (échanges relus et réutilisés) et ne parle plus d’image envoyée', async () => {
    const sv = server(); await mount('#/8/recettes', s => { s.consents.health = true })
    expect(screen.queryByRole('button', { name: 'Proposer 3 recettes' })).toBeNull(); expect(sv.calls).toEqual([])
    expect(screen.getAllByText(/Believe n’utilise que l’offre gratuite de l’API Gemini\. D’après les conditions de Google pour cette offre, vos messages et les réponses peuvent servir à améliorer ses produits et être lus par des personnes : n’envoyez rien de sensible, confidentiel ou personnel\. Cette API est réservée aux personnes de 18 ans et plus\./).length).toBeGreaterThan(0) // l’accord figure dans les deux onglets qui envoient à l’IA : Scanner et Recettes
    expect(document.body.textContent).not.toMatch(/image d’une recette|son titre et ses ingrédients sont envoyés/)
  })
})
