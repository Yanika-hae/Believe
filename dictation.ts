import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Dictée vocale de la rubrique 3 (Believe AI). Elle passe par la reconnaissance vocale du navigateur (API Web Speech) : selon le navigateur (Chrome, Safari), le son est envoyé à Google ou
 * à Apple pour être transcrit. Believe ne reçoit que le texte, ne garde aucun enregistrement et n'envoie rien tout seul : le texte dicté est ajouté au champ de la question, que la personne
 * relit avant d'appuyer sur « Envoyer ». Le micro n'est ouvert que le temps d'une phrase lancée par un clic, et relâché dès que la page est quittée ou masquée.
 */
export interface SpeechResult { isFinal: boolean; length: number; [i: number]: { transcript: string } }
export interface SpeechEvent { resultIndex: number; results: { length: number; [i: number]: SpeechResult } }
export interface SpeechRec {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  onstart: (() => void) | null; onresult: ((e: SpeechEvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
type Ctor = new () => SpeechRec

/** Moteur de reconnaissance vocale du navigateur, ou null s'il n'y en a pas (Firefox, certains navigateurs intégrés). */
export const speechCtor = (): Ctor | null => {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Longueur maximale d'une question (celle du champ de saisie). */
export const MAX_Q = 4000

/**
 * Ajoute le texte dicté à ce qui est déjà écrit : une seule espace entre les deux, majuscule en début de phrase (champ vide ou phrase terminée), espaces superflues retirées.
 * Renvoie null si le résultat dépasserait `max` caractères : rien n'est coupé en silence.
 */
export function addSpoken(base: string, spoken: string, max = MAX_Q): string | null {
  const s = spoken.replace(/\s+/g, ' ').trim()
  if (!s) return base
  const b = base.replace(/\s+$/, '')
  const t = !b || /[.!?…]$/.test(b) ? s.charAt(0).toLocaleUpperCase('fr-FR') + s.slice(1) : s
  const out = b ? b + ' ' + t : t
  return out.length > max ? null : out
}

const ERR: Record<string, string> = {
  'not-allowed': 'Le micro est refusé pour ce site. Autorisez-le dans les réglages du navigateur, puis réessayez.',
  'service-not-allowed': 'La dictée n’est pas autorisée par ce navigateur ou cet appareil (réglages du micro ou de la dictée).',
  'no-speech': 'Aucune voix détectée. Rapprochez-vous du micro et réessayez.',
  'audio-capture': 'Aucun micro n’a été trouvé.',
  network: 'Le service de reconnaissance vocale du navigateur est injoignable (connexion ?). Vous pouvez écrire votre question au clavier.',
  'language-not-supported': 'Le français n’est pas pris en charge par la dictée de ce navigateur.'
}
/** Message clair pour une erreur de la reconnaissance vocale ; un code inconnu donne un message général. */
export const dictErr = (code: string): string => ERR[code] ?? 'La dictée s’est arrêtée de façon inattendue. Vous pouvez écrire votre question au clavier.'
/** Après « Arrêter », le moteur rend normalement la main tout seul ; sinon on le coupe au bout de ce délai. */
export const STOP_MS = 4000

export type DictState = 'idle' | 'starting' | 'listening'

/**
 * Pilote une dictée à la fois. `onText` reçoit chaque phrase reconnue (définitive). `start` doit être appelé depuis un clic (le navigateur demande alors l'accès au micro).
 * `kill` coupe tout de suite le micro et ignore les résultats qui arriveraient après (envoi de la question, changement de page, page masquée).
 */
export function useDictation(onText: (text: string) => void) {
  const [st, setSt] = useState<DictState>('idle'), [interim, setInterim] = useState(''), [err, setErr] = useState<string | null>(null)
  const rec = useRef<SpeechRec | null>(null), cb = useRef(onText), timer = useRef<number | undefined>(undefined)
  cb.current = onText
  const kill = useCallback(() => {
    window.clearTimeout(timer.current)
    const r = rec.current; rec.current = null
    if (r) { r.onstart = r.onresult = r.onerror = r.onend = null; try { r.abort() } catch { /* déjà arrêté */ } }
    setSt('idle'); setInterim('')
  }, [])
  const start = useCallback(() => {
    const C = speechCtor()
    if (!C || rec.current) return
    const r = new C()
    r.lang = 'fr-FR'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1
    rec.current = r; setErr(null); setSt('starting'); setInterim('')
    r.onstart = () => { if (rec.current === r) setSt('listening') }
    r.onresult = e => {
      if (rec.current !== r) return
      let fin = '', tmp = ''
      for (let i = e.resultIndex; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) fin += x[0].transcript + ' '; else tmp += x[0].transcript }
      if (fin.trim()) cb.current(fin)
      setInterim(tmp)
    }
    r.onerror = e => { if (rec.current === r && e.error !== 'aborted') setErr(dictErr(e.error)) }
    r.onend = () => { if (rec.current === r) { window.clearTimeout(timer.current); rec.current = null; setSt('idle'); setInterim('') } }
    try { r.start() } catch { rec.current = null; setSt('idle'); setErr(dictErr('')) }
  }, [])
  const stop = useCallback(() => {
    const r = rec.current
    if (!r) return
    try { r.stop() } catch { /* déjà arrêté */ }
    window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (rec.current === r) kill() }, STOP_MS)
  }, [kill])
  useEffect(() => { // le micro ne reste jamais ouvert quand la page est quittée ou masquée
    const h = () => { if (document.hidden) kill() }
    document.addEventListener('visibilitychange', h)
    return () => { document.removeEventListener('visibilitychange', h); kill() }
  }, [kill])
  return { st, interim, err, setErr, start, stop, kill }
}
