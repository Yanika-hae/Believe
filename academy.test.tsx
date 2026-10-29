import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { btn, go, iso, mount, reopen, stored, tick } from './testkit'
import { FakeMR, idbCount, micStub, wipeDb } from './testmic'
import { KEY } from './lib'
import type { State } from './lib'
import { BANK } from './quizbank'
import { EXOS, KINDS } from './exobank'
import { genRequest, qhash, view } from './quiz'
import { adviceRequest } from './ImproTab'
import { decode } from './impro'
import { mmss } from './util'

URL.createObjectURL = vi.fn(() => 'blob:fake'); URL.revokeObjectURL = vi.fn()

const TODAY = () => iso(new Date())
const days = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d) }
/** Horloge simulée pour les chronos (setTimeout reste réel : les attentes habituelles continuent de fonctionner). */
const fakeClock = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
const adv = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

const cards = () => screen.getAllByRole('article').filter(a => (a.getAttribute('aria-label') ?? '').startsWith('Exercice : '))
const optBtns = () => screen.getAllByRole('button', { name: /^[ABCD]\. / })
const curQ = () => { const t = document.querySelector('.qq')!.textContent!; return BANK.find(q => q.q === t)! }
/** Répond à la question affichée (bonne ou mauvaise réponse) et renvoie la question de la banque. */
const answer = (good: boolean) => { const q = curQ(), k = view(q).ok; fireEvent.click(optBtns()[good ? k : (k + 1) % 4]); return q }

beforeEach(() => { FakeMR.last = null })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); await tick(20); await wipeDb() })

describe('Rubrique 13 : exercices d’éloquence', () => {
  it('5 exercices de familles différentes, enregistrés avant affichage, identiques toute la journée', async () => {
    await mount('#/13/exo'); await tick(20)
    expect(screen.getByRole('heading', { level: 1, name: 'Académie d’éloquence et quiz' })).toBeTruthy()
    const a = cards(); expect(a).toHaveLength(5)
    expect(new Set(a.map(x => Object.values(KINDS).find(k => within(x).queryByText(k)))).size).toBe(5) // une famille par exercice
    const e = stored().exo
    expect(e.cur.d).toBe(TODAY()); expect(e.cur.ids).toHaveLength(5); expect(e.seen).toEqual(e.cur.ids); expect(e.done).toEqual({}) // servis = mémorisés, rien de coché
    expect(screen.getByText(/Aujourd’hui :/).textContent).toContain('0 / 5')
    const titles = a.map(x => x.getAttribute('aria-label'))
    cleanup(); await reopen('#/13/exo'); await tick(20)
    expect(cards().map(x => x.getAttribute('aria-label'))).toEqual(titles); expect(stored().exo).toEqual(e) // même lot, rien de consommé en plus
  })

  it('un nouveau jour tire d’autres exercices (jamais parmi les 55 derniers servis) ; les jours sans ouverture n’en consomment aucun', async () => {
    const old = EXOS.slice(0, 55).map(e => e.id)
    await mount('#/13/exo', s => { s.exo = { seen: old, cur: { d: days(-3), ids: old.slice(-5) }, done: {} } }); await tick(20)
    const e = stored().exo
    expect(e.cur.d).toBe(TODAY()); expect(e.cur.ids).toHaveLength(5)
    for (const id of e.cur.ids) expect(old).not.toContain(id)
    expect(e.seen).toEqual([...old, ...e.cur.ids]) // trois jours sans ouverture : un seul lot consommé
  })

  it('un exercice s’ouvre avec texte, étapes et conseil ; « fait » ne se coche que sur clic, se retire, et la série de jours s’affiche', async () => {
    await mount('#/13/exo', s => { s.exo.done = { [days(-1)]: ['di01'], [days(-2)]: ['di02'] } }); await tick(20)
    expect(screen.getByText(/Aujourd’hui :/).textContent).toContain('2 jours de suite')
    const first = cards()[0], title = first.getAttribute('aria-label')!.replace('Exercice : ', ''), id = stored().exo.cur.ids[0], item = EXOS.find(x => x.id === id)!
    fireEvent.click(within(first).getByRole('button', { name: /^Ouvrir l’exercice/ }))
    const d = within(screen.getByRole('dialog', { name: 'Exercice : ' + title }))
    expect(d.getByText('Comment faire')).toBeTruthy(); expect(d.getByText(item.tip, { exact: false })).toBeTruthy(); expect(d.getByRole('timer', { name: 'Chrono de l’exercice' })).toBeTruthy(); expect(d.getByText('M’écouter')).toBeTruthy()
    if (item.txt) expect(d.getAllByText(item.txt).some(x => x.tagName === 'BLOCKQUOTE')).toBe(true)       // le texte à dire (pour certains exercices, il est identique au titre : d'où « getAll »)
    expect(stored().exo.done[TODAY()]).toBeUndefined() // ouvrir ne coche rien
    fireEvent.click(d.getByRole('button', { name: 'Marquer comme fait' }))
    expect(stored().exo.done[TODAY()]).toEqual([id]); expect(screen.getByText('Exercice marqué comme fait : ' + title + '.')).toBeTruthy(); expect(d.getByText('Fait aujourd’hui')).toBeTruthy()
    expect(screen.getByText(/Aujourd’hui :/).textContent).toContain('3 jours de suite')
    fireEvent.click(d.getByRole('button', { name: 'Retirer la marque « fait »' })); expect(stored().exo.done[TODAY()]).toBeUndefined()
    fireEvent.click(d.getByRole('button', { name: 'Fermer' })); expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('chrono dédié : durée réglable par 15 s, démarrage, pause, reprise, fin signalée par écrit et par vibration', async () => {
    const vib = vi.fn(); Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vib })
    await mount('#/13/exo'); await tick(20)
    fireEvent.click(within(cards()[0]).getByRole('button', { name: /^Ouvrir/ }))
    const sec = EXOS.find(x => x.id === stored().exo.cur.ids[0])!.sec, tm = () => screen.getByRole('timer', { name: 'Chrono de l’exercice' }).textContent
    expect(tm()).toBe(mmss(sec * 1000))
    fireEvent.click(btn('Ajouter 15 secondes')); expect(tm()).toBe(mmss((sec + 15) * 1000)); fireEvent.click(btn('Retirer 15 secondes')); expect(tm()).toBe(mmss(sec * 1000))
    fakeClock()
    fireEvent.click(btn('Démarrer le chrono')); adv(5000); expect(tm()).toBe(mmss((sec - 5) * 1000))
    expect((btn('Ajouter 15 secondes') as HTMLButtonElement).disabled).toBe(true) // durée verrouillée pendant le chrono
    fireEvent.click(btn('Pause')); adv(10_000); expect(tm()).toBe(mmss((sec - 5) * 1000)); expect(vib).not.toHaveBeenCalled() // la pause fige le temps
    fireEvent.click(btn('Reprendre')); adv((sec - 5) * 1000 + 600)
    expect(tm()).toBe('0:00'); expect(screen.getByText('Temps écoulé : ' + mmss(sec * 1000) + '.')).toBeTruthy(); expect(vib).toHaveBeenCalledWith([200, 100, 200]); expect(btn('Recommencer')).toBeTruthy()
    fireEvent.click(btn('Remettre à zéro')); expect(tm()).toBe(mmss(sec * 1000)); expect(screen.queryByText(/Temps écoulé/)).toBeNull()
  })

  it('auto-écoute : micro demandé au clic seulement, relâché à l’arrêt ; l’enregistrement est jeté en quittant l’exercice, sauf s’il est gardé dans le dictaphone', async () => {
    const mic = micStub()
    await mount('#/13/exo'); await tick(20)
    const open = () => fireEvent.click(within(cards()[0]).getByRole('button', { name: /^Ouvrir/ })), title = cards()[0].getAttribute('aria-label')!.replace('Exercice : ', '')
    open()
    expect(screen.getByText('Microphone')).toBeTruthy(); expect(mic.gum).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'M’enregistrer' })).toBeNull()
    fireEvent.click(btn('J’accepte')); expect(stored().consents.mic).toBe(true); expect(mic.gum).not.toHaveBeenCalled() // l’accord ne démarre pas le micro
    fireEvent.click(btn('M’enregistrer')); await tick(20)
    expect(mic.gum).toHaveBeenCalledTimes(1); expect(screen.getByRole('timer', { name: 'Durée enregistrée' })).toBeTruthy(); expect(screen.queryByText(/Enregistrement en cours/)).toBeNull() // pas de bandeau renvoyant au dictaphone
    fireEvent.click(btn('Arrêter et m’écouter')); await tick(10)
    expect(screen.queryByText(/pas encore sauvegardé/)).toBeNull(); expect(mic.tracks[0].stop).toHaveBeenCalled(); expect(document.querySelector('audio[aria-label="Écouter mon enregistrement"]')).toBeTruthy()
    expect(await idbCount('audios')).toBeLessThanOrEqual(0) // rien n’est gardé sans clic
    fireEvent.click(btn('Jeter l’enregistrement')); expect(document.querySelector('audio')).toBeNull(); expect(await idbCount('audios')).toBeLessThanOrEqual(0)
    // enregistrer à nouveau puis quitter l’exercice sans garder : tout est supprimé
    fireEvent.click(btn('M’enregistrer')); await tick(20); fireEvent.click(btn('Arrêter et m’écouter')); await tick(10)
    fireEvent.click(btn('Fermer')); await tick(10)
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText(/n’est pas encore sauvegardé/)).toBeNull(); expect(await idbCount('audios')).toBeLessThanOrEqual(0)
    open(); expect(document.querySelector('audio')).toBeNull() // rien ne revient à la réouverture
    // enregistrer puis garder : dictaphone, catégorie Apprentissages
    fireEvent.click(btn('M’enregistrer')); await tick(20); fireEvent.click(btn('Arrêter et m’écouter')); await tick(10)
    fireEvent.click(btn('Garder dans le dictaphone')); await tick(60)
    expect(screen.getByText(/Audio gardé dans le dictaphone/)).toBeTruthy(); expect(await idbCount('audios')).toBe(1); expect(await idbCount('audioMeta')).toBe(1); expect(document.querySelector('audio')).toBeNull()
    await go('#/11/audio'); await tick(60)
    const art = screen.getByRole('article', { name: 'Audio Éloquence : ' + title }); expect(within(art).getByText('Apprentissages')).toBeTruthy()
  })

  it('auto-écoute : micro refusé = message clair, l’exercice et le chrono restent utilisables ; quitter pendant l’enregistrement relâche le micro', async () => {
    micStub('NotAllowedError')
    await mount('#/13/exo', s => { s.consents.mic = true }); await tick(20)
    fireEvent.click(within(cards()[0]).getByRole('button', { name: /^Ouvrir/ }))
    fireEvent.click(btn('M’enregistrer')); await tick(20)
    expect(screen.getByText(/Accès au micro refusé/)).toBeTruthy(); expect(btn('Démarrer le chrono')).toBeTruthy(); expect(btn('Marquer comme fait')).toBeTruthy()
    cleanup(); vi.unstubAllGlobals()
    const mic = micStub()
    await mount('#/13/exo', s => { s.consents.mic = true }); await tick(20)
    fireEvent.click(within(cards()[0]).getByRole('button', { name: /^Ouvrir/ })); fireEvent.click(btn('M’enregistrer')); await tick(20)
    expect(btn('Arrêter et m’écouter')).toBeTruthy(); expect(mic.tracks[0].stop).not.toHaveBeenCalled()
    fireEvent.click(btn('Fermer')); await tick(10)
    expect(mic.tracks[0].stop).toHaveBeenCalled(); expect(screen.queryByText(/Enregistrement en cours/)).toBeNull()
  })
})

describe('Rubrique 13 : quiz', () => {
  it('quiz du jour : 5 questions inédites (une par thème) mémorisées dès l’attribution, explication après chaque réponse, score, historique, habitude cochée une fois', async () => {
    await mount('#/13/quiz'); await tick(10)
    expect(stored().quiz.seen).toEqual([]); expect(screen.getByText(/Questions inédites restantes : 136 sur 136/)).toBeTruthy()
    fireEvent.click(btn('Commencer le quiz du jour'))
    const cur = stored().quiz.cur; expect(cur.ids).toHaveLength(5)
    expect(new Set(cur.ids.map((id: string) => BANK.find(q => q.id === id)!.c)).size).toBe(5)
    expect([...stored().quiz.seen].sort()).toEqual([...cur.ids].sort()); expect(stored().quiz.hashes).toHaveLength(5) // vues = attribuées, avant même la première réponse
    expect(screen.getByRole('heading', { name: 'Question 1 sur 5' })).toBeTruthy(); expect(optBtns()).toHaveLength(4)
    expect(screen.queryByText(/Bonne réponse|pas la bonne réponse/)).toBeNull() // pas de correction avant de répondre
    const q1 = answer(true)
    expect(screen.getByText('Bonne réponse.')).toBeTruthy(); expect(screen.getByText(q1.e)).toBeTruthy(); expect(document.activeElement).toBe(btn('Question suivante'))
    const before = JSON.stringify(stored().quiz.cur.ans); fireEvent.click(optBtns()[(view(q1).ok + 1) % 4]); expect(JSON.stringify(stored().quiz.cur.ans)).toBe(before) // la première réponse ne change pas
    fireEvent.click(btn('Question suivante'))
    const q2 = answer(false); expect(screen.getByText('Ce n’est pas la bonne réponse.')).toBeTruthy(); expect(screen.getByText(/La bonne réponse est : [ABCD]\. /).textContent).toContain(q2.o[q2.a]); expect(screen.getByText(q2.e)).toBeTruthy()
    expect(stored().quiz.hist).toEqual([]) // pas d’historique avant la fin
    fireEvent.click(btn('Question suivante')); answer(true); fireEvent.click(btn('Question suivante')); answer(false); fireEvent.click(btn('Question suivante'))
    expect(screen.queryByText(/Habitude «/)).toBeNull(); answer(true)
    expect(screen.getByText(/Quiz terminé et ajouté à l’historique\. Habitude « Apprendre une chose \(mini-carnet\) » cochée pour aujourd’hui\./)).toBeTruthy()
    expect(stored().quiz.hist).toEqual([{ d: TODAY(), n: 5, ok: 3, cats: expect.any(Array) }]); expect(stored().quiz.hist[0].cats).toHaveLength(5); expect(stored().checks[TODAY()]).toContain('h4')
    fireEvent.click(btn('Voir mon score'))
    expect(screen.getByText('3 / 5')).toBeTruthy(); expect(screen.getByText(/60 % de bonnes réponses/)).toBeTruthy()
    for (const id of cur.ids) expect(screen.getByText(BANK.find(q => q.id === id)!.q)).toBeTruthy() // revue des cinq questions
    // un autre quiz : aucune question déjà vue, habitude non recochée
    fireEvent.click(btn('Un autre quiz inédit'))
    const ids2: string[] = stored().quiz.cur.ids; expect(ids2).toHaveLength(5); for (const id of ids2) expect(cur.ids).not.toContain(id)
    expect(new Set(stored().quiz.seen).size).toBe(10)
    for (let i = 0; i < 5; i++) { answer(true); if (i < 4) fireEvent.click(btn('Question suivante')) }
    expect(screen.getByText('Quiz terminé et ajouté à l’historique.')).toBeTruthy(); expect(stored().quiz.hist).toHaveLength(2)
    fireEvent.click(btn('Voir mon score')); fireEvent.click(btn('Retour'))
    expect(screen.getByText(/2 quiz terminés · 8 bonnes réponses sur 10 \(80 %\) · meilleur score : 100 %/)).toBeTruthy(); expect(within(screen.getByRole('list', { name: 'Derniers quiz' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('quitter en cours de route : le quiz reprend à la question suivante, les questions attribuées ne reviennent pas, l’abandon ne compte pas', async () => {
    await mount('#/13/quiz'); fireEvent.click(btn('Commencer le quiz du jour'))
    const first: string[] = stored().quiz.cur.ids
    answer(true); fireEvent.click(btn('Question suivante')); answer(false)
    fireEvent.click(btn('Quitter, reprendre plus tard'))
    expect(screen.getByText(/Un quiz est en cours : 2 réponses sur 5/)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Commencer le quiz du jour' })).toBeNull()
    expect((btn(/^Vocabulaire \(/) as HTMLButtonElement).disabled).toBe(true) // pas de second quiz en parallèle
    cleanup(); await reopen('#/13/quiz'); await tick(10)
    expect(screen.getByRole('heading', { name: 'Question 3 sur 5' })).toBeTruthy()
    fireEvent.click(btn('Abandonner ce quiz')); expect(stored().quiz.cur).not.toBeNull() // une confirmation est demandée
    fireEvent.click(btn('Confirmer l’abandon'))
    expect(stored().quiz.cur).toBeNull(); expect(stored().quiz.hist).toEqual([]); expect(stored().quiz.seen).toHaveLength(5); expect(screen.getByText('Quiz abandonné.')).toBeTruthy()
    fireEvent.click(btn('Commencer le quiz du jour'))
    for (const id of stored().quiz.cur.ids) expect(first).not.toContain(id) // les cinq questions abandonnées ne reviennent pas
  })

  it('quiz par thème : seules les questions inédites du thème, effectifs affichés', async () => {
    await mount('#/13/quiz')
    expect(screen.getByRole('button', { name: 'Biblique (32)' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Vocabulaire (25)' })).toBeTruthy()
    fireEvent.click(btn('Biblique (32)'))
    const ids: string[] = stored().quiz.cur.ids; expect(ids).toHaveLength(5); for (const id of ids) expect(BANK.find(q => q.id === id)!.c).toBe('Biblique')
    fireEvent.click(btn('Quitter, reprendre plus tard'))
    expect(screen.getByText(/Questions inédites restantes : 131 sur 136/)).toBeTruthy()
  })

  it('banque épuisée : plus de quiz inédit ; la révision est hors statistiques, ne consomme rien et ne coche pas l’habitude', async () => {
    await mount('#/13/quiz', s => { s.quiz.seen = BANK.map(q => q.id); s.quiz.hashes = BANK.map(q => qhash(q.q)) })
    expect(screen.getByText('Vous avez vu toutes les questions disponibles.')).toBeTruthy(); expect(screen.queryByRole('button', { name: /Commencer le quiz du jour/ })).toBeNull()
    expect(screen.getByText(new RegExp('Questions inédites restantes : 0 sur ' + BANK.length))).toBeTruthy(); expect((btn(/^Vocabulaire \(0\)/) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(btn('Réviser 5 questions'))
    expect(stored().quiz.cur.rev).toBe(true); expect(screen.getByText('Révision')).toBeTruthy()
    for (let i = 0; i < 5; i++) { answer(true); if (i < 4) fireEvent.click(btn('Question suivante')) }
    expect(screen.getByText('Révision terminée.')).toBeTruthy(); expect(screen.queryByText(/Habitude «/)).toBeNull()
    expect(stored().quiz.hist).toEqual([{ d: TODAY(), n: 5, ok: 5, cats: expect.any(Array), rev: true }]); expect(stored().quiz.seen).toHaveLength(BANK.length); expect(stored().checks[TODAY()] ?? []).not.toContain('h4')
    fireEvent.click(btn('Voir mon score')); expect(screen.getByText(/Cette révision n’est pas comptée dans vos statistiques/)).toBeTruthy()
    fireEvent.click(btn('Retour')); expect(screen.getByText(/Aucun quiz terminé pour le moment\. Révisions : 1 \(non comptées\)/)).toBeTruthy()
  })

  it('dernier quiz inédit terminé : plus de nouveau quiz proposé, orientation vers la révision ou l’IA', async () => {
    await mount('#/13/quiz', s => { const rest = BANK.slice(5); s.quiz.seen = rest.map(q => q.id); s.quiz.hashes = rest.map(q => qhash(q.q)) })
    expect(screen.getByText(/Questions inédites restantes : 5 sur/)).toBeTruthy()
    fireEvent.click(btn('Commencer le quiz du jour')); expect([...stored().quiz.cur.ids].sort()).toEqual(BANK.slice(0, 5).map(q => q.id).sort())
    for (let i = 0; i < 5; i++) { answer(i % 2 === 0); if (i < 4) fireEvent.click(btn('Question suivante')) }
    fireEvent.click(btn('Voir mon score'))
    expect((btn('Un autre quiz inédit') as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText(/Plus aucune question inédite/)).toBeTruthy()
    fireEvent.click(btn('Retour')); expect(screen.getByText('Vous avez vu toutes les questions disponibles.')).toBeTruthy()
    expect(screen.getByText(/Quiz du jour terminé : 3 \/ 5/)).toBeTruthy(); expect(btn('Revoir les réponses du dernier quiz')).toBeTruthy()
    fireEvent.click(btn('Revoir les réponses du dernier quiz')); expect(screen.getByText('3 / 5')).toBeTruthy() // le score reste consultable
  })

  const GOOD = (n: number) => ({ q: 'Quelle figure de style répète un même mot au début de phrases successives, essai ' + n + ' ?', o: ['L’anaphore ' + n, 'L’ellipse ' + n, 'La litote ' + n, 'L’hyperbole ' + n], a: 0, e: 'L’anaphore répète le même mot au début de phrases qui se suivent.' })

  it('questions par IA : texte exact montré, accord puis clic requis, contrôle strict (doublons et formes invalides refusés), questions signalées IA', async () => {
    const reply = [GOOD(1), GOOD(2), { q: BANK[0].q, o: BANK[0].o, a: BANK[0].a, e: BANK[0].e }, { ...GOOD(4), o: ['A', 'B', 'C'] }, { ...GOOD(5), o: ['Même', 'Même', 'Autre', 'Encore'] }, GOOD(3)]
    const f = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: reply, model: 'gemini-test' }) })
    vi.stubGlobal('fetch', f)
    await mount('#/13/quiz', s => { s.profile = { g: 'F', name: 'Ada', age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' } })
    const shown = () => screen.getByLabelText('Texte exact qui sera envoyé').textContent
    expect(shown()).toBe(genRequest('Vocabulaire')); fireEvent.change(screen.getByLabelText('Thème des questions'), { target: { value: 'Biblique' } }); expect(shown()).toBe(genRequest('Biblique'))
    expect(f).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Générer 6 questions' })).toBeNull() // pas d’accord : pas de bouton d’envoi
    fireEvent.click(btn('Donner mon accord pour l’IA')); expect(stored().consents.ai).toBe(true); expect(f).not.toHaveBeenCalled() // l’accord seul n’envoie rien
    fireEvent.click(btn('Générer 6 questions')); await tick(10)
    expect(f).toHaveBeenCalledTimes(1)
    const body = JSON.parse(f.mock.calls[0][1].body); expect(body).toEqual({ mode: 'quiz', messages: [{ role: 'user', content: genRequest('Biblique') }] }); expect(JSON.stringify(body)).not.toContain('Ada')
    expect(screen.getByText(/3 nouvelles questions ajoutées \(thème « Biblique »\), signalées « Généré par IA »\. Vérifiez les réponses importantes\. 2 questions refusées \(forme invalide\)\. 1 doublon écarté\./)).toBeTruthy()
    expect(stored().quiz.gen).toHaveLength(3); expect(stored().quiz.gen.every((g: { id: string; c: string }) => g.id.startsWith('g') && g.c === 'Biblique')).toBe(true)
    expect(screen.getByText(new RegExp('Questions inédites restantes : ' + (BANK.length + 3) + ' sur ' + (BANK.length + 3)))).toBeTruthy()
    // la même réponse rejouée n’ajoute plus rien (doublons)
    fireEvent.click(btn('Générer 6 questions')); await tick(10)
    expect(stored().quiz.gen).toHaveLength(3); expect(screen.getByText(/Aucune question utilisable/)).toBeTruthy()
  })

  it('questions par IA : service indisponible = message simple, rien n’est ajouté', async () => {
    const f = vi.fn().mockResolvedValue({ status: 503, ok: false, json: async () => ({ error: 'not_configured' }) })
    vi.stubGlobal('fetch', f)
    await mount('#/13/quiz', s => { s.consents.ai = true })
    fireEvent.click(btn('Générer 6 questions')); await tick(10)
    expect(screen.getByText(/Believe AI n’est pas disponible pour le moment/)).toBeTruthy(); expect(document.body.textContent).not.toMatch(/GEMINI|README|redéployez/); expect(stored().quiz.gen).toEqual([]); expect(btn('Générer 6 questions')).toBeTruthy() // on peut réessayer
  })

  it('questions générées par IA : servies comme les autres, signalées « Généré par IA » avec rappel de vérifier', async () => {
    const gen = [1, 2, 3].map(n => { const g = GOOD(n); return { id: 'g' + qhash(g.q), c: 'Rhétorique' as const, ...g } })
    await mount('#/13/quiz', s => { s.quiz.seen = BANK.map(q => q.id); s.quiz.hashes = BANK.map(q => qhash(q.q)); s.quiz.gen = gen })
    expect(screen.getByText(/Il ne reste que 3 questions inédites : le quiz sera plus court/)).toBeTruthy()
    fireEvent.click(btn('Commencer le quiz du jour'))
    expect(stored().quiz.cur.ids.sort()).toEqual(gen.map(g => g.id).sort()); expect(screen.getByText('Généré par IA')).toBeTruthy()
    fireEvent.click(optBtns()[0]); expect(screen.getByText('Question générée par IA : vérifiez les réponses importantes.')).toBeTruthy()
  })
})

describe('Rubrique 13 : improvisation', () => {
  it('sujets : note de difficulté sous chaque sujet, jamais deux fois le même, thème jamais repris dans les trois tirages suivants', async () => {
    await mount('#/13/impro')
    expect(screen.queryByRole('region', { name: 'Sujet d’improvisation' })).toBeNull()
    fireEvent.click(btn('Obtenir un sujet'))
    const sub = () => decode(stored().impro.cur)!, themes: string[] = []
    const r = within(screen.getByRole('region', { name: 'Sujet d’improvisation' }))
    expect(r.getByText(sub().text)).toBeTruthy(); expect(r.getByText('Difficulté : ' + sub().diff + ' / 5')).toBeTruthy(); expect(r.getByText(/Pourquoi cette note/)).toBeTruthy(); themes.push(sub().theme)
    expect(screen.getByRole('button', { name: 'Nouveau sujet' })).toBeTruthy()
    for (let i = 0; i < 40; i++) {
      fireEvent.click(btn('Nouveau sujet')); const t = sub().theme
      expect(themes.slice(-3)).not.toContain(t); themes.push(t)
      expect(screen.getByRole('region', { name: 'Sujet d’improvisation' }).textContent).toContain('Difficulté : ' + sub().diff + ' / 5')
    }
    expect(stored().impro.seen).toHaveLength(41); expect(new Set(stored().impro.seen).size).toBe(41) // aucun sujet repris
    expect(stored().impro.hist).toEqual([]) // tirer un sujet n’enregistre aucune improvisation
  })

  it('chrono et historique : durée au choix, enregistrement seulement sur clic, durée réellement chronométrée, conservé après réouverture', async () => {
    await mount('#/13/impro'); fireEvent.click(btn('Obtenir un sujet'))
    const tm = () => screen.getByRole('timer', { name: 'Chrono de l’improvisation' }).textContent, id: string = stored().impro.cur, sub = decode(id)!
    expect(tm()).toBe('2:00'); fireEvent.click(btn('3 min')); expect(tm()).toBe('3:00'); expect(btn('3 min').getAttribute('aria-pressed')).toBe('true')
    fakeClock()
    fireEvent.click(btn('Démarrer le chrono')); adv(20_000); expect(tm()).toBe('2:40'); expect((btn('5 min') as HTMLButtonElement).disabled).toBe(true) // durée verrouillée pendant le chrono
    expect(stored().impro.hist).toEqual([]) // rien d’enregistré tout seul
    fireEvent.click(btn('J’ai terminé cette improvisation'))
    expect(stored().impro.hist).toEqual([{ d: TODAY(), id, diff: sub.diff, sec: 20 }])
    expect(screen.getByText('Improvisation enregistrée dans l’historique : durée 0:20, difficulté ' + sub.diff + ' sur 5.')).toBeTruthy()
    expect((btn('✓ Enregistrée dans l’historique') as HTMLButtonElement).disabled).toBe(true) // pas de double enregistrement
    expect(tm()).toBe('3:00'); expect(screen.getByText(/1 improvisation enregistrée · temps chronométré : 0:20/)).toBeTruthy()
    // un chrono qui va au bout n’enregistre rien non plus
    fireEvent.click(btn('Nouveau sujet')); expect(tm()).toBe('2:00')
    fireEvent.click(btn('Démarrer le chrono')); adv(121_000)
    expect(screen.getByText('Temps écoulé : 2:00.')).toBeTruthy(); expect(stored().impro.hist).toHaveLength(1)
    fireEvent.click(btn('J’ai terminé cette improvisation')); expect(stored().impro.hist[1].sec).toBe(120)
    cleanup(); vi.useRealTimers(); await reopen('#/13/impro')
    expect(stored().impro.hist).toHaveLength(2); expect(screen.getByRole('list', { name: 'Dernières improvisations' }).textContent).toContain(sub.theme)
    expect(screen.getByRole('timer', { name: 'Chrono de l’improvisation' }).textContent).toBe('2:00') // chrono remis à zéro, sujet courant conservé
  })

  it('chrono sans usage : « J’ai terminé » l’indique honnêtement (chrono non utilisé)', async () => {
    await mount('#/13/impro'); fireEvent.click(btn('Obtenir un sujet'))
    fireEvent.click(btn('J’ai terminé cette improvisation'))
    expect(stored().impro.hist[0].sec).toBe(0); expect(screen.getByText(/^Improvisation enregistrée dans l’historique : chrono non utilisé, difficulté \d sur 5\.$/)).toBeTruthy(); expect(screen.getByRole('list', { name: 'Dernières improvisations' }).textContent).toContain('chrono non utilisé')
  })

  it('Conseil Believe AI : texte exact montré, accord puis clic requis, conseil signalé IA, non enregistré, effacé au changement de sujet', async () => {
    const f = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ text: 'Ouvrez par une image, développez en trois temps, concluez court.', model: 'gemini-test' }) })
    vi.stubGlobal('fetch', f)
    await mount('#/13/impro', s => { s.profile = { g: 'F', name: 'Ada', age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' } })
    fireEvent.click(btn('Obtenir un sujet')); const sub = decode(stored().impro.cur)!
    fireEvent.click(btn('Conseil Believe AI'))
    const shown = screen.getByLabelText('Texte exact qui sera envoyé').textContent!
    expect(shown).toBe(adviceRequest(sub)); expect(shown).toContain(sub.text); expect(f).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Envoyer ce sujet à l’IA' })).toBeNull() // pas d’accord : pas de bouton d’envoi
    fireEvent.click(btn('Donner mon accord pour l’IA')); expect(stored().consents.ai).toBe(true); expect(f).not.toHaveBeenCalled()
    fireEvent.click(btn('Envoyer ce sujet à l’IA')); await tick(10)
    expect(f).toHaveBeenCalledTimes(1)
    const body = JSON.parse(f.mock.calls[0][1].body); expect(body).toEqual({ mode: 'eloquence', messages: [{ role: 'user', content: shown }], context: '' }); expect(JSON.stringify(body)).not.toContain('Ada')
    expect(screen.getByText('Généré par IA')).toBeTruthy(); expect(screen.getByText('Ouvrez par une image, développez en trois temps, concluez court.')).toBeTruthy()
    expect(localStorage.getItem(KEY)).not.toContain('Ouvrez par une image') // le conseil n’est pas gardé
    fireEvent.click(btn('Nouveau sujet')); expect(screen.queryByText('Ouvrez par une image, développez en trois temps, concluez court.')).toBeNull()
  })

  it('Conseil Believe AI : service indisponible = message simple et nouvel essai possible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 503, ok: false, json: async () => ({ error: 'not_configured' }) }))
    await mount('#/13/impro', s => { s.consents.ai = true }); fireEvent.click(btn('Obtenir un sujet')); fireEvent.click(btn('Conseil Believe AI')); fireEvent.click(btn('Envoyer ce sujet à l’IA')); await tick(10)
    expect(screen.getByText(/Believe AI n’est pas disponible pour le moment/)).toBeTruthy(); expect(btn('Envoyer ce sujet à l’IA')).toBeTruthy()
  })
})

describe('Rubrique 13 : ensemble', () => {
  it('l’adresse ouvre la bonne section, le balayage passe de l’une à l’autre, la rubrique figure au menu', async () => {
    await mount('#/13/impro')
    expect(btn('Improvisation').getAttribute('aria-pressed')).toBe('true')
    const area = () => document.querySelector('.swipe') as HTMLElement
    const swipe = (dx: number) => { fireEvent.pointerDown(area(), { clientX: 300, clientY: 100, pointerType: 'touch' }); fireEvent.pointerUp(area(), { clientX: 300 + dx, clientY: 104, pointerType: 'touch' }) }
    swipe(200); expect(btn('Quiz').getAttribute('aria-pressed')).toBe('true'); swipe(200); expect(btn('Exercices').getAttribute('aria-pressed')).toBe('true')
    swipe(-200); expect(btn('Quiz').getAttribute('aria-pressed')).toBe('true')
    await go('#/menu'); expect(within(screen.getByRole('main')).getByRole('link', { name: /Académie d’éloquence et quiz/ }).getAttribute('href')).toBe('#/13')
  })

  it('aucune donnée n’est envoyée en parcourant les trois sections, même avec l’accord IA et l’accord micro donnés', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f); micStub()
    await mount('#/13/exo', (s: State) => { s.consents.ai = true; s.consents.mic = true }); await tick(20)
    fireEvent.click(within(cards()[0]).getByRole('button', { name: /^Ouvrir/ })); fireEvent.click(btn('Fermer'))
    fireEvent.click(btn('Quiz')); fireEvent.click(btn('Commencer le quiz du jour')); answer(true); fireEvent.click(btn('Question suivante'))
    fireEvent.click(btn('Improvisation')); fireEvent.click(btn('Obtenir un sujet')); fireEvent.click(btn('Conseil Believe AI')); fireEvent.click(btn('J’ai terminé cette improvisation'))
    expect(f).not.toHaveBeenCalled()
  })
})
