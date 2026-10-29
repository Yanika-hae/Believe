import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { btn, go, iso, mount, reopen, stored, tick, type } from './testkit'
import { SEND_MAX, SOOTHE } from './Notes'
import { FakeMR, idbCount, micStub, wipeDb } from './testmic'

URL.createObjectURL = vi.fn(() => 'blob:fake'); URL.revokeObjectURL = vi.fn()

const N0 = '2026-10-20T08:00:00.000Z'
const NOTE = { id: 'n1', cat: 'Cauchemars' as const, t: 'Poursuivi', b: 'J’étais poursuivi dans un couloir sans fin.', c: N0, u: N0 }

beforeEach(() => { FakeMR.last = null })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); await tick(20); await wipeDb() })

describe('Rubrique 11 : notes', () => {
  it('créer, valider, cocher l’habitude liée, chercher sans accents, filtrer, modifier, supprimer', async () => {
    await mount('#/11/notes')
    fireEvent.click(btn('Enregistrer la note')); expect(screen.getByText('Écrivez un titre ou un texte avant d’enregistrer.')).toBeTruthy(); expect(stored().notes).toHaveLength(0)
    type('Titre (facultatif)', 'Rêve du fleuve'); type('Votre note', 'J’ai vu un fleuve très calme au lever du jour.'); fireEvent.click(btn('Enregistrer la note'))
    expect(screen.getByText('Note enregistrée.')).toBeTruthy(); expect(stored().notes[0]).toMatchObject({ cat: 'Rêves', t: 'Rêve du fleuve' }); expect(stored().checks[iso(new Date())] ?? []).not.toContain('h4')
    expect((screen.getByLabelText('Votre note') as HTMLTextAreaElement).value).toBe('') // formulaire vidé après l’enregistrement confirmé
    type('Votre note', 'Les anaphores répètent un mot en début de phrase.'); type('Catégorie', 'Apprentissages'); fireEvent.click(btn('Enregistrer la note'))
    expect(screen.getByText(/Habitude « Apprendre une chose \(mini-carnet\) » cochée pour aujourd’hui/)).toBeTruthy(); expect(stored().checks[iso(new Date())]).toContain('h4')
    type('Votre note', 'Deuxième leçon.'); type('Catégorie', 'Apprentissages'); fireEvent.click(btn('Enregistrer la note'))
    expect(screen.getByText('Note enregistrée.')).toBeTruthy(); expect(screen.queryByText(/Habitude «/)).toBeNull() // déjà cochée : pas de nouveau message
    expect(stored().notes).toHaveLength(3)
    // recherche : sans accents, sans casse, tous les mots, surlignage
    type('Rechercher dans mes notes', 'FLEUVE reve'); expect(screen.getByText(/1 note pour « FLEUVE reve »/)).toBeTruthy()
    expect([...document.querySelectorAll('mark')].map(m => m.textContent?.toLowerCase())).toEqual(expect.arrayContaining(['rêve', 'fleuve']))
    type('Rechercher dans mes notes', 'zzz'); expect(screen.getByText('Aucune note ne correspond à cette recherche.')).toBeTruthy()
    type('Rechercher dans mes notes', 'ANAPHORES'); expect(screen.getByText(/1 note pour/)).toBeTruthy(); expect(screen.queryByText('Rêve du fleuve')).toBeNull()
    type('Rechercher dans mes notes', '')
    // filtre par catégorie (puces visibles, avec effectifs)
    fireEvent.click(btn('Apprentissages (2)')); expect(screen.getAllByRole('article')).toHaveLength(2); expect(screen.queryByText('Rêve du fleuve')).toBeNull()
    fireEvent.click(btn('Rêves (1)')); expect(screen.getAllByRole('article')).toHaveLength(1)
    // modification
    fireEvent.click(btn('Modifier la note Rêve du fleuve'))
    const f = within(screen.getByRole('form', { name: 'Modifier la note' })); fireEvent.change(f.getByLabelText('Votre note'), { target: { value: 'Le fleuve était vert.' } }); fireEvent.click(f.getByRole('button', { name: 'Enregistrer les modifications' }))
    expect(screen.getByText('Note modifiée.')).toBeTruthy(); expect(stored().notes.find((n: { t: string }) => n.t === 'Rêve du fleuve').b).toBe('Le fleuve était vert.')
    // suppression avec confirmation
    fireEvent.click(btn('Supprimer la note Rêve du fleuve')); expect(stored().notes).toHaveLength(3); fireEvent.click(btn('Confirmer la suppression de la note Rêve du fleuve'))
    expect(screen.getByText('Note supprimée.')).toBeTruthy(); expect(stored().notes).toHaveLength(2)
  })

  it('les catégories se changent aussi par balayage (puces visibles en plus) ; au bout, le balayage passe à la section suivante', async () => {
    await mount('#/11/notes')
    const area = () => document.querySelectorAll('.swipe')[1] as HTMLElement
    const swipe = (dx: number) => { fireEvent.pointerDown(area(), { clientX: 300, clientY: 100, pointerType: 'touch' }); fireEvent.pointerUp(area(), { clientX: 300 + dx, clientY: 104, pointerType: 'touch' }) }
    const on = () => document.querySelector('[aria-label="Filtrer les notes par catégorie"] .chip[aria-pressed=true]')?.textContent
    expect(on()).toBe('Toutes (0)'); swipe(-200); expect(on()).toBe('Rêves (0)'); swipe(-200); expect(on()).toBe('Cauchemars (0)'); swipe(200); expect(on()).toBe('Rêves (0)')
    swipe(-30); expect(on()).toBe('Rêves (0)') // geste trop court
    for (let i = 0; i < 4; i++) swipe(-200)
    expect(on()).toBe('Apprentissages (0)'); swipe(-200)
    expect(btn('Dictaphone').getAttribute('aria-pressed')).toBe('true') // au bout des catégories, le geste est repris par la section suivante
    fireEvent.click(btn('Notes')); expect(on()).toBe('Toutes (0)') // la puce « Notes » reste disponible sans geste
  })

  it('cauchemar : le texte exact est montré avant l’envoi, rien ne part sans accord ni clic, la réponse est signalée IA et n’est ajoutée qu’à la demande', async () => {
    const f = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ text: 'Respirez doucement. Que la paix vous garde.', model: 'gemini-test' }) })
    vi.stubGlobal('fetch', f)
    await mount('#/11/notes', s => { s.notes = [NOTE]; s.profile = { g: 'F', name: 'Ada', age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' } })
    expect(screen.queryByRole('button', { name: /Apaisement/ })).not.toBeNull()
    fireEvent.click(btn('Apaisement et prière (IA) pour la note Poursuivi'))
    const shown = screen.getByLabelText('Texte exact qui sera envoyé').textContent!
    expect(shown).toBe(SOOTHE + NOTE.b); expect(shown).toContain('N’interprète pas le rêve')
    expect(f).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Envoyer cette note à l’IA' })).toBeNull() // pas d’accord : pas de bouton d’envoi
    fireEvent.click(btn('Donner mon accord pour l’IA')); expect(stored().consents.ai).toBe(true); expect(f).not.toHaveBeenCalled() // l’accord seul n’envoie rien
    fireEvent.click(btn('Envoyer cette note à l’IA')); await tick(10)
    expect(f).toHaveBeenCalledTimes(1)
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(Object.keys(body).sort()).toEqual(['context', 'messages', 'mode']); expect(body).toEqual({ mode: 'spirit', messages: [{ role: 'user', content: shown }], context: '' })
    expect(JSON.stringify(body)).not.toContain('Ada') // ni profil ni autre donnée
    expect(screen.getByText('Généré par IA')).toBeTruthy(); expect(screen.getByText('Respirez doucement. Que la paix vous garde.')).toBeTruthy()
    expect(stored().notes[0].b).toBe(NOTE.b) // rien n’est ajouté sans demande
    fireEvent.click(btn('Ajouter à ma note'))
    expect(stored().notes[0].b).toContain('— Apaisement et prière générés par IA —'); expect(stored().notes[0].b).toContain('Que la paix vous garde.'); expect(screen.getByText(/signalé comme généré par IA/)).toBeTruthy()
  })

  it('cauchemar : annuler n’envoie rien ; erreur serveur expliquée ; note trop longue tronquée à ' + SEND_MAX + ' caractères avec avertissement', async () => {
    const f = vi.fn().mockResolvedValue({ status: 503, ok: false, json: async () => ({ error: 'not_configured' }) })
    vi.stubGlobal('fetch', f)
    await mount('#/11/notes', s => { s.consents.ai = true; s.notes = [NOTE, { ...NOTE, id: 'n2', t: 'Très long', b: 'x'.repeat(SEND_MAX + 500) }] })
    fireEvent.click(btn('Apaisement et prière (IA) pour la note Poursuivi')); fireEvent.click(btn('Annuler')); expect(f).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Texte exact qui sera envoyé')).toBeNull()
    fireEvent.click(btn('Apaisement et prière (IA) pour la note Très long'))
    expect(screen.getByLabelText('Texte exact qui sera envoyé').textContent).toHaveLength(SOOTHE.length + SEND_MAX); expect(screen.getByText(/seuls les 3 000 premiers sont envoyés/)).toBeTruthy()
    fireEvent.click(btn('Envoyer cette note à l’IA')); await tick(10)
    expect(screen.getByText(/Believe AI n’est pas disponible pour le moment/)).toBeTruthy(); expect(screen.getByRole('button', { name: 'Envoyer cette note à l’IA' })).toBeTruthy() // on peut réessayer
    expect(stored().notes[1].b).toHaveLength(SEND_MAX + 500)
  })
})

describe('Rubrique 11 : dictaphone', () => {
  it('accord, enregistrement, sauvegarde IndexedDB, relecture après réouverture, écoute, renommage, suppression vérifiée', async () => {
    const mic = micStub()
    await mount('#/11/audio')
    expect(screen.getByText('Microphone')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull(); expect(mic.gum).not.toHaveBeenCalled()
    fireEvent.click(btn('J’accepte')); expect(stored().consents.mic).toBe(true); expect(mic.gum).not.toHaveBeenCalled() // l’accord ne démarre pas le micro
    fireEvent.click(btn('Enregistrer')); await tick(20)
    expect(mic.gum).toHaveBeenCalledTimes(1); expect(FakeMR.last!.mimeType).toBe('audio/webm;codecs=opus'); expect(btn('Arrêter')).toBeTruthy(); expect(mic.tracks[0].stop).not.toHaveBeenCalled()
    fireEvent.click(btn('Arrêter')); await tick(10)
    expect(screen.getByText(/Enregistrement terminé/)).toBeTruthy(); expect(mic.tracks[0].stop).toHaveBeenCalled() // micro relâché dès l’arrêt
    expect(await idbCount('audios')).toBe(0) // rien n’est sauvegardé avant la confirmation de l’utilisateur
    type('Titre (facultatif)', 'Mon rêve'); type('Catégorie', 'Cauchemars'); fireEvent.click(btn('Sauvegarder sur l’appareil')); await tick(60)
    expect(screen.getByText(/Audio enregistré sur cet appareil/)).toBeTruthy(); expect(await idbCount('audios')).toBe(1); expect(await idbCount('audioMeta')).toBe(1)
    expect(screen.getByRole('article', { name: 'Audio Mon rêve' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Sauvegarder sur l’appareil' })).toBeNull()
    // fermeture puis réouverture de l’application : l’audio est relu depuis IndexedDB
    cleanup(); await reopen('#/11/audio'); await tick(60)
    expect(screen.getByRole('article', { name: 'Audio Mon rêve' })).toBeTruthy(); expect(within(screen.getByRole('article', { name: 'Audio Mon rêve' })).getByText('Cauchemars')).toBeTruthy()
    expect(document.querySelector('audio')).toBeNull() // les données ne sont lues qu’à la demande
    fireEvent.click(btn('Écouter Mon rêve')); await tick(60); expect(document.querySelector('audio[aria-label="Écouter Mon rêve"]')).toBeTruthy()
    fireEvent.click(btn('Renommer Mon rêve')); type('Nouveau titre', 'Rêve du lundi'); fireEvent.click(btn('Valider le titre')); await tick(60)
    expect(screen.getByRole('article', { name: 'Audio Rêve du lundi' })).toBeTruthy()
    fireEvent.click(btn('Supprimer Rêve du lundi')); await tick(5); expect(await idbCount('audios')).toBe(1) // la première pression ne supprime rien
    fireEvent.click(btn('Confirmer la suppression de Rêve du lundi')); await tick(60)
    expect(screen.getByText('Audio supprimé de cet appareil (vérifié).')).toBeTruthy(); expect(await idbCount('audios')).toBe(0); expect(await idbCount('audioMeta')).toBe(0)
    expect(screen.getByText('Aucun enregistrement pour le moment.')).toBeTruthy()
  })

  it('micro refusé : message clair, nouvel essai possible, le reste de l’application continue', async () => {
    micStub('NotAllowedError')
    await mount('#/11/audio', s => { s.consents.mic = true })
    fireEvent.click(btn('Enregistrer')); await tick(20)
    expect(screen.getByText(/Accès au micro refusé/)).toBeTruthy(); expect(btn('Enregistrer')).toBeTruthy()
    fireEvent.click(btn('Notes')); expect(screen.getByLabelText('Votre note')).toBeTruthy()
    await go('#/6'); expect(screen.getByRole('heading', { name: 'Habitudes' })).toBeTruthy()
  })

  it('l’enregistrement continue hors de la page (bandeau) ; retirer l’accord micro l’arrête et relâche le micro', async () => {
    const mic = micStub()
    await mount('#/11/audio', s => { s.consents.mic = true })
    fireEvent.click(btn('Enregistrer')); await tick(20)
    await go('#/4'); expect(screen.getByText(/Enregistrement en cours/)).toBeTruthy(); expect(mic.tracks[0].stop).not.toHaveBeenCalled()
    await go('#/2/confidentialite'); fireEvent.click(btn('Retirer Microphone')); expect(stored().consents.mic).toBe(true) // confirmation demandée d’abord
    fireEvent.click(btn(/^Confirmer le retrait/)); expect(stored().consents.mic).toBe(false); expect(mic.tracks[0].stop).toHaveBeenCalled()
    await go('#/4'); expect(screen.queryByText(/Enregistrement en cours/)).toBeNull()
    await go('#/11/audio'); expect(screen.getByText('Microphone')).toBeTruthy() // la fonction redemande l’accord
  })

  it('stockage indisponible : l’enregistrement n’est pas déclaré sauvegardé et reste disponible', async () => {
    micStub()
    await mount('#/11/audio', s => { s.consents.mic = true })
    fireEvent.click(btn('Enregistrer')); await tick(20); fireEvent.click(btn('Arrêter')); await tick(10)
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    fireEvent.click(btn('Sauvegarder sur l’appareil')); await tick(60)
    expect(screen.getByText(/Audio non enregistré/)).toBeTruthy(); expect(screen.queryByText(/Audio enregistré sur cet appareil/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sauvegarder sur l’appareil' })).toBeTruthy(); expect(screen.getByRole('link', { name: 'Télécharger une copie' })).toBeTruthy()
    put.mockRestore()
  })
})

describe('Rubrique 11 : prompteur et métronome', () => {
  /** jsdom ne calcule pas les hauteurs : on les simule pour que le défilement ait de la place. */
  function layout(inner: number, stage: number) {
    const oh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'), ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('tele-in') ? inner : 0 } })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('tele') ? stage : 0 } })
    return () => { if (oh) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', oh); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight; if (ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight }
  }
  const shift = () => { const m = /translate3d\(0(?:px)?,\s*(-?[\d.]+)px/.exec((document.querySelector('.tele-in') as HTMLElement).style.transform); return m ? -parseFloat(m[1]) : 0 }

  it('prompteur : texte et réglages conservés (même en quittant la page tout de suite), défilement avancé puis arrêté en pause', async () => {
    const restore = layout(4000, 400)
    try {
      await mount('#/11/prompteur')
      type('Texte à lire', 'Bonjour à tous. '.repeat(30)); fireEvent.change(screen.getByLabelText(/^Vitesse/), { target: { value: '120' } })
      await tick(700); expect(stored().prompter).toMatchObject({ speed: 120 }); expect(stored().prompter.text).toHaveLength(480)
      fireEvent.change(screen.getByLabelText(/^Taille du texte/), { target: { value: '60' } }); await go('#/4') // quitter avant la fin du délai
      expect(stored().prompter.size).toBe(60)
      await go('#/11/prompteur'); expect((screen.getByLabelText('Texte à lire') as HTMLTextAreaElement).value).toHaveLength(480); expect((screen.getByLabelText(/^Vitesse/) as HTMLInputElement).value).toBe('120')
      fireEvent.click(btn('Démarrer')); await tick(500)
      expect(btn('Pause')).toBeTruthy(); const a = shift(); expect(a).toBeGreaterThan(5); expect(a).toBeLessThan(120)
      fireEvent.click(btn('Pause')); const b = shift(); await tick(250); expect(shift()).toBe(b)
      fireEvent.click(btn('Reprendre')); await tick(250); expect(shift()).toBeGreaterThan(b); fireEvent.click(btn('Pause'))
      fireEvent.click(btn('Revenir au début')); expect(shift()).toBeCloseTo(0)
    } finally { restore() }
  })

  it('prompteur : fin du texte signalée, relecture possible ; plein écran avec Échap ; charger une note avec confirmation', async () => {
    const restore = layout(420, 400) // 20 px à parcourir : 0,5 s à 40 px/s
    try {
      await mount('#/11/prompteur', s => { s.notes = [{ ...NOTE, id: 'c1', cat: 'Chants', t: 'Chant du matin', b: 'Gloire à Dieu au plus haut des cieux.' }] })
      type('Texte à lire', 'Court texte.'); fireEvent.click(btn('Démarrer')); await tick(900)
      expect(screen.getByText('Fin du texte.')).toBeTruthy(); expect(btn('Relire depuis le début')).toBeTruthy()
      fireEvent.click(btn('Plein écran')); expect(document.querySelector('.telewrap.full')).toBeTruthy(); expect(screen.queryByLabelText('Texte à lire')).toBeNull(); expect(btn('Quitter le plein écran').getAttribute('aria-pressed')).toBe('true')
      fireEvent.keyDown(document, { key: 'Escape' }); expect(document.querySelector('.telewrap.full')).toBeNull()
      fireEvent.change(screen.getByLabelText('Charger une de mes notes'), { target: { value: 'c1' } })
      expect(screen.getByText(/Remplacer le texte actuel par « Chant du matin »/)).toBeTruthy(); expect((screen.getByLabelText('Texte à lire') as HTMLTextAreaElement).value).toBe('Court texte.')
      fireEvent.click(btn('Remplacer')); expect((screen.getByLabelText('Texte à lire') as HTMLTextAreaElement).value).toBe('Gloire à Dieu au plus haut des cieux.')
    } finally { restore() }
  })

  function audioStub() {
    const made: { frequency: { value: number } }[] = []
    class AC {
      get currentTime() { return performance.now() / 1000 }
      destination = {}; resume = async () => {}; close = vi.fn(async () => {})
      createOscillator() { const o = { frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; made.push(o); return o }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } }
    }
    vi.stubGlobal('AudioContext', AC)
    return made
  }

  it('métronome : démarre avec le premier temps accentué, frappe du tempo, réglages conservés, s’arrête quand l’écran est quitté', async () => {
    const osc = audioStub()
    await mount('#/11/metronome', s => { s.prompter.bpm = 240 })
    expect(btn('Démarrer').getAttribute('aria-pressed')).toBe('false'); expect(osc).toHaveLength(0) // aucun son avant le clic
    fireEvent.click(btn('Démarrer')); await tick(120)
    expect(btn('Arrêter').getAttribute('aria-pressed')).toBe('true'); expect(osc.length).toBeGreaterThan(0); expect(osc[0].frequency.value).toBe(1320) // premier temps aigu
    expect(document.querySelectorAll('.bdots i')).toHaveLength(4); expect(document.querySelector('.bdots i.acc.on')).toBeTruthy()
    let t = 0; vi.spyOn(Date, 'now').mockImplementation(() => t)
    for (const x of [0, 500, 1000]) { t = x; fireEvent.click(btn('Frapper le tempo')) }
    vi.mocked(Date.now).mockRestore(); expect(screen.getByText('120')).toBeTruthy(); expect(screen.getByText(/Allegro/)).toBeTruthy()
    fireEvent.click(btn('3 temps')); expect(btn('3 temps').getAttribute('aria-pressed')).toBe('true'); expect(document.querySelectorAll('.bdots i')).toHaveLength(3)
    fireEvent.click(btn('Augmenter le tempo de 1')); expect(screen.getByText('121')).toBeTruthy()
    await tick(700); expect(stored().prompter).toMatchObject({ bpm: 121, beats: 3 })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))
    await tick(10); delete (document as unknown as Record<string, unknown>).hidden
    expect(screen.getByText(/Métronome arrêté/)).toBeTruthy(); expect(btn('Démarrer')).toBeTruthy()
  })

  it('métronome : sons désactivés = aucun clic, avertissement et réactivation en un geste ; audio absent = message clair', async () => {
    const osc = audioStub()
    await mount('#/11/metronome', s => { s.settings.sounds = false })
    expect(screen.getByText(/Les sons sont désactivés/)).toBeTruthy()
    fireEvent.click(btn('Démarrer')); await tick(150); expect(osc).toHaveLength(0); expect(document.querySelector('.bdots i.on')).toBeTruthy() // rythme visuel seul
    fireEvent.click(btn('Arrêter')); fireEvent.click(btn('Activer les sons')); expect(stored().settings.sounds).toBe(true); expect(screen.queryByText(/Les sons sont désactivés/)).toBeNull()
    vi.stubGlobal('AudioContext', undefined); fireEvent.click(btn('Démarrer')); expect(screen.getByText(/le métronome ne peut pas démarrer/)).toBeTruthy()
  })

  it('actions rapides : « Nouvelle note » et « Enregistrer un audio » mènent aux bons onglets', async () => {
    await mount('#/4')
    fireEvent.click(btn('Actions rapides')); expect(screen.getByRole('link', { name: /Nouvelle note/ }).getAttribute('href')).toBe('#/11/notes'); expect(screen.getByRole('link', { name: /Enregistrer un audio/ }).getAttribute('href')).toBe('#/11/audio')
    await go('#/11/audio'); expect(btn('Dictaphone').getAttribute('aria-pressed')).toBe('true')
    await go('#/11/notes'); expect(btn('Notes').getAttribute('aria-pressed')).toBe('true')
    await go('#/menu'); expect(within(screen.getByRole('main')).getByRole('link', { name: /Notes, dictaphone, prompteur/ }).getAttribute('href')).toBe('#/11')
  })
})
