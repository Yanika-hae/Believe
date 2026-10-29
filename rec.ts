import { useEffect, useState } from 'react'
import { lockScreen, unlockScreen } from './wake'

// Enregistreur audio partagé, hors de React : l'enregistrement continue si l'on change de rubrique, et le micro est
// toujours relâché à l'arrêt. Le micro n'est demandé qu'au moment où l'on appuie sur « Enregistrer ».
export type RecSt = 'idle' | 'ask' | 'rec' | 'done'
export interface Rec { st: RecSt; ms: number; err: string; url: string; blob: Blob | null; type: string; owner: string }
/** Durée maximale d'un enregistrement (10 minutes) : au-delà, l'arrêt est automatique et ce qui est capté est conservé. */
export const MAX_MS = 10 * 60_000
export const rec: Rec = { st: 'idle', ms: 0, err: '', url: '', blob: null, type: '', owner: '' }

let stream: MediaStream | null = null, mr: MediaRecorder | null = null, chunks: Blob[] = [], t0 = 0, tick = 0, cap = MAX_MS, gen = 0, held = false
const subs = new Set<() => void>()
const bump = () => subs.forEach(f => f())
export function useRec() {
  const [, setN] = useState(0)
  useEffect(() => { const f = () => setN(n => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  return rec
}

export const recSupported = () => typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus']
/** Premier format d'enregistrement pris en charge par le navigateur (Chrome : webm, Safari : mp4), ou '' pour laisser le navigateur choisir. */
export const pickType = () => TYPES.find(t => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } }) ?? ''
/** Extension de fichier correspondant au format enregistré. */
export const extOf = (type: string) => (/mp4|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm')

/** Message clair selon la cause du refus ou de l'échec d'accès au micro. */
export const micError = (e: unknown) => {
  const n = (e as { name?: string } | null)?.name
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'Accès au micro refusé. Autorisez le micro dans les réglages du navigateur pour enregistrer ; le reste de l’application fonctionne normalement.'
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'Aucun micro détecté sur cet appareil.'
  if (n === 'NotReadableError' || n === 'AbortError') return 'Le micro est utilisé par une autre application. Fermez-la puis réessayez.'
  return 'Le micro n’a pas pu être démarré.'
}

const release = () => {
  clearInterval(tick); tick = 0
  if (held) { held = false; unlockScreen() }
  stream?.getTracks().forEach(t => { t.onended = null; try { t.stop() } catch { /* déjà arrêtée */ } })
  stream = null
}
const clearBlob = () => { if (rec.url) { try { URL.revokeObjectURL(rec.url) } catch { /* ignoré */ } } rec.url = ''; rec.blob = null }

/** Termine l'enregistrement (appelé une seule fois, à l'arrêt du MediaRecorder) : assemble les morceaux et conserve le résultat tant qu'il n'est pas sauvegardé ou jeté. */
const finish = () => {
  if (rec.st !== 'rec') return
  const ms = Math.min(Date.now() - t0, cap), type = mr?.mimeType || rec.type || 'audio/webm'
  release()
  const blob = new Blob(chunks, { type }); chunks = []; mr = null
  if (blob.size === 0) { rec.st = 'idle'; rec.owner = ''; rec.err = rec.err || 'Aucun son n’a été capté.'; bump(); return }
  rec.ms = ms; rec.blob = blob; rec.type = type; rec.url = URL.createObjectURL(blob); rec.st = 'done'; bump()
}

/** Demande le micro (c'est là que le navigateur affiche sa demande d'autorisation) puis démarre. Renvoie true si l'enregistrement a démarré. */
export async function startRec(owner: string, max = MAX_MS): Promise<boolean> {
  if (rec.st === 'rec' || rec.st === 'ask') return false
  if (!recSupported()) { rec.err = 'Enregistrement audio non disponible sur ce navigateur.'; bump(); return false }
  clearBlob(); rec.err = ''; rec.ms = 0; rec.owner = owner; rec.st = 'ask'
  const my = ++gen
  bump()
  let s: MediaStream
  try { s = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch (e) {
    if (my === gen) { rec.st = 'idle'; rec.owner = ''; rec.err = micError(e); bump() }
    return false
  }
  if (my !== gen) { s.getTracks().forEach(t => t.stop()); return false } // annulé pendant la demande d'autorisation
  stream = s; chunks = []; cap = max
  const type = pickType()
  try { mr = new MediaRecorder(s, type ? { mimeType: type } : undefined) } catch {
    release(); rec.st = 'idle'; rec.owner = ''; rec.err = 'Format d’enregistrement non pris en charge par ce navigateur.'; bump(); return false
  }
  rec.type = type
  mr.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data) }
  mr.onerror = () => { rec.err = 'Erreur du micro pendant l’enregistrement. Ce qui a été capté est conservé.'; stopRec() }
  mr.onstop = finish
  s.getAudioTracks().forEach(t => { t.onended = () => { rec.err = 'Le micro a été interrompu (appel, autre application…). Ce qui a été capté est conservé.'; stopRec() } })
  try { mr.start(1000) } catch { release(); mr = null; rec.st = 'idle'; rec.owner = ''; rec.err = 'Le micro n’a pas pu être démarré.'; bump(); return false }
  t0 = Date.now(); rec.st = 'rec'; held = true; lockScreen() // l'écran reste allumé : un écran éteint coupe souvent le micro d'une page web
  tick = window.setInterval(() => { rec.ms = Date.now() - t0; if (rec.ms >= cap) stopRec(); bump() }, 250)
  bump()
  return true
}
/** Arrête l'enregistrement et conserve le résultat (état « done »). */
export function stopRec() {
  if (rec.st !== 'rec') return
  try { if (mr && mr.state !== 'inactive') mr.stop(); else finish() } catch { finish() }
}
/** Abandonne tout : arrête le micro, oublie les données captées et libère la mémoire. */
export function discardRec() {
  gen++
  if (mr) { mr.ondataavailable = null; mr.onstop = null; mr.onerror = null; try { if (mr.state !== 'inactive') mr.stop() } catch { /* déjà arrêté */ } }
  release(); mr = null; chunks = []; clearBlob()
  rec.st = 'idle'; rec.ms = 0; rec.err = ''; rec.owner = ''; rec.type = ''
  bump()
}
