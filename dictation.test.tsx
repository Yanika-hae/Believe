import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { btn, go, mount, reopen, stored, tick } from './testkit'
import { MAX_Q, STOP_MS, addSpoken, dictErr } from './dictation'

/**
 * Rubrique 3 : dictée vocale du chat Believe AI. Le vrai moteur de reconnaissance du navigateur n'existe pas ici : un faux moteur reproduit son interface (démarrer, arrêter, interrompre,
 * événements de début, de résultat, d'erreur et de fin) pour vérifier ce que Believe en fait.
 */
type Part = [text: string, final: boolean]
class FakeRec {
  static all: FakeRec[] = []
  static failStart = false
  lang = ''; continuous = true; interimResults = false; maxAlternatives = 0
  onstart: (() => void) | null = null; onresult: ((e: unknown) => void) | null = null; onerror: ((e: { error: string }) => void) | null = null; onend: (() => void) | null = null
  started = 0; stopped = 0; aborted = 0
  constructor() { FakeRec.all.push(this) }
  start() { this.started++; if (FakeRec.failStart) throw new Error('InvalidStateError') }
  stop() { this.stopped++ }
  abort() { this.aborted++ }
  begin() { act(() => { this.onstart?.() }) }
  say(parts: Part[], from = 0) { act(() => { this.onresult?.({ resultIndex: from, results: Object.assign(parts.map(([t, f]) => ({ isFinal: f, length: 1, 0: { transcript: t } })), {}) }) }) }
  fail(error: string) { act(() => { this.onerror?.({ error }) }) }
  finish() { act(() => { this.onend?.() }) }
}
const engine = (on: boolean) => {
  if (on) Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, writable: true, value: FakeRec })
  else delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
}
const field = () => screen.getByLabelText('Votre question') as HTMLTextAreaElement
const last = () => FakeRec.all[FakeRec.all.length - 1]
/** Textes des zones annoncées (la page en a plusieurs : message d'enregistrement de l'accord, état de la dictée…). */
const said = () => screen.getAllByRole('status').map(e => e.textContent)
const withAI = (speech = false) => (s: { consents: { ai: boolean; speech: boolean } }) => { s.consents.ai = true; s.consents.speech = speech }
const askOk = () => vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ text: 'Voici un plan simple.', model: 'gemini-test' }) })

beforeEach(() => { FakeRec.all = []; FakeRec.failStart = false; engine(true) })
afterEach(() => { cleanup(); engine(false); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Texte dicté ajouté à la question (calcul pur)', () => {
  it('une espace entre l’existant et le dicté, majuscule en début de phrase seulement, espaces superflues retirées', () => {
    expect(addSpoken('', 'bonjour tout le monde')).toBe('Bonjour tout le monde')
    expect(addSpoken('Bonjour', 'je cherche un plan')).toBe('Bonjour je cherche un plan')
    expect(addSpoken('Bonjour.', 'je cherche un plan')).toBe('Bonjour. Je cherche un plan')
    expect(addSpoken('Vraiment ?', 'oui')).toBe('Vraiment ? Oui')
    expect(addSpoken('Fin…', 'suite')).toBe('Fin… Suite')
    expect(addSpoken('Bonjour   \n', '  deux   mots \n')).toBe('Bonjour deux mots')
    expect(addSpoken('éa', 'écoute')).toBe('éa écoute'); expect(addSpoken('', 'écoute')).toBe('Écoute')
  })
  it('un texte vide ne change rien ; un résultat trop long est refusé au lieu d’être coupé', () => {
    expect(MAX_Q).toBe(4000) // la limite de la fonction serveur (api/ai.ts) et du champ de saisie
    expect(addSpoken('abc', '   ')).toBe('abc'); expect(addSpoken('', '')).toBe('')
    expect(addSpoken('a'.repeat(MAX_Q - 5), 'bcd')).toBe('a'.repeat(MAX_Q - 5) + ' bcd')
    expect(addSpoken('a'.repeat(MAX_Q - 3), 'bcd')).toBeNull(); expect(addSpoken('', 'x'.repeat(MAX_Q + 1))).toBeNull(); expect(addSpoken('', 'x'.repeat(MAX_Q))).toBe('X' + 'x'.repeat(MAX_Q - 1))
    expect(addSpoken('a'.repeat(50), 'bcd', 54)).toBe('a'.repeat(50) + ' bcd'); expect(addSpoken('a'.repeat(50), 'bcde', 54)).toBeNull()
  })
  it('chaque code d’erreur connu a son message ; un code inconnu donne un message général', () => {
    const codes = ['not-allowed', 'service-not-allowed', 'no-speech', 'audio-capture', 'network', 'language-not-supported']
    const msgs = codes.map(dictErr); expect(new Set(msgs).size).toBe(codes.length); expect(msgs.every(m => m.length > 20)).toBe(true)
    expect(dictErr('quelque-chose')).toContain('inattendue'); expect(dictErr('')).toBe(dictErr('autre'))
  })
})

describe('Rubrique 3 : dictée vocale du chat Believe AI', () => {
  it('navigateur sans reconnaissance vocale : pas de bouton « Dicter », la raison est écrite, le chat reste utilisable', async () => {
    engine(false); await mount('#/3', withAI())
    expect(screen.queryByRole('button', { name: 'Dicter' })).toBeNull(); expect(screen.getByText(/La dictée vocale n’est pas disponible dans ce navigateur/)).toBeTruthy()
    fireEvent.change(field(), { target: { value: 'Bonjour' } }); expect((btn('Envoyer') as HTMLButtonElement).disabled).toBe(false)
  })

  it('le moteur préfixé (webkit) comme le moteur standard sont reconnus', async () => {
    engine(false); Object.defineProperty(window, 'SpeechRecognition', { configurable: true, writable: true, value: FakeRec })
    try { await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); expect(FakeRec.all).toHaveLength(1) } finally { delete (window as unknown as Record<string, unknown>).SpeechRecognition }
  })

  it('sans accord : « Dicter » explique où part le son (Google ou Apple selon le navigateur) et ne démarre rien ; « Plus tard » ferme sans donner l’accord', async () => {
    await mount('#/3', withAI())
    fireEvent.click(btn('Dicter'))
    const card = screen.getByRole('group', { name: 'Dictée vocale' })
    expect(card.textContent).toContain('Google'); expect(card.textContent).toContain('Apple'); expect(card.textContent).toContain('ne garde aucun enregistrement'); expect(card.textContent).toContain('rien n’est envoyé à l’IA tant que vous n’appuyez pas sur « Envoyer »')
    expect(FakeRec.all).toHaveLength(0); expect(stored().consents.speech).toBe(false)
    fireEvent.click(btn('Plus tard')); expect(screen.queryByRole('group', { name: 'Dictée vocale' })).toBeNull(); expect(FakeRec.all).toHaveLength(0); expect(stored().consents.speech).toBe(false)
  })

  it('l’accord « micro » du dictaphone ne vaut pas accord pour la dictée (le son n’y reste pas sur l’appareil)', async () => {
    await mount('#/3', s => { s.consents.ai = true; s.consents.mic = true })
    fireEvent.click(btn('Dicter')); expect(screen.getByRole('group', { name: 'Dictée vocale' })).toBeTruthy(); expect(FakeRec.all).toHaveLength(0)
  })

  it('« J’accepte et je dicte » enregistre l’accord et lance l’écoute en français : une phrase à la fois, résultats provisoires', async () => {
    await mount('#/3', withAI())
    fireEvent.click(btn('Dicter')); fireEvent.click(btn('J’accepte et je dicte'))
    expect(stored().consents.speech).toBe(true); expect(screen.queryByRole('group', { name: 'Dictée vocale' })).toBeNull()
    expect(FakeRec.all).toHaveLength(1); const r = last()
    expect([r.lang, r.continuous, r.interimResults, r.maxAlternatives, r.started]).toEqual(['fr-FR', false, true, 1, 1])
    expect(said()).toContain('Préparation du micro…'); expect(btn('Arrêter la dictée')).toBeTruthy()
    r.begin(); expect(said()).toContain('Dictée en cours : parlez, puis faites une pause.')
  })

  it('texte reconnu : le provisoire s’affiche à part, le définitif est ajouté au champ (majuscule, espaces), rien n’est envoyé ; une seconde dictée complète le texte', async () => {
    const f = askOk(); vi.stubGlobal('fetch', f); await mount('#/3', withAI(true))
    fireEvent.click(btn('Dicter')); const r = last(); r.begin()
    r.say([['bonjour je cherche', false]]); expect(screen.getByText('bonjour je cherche')).toBeTruthy(); expect(field().value).toBe('')
    r.say([['bonjour je cherche un plan', true]]); expect(field().value).toBe('Bonjour je cherche un plan'); expect(screen.queryByText('bonjour je cherche')).toBeNull()
    r.finish(); expect(btn('Dicter')).toBeTruthy(); expect(said()).toContain('Texte dicté ajouté à votre question.')
    fireEvent.click(btn('Dicter')); expect(FakeRec.all).toHaveLength(2); expect(said()).toContain('Préparation du micro…'); expect(screen.queryByRole('group', { name: 'Dictée vocale' })).toBeNull()
    const r2 = last(); r2.begin(); r2.say([['pour dimanche', true]]); expect(field().value).toBe('Bonjour je cherche un plan pour dimanche'); r2.finish()
    fireEvent.change(field(), { target: { value: 'Bonjour.' } }); fireEvent.click(btn('Dicter')); last().say([['merci', true]]); expect(field().value).toBe('Bonjour. Merci')
    expect(f).not.toHaveBeenCalled()
  })

  it('seulement du texte provisoire puis la fin du moteur : rien n’est ajouté, et rien n’est annoncé comme ajouté', async () => {
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin(); r.say([['bonjour peut-être', false]]); r.finish()
    expect(field().value).toBe(''); expect(btn('Dicter')).toBeTruthy(); expect(said().join('|')).not.toContain('Texte dicté ajouté'); expect(screen.queryByText('bonjour peut-être')).toBeNull()
  })

  it('plusieurs morceaux dans un même résultat : les définitifs sont réunis, le provisoire reste à part', async () => {
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin()
    r.say([['je voudrais', true], ['manger', true], ['plus léger', false]]); expect(field().value).toBe('Je voudrais manger'); expect(screen.getByText('plus léger')).toBeTruthy()
  })

  it('résultats cumulés : seuls les morceaux nouveaux (à partir de « resultIndex ») sont ajoutés, jamais ceux déjà pris en compte', async () => {
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin()
    r.say([['bonjour', true], ['tout le monde', false]]); expect(field().value).toBe('Bonjour'); expect(screen.getByText('tout le monde')).toBeTruthy()
    r.say([['bonjour', true], ['tout le monde', true]], 1); expect(field().value).toBe('Bonjour tout le monde')
  })

  it('le texte dicté ne part qu’avec « Envoyer » : l’écoute en cours est alors coupée, une phrase tardive du moteur est ignorée', async () => {
    const f = askOk(); vi.stubGlobal('fetch', f); await mount('#/3', withAI(true))
    fireEvent.click(btn('Dicter')); const r = last(); r.begin(); r.say([['quel plan pour dimanche', true]]); expect(f).not.toHaveBeenCalled()
    fireEvent.click(btn('Envoyer')); await tick(10)
    expect(f).toHaveBeenCalledTimes(1); expect(JSON.parse(f.mock.calls[0][1].body).messages).toEqual([{ role: 'user', content: 'Quel plan pour dimanche' }])
    expect(r.aborted).toBe(1); expect(field().value).toBe(''); r.say([['phrase tardive', true]]); expect(field().value).toBe('')
    expect(btn('Dicter')).toBeTruthy(); expect(screen.getByText('Voici un plan simple.')).toBeTruthy()
  })

  it('après l’envoi, ni « Texte dicté ajouté… » ni une ancienne erreur de dictée ne restent affichés', async () => {
    vi.stubGlobal('fetch', askOk()); await mount('#/3', withAI(true))
    fireEvent.click(btn('Dicter')); const r = last(); r.begin(); r.say([['bonjour', true]]); r.fail('no-speech'); r.finish()
    expect(said().join('|')).toContain('Texte dicté ajouté'); expect(screen.getByRole('alert').textContent).toContain('Aucune voix détectée')
    fireEvent.click(btn('Envoyer')); await tick(10)
    expect(screen.getByText('Voici un plan simple.')).toBeTruthy(); expect(said().join('|')).not.toContain('Texte dicté ajouté'); expect(screen.queryByRole('alert')).toBeNull()
  })

  it('après l’envoi, le message « question trop longue » de la dictée ne reste pas affiché', async () => {
    vi.stubGlobal('fetch', askOk()); await mount('#/3', withAI(true)); fireEvent.change(field(), { target: { value: 'a'.repeat(MAX_Q - 3) } })
    fireEvent.click(btn('Dicter')); const r = last(); r.begin(); r.say([['bonjour', true]]); expect(screen.getByRole('alert').textContent).toContain('trop longue')
    fireEvent.click(btn('Envoyer')); await tick(10); expect(screen.queryByText(/trop longue/)).toBeNull()
  })

  it('« Arrêter la dictée » demande l’arrêt au moteur sans rien jeter : le dernier résultat rendu après l’arrêt est gardé', async () => {
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin(); r.say([['bonjour', false]])
    fireEvent.click(btn('Arrêter la dictée')); expect([r.stopped, r.aborted]).toEqual([1, 0]); expect(btn('Arrêter la dictée')).toBeTruthy()
    r.say([['bonjour à tous', true]]); r.finish(); expect(field().value).toBe('Bonjour à tous'); expect(btn('Dicter')).toBeTruthy()
  })

  it('moteur muet après l’arrêt : il est coupé au bout de 4 secondes, le bouton redevient « Dicter »', async () => {
    const spy = vi.spyOn(window, 'setTimeout'); await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin()
    fireEvent.click(btn('Arrêter la dictée')); const t = spy.mock.calls.find(c => c[1] === STOP_MS); expect(t, 'aucun délai de sécurité').toBeTruthy()
    expect(STOP_MS).toBe(4000); expect(r.aborted).toBe(0); act(() => { (t![0] as () => void)() }); expect(r.aborted).toBe(1); expect(btn('Dicter')).toBeTruthy()
  })

  it('fin normale du moteur après « Arrêter » : l’ancien délai de sécurité ne coupe pas la dictée suivante', async () => {
    const spy = vi.spyOn(window, 'setTimeout'); await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin()
    fireEvent.click(btn('Arrêter la dictée')); const t = spy.mock.calls.find(c => c[1] === STOP_MS)!; r.finish(); expect(btn('Dicter')).toBeTruthy()
    fireEvent.click(btn('Dicter')); const r2 = last(); r2.begin(); act(() => { (t[0] as () => void)() }); expect(r2.aborted).toBe(0); expect(btn('Arrêter la dictée')).toBeTruthy()
  })

  it.each([
    ['not-allowed', /Le micro est refusé pour ce site/],
    ['service-not-allowed', /n’est pas autorisée par ce navigateur/],
    ['no-speech', /Aucune voix détectée/],
    ['audio-capture', /Aucun micro n’a été trouvé/],
    ['network', /injoignable/],
    ['language-not-supported', /Le français n’est pas pris en charge/],
    ['bad-grammar', /s’est arrêtée de façon inattendue/]
  ])('erreur « %s » : message clair annoncé, le micro est libéré, le clavier reste possible', async (code, rx) => {
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin(); r.fail(code); r.finish()
    expect(screen.getByRole('alert').textContent).toMatch(rx); expect(btn('Dicter')).toBeTruthy(); expect(field().disabled).toBe(false)
    fireEvent.click(btn('Dicter')); expect(screen.queryByRole('alert')).toBeNull() // un nouvel essai efface l’ancien message
  })

  it('« aborted » (arrêt voulu) n’affiche aucune erreur', async () => {
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin(); r.fail('aborted'); r.finish(); expect(screen.queryByRole('alert')).toBeNull(); expect(btn('Dicter')).toBeTruthy()
  })

  it('démarrage refusé par le moteur (exception) : message général, retour à « Dicter »', async () => {
    FakeRec.failStart = true; await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter'))
    expect(screen.getByRole('alert').textContent).toContain('inattendue'); expect(btn('Dicter')).toBeTruthy(); FakeRec.failStart = false
    fireEvent.click(btn('Dicter')); expect(screen.queryByRole('alert')).toBeNull(); expect(btn('Arrêter la dictée')).toBeTruthy()
  })

  it('on ne lance pas deux écoutes à la fois', async () => {
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); fireEvent.click(btn('Arrêter la dictée')); expect(FakeRec.all).toHaveLength(1)
  })

  it('quitter la page ou la masquer libère le micro tout de suite', async () => {
    const r1 = await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const a = last(); a.begin(); r1.unmount(); expect(a.aborted).toBe(1)
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const b = last(); b.begin()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    try { act(() => { document.dispatchEvent(new Event('visibilitychange')) }); expect(b.aborted).toBe(1); expect(btn('Dicter')).toBeTruthy(); b.say([['tardif', true]]); expect(field().value).toBe('') } finally { delete (document as unknown as Record<string, unknown>).hidden }
  })

  it('« Nouvelle conversation » coupe aussi l’écoute', async () => {
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin(); fireEvent.click(btn('Nouvelle conversation')); expect(r.aborted).toBe(1); expect(btn('Dicter')).toBeTruthy()
  })

  it('une question qui dépasserait 4000 caractères : la phrase dictée n’est pas ajoutée, un message le dit, rien n’est coupé en silence', async () => {
    await mount('#/3', withAI(true)); fireEvent.change(field(), { target: { value: 'a'.repeat(MAX_Q - 3) } })
    fireEvent.click(btn('Dicter')); const r = last(); r.begin(); r.say([['bonjour', true]])
    expect(field().value).toBe('a'.repeat(MAX_Q - 3)); expect(screen.getByRole('alert').textContent).toContain('trop longue'); expect(screen.getByRole('alert').textContent).toContain(String(MAX_Q))
    fireEvent.change(field(), { target: { value: 'ok' } }); fireEvent.click(btn('Arrêter la dictée')); r.finish(); fireEvent.click(btn('Dicter')); expect(screen.queryByText(/trop longue/)).toBeNull()
  })

  it('le texte provisoire n’est pas annoncé aux lecteurs d’écran à chaque mot (zone non annoncée), l’état de la dictée l’est (zone « status »)', async () => {
    await mount('#/3', withAI(true)); fireEvent.click(btn('Dicter')); const r = last(); r.begin(); r.say([['mots provisoires', false]])
    const prov = screen.getByText('mots provisoires'); expect(prov.getAttribute('aria-live')).toBe('off'); expect(said().join('|')).not.toContain('mots provisoires')
  })

  it('accord retiré dans la rubrique 5 : la dictée redemande l’accord ; l’accord figure dans la liste avec son explication', async () => {
    await mount('#/3', s => { withAI(true)(s); s.consents.mic = true }); await go('#/2/confidentialite')
    expect(screen.getByText(/le son est envoyé à Google ou à Apple pour être transcrit/)).toBeTruthy()
    fireEvent.click(btn('Retirer Dictée vocale')); expect(stored().consents.speech).toBe(false); expect(stored().consents.mic).toBe(true) // le micro du dictaphone est un autre accord
    await go('#/3'); fireEvent.click(btn('Dicter')); expect(screen.getByRole('group', { name: 'Dictée vocale' })).toBeTruthy(); expect(FakeRec.all).toHaveLength(0)
  })

  it('anciennes données sans l’accord « dictée » : valeur par défaut « non » (rien n’est supposé accepté)', async () => {
    await mount('#/3', s => { s.consents.ai = true; delete (s.consents as unknown as Record<string, unknown>).speech })
    fireEvent.click(btn('Dicter')); expect(screen.getByRole('group', { name: 'Dictée vocale' })).toBeTruthy(); expect(FakeRec.all).toHaveLength(0)
    fireEvent.click(btn('J’accepte et je dicte')); expect(stored().consents.speech).toBe(true); expect(FakeRec.all).toHaveLength(1)
  })

  it('la politique de confidentialité nomme la dictée, dit où part le son et que rien n’est conservé ni envoyé à l’IA sans « Envoyer »', async () => {
    await mount('#/legal')
    const row = screen.getByText(/^Dictée vocale de vos questions à Believe AI/).closest('tr')!
    expect(row.cells[1].textContent).toContain('Believe ne garde aucun son'); expect(row.cells[1].textContent).toContain('ne part vers l’IA que si vous appuyez sur « Envoyer »')
    expect(row.cells[2].textContent).toMatch(/^Oui, par le navigateur et non par Believe/); expect(row.cells[2].textContent).toContain('à Google (Chrome) ou à Apple (Safari)'); expect(row.cells[2].textContent).toContain('Believe ne reçoit que le texte')
    const t = document.body.textContent ?? ''
    expect(t).toContain('pour l’IA, les photos, la dictée vocale et le compte en ligne, sans votre accord préalable'); expect(t).toContain('reconnaissance vocale de Chrome si vous dictez'); expect(t).toContain('reconnaissance vocale de Safari si vous dictez')
  })

  it('l’accord est conservé à la réouverture de l’application : plus de question, l’écoute démarre directement', async () => {
    const r = await mount('#/3', withAI()); fireEvent.click(btn('Dicter')); fireEvent.click(btn('J’accepte et je dicte')); expect(stored().consents.speech).toBe(true)
    r.unmount(); FakeRec.all = []; await reopen('#/3')
    expect(stored().consents.speech).toBe(true); fireEvent.click(btn('Dicter')); expect(screen.queryByRole('group', { name: 'Dictée vocale' })).toBeNull(); expect(FakeRec.all).toHaveLength(1)
  })

  it('le bouton change de libellé sans état « appuyé » : les deux ensemble seraient annoncés de façon contradictoire', async () => {
    await mount('#/3', withAI(true)); expect(btn('Dicter').hasAttribute('aria-pressed')).toBe(false)
    fireEvent.click(btn('Dicter')); expect(btn('Arrêter la dictée').hasAttribute('aria-pressed')).toBe(false); expect(screen.queryByRole('button', { name: 'Dicter' })).toBeNull()
  })

  it('le clavier ne perd pas sa place : le focus va sur le titre de la carte d’accord à son ouverture, puis revient sur le bouton de dictée quand elle se ferme', async () => {
    await mount('#/3', withAI())
    fireEvent.click(btn('Dicter')); expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Dictée vocale' }))
    fireEvent.click(btn('Plus tard')); expect(document.activeElement).toBe(btn('Dicter'))
    fireEvent.click(btn('Dicter')); expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Dictée vocale' }))
    fireEvent.click(btn('J’accepte et je dicte')); expect(document.activeElement).toBe(btn('Arrêter la dictée'))
  })

  it('carte d’accord ouverte : le focus n’est pas repris par le titre à chaque frappe dans le champ', async () => {
    await mount('#/3', withAI()); fireEvent.click(btn('Dicter')); const t = field(); t.focus()
    fireEvent.change(t, { target: { value: 'abc' } }); expect(document.activeElement).toBe(t); fireEvent.change(t, { target: { value: 'abcd' } }); expect(document.activeElement).toBe(t)
  })

  it('le focus n’est pas déplacé en dehors de la carte d’accord : ni au clic sur « Dicter » avec accord, ni quand du texte est ajouté', async () => {
    await mount('#/3', withAI(true)); const t = field(); t.focus()
    fireEvent.click(btn('Dicter')); expect(document.activeElement).toBe(t); last().begin(); last().say([['bonjour', true]]); last().finish(); expect(document.activeElement).toBe(t)
  })
})
