import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { btn, go, iso, mount, stored, tick, type } from './testkit'
import type { Prayer } from './lib'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

/** Jour décalé de n jours par rapport à aujourd'hui (AAAA-MM-JJ). */
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d) }
const P = (id: string, t: string, c: string, a: string | null = null, k?: 'g'): Prayer => (k ? { id, t, c, a, k } : { id, t, c, a })
const h3 = (t: string) => screen.queryByRole('heading', { level: 3, name: t })
const box = (t: string) => screen.getByLabelText(t) as HTMLInputElement

describe('Rubrique 4 : mur de prières et gratitudes', () => {
  it('vide au départ ; un sujet vide est refusé ; l’ajout est enregistré, le champ vidé, et rien ne part sur le réseau', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    await mount('#/4')
    expect(screen.getByRole('heading', { level: 2, name: 'Mur de prières et gratitudes' })).toBeTruthy(); expect(screen.getByText(/Le mur est vide/)).toBeTruthy(); expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    fireEvent.click(btn('Ajouter au mur')); expect(screen.getByText('Écrivez d’abord un sujet.')).toBeTruthy(); expect(stored().prayers).toEqual([])
    type('Sujet de prière', '   \n  '); fireEvent.click(btn('Ajouter au mur')); expect(screen.getByText('Écrivez d’abord un sujet.')).toBeTruthy(); expect(stored().prayers).toEqual([]) // des espaces ne sont pas un sujet
    type('Sujet de prière', '  Pour la guérison de ma sœur '); fireEvent.click(btn('Ajouter au mur'))
    expect(screen.getByText('Sujet de prière ajouté au mur.')).toBeTruthy(); expect(screen.queryByText('Écrivez d’abord un sujet.')).toBeNull()
    expect(stored().prayers).toEqual([{ id: expect.stringMatching(/^p/), t: 'Pour la guérison de ma sœur', c: day(0), a: null }])
    expect((box('Sujet de prière') as unknown as HTMLTextAreaElement).value).toBe(''); expect(h3('Prières en cours (1)')).toBeTruthy(); expect(screen.queryByText(/Le mur est vide/)).toBeNull(); expect(screen.getByText('Pour la guérison de ma sœur')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('gratitude : autre libellé, pas de case « Exaucée », groupe à part, enregistrée avec son type', async () => {
    await mount('#/4')
    expect((screen.getByRole('radio', { name: 'Prière' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Gratitude' })); expect(screen.queryByLabelText('Sujet de prière')).toBeNull()
    fireEvent.click(btn('Ajouter au mur')); expect(screen.getByText('Écrivez d’abord un motif de gratitude.')).toBeTruthy(); expect(stored().prayers).toEqual([])
    type('Motif de gratitude', 'Merci pour cette journée'); fireEvent.click(btn('Ajouter au mur'))
    expect(screen.getByText('Gratitude ajoutée au mur.')).toBeTruthy(); expect(stored().prayers).toEqual([{ id: expect.stringMatching(/^p/), t: 'Merci pour cette journée', c: day(0), a: null, k: 'g' }])
    expect(h3('Gratitudes (1)')).toBeTruthy(); expect(h3('Prières en cours (1)')).toBeNull(); expect(screen.queryByLabelText('Exaucée : Merci pour cette journée')).toBeNull(); expect(screen.queryByLabelText(/^Date d’exaucement/)).toBeNull()
    expect(screen.getByText(/vos gratitudes ne le sont jamais/)).toBeTruthy()
  })

  it('exaucée : la prière change de groupe et le focus la suit, date proposée aujourd’hui, modifiable entre la création et aujourd’hui seulement, décocher la remet en cours', async () => {
    await mount('#/4', s => { s.prayers = [P('p-old', 'Un ancien sujet', day(-10)), P('p-new', 'Pour la paix', day(0))] })
    expect(h3('Prières en cours (2)')).toBeTruthy(); expect(h3('Prières exaucées (1)')).toBeNull()
    fireEvent.click(box('Exaucée : Un ancien sujet'))
    expect(h3('Prières en cours (1)')).toBeTruthy(); expect(h3('Prières exaucées (1)')).toBeTruthy(); expect(stored().prayers.find((p: Prayer) => p.id === 'p-old').a).toBe(day(0)); expect(screen.getByText('Marquée comme exaucée : Un ancien sujet')).toBeTruthy()
    expect(document.activeElement).toBe(box('Exaucée : Un ancien sujet')); expect(box('Exaucée : Un ancien sujet').checked).toBe(true) // le focus suit l’élément dans son nouveau groupe
    const dt = box('Date d’exaucement : Un ancien sujet'); expect([dt.value, dt.min, dt.max]).toEqual([day(0), day(-10), day(0)])
    const a = () => stored().prayers.find((p: Prayer) => p.id === 'p-old').a
    fireEvent.change(dt, { target: { value: day(-5) } }); expect(a()).toBe(day(-5)); expect(document.querySelector('time[datetime="' + day(-5) + '"]')).not.toBeNull(); expect(screen.getByText('Date d’exaucement modifiée : Un ancien sujet')).toBeTruthy()
    for (const [n, why] of [[-11, 'avant la création'], [1, 'dans le futur']] as const) {
      fireEvent.change(dt, { target: { value: day(n) } }); expect(screen.getByRole('alert').textContent).toMatch(/^Date d’exaucement : entre le \d+ \p{L}+ \d{4} et aujourd’hui\.$/u); expect(a(), 'date ' + why + ' acceptée').toBe(day(-5))
      fireEvent.change(dt, { target: { value: day(-5) } }); expect(screen.queryByRole('alert')).toBeNull()
    }
    fireEvent.change(dt, { target: { value: '' } }); expect(a()).toBe(day(-5)); expect(screen.queryByRole('alert')).toBeNull() // saisie incomplète : rien n’est changé, rien n’est signalé
    fireEvent.change(dt, { target: { value: '10000-01-01' } }); expect(screen.getByRole('alert')).toBeTruthy(); expect(a()).toBe(day(-5))
    fireEvent.change(dt, { target: { value: day(-10) } }); expect(a()).toBe(day(-10)); fireEvent.change(dt, { target: { value: day(0) } }); expect(a()).toBe(day(0)) // bornes incluses
    fireEvent.click(box('Exaucée : Un ancien sujet')); expect(a()).toBeNull(); expect(h3('Prières en cours (2)')).toBeTruthy(); expect(h3('Prières exaucées (1)')).toBeNull(); expect(screen.queryByLabelText(/^Date d’exaucement/)).toBeNull()
    expect(document.activeElement).toBe(box('Exaucée : Un ancien sujet'))
  })

  it('horloge de l’appareil reculée (prière « créée dans le futur ») : l’exaucement n’est jamais daté avant la création', async () => {
    await mount('#/4', s => { s.prayers = [P('p-fut', 'Sujet daté du futur', day(3))] })
    fireEvent.click(box('Exaucée : Sujet daté du futur')); expect(stored().prayers[0].a).toBe(day(3))
  })

  it('modifier : texte prérempli et focus, vide refusé, Échap annule, enregistrement confirmé, le focus revient au bouton', async () => {
    await mount('#/4', s => { s.prayers = [P('p1', 'Pour la paix', day(0)), P('g1', 'Merci pour le pain', day(0), null, 'g')] })
    fireEvent.click(btn('Modifier : Pour la paix'))
    const ta = box('Modifier le sujet') as unknown as HTMLTextAreaElement; expect(ta.value).toBe('Pour la paix'); expect(document.activeElement).toBe(ta)
    fireEvent.change(ta, { target: { value: '   ' } }); fireEvent.click(btn('Enregistrer')); expect(screen.getByRole('alert').textContent).toBe('Le sujet ne peut pas être vide : supprimez-le pour l’enlever.'); expect(stored().prayers[0].t).toBe('Pour la paix')
    fireEvent.change(ta, { target: { value: 'autre texte' } }); fireEvent.keyDown(ta, { key: 'Escape' })
    expect(screen.queryByLabelText('Modifier le sujet')).toBeNull(); expect(stored().prayers[0].t).toBe('Pour la paix'); expect(document.activeElement).toBe(btn('Modifier : Pour la paix'))
    fireEvent.click(btn('Modifier : Pour la paix')); fireEvent.click(btn('Annuler')); expect(screen.getByText('Pour la paix')).toBeTruthy() // Annuler, après Échap : la valeur de départ est celle du mur
    fireEvent.click(btn('Modifier : Pour la paix')); expect((box('Modifier le sujet') as unknown as HTMLTextAreaElement).value).toBe('Pour la paix')
    fireEvent.change(box('Modifier le sujet'), { target: { value: 'Pour la paix de ma famille' } }); fireEvent.click(btn('Enregistrer'))
    expect(screen.getByText('Texte modifié.')).toBeTruthy(); expect(stored().prayers[0].t).toBe('Pour la paix de ma famille'); expect(screen.getByText('Pour la paix de ma famille')).toBeTruthy(); expect(document.activeElement).toBe(btn('Modifier : Pour la paix de ma famille'))
    fireEvent.click(btn('Modifier : Merci pour le pain')); expect(box('Modifier le motif')).toBeTruthy() // libellé propre à la gratitude
    fireEvent.change(box('Modifier le motif'), { target: { value: '' } }); fireEvent.click(btn('Enregistrer')); expect(screen.getByRole('alert').textContent).toBe('Le motif ne peut pas être vide : supprimez-le pour l’enlever.')
    fireEvent.click(btn('Annuler')); expect(stored().prayers[1]).toMatchObject({ t: 'Merci pour le pain', k: 'g' })
  })

  it('supprimer : jamais sans confirmation, « Annuler » ne change rien, « Oui, supprimer » enlève un seul élément, le focus revient au titre', async () => {
    await mount('#/4', s => { s.prayers = [P('p1', 'Premier', day(0)), P('p2', 'Second', day(0)), P('g1', 'Merci', day(0), null, 'g')] })
    fireEvent.click(btn('Supprimer : Second')); expect(stored().prayers).toHaveLength(3)
    const grp = screen.getByRole('group', { name: 'Supprimer : Second' }); expect(within(grp).getByText('Supprimer ce sujet ?')).toBeTruthy()
    fireEvent.click(within(grp).getByRole('button', { name: 'Annuler' })); expect(stored().prayers).toHaveLength(3); expect(screen.queryByRole('group', { name: 'Supprimer : Second' })).toBeNull(); expect(btn('Supprimer : Second')).toBeTruthy()
    fireEvent.click(btn('Supprimer : Second')); fireEvent.click(btn('Oui, supprimer'))
    expect(stored().prayers.map((p: Prayer) => p.id)).toEqual(['p1', 'g1']); expect(screen.getByText('Sujet supprimé : Second')).toBeTruthy(); expect(screen.queryByText('Second')).toBeNull(); expect(h3('Prières en cours (1)')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Mur de prières et gratitudes' }))
    fireEvent.click(btn('Supprimer : Merci')); expect(within(screen.getByRole('group', { name: 'Supprimer : Merci' })).getByText('Supprimer cette gratitude ?')).toBeTruthy(); fireEvent.click(btn('Oui, supprimer'))
    expect(stored().prayers.map((p: Prayer) => p.id)).toEqual(['p1']); expect(h3('Gratitudes (1)')).toBeNull(); expect(screen.getByText('Gratitude supprimée : Merci')).toBeTruthy()
  })

  it('texte long : l’intitulé des boutons est abrégé à 60 caractères ; au-delà de dix éléments, la suite se demande ; plus récents d’abord', async () => {
    const many = Array.from({ length: 25 }, (_, i) => P('p' + i, 'Sujet numéro ' + i, day(-(25 - i)))) // p24 est le plus récent
    await mount('#/4', s => { s.prayers = [...many, P('p-long', 'A'.repeat(480), day(0))] })
    expect(h3('Prières en cours (26)')).toBeTruthy()
    expect(screen.getAllByRole('listitem').map(li => li.querySelector('.pq')!.textContent!.slice(0, 15))).toEqual(['A'.repeat(15), ...[24, 23, 22, 21, 20, 19, 18, 17, 16].map(i => 'Sujet numéro ' + i)]) // aujourd’hui d’abord, puis du plus récent au plus ancien
    expect(btn('Supprimer : ' + 'A'.repeat(57) + '…')).toBeTruthy(); expect(box('Exaucée : ' + 'A'.repeat(57) + '…')).toBeTruthy()
    expect(screen.getByText('A'.repeat(480))).toBeTruthy() // le texte entier reste affiché
    expect(screen.queryByText('Sujet numéro 0')).toBeNull(); fireEvent.click(btn('Afficher la suite (16 restants)')); expect(screen.getAllByRole('listitem')).toHaveLength(20)
    fireEvent.click(btn('Afficher la suite (6 restants)')); expect(screen.getAllByRole('listitem')).toHaveLength(26); expect(screen.queryByRole('button', { name: /Afficher la suite/ })).toBeNull(); expect(screen.getByText('Sujet numéro 0')).toBeTruthy()
  })

  it('1 000 éléments au plus : le suivant est refusé avec un message, sans rien perdre', async () => {
    await mount('#/4', s => { s.prayers = Array.from({ length: 1000 }, (_, i) => P('p' + i, 'Sujet ' + i, day(0))) })
    type('Sujet de prière', 'Le mille et unième'); fireEvent.click(btn('Ajouter au mur'))
    expect(screen.getByRole('alert').textContent).toMatch(/^Limite de 1\s000 éléments atteinte : supprimez-en avant d’en ajouter\.$/); expect(stored().prayers).toHaveLength(1000); expect((box('Sujet de prière') as unknown as HTMLTextAreaElement).value).toBe('Le mille et unième')
  })

  it('stockage plein ou indisponible : l’ajout et les changements le disent au lieu de faire croire à un enregistrement, sans doublon en réessayant', async () => {
    await mount('#/4', s => { s.prayers = [P('p1', 'Pour la paix', day(0))] })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    type('Sujet de prière', 'Nouveau sujet'); fireEvent.click(btn('Ajouter au mur'))
    expect(screen.getByText('Sujet de prière ajouté au mur : non enregistré, le stockage local est indisponible ou plein.')).toBeTruthy(); expect(screen.getByText(/Enregistrement impossible/)).toBeTruthy()
    expect((box('Sujet de prière') as unknown as HTMLTextAreaElement).value).toBe(''); expect(screen.getAllByText('Nouveau sujet')).toHaveLength(1) // en mémoire une seule fois : pas de doublon si l’on appuie de nouveau
    fireEvent.click(btn('Ajouter au mur')); expect(screen.getByText('Écrivez d’abord un sujet.')).toBeTruthy(); expect(screen.getAllByText('Nouveau sujet')).toHaveLength(1)
    fireEvent.click(box('Exaucée : Pour la paix')); expect(screen.getByText('Marquée comme exaucée : Pour la paix : non enregistré, le stockage local est indisponible ou plein.')).toBeTruthy()
    set.mockRestore(); fireEvent.click(box('Exaucée : Nouveau sujet')); expect(screen.getByText('Marquée comme exaucée : Nouveau sujet')).toBeTruthy(); expect(stored().prayers.map((p: Prayer) => p.t)).toEqual(['Pour la paix', 'Nouveau sujet']) // le stockage revient : tout est écrit
  })

  it('l’adresse #/4/prieres met le curseur dans le champ ; le raccourci « Ajouter une prière » le fait aussi quand on y est déjà, et depuis une autre page', async () => {
    await mount('#/4/prieres')
    expect(document.activeElement).toBe(document.getElementById('pnew'))
    ;(document.getElementById('pnew') as HTMLElement).blur(); expect(document.activeElement).toBe(document.body)
    fireEvent.click(btn('Actions rapides')); fireEvent.click(screen.getByRole('link', { name: /Ajouter une prière/ })); await tick(20)
    expect(screen.queryByRole('dialog', { name: 'Actions rapides' })).toBeNull(); expect(location.hash).toBe('#/4/prieres'); expect(document.activeElement).toBe(document.getElementById('pnew')) // même adresse : pas d’événement d’adresse, le raccourci place lui-même le curseur
    await go('#/6'); expect(document.getElementById('pnew')).toBeNull()
    fireEvent.click(btn('Actions rapides')); fireEvent.click(screen.getByRole('link', { name: /Ajouter une prière/ })); await tick(20)
    expect(location.hash).toBe('#/4/prieres'); expect(screen.getByRole('heading', { level: 2, name: 'Mur de prières et gratitudes' })).toBeTruthy(); expect(document.activeElement).toBe(document.getElementById('pnew'))
    ;(document.getElementById('pnew') as HTMLElement).blur(); await act(async () => { location.hash = '#/4' }); await tick(10); expect(document.activeElement).toBe(document.body) // l’accueil seul ne prend pas le focus
  })

  it('les données du mur survivent à l’export et à l’import ; une gratitude mal formée est refusée à l’import', async () => {
    await mount('#/4', s => { s.prayers = [P('p1', 'Pour la paix', day(-2), day(-1)), P('g1', 'Merci', day(0), null, 'g')] })
    const { load } = await import('./lib')
    const ok = JSON.parse(localStorage.getItem('believe:v2')!); expect(load().s.prayers).toEqual(ok.prayers)
    const bad = { ...ok, prayers: [{ id: 'g2', t: 'Merci', c: day(0), a: null, k: 'x' }] }; localStorage.setItem('believe:v2', JSON.stringify(bad))
    const r = load(); expect(r.err).toBeTruthy(); expect(r.s.prayers).toEqual([]) // état illisible : valeurs par défaut, copie brute gardée
    expect(localStorage.getItem('believe:illisible')).toBe(JSON.stringify(bad))
  })
})
