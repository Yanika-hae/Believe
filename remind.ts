import type { Task } from './cal'

/**
 * Rappels de tâches (rubrique 9). Ici, tout se passe sur l'appareil, sans serveur : un rappel n'est donné que pendant que Believe est ouvert
 * (premier plan, ou onglet / fenêtre en arrière-plan tant que le navigateur ne l'a pas suspendu). Application fermée : soit les rappels envoyés par le service (Web Push chiffré, facultatif :
 * src/push.ts, qui programme les mêmes échéances avec ces mêmes calculs), soit l'export .ics (rappel 30 minutes avant) géré par l'agenda de la personne.
 * Calculs purs : l'heure est passée en argument.
 */
export const LEADS = [0, 10, 30, 60, 120] as const
export type Lead = (typeof LEADS)[number]
export const LEAD_LABEL: Record<Lead, string> = { 0: 'À l’heure de l’échéance', 10: '10 minutes avant', 30: '30 minutes avant', 60: '1 heure avant', 120: '2 heures avant' }
/** Un rappel reste valable jusqu'à 12 h après l'échéance : au-delà, la tâche est simplement en retard et rien n'est rappelé (pas de rafale en rouvrant l'application après plusieurs jours). */
export const GRACE_MS = 12 * 3600e3
/** Intervalle de vérification pendant que l'application est ouverte. */
export const CHECK_MS = 30_000

const dueMs = (t: Task) => (t.due ? Date.parse(t.due) : NaN)
/** Moment du rappel d'une tâche (ms), ou NaN sans échéance valide. */
export const remindAt = (t: Task, lead: number) => dueMs(t) - lead * 60_000
/**
 * Tâches à rappeler maintenant : non terminées, échéance valide, moment du rappel atteint, échéance pas dépassée de plus de 12 h, rappel pas déjà donné pour cette échéance.
 * Triées par échéance.
 */
export const dueReminders = (tasks: Task[], now: number, lead: number): Task[] =>
  tasks.filter(t => { const d = dueMs(t); return !t.done && t.r !== t.due && !isNaN(d) && now >= d - lead * 60_000 && now <= d + GRACE_MS }).sort((a, b) => dueMs(a) - dueMs(b))
/** Une tâche créée alors que son moment de rappel est déjà passé ne sonne pas aussitôt : la personne la regarde au moment même. */
export const startsReminded = (due: string | null, now: number, lead: number) => { const d = due ? Date.parse(due) : NaN; return !isNaN(d) && now >= d - lead * 60_000 }

const clock = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const dayN = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5)
/** « aujourd’hui à 14:30 », « demain à 09:00 », « hier à 09:00 » ou « le 25 octobre à 09:00 » (jours calendaires de l'appareil). */
export function when(at: string | number, now: number): string {
  const d = new Date(at), k = dayN(d) - dayN(new Date(now))
  const day = k === 0 ? 'aujourd’hui' : k === 1 ? 'demain' : k === -1 ? 'hier' : 'le ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  return day + ' à ' + clock(d)
}

export type Perm = 'granted' | 'denied' | 'default' | 'unsupported'
/** Autorisation des notifications du système donnée dans le navigateur (jamais demandée ici : voir `askPermission`). */
export const permission = (): Perm => (typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as Perm))
/** Demande l'autorisation au navigateur ; à appeler uniquement depuis un geste de la personne (clic). */
export async function askPermission(): Promise<Perm> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try { return (await Notification.requestPermission()) as Perm } catch { return permission() }
}
/**
 * Affiche une notification du système ; renvoie true seulement si le navigateur l'a acceptée. Par le service worker quand il existe (obligatoire sur Android), sinon directement.
 * Le clic sur la notification ouvre la rubrique 9 (voir public/sw-notify.js).
 */
export async function notify(title: string, body: string, tag: string): Promise<boolean> {
  if (permission() !== 'granted') return false
  const opt: NotificationOptions = { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', lang: 'fr', data: { url: '/#/9' } }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg && typeof reg.showNotification === 'function') { await reg.showNotification(title, opt); return true }
  } catch { /* repli ci-dessous */ }
  try { new Notification(title, opt); return true } catch { return false }
}
