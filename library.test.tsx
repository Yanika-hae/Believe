import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { btn, go, iso, mount, reopen, stored, tick, type, DN } from './testkit'
import { BOOKS } from './books'
import { ficheAsk } from './reading'

afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); await tick(20) })

const TODAY = () => iso(new Date())
const todayName = () => DN[(new Date().getDay() + 6) % 7]
const ok = (j: unknown, type = 'application/json') => ({ status: 200, ok: true, headers: { get: () => type }, json: async () => j })
const fail = (status: number, j: unknown) => ({ status, ok: false, headers: { get: () => 'application/json' }, json: async () => j })
const GU = { src: 'gu', id: '1342', t: 'Pride and Prejudice', a: 'Jane Austen', y: null, l: 'en', cover: 'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg', desc: 'Roman célèbre sur l’orgueil et les préjugés.', pub: 'Project Gutenberg', url: 'https://www.gutenberg.org/ebooks/1342', acc: 'free', med: 'text' }
const OL = { src: 'ol', id: '/works/OL66554W', t: 'Pride and prejudice', a: 'Jane Austen', y: 1813, l: 'en', cover: null, desc: '', pub: 'Open Library', url: 'https://openlibrary.org/works/OL66554W', acc: 'loan', med: 'text' }
const GB = { src: 'gb', id: 'abcd1234', t: 'Pride & Prejudice', a: 'Jane Austen', y: 2003, l: 'en', cover: null, desc: 'x'.repeat(300), pub: 'Penguin', url: 'https://books.google.com/books?id=abcd1234', acc: 'info', med: 'text' }
const LV = { src: 'lv', id: '987', t: 'Pride and Prejudice (version audio)', a: 'Jane Austen', y: 1813, l: 'en', cover: null, desc: '', pub: 'LibriVox (lecteurs bénévoles)', url: 'https://librivox.org/pride-and-prejudice-by-jane-austen/', acc: 'free', med: 'audio' }
const MY = { id: 'b1', t: 'Mon roman', a: 'Moi', src: 'perso' as const, ref: '', cover: null, url: null, total: 200, page: 0, st: 'lire' as const }
const nb = (p: (b: (typeof BOOKS)[number]) => boolean) => BOOKS.filter(p).length
const marks = () => [...document.querySelectorAll('mark')].map(m => m.textContent)
const search = (q: string) => type('Rechercher un livre', q)
/** Bouton « Chercher en ligne » de la barre de recherche (le premier ; le catalogue en propose un second sous la liste). */
const online = () => screen.getAllByRole('button', { name: 'Chercher en ligne' })[0]
/** Vrai si un paragraphe a exactement ce texte (le texte peut être coupé par des éléments en gras). */
const para = (t: string) => [...document.querySelectorAll('p')].some(p => p.textContent === t)
/** Formulaire de marque-page d'un livre ou d'un cours (plusieurs peuvent figurer sur la même page). */
const mark = (n: string) => within(screen.getByRole('group', { name: 'Marque-page : ' + n }))
const setIn = (g: ReturnType<typeof mark>, label: string, v: string) => fireEvent.change(g.getByLabelText(label), { target: { value: v } })

describe('Rubrique 12 : catalogue intégré', () => {
  it('liste par catégorie, filtre FR/EN, recherche instantanée sans accents ni casse avec surlignage ; rien n’est envoyé en tapant', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    await mount('#/12')
    expect(screen.getByRole('heading', { name: 'Bibliothèque et recherche de livres' })).toBeTruthy()
    expect(btn('Toutes (' + BOOKS.length + ')').getAttribute('aria-pressed')).toBe('true'); expect(screen.getByText(BOOKS.length + ' livres.')).toBeTruthy()
    for (const c of ['Classique', 'Développement personnel', 'Manipulation & Persuasion', 'Biblique', 'Art de la rhétorique']) expect(btn(c + ' (' + nb(b => b.c === c) + ')')).toBeTruthy()
    fireEvent.click(btn('Biblique (' + nb(b => b.c === 'Biblique') + ')')); expect(screen.getByText(nb(b => b.c === 'Biblique') + ' livres.')).toBeTruthy(); expect(screen.getAllByRole('article').length).toBe(nb(b => b.c === 'Biblique'))
    fireEvent.click(btn(/^Toutes \(/))
    fireEvent.click(btn('English')); expect(btn('English').getAttribute('aria-pressed')).toBe('true'); expect(screen.getByText(nb(b => b.l.includes('en')) + ' livres.')).toBeTruthy()
    fireEvent.click(btn('Français')); expect(screen.getByText(nb(b => b.l.includes('fr')) + ' livres.')).toBeTruthy(); fireEvent.click(btn('Toutes les langues'))
    search('MACHIAVEL'); expect(screen.getByText(/1 livre pour « MACHIAVEL »\./)).toBeTruthy(); expect(marks()).toContain('Machiavel'); expect(screen.getByRole('article', { name: 'Livre : The Prince' })).toBeTruthy()
    search('stoïcisme'); expect(screen.getByRole('article', { name: 'Livre : Pensées pour moi-même' })).toBeTruthy(); search('zzzqqq'); expect(screen.getByText('Aucun livre du catalogue intégré ne correspond.')).toBeTruthy()
    search('stratégie guerre'); expect(screen.getByRole('article', { name: 'Livre : The Art of War' })).toBeTruthy()
    expect(f).not.toHaveBeenCalled() // la recherche interne reste sur l’appareil
  })

  it('fiche d’un livre du domaine public : résumé, citation référencée, liens légaux dans un nouvel onglet, ajout à Mes livres, fermeture', async () => {
    await mount('#/12')
    search('machiavel'); fireEvent.click(btn('Ouvrir la fiche de The Prince'))
    const d = screen.getByRole('dialog', { name: 'Fiche du livre The Prince' })
    expect(within(d).getByText('Idée centrale')).toBeTruthy(); expect(within(d).getByText('Domaine public')).toBeTruthy(); expect(within(d).getByText(/it is difficult to fix them in that persuasion/)).toBeTruthy()
    expect(within(d).getByText(/The Prince, chapitre VI \(trad\. W\. K\. Marriott\)\. Source : Project Gutenberg n° 1232\./)).toBeTruthy()
    const links = within(d).getAllByRole('link'); expect(links.length).toBeGreaterThanOrEqual(2)
    for (const a of links) { expect(a.getAttribute('target')).toBe('_blank'); expect(a.getAttribute('rel')).toBe('noopener noreferrer'); expect(a.getAttribute('href')).toMatch(/^https:\/\//) }
    expect(links.map(a => a.getAttribute('href'))).toContain('https://www.gutenberg.org/ebooks/1232')
    fireEvent.click(within(d).getByRole('button', { name: 'Ajouter à Mes livres' }))
    expect(stored().books).toHaveLength(1); expect(stored().books[0]).toMatchObject({ id: 'cat:the-prince', t: 'The Prince', src: 'cat', page: 0, st: 'lire', url: null, cover: null })
    expect(within(d).getByText(/Ajouté à Mes livres/)).toBeTruthy(); expect(within(d).getByText('Dans Mes livres')).toBeTruthy(); expect(within(d).queryByRole('button', { name: 'Ajouter à Mes livres' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Dans Mes livres')).toBeTruthy(); expect(btn(/^Mes livres \(1\)$/)).toBeTruthy()
  })

  it('livre encore protégé : aucune citation, aucun lien de lecture, seulement la recherche d’une édition ou d’un emprunt', async () => {
    await mount('#/12')
    search('atomic'); fireEvent.click(btn('Ouvrir la fiche de Atomic Habits'))
    const d = screen.getByRole('dialog', { name: 'Fiche du livre Atomic Habits' })
    expect(within(d).getByText(/Aucune citation : l’œuvre est encore protégée/)).toBeTruthy(); expect(within(d).queryByText('Domaine public')).toBeNull(); expect(within(d).getByText(/Sous droits d’auteur/)).toBeTruthy()
    const links = within(d).getAllByRole('link'); expect(links).toHaveLength(1); expect(links[0].getAttribute('href')).toMatch(/^https:\/\/openlibrary\.org\/search\?q=Atomic\+Habits/)
    expect(within(d).queryByText(/Lire gratuitement/)).toBeNull(); expect(within(d).getByText(/ne propose ni texte, ni téléchargement/)).toBeTruthy()
  })

  it('bible : chapitre français (Louis Segond) et texte anglais (King James) en lecture libre, citations dans les deux langues', async () => {
    await mount('#/12')
    search('évangile jean'); fireEvent.click(btn('Ouvrir la fiche de L’Évangile selon Jean'))
    const d = screen.getByRole('dialog'); const hrefs = within(d).getAllByRole('link').map(a => a.getAttribute('href'))
    expect(hrefs).toContain('https://www.biblegateway.com/passage/?search=Jean+3&version=LSG'); expect(hrefs).toContain('https://www.gutenberg.org/ebooks/10')
    expect(within(d).getByText(/Car Dieu a tant aimé le monde/)).toBeTruthy(); expect(within(d).getByText(/For God so loved the world/)).toBeTruthy(); expect(within(d).getByText(/Jean 3:16\. Source : Bible Louis Segond 1910/)).toBeTruthy()
  })
})

describe('Rubrique 12 : recherche en ligne', () => {
  it('rien ne part avant le clic ; requête, catalogues choisis et langue transmis ; accès légal en clair, libres d’abord ; couvertures masquées par défaut', async () => {
    const f = vi.fn().mockResolvedValue(ok({ items: [GU, OL, GB, LV], errors: [{ s: 'gb', e: 'timeout' }] })); vi.stubGlobal('fetch', f)
    await mount('#/12')
    search('austen'); fireEvent.click(btn('Français')); expect(f).not.toHaveBeenCalled()
    fireEvent.click(online()); await tick(10)
    expect(f).toHaveBeenCalledTimes(1); const u = new URL(f.mock.calls[0][0], 'http://x'); expect(u.pathname).toBe('/api/ext'); expect(Object.fromEntries(u.searchParams)).toEqual({ q: 'austen', src: 'gu,lv,ol,gb', lang: 'fr' })
    expect(f.mock.calls[0][1].headers).toEqual({}) // pas de code d’accès saisi, aucun autre en-tête, aucune donnée de profil
    expect(btn(/^En ligne \(4\)$/).getAttribute('aria-pressed')).toBe('true')
    const names = screen.getAllByRole('article').map(a => a.getAttribute('aria-label')); expect(names).toEqual(['Résultat : Pride and Prejudice', 'Résultat : Pride and Prejudice (version audio)', 'Résultat : Pride and prejudice', 'Résultat : Pride & Prejudice']) // gratuit, gratuit, emprunt, fiche
    expect(screen.getByText(/Lecture libre : domaine public aux États-Unis selon Project Gutenberg\. La règle peut être différente dans votre pays\./)).toBeTruthy()
    expect(screen.getByText(/Écoute libre : livre audio du domaine public, lu par des bénévoles \(LibriVox\)\./)).toBeTruthy(); expect(screen.getByText(/Emprunt numérique possible/)).toBeTruthy(); expect(screen.getByText(/Fiche seulement : pas de texte libre/)).toBeTruthy()
    expect(screen.getByText(/Certains catalogues n’ont pas répondu : Google Books \(trop long à répondre\)/)).toBeTruthy(); expect(screen.getByText(/4 résultats pour « austen »/)).toBeTruthy()
    expect(screen.getByText('Roman célèbre sur l’orgueil et les préjugés.')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Lire tout le descriptif de Pride & Prejudice' })).toBeTruthy() // descriptif long replié
    const lire = screen.getByRole('link', { name: /Lire gratuitement sur Project Gutenberg/ }); expect(lire.getAttribute('href')).toBe('https://www.gutenberg.org/ebooks/1342'); expect(lire.getAttribute('target')).toBe('_blank'); expect(lire.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('link', { name: /Écouter sur LibriVox/ })).toBeTruthy(); expect(screen.getByRole('link', { name: /Voir l’emprunt sur Open Library/ })).toBeTruthy(); expect(screen.getByRole('link', { name: /Voir la fiche sur Google Books/ })).toBeTruthy()
    expect(document.querySelectorAll('img')).toHaveLength(0) // couvertures masquées : aucune image tierce chargée
    fireEvent.click(screen.getByLabelText('Afficher les couvertures des livres')); expect(stored().ui.covers).toBe(true)
    const img = document.querySelector('img.cov')!; expect(img.getAttribute('src')).toBe(GU.cover); expect(img.getAttribute('referrerpolicy')).toBe('no-referrer'); expect(img.getAttribute('loading')).toBe('lazy'); expect(img.getAttribute('alt')).toBe('')
    fireEvent.click(screen.getByLabelText('Afficher les couvertures des livres')); expect(stored().ui.covers).toBe(false); expect(document.querySelectorAll('img')).toHaveLength(0)
  })

  it('ajout d’un résultat à Mes livres (informations officielles gardées, doublon refusé) ; catalogues décochés non interrogés', async () => {
    const f = vi.fn().mockResolvedValue(ok({ items: [GU, LV], errors: [] })); vi.stubGlobal('fetch', f)
    await mount('#/12/en-ligne')
    fireEvent.click(screen.getByLabelText('Google Books')); fireEvent.click(screen.getByLabelText('Open Library'))
    expect((online() as HTMLButtonElement).disabled).toBe(true); search('austen'); expect((online() as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(online()); await tick(10)
    expect(new URL(f.mock.calls[0][0], 'http://x').searchParams.get('src')).toBe('gu,lv')
    fireEvent.click(btn('Ajouter à Mes livres : Pride and Prejudice')); await tick(5)
    expect(stored().books).toHaveLength(1); expect(stored().books[0]).toMatchObject({ id: 'gu:1342', t: 'Pride and Prejudice', a: 'Jane Austen', src: 'gu', ref: '1342', url: GU.url, cover: GU.cover, desc: GU.desc, page: 0, st: 'lire', total: null })
    expect(screen.getByText(/« Pride and Prejudice » ajouté à Mes livres/)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Ajouter à Mes livres : Pride and Prejudice' })).toBeNull(); expect(btn(/^Mes livres \(1\)$/)).toBeTruthy()
    fireEvent.click(btn('Ajouter à Mes livres : Pride and Prejudice (version audio)')); await tick(5); expect(stored().books.map((b: { id: string }) => b.id)).toEqual(['lv:987', 'gu:1342'])
  })

  it('échecs expliqués en français : fonction absente, hors ligne, tous les catalogues en échec, limite, code d’accès ; annulation', async () => {
    await mount('#/12/en-ligne'); search('austen')
    const run = async (f: unknown) => { vi.stubGlobal('fetch', f); fireEvent.click(online()); await tick(10) }
    await run(vi.fn().mockResolvedValue(ok('<html>', 'text/html'))); expect(screen.getByText('La recherche de livres n’est pas disponible pour le moment. Le catalogue intégré reste disponible.')).toBeTruthy(); expect(document.body.textContent).not.toMatch(/api\/ext|README|hébergement/)
    await run(vi.fn().mockResolvedValue(fail(404, {}))); expect(screen.getByText('La recherche de livres n’est pas disponible pour le moment. Le catalogue intégré reste disponible.')).toBeTruthy()
    await run(vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))); expect(screen.getByText('Serveur injoignable ou hors ligne. Réessayez une fois connecté.')).toBeTruthy()
    await run(vi.fn().mockResolvedValue(fail(502, { error: 'timeout', errors: [{ s: 'gu', e: 'timeout' }, { s: 'ol', e: 'network' }], items: [] }))); expect(screen.getByText('Aucun catalogue n’a répondu (Project Gutenberg : trop long à répondre ; Open Library : injoignable). Réessayez dans un instant.')).toBeTruthy()
    await run(vi.fn().mockResolvedValue(fail(429, { error: 'quota' }))); expect(screen.getByText('Limite de requêtes atteinte. Réessayez plus tard.')).toBeTruthy()
    await run(vi.fn().mockResolvedValue(fail(401, { error: 'code' }))); expect(screen.getByText(/Code d’accès requis ou incorrect/)).toBeTruthy()
    await run(vi.fn().mockResolvedValue(fail(429, { error: 'daily' }))); expect(screen.getByText('Limite quotidienne atteinte pour votre accès. Réessayez demain.')).toBeTruthy()
    await run(vi.fn().mockResolvedValue(ok({ items: [], errors: [] }))); expect(screen.getByText(/Aucun résultat dans ces catalogues/)).toBeTruthy()
    // annulation : la requête est interrompue et l’écran redevient disponible
    let sig: AbortSignal | undefined
    await run(vi.fn((_u: string, i: { signal: AbortSignal }) => new Promise((_r, rej) => { sig = i.signal; i.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))) })))
    expect(screen.getByText('Recherche en cours dans les catalogues…')).toBeTruthy(); expect((online() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(btn('Annuler la recherche')); await tick(10); expect(sig!.aborted).toBe(true); expect(screen.queryByText('Recherche en cours dans les catalogues…')).toBeNull(); expect((online() as HTMLButtonElement).disabled).toBe(false)
  })

  it('une réponse détournée est contrôlée : lien ou couverture hors des domaines autorisés écartés, notices invalides ignorées', async () => {
    const evil = { ...GU, id: '2', url: 'https://evil.example/x' }, js = { ...GU, id: '3', url: 'javascript:alert(1)' }, cov = { ...GU, id: '4', t: 'Couverture piégée', cover: 'https://evil.example/c.jpg' }, bad = { ...GU, id: 'abc/../', t: 'Identifiant piégé' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ items: [evil, js, cov, bad, GU], errors: [] })))
    await mount('#/12/en-ligne', s => { s.ui.covers = true }); search('austen'); fireEvent.click(online()); await tick(10)
    expect(screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Résultat : Couverture piégée', 'Résultat : Pride and Prejudice'])
    expect([...document.querySelectorAll('img')].map(i => i.getAttribute('src'))).toEqual([GU.cover]) // la couverture hors liste est devenue une tuile, seule la couverture autorisée est chargée
  })

  it('le texte envoyé ne contient que la recherche : pas de profil, de note ni de livre', async () => {
    const f = vi.fn().mockResolvedValue(ok({ items: [], errors: [] })); vi.stubGlobal('fetch', f)
    await mount('#/12', s => { s.profile = { g: 'F', name: 'Ada', age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' }; s.notes = [{ id: 'n1', cat: 'Rêves', t: 'Secret', b: 'Très privé', c: '2026-10-20T08:00:00.000Z', u: '2026-10-20T08:00:00.000Z' }]; s.books = [MY] })
    search('orgueil'); fireEvent.click(online()); await tick(10)
    expect(f).toHaveBeenCalledTimes(1); expect(f.mock.calls[0][1].method).toBeUndefined(); expect(f.mock.calls[0][1].body).toBeUndefined(); const all = JSON.stringify(f.mock.calls[0]); for (const s of ['Ada', 'Secret', 'Très privé', 'Mon roman', '170']) expect(all).not.toContain(s)
  })
})

describe('Rubrique 12 : Mes livres et marque-pages des habitudes', () => {
  it('pages lues : le marque-page avance, l’habitude « 20 pages de mon livre » est cochée à 20 pages (même renommée), la rubrique Habitudes montre les mêmes pages', async () => {
    await mount('#/12/mes-livres', s => { s.books = [MY]; s.habits.find(h => h.k === 'livre')!.n = 'Lecture du soir' })
    expect(screen.getByText(/0 \/ 20 pages/)).toBeTruthy(); expect(screen.getByText('Livre proposé au marque-page : Mon roman.')).toBeTruthy()
    type('Pages lues', '15'); fireEvent.click(btn('Ajouter les pages lues : Mon roman'))
    expect(screen.getByText('+ 15 pages lues. Aujourd’hui : 15/20.')).toBeTruthy(); expect(stored().books[0]).toMatchObject({ page: 15, st: 'cours' }); expect(stored().pages[TODAY()]).toBe(15); expect(stored().checks[TODAY()] ?? []).not.toContain('h7')
    type('Pages lues', '5'); fireEvent.click(btn('Ajouter les pages lues : Mon roman'))
    expect(screen.getByText('+ 5 pages lues. Aujourd’hui : 20/20. Habitude « Lecture du soir » cochée pour aujourd’hui.')).toBeTruthy(); expect(stored().checks[TODAY()]).toContain('h7'); expect(para('Page 20 sur 200 (10 %)')).toBe(true)
    await go('#/6')
    expect(screen.getByRole('heading', { name: 'Marque-page : Lecture du soir' })).toBeTruthy(); expect(screen.getByText(/20 \/ 20 pages/)).toBeTruthy(); expect(screen.getByText(/objectif atteint/)).toBeTruthy()
    expect((screen.getByLabelText('Livre en cours de lecture') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Mon roman (page 20 sur 200)')
    expect(btn('Lecture du soir, ' + todayName()).getAttribute('aria-pressed')).toBe('true')
    // depuis les Habitudes : « je suis à la page 35 » compte 15 pages de plus, même liste, mêmes pages
    const g = mark('Mon roman'); setIn(g, 'Page atteinte (marque-page)', '35'); expect(g.getByText(/Page actuelle 20, nouvelle page 35 : \+ 15 pages comptées\./)).toBeTruthy(); fireEvent.click(btn('Placer le marque-page : Mon roman'))
    expect(screen.getByText('+ 15 pages lues. Aujourd’hui : 35/20.')).toBeTruthy(); expect(stored().books[0].page).toBe(35); expect(stored().pages[TODAY()]).toBe(35)
    // sans compter l’écart : le marque-page bouge seulement
    fireEvent.click(mark('Mon roman').getByLabelText('Compter l’écart dans mes pages d’aujourd’hui')); setIn(mark('Mon roman'), 'Page atteinte (marque-page)', '60'); fireEvent.click(btn('Placer le marque-page : Mon roman'))
    expect(screen.getByText('Marque-page déplacé à la page 60. Aujourd’hui : 35/20.')).toBeTruthy(); expect(stored().books[0].page).toBe(60); expect(stored().pages[TODAY()]).toBe(35)
    await go('#/12/mes-livres'); expect(para('Page 60 sur 200 (30 %)')).toBe(true)
  })

  it('valeurs refusées avec un message clair et sans rien modifier ; fin du livre ; autre livre sans marque-page', async () => {
    await mount('#/6', s => { s.books = [{ ...MY, total: 30, page: 25, st: 'cours' }] })
    const g = () => mark('Mon roman')
    for (const v of ['0', '-4', '1.5', '', '1001']) { setIn(g(), 'Pages lues', v); fireEvent.click(btn('Ajouter les pages lues : Mon roman')); expect(g().getByRole('alert').textContent).toMatch(/Indiquez un nombre de pages entre 1 et 1000/) }
    expect(stored().books[0].page).toBe(25); expect(stored().pages ?? {}).toEqual({})
    setIn(g(), 'Pages lues', '20'); fireEvent.click(btn('Ajouter les pages lues : Mon roman')); expect(screen.getByText(/\+ 5 pages lues\..*Livre terminé : bravo !/)).toBeTruthy(); expect(stored().books[0]).toMatchObject({ page: 30, st: 'fini' })
    setIn(g(), 'Pages lues', '3'); fireEvent.click(btn('Ajouter les pages lues : Mon roman')); expect(g().getByRole('alert').textContent).toBe('Vous êtes déjà à la dernière page de ce livre.')
    setIn(g(), 'Page atteinte (marque-page)', '99'); fireEvent.click(btn('Placer le marque-page : Mon roman')); expect(g().getByRole('alert').textContent).toBe('La page doit être un nombre entier entre 0 et 30.')
    // le livre terminé reste proposé tant qu’il est sélectionné ; « autre livre » compte les pages sans marque-page
    fireEvent.change(screen.getByLabelText('Livre en cours de lecture'), { target: { value: '-' } })
    const free = mark('livre'); expect(free.queryByLabelText('Page atteinte (marque-page)')).toBeNull(); setIn(free, 'Pages lues', '12'); fireEvent.click(btn('Ajouter les pages lues : livre')); expect(screen.getByText('+ 12 pages lues. Aujourd’hui : 17/20.')).toBeTruthy(); expect(stored().books[0].page).toBe(30)
  })

  it('sans livre : les pages sont comptées sans marque-page, avec un lien vers la bibliothèque ; habitude retirée = carte absente', async () => {
    await mount('#/6')
    expect(screen.getByText(/Aucun livre dans Mes livres/)).toBeTruthy(); expect(screen.getByRole('link', { name: 'Trouver un livre' }).getAttribute('href')).toBe('#/12/en-ligne')
    fireEvent.click(btn('Ajouter les pages lues : livre')); expect(screen.getByText('+ 20 pages lues. Aujourd’hui : 20/20. Habitude « 20 pages de mon livre » cochée pour aujourd’hui.')).toBeTruthy(); expect(stored().pages[TODAY()]).toBe(20)
    cleanup(); await mount('#/6', s => { s.habits = s.habits.filter(h => h.k !== 'livre' && h.k !== 'cours') }); expect(screen.queryByRole('heading', { name: /Marque-page/ })).toBeNull()
  })

  it('marque-page du cours : intitulé libre, pages comptées à part, habitude « 20 pages de cours » cochée', async () => {
    await mount('#/6')
    const c = screen.getByLabelText('Cours ou support (facultatif)'); fireEvent.change(c, { target: { value: 'Droit civil' } }); fireEvent.blur(c); expect(stored().course.n).toBe('Droit civil')
    const cours = screen.getByRole('group', { name: 'Marque-page : Droit civil' })
    fireEvent.click(within(cours).getByRole('button', { name: 'Ajouter les pages lues : Droit civil' }))
    expect(screen.getByText('+ 20 pages lues. Aujourd’hui : 20/20. Habitude « 20 pages de cours » cochée pour aujourd’hui.')).toBeTruthy()
    expect(stored().course).toMatchObject({ n: 'Droit civil', page: 20 }); expect(stored().course.days[TODAY()]).toBe(20); expect(stored().checks[TODAY()]).toEqual(['h6']); expect(stored().pages ?? {}).toEqual({})
  })

  it('statut, nombre de pages, retrait confirmé (les pages lues restent), liste filtrée par statut ; persistance après réouverture', async () => {
    await mount('#/12/mes-livres', s => { s.books = [MY, { ...MY, id: 'b2', t: 'Deuxième', st: 'fini', page: 50, total: 50 }]; s.pages = { [iso(new Date())]: 7 } })
    expect(screen.getByText('2 livres. Limite : 500.')).toBeTruthy(); fireEvent.click(btn('Terminé (1)')); expect(screen.getAllByRole('article')).toHaveLength(1); expect(screen.getByRole('article', { name: 'Mon livre : Deuxième' })).toBeTruthy(); fireEvent.click(btn(/^Tous \(/))
    fireEvent.change(screen.getByLabelText('Statut de Mon roman'), { target: { value: 'cours' } }); expect(stored().books[0].st).toBe('cours'); expect(screen.getByText('Statut : En cours.')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Nombre de pages du livre')[0]); type('Nombre de pages de Mon roman', '120'); fireEvent.click(btn('Enregistrer le nombre de pages de Mon roman')); expect(stored().books[0].total).toBe(120)
    type('Nombre de pages de Mon roman', '0'); fireEvent.click(btn('Enregistrer le nombre de pages de Mon roman')); expect(screen.getByText(/entier entre 1 et 50000/)).toBeTruthy(); expect(stored().books[0].total).toBe(120)
    // ajout à la main
    fireEvent.click(screen.getByText('Ajouter un livre à la main')); type('Titre', 'Le Cid'); type('Auteur (facultatif)', 'Corneille'); fireEvent.click(btn('Ajouter le livre')); expect(stored().books[0]).toMatchObject({ t: 'Le Cid', a: 'Corneille', src: 'perso', total: null }); expect((screen.getByLabelText('Titre') as HTMLInputElement).value).toBe('')
    type('Titre', 'le cid'); type('Auteur (facultatif)', 'CORNEILLE'); fireEvent.click(btn('Ajouter le livre')); expect(screen.getByText('Un livre de même titre et de même auteur est déjà dans Mes livres.')).toBeTruthy(); expect(stored().books).toHaveLength(3)
    // retrait en deux temps : annuler puis confirmer ; les pages déjà lues restent comptées
    fireEvent.click(btn('Retirer de Mes livres : Le Cid')); fireEvent.click(btn('Annuler')); expect(stored().books).toHaveLength(3); fireEvent.click(btn('Retirer de Mes livres : Le Cid')); fireEvent.click(btn('Confirmer le retrait de Le Cid'))
    expect(stored().books.map((b: { t: string }) => b.t)).toEqual(['Mon roman', 'Deuxième']); expect(stored().pages[TODAY()]).toBe(7)
    cleanup(); await reopen('#/12/mes-livres'); expect(screen.getByRole('article', { name: 'Mon livre : Mon roman' })).toBeTruthy(); expect((screen.getByLabelText('Statut de Mon roman') as HTMLSelectElement).value).toBe('cours')
  })
})

describe('Rubrique 12 : fiche de synthèse par Believe AI', () => {
  const FICHE = { idee: 'Un roman sur les premières impressions.', points: ['Les apparences trompent.', 'Elizabeth révise son jugement.', 'Darcy corrige son orgueil.'], retenir: 'Vérifier avant de juger.', pour_qui: 'Les amateurs de romans classiques.', fiabilite: 'Livre très connu : fiche fiable dans l’ensemble.' }
  const LIVRE = { ...MY, id: 'gu:1342', t: 'Pride and Prejudice', a: 'Jane Austen', src: 'gu' as const, ref: '1342', url: 'https://www.gutenberg.org/ebooks/1342', desc: 'Un roman célèbre.', page: 0 }

  it('le texte exact est montré avant l’envoi ; rien ne part sans accord ni clic ; la fiche est signalée IA et n’est gardée qu’à la demande', async () => {
    const f = vi.fn().mockResolvedValue(ok({ data: FICHE, model: 'gemini-test' })); vi.stubGlobal('fetch', f)
    await mount('#/12/mes-livres', s => { s.books = [LIVRE]; s.profile = { g: 'F', name: 'Ada', age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' } })
    fireEvent.click(btn('Créer une fiche de synthèse (IA) : Pride and Prejudice'))
    const shown = screen.getByLabelText('Texte exact qui sera envoyé').textContent!
    expect(shown).toBe(ficheAsk(LIVRE)); expect(shown).toBe('Livre : « Pride and Prejudice »\nAuteur : Jane Austen\nDescriptif du catalogue (Project Gutenberg) : Un roman célèbre.\nRédige la fiche de synthèse de ce livre.')
    expect(f).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Envoyer à l’IA' })).toBeNull() // pas d’accord : pas de bouton d’envoi
    fireEvent.click(btn('Donner mon accord pour l’IA')); expect(stored().consents.ai).toBe(true); expect(f).not.toHaveBeenCalled()
    fireEvent.click(btn('Envoyer à l’IA')); await tick(10)
    expect(f).toHaveBeenCalledTimes(1); expect(f.mock.calls[0][0]).toBe('/api/ai'); const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body).toEqual({ mode: 'book', messages: [{ role: 'user', content: shown }] }); expect(JSON.stringify(body)).not.toContain('Ada'); expect(body.image).toBeUndefined()
    expect(screen.getByText('Généré par IA')).toBeTruthy(); expect(screen.getByText('Un roman sur les premières impressions.')).toBeTruthy(); expect(screen.getByText('Darcy corrige son orgueil.')).toBeTruthy(); expect(screen.getByText(/Modèle : gemini-test, le /)).toBeTruthy()
    expect(stored().books[0].f ?? null).toBeNull() // rien n’est gardé sans demande
    fireEvent.click(btn('Garder la fiche avec le livre')); expect(stored().books[0].f).toMatchObject({ idee: FICHE.idee, points: FICHE.points, retenir: FICHE.retenir, pour: FICHE.pour_qui, fia: FICHE.fiabilite, m: 'gemini-test', d: TODAY() })
    expect(screen.getByText('Fiche gardée avec le livre.')).toBeTruthy()
    cleanup(); await reopen('#/12/mes-livres'); expect(screen.getByText('Un roman sur les premières impressions.')).toBeTruthy() // la fiche survit à la réouverture
    fireEvent.click(btn('Supprimer la fiche de Pride and Prejudice')); fireEvent.click(btn('Confirmer la suppression de la fiche de Pride and Prejudice')); expect(stored().books[0].f).toBeNull(); expect(screen.getByText('Fiche supprimée.')).toBeTruthy()
  })

  it('erreurs expliquées (service indisponible, réponse illisible) avec nouvel essai possible ; annuler n’envoie rien ; fermer sans garder', async () => {
    const f = vi.fn().mockResolvedValueOnce(fail(503, { error: 'not_configured' })).mockResolvedValueOnce(ok({ data: { idee: 'seule' }, model: 'm' })).mockResolvedValueOnce(ok({ data: FICHE, model: 'm2' })); vi.stubGlobal('fetch', f)
    await mount('#/12/mes-livres', s => { s.consents.ai = true; s.books = [LIVRE] })
    fireEvent.click(btn('Créer une fiche de synthèse (IA) : Pride and Prejudice')); fireEvent.click(btn('Annuler')); expect(f).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Texte exact qui sera envoyé')).toBeNull()
    fireEvent.click(btn('Créer une fiche de synthèse (IA) : Pride and Prejudice')); fireEvent.click(btn('Envoyer à l’IA')); await tick(10)
    expect(screen.getByText(/Believe AI n’est pas disponible pour le moment/)).toBeTruthy(); fireEvent.click(btn('Envoyer à l’IA')); await tick(10)
    expect(screen.getByText('Réponse illisible de l’IA : réessayez.')).toBeTruthy(); expect(stored().books[0].f ?? null).toBeNull()
    fireEvent.click(btn('Envoyer à l’IA')); await tick(10); expect(screen.getByText('Généré par IA')).toBeTruthy(); expect(f).toHaveBeenCalledTimes(3)
    fireEvent.click(btn('Fermer sans garder')); expect(stored().books[0].f ?? null).toBeNull(); expect(screen.queryByText('Généré par IA')).toBeNull()
  })

  it('livre saisi à la main : seul le titre part, sans descriptif ; les autres livres et pages ne sont jamais envoyés', async () => {
    const f = vi.fn().mockResolvedValue(ok({ data: FICHE, model: 'm' })); vi.stubGlobal('fetch', f)
    await mount('#/12/mes-livres', s => { s.consents.ai = true; s.books = [MY, LIVRE]; s.pages = { [TODAY()]: 33 } })
    fireEvent.click(btn('Créer une fiche de synthèse (IA) : Mon roman')); expect(screen.getByLabelText('Texte exact qui sera envoyé').textContent).toBe('Livre : « Mon roman »\nAuteur : Moi\nRédige la fiche de synthèse de ce livre.')
    fireEvent.click(btn('Envoyer à l’IA')); await tick(10); const sent = JSON.stringify(f.mock.calls[0][1].body); expect(sent).not.toContain('Pride'); expect(sent).not.toContain('33')
  })
})

describe('Rubrique 12 : accès et navigation', () => {
  it('liens directs vers les trois sections ; la rubrique figure au menu', async () => {
    await mount('#/12/en-ligne'); expect(btn(/^En ligne/).getAttribute('aria-pressed')).toBe('true'); expect(screen.getByRole('heading', { name: 'Chercher dans les catalogues publics' })).toBeTruthy()
    cleanup(); await mount('#/12/mes-livres'); expect(btn(/^Mes livres/).getAttribute('aria-pressed')).toBe('true'); expect(screen.getByRole('heading', { name: 'Mes livres' })).toBeTruthy()
    cleanup(); await mount('#/12'); expect(btn(/^Catalogue/).getAttribute('aria-pressed')).toBe('true')
    await go('#/menu'); expect(within(screen.getByRole('main')).getByRole('link', { name: /Bibliothèque et recherche de livres/ }).getAttribute('href')).toBe('#/12')
  })
})
