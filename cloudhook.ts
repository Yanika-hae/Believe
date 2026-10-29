// Passerelle légère entre l'application et le compte en ligne.
// Le code du compte (chiffrement, réseau, synchronisation) n'est chargé que si le compte sert : tant qu'aucune synchronisation n'est activée,
// l'application ne télécharge ni n'exécute rien de tout cela et ne fait aucun appel réseau.
const META = 'believe:sync', AUTH = 'believe:auth', KEY = 'believe:synckey', BAK = 'believe:syncbak', PENDING = 'believe:auth-pending', CIRC = 'believe:circles', INVITE = 'believe:invite', PUSH = 'believe:push'

/** Vrai si la synchronisation a été activée sur cet appareil (simple indice : sync.ts revérifie tout avant d'agir). */
export function syncOn(): boolean {
  try { const r = localStorage.getItem(META); return !!r && (JSON.parse(r) as { on?: unknown }).on === true } catch { return false }
}
/** Vrai s'il reste quelque chose du compte en ligne sur cet appareil (session, repères de synchronisation, clé, copie de sécurité, connexion en cours, cartes partagées, rappels application fermée). */
export function cloudUsed(): boolean {
  try { return [META, AUTH, KEY, BAK, PENDING, CIRC, PUSH].some(k => localStorage.getItem(k) !== null) } catch { return false }
}
/** Vrai si l'adresse de la page ressemble à un retour de connexion Google (code ou erreur) : seul cas où le module de connexion est chargé au démarrage. */
export const looksLikeBack = (): boolean => { try { return /[?&#](code|error|error_code)=/.test(location.search + location.hash) } catch { return false } }

type SyncMod = typeof import('./sync')
let mod: Promise<SyncMod> | null = null
const sync = (): Promise<SyncMod> => (mod ??= import('./sync').catch(e => { mod = null; throw e }))

/** À appeler après chaque enregistrement local confirmé : planifie (après un délai de calme) l'envoi des changements, si la synchronisation est activée. */
export function touchSync(): void {
  if (!syncOn()) return
  void sync().then(m => m.touch(), () => undefined)
}
/** Démarre les déclencheurs automatiques (retour au premier plan, réseau retrouvé, relevé toutes les 5 minutes) et un premier tour. Sans effet si la synchronisation n'est pas activée. */
export function startSync(): void {
  if (!syncOn()) return
  void sync().then(m => { m.startAuto() }, () => undefined)
}
/** Arrête les déclencheurs automatiques (verrouillage, suppression des données). */
export function stopSyncAuto(): void {
  if (mod) void mod.then(m => m.stopAuto(), () => undefined)
}
/** Efface de la mémoire de la page toute session non enregistrée (à appeler au verrouillage quand les données sont chiffrées). */
export function forgetSession(): void {
  if (!cloudUsed()) return
  void import('./cloud').then(m => m.forgetMemory(), () => undefined)
}
// ---------------------------------------------------------------- cercles d'amis : mise à jour de ma carte et retrait
/** Vrai si cet appareil sait qu'une carte est partagée dans un cercle, ou qu'un retrait de cartes attend sa confirmation (simple indice : circles.ts revérifie tout). */
export function circOn(): boolean {
  try { const o = JSON.parse(localStorage.getItem(CIRC) ?? 'null') as { on?: unknown; retract?: unknown } | null; return !!o && (o.on === true || o.retract === true) } catch { return false }
}
type CircMod = typeof import('./circles')
let cmod: Promise<CircMod> | null = null
const circles = (): Promise<CircMod> => (cmod ??= import('./circles').catch(e => { cmod = null; throw e }))
/** À appeler après chaque enregistrement local confirmé : met ma carte à jour dans les cercles où je la partage (après un délai de calme). Sans effet si je n'en partage nulle part. */
export function touchCircles(): void {
  if (!circOn()) return
  void circles().then(m => m.touch(), () => undefined)
}
/** Démarre les déclencheurs (retour au premier plan, réseau retrouvé) et un premier tour. Sans effet si je ne partage nulle part et qu'aucun retrait n'attend. */
export function startCircles(): void {
  if (!circOn()) return
  void circles().then(m => { m.start() }, () => undefined)
}
export function stopCircles(): void {
  if (cmod) void cmod.then(m => m.stop(), () => undefined)
}
// ---------------------------------------------------------------- rappels application fermée : programmation et arrêt
/** Vrai si les rappels application fermée sont activés sur cet appareil (simple indice : push.ts revérifie tout avant d'agir). */
export function pushOn(): boolean {
  try { const r = localStorage.getItem(PUSH); return !!r && (JSON.parse(r) as { on?: unknown }).on === true } catch { return false }
}
type PushMod = typeof import('./push')
let pmod: Promise<PushMod> | null = null
const pushm = (): Promise<PushMod> => (pmod ??= import('./push').catch(e => { pmod = null; throw e }))
/** À appeler après chaque enregistrement local confirmé : reprogramme les rappels à venir (après un court délai de calme). Sans effet si les rappels application fermée ne sont pas activés. */
export function touchPush(): void {
  if (!pushOn()) return
  void pushm().then(m => m.touch(), () => undefined)
}
/** Démarre les déclencheurs (retour au premier plan, réseau retrouvé, données remplacées) et une première programmation. Sans effet si les rappels application fermée ne sont pas activés. */
export function startPush(): void {
  if (!pushOn()) return
  void pushm().then(m => { m.start() }, () => undefined)
}
/** Arrête les déclencheurs (verrouillage, suppression des données). */
export function stopPush(): void {
  if (pmod) void pmod.then(m => m.stop(), () => undefined)
}
/** Désactive les rappels application fermée de cet appareil (accord retiré, déconnexion) : 'none' (rien n'était activé), 'removed' (le service a confirmé), 'failed' (non confirmé). */
export async function disablePush(): Promise<'none' | 'removed' | 'failed'> {
  if (!pushOn()) return 'none'
  try { return await (await pushm()).disable() } catch { return 'failed' }
}

/** Vrai si une invitation reçue par lien attend dans la mémoire de l'onglet. */
export function hasInvite(): boolean { try { return sessionStorage.getItem(INVITE) !== null } catch { return false } }
/** Efface le code d'une invitation reçue par lien, gardé dans la mémoire de l'onglet (verrouillage, suppression des données). */
export function forgetInvite(): void { try { sessionStorage.removeItem(INVITE) } catch { /* ignoré */ } }

/** Sort d'un retrait de mes cartes : 'none' (rien à retirer ou rien d'atteignable), 'removed' (le service a confirmé), 'failed' (non confirmé : le retrait reprendra à la prochaine ouverture avec connexion). */
export type Cards = 'none' | 'removed' | 'failed'
/** Retire mes cartes de tous mes cercles (accord « Partage » retiré). */
export async function retractCards(): Promise<Cards> {
  let signed = false
  try { signed = localStorage.getItem(AUTH) !== null } catch { /* ignoré */ }
  if (!signed && !circOn()) return 'none'
  try { return (await (await circles()).retractAll()) > 0 ? 'removed' : 'none' } catch { return 'failed' }
}
/**
 * Quitte le compte sur cet appareil (déconnexion, retrait de ce que l'appareil avait déposé). Résolu une fois fait, au plus tard après un court délai.
 * `cards` : retire d'abord mes cartes des cercles (accord « Compte en ligne » retiré) ; le résultat dit si le service l'a confirmé.
 */
export async function leave(cards = false): Promise<Cards> {
  if (!cloudUsed()) return 'none'
  try { return (await (await import('./account')).leaveCloud({ cards })).cards } catch { return cards ? 'failed' : 'none' /* la session locale est effacée par le module appelé */ }
}
