// Compte en ligne : ce que le service garde, départ propre (déconnexion, accord retiré) et suppression du compte.
// Tout ce qui quitte le compte passe ici, pour qu'aucun chemin n'oublie une partie (cartes d'amis, rappels, synchronisation).
import { CloudError, dropSession, getSession, rpc, signOut } from './cloud'
import { stopAuto, stopSync, refreshStatus } from './sync'
import { clearLocal as clearCircles, retractAll, stop as stopCircles } from './circles'
import { clearLocal as clearPush, disable as disablePush, stop as stopPush } from './push'

/** Ce que le service garde pour ce compte (réponse de bl_account_info, vérifiée avant d'être affichée). */
export interface Info { snap: { rev: number; size: number; at: string; dev: string | null } | null; circles: number; owned: number; subs: number; reminders: number; cards: number }
const cnt = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0
function okInfo(o: unknown): o is Info {
  const i = o as Info
  if (!i || typeof i !== 'object' || !cnt(i.circles) || !cnt(i.owned) || !cnt(i.subs) || !cnt(i.reminders) || !cnt(i.cards)) return false
  const s = i.snap
  return s === null || (!!s && typeof s === 'object' && cnt(s.rev) && cnt(s.size) && typeof s.at === 'string' && (s.dev === null || typeof s.dev === 'string'))
}
export async function accountInfo(): Promise<{ ok: true; info: Info } | { ok: false; code: string }> {
  try {
    const j = await rpc<unknown>('bl_account_info')
    return okInfo(j) ? { ok: true, info: j } : { ok: false, code: 'server' }
  } catch (e) { return { ok: false, code: e instanceof CloudError ? e.code : 'server' } }
}

/** Délai maximal accordé aux nettoyages avant la déconnexion (réseau lent : la déconnexion locale ne doit jamais attendre longtemps). */
const LEAVE_MS = 6000
/**
 * Quitte le compte sur cet appareil : arrêt de la synchronisation automatique, retrait de ce que cet appareil avait déposé (cartes d'amis si `cards`, abonnement aux rappels), puis déconnexion.
 * La session locale est effacée dans tous les cas, même hors ligne (le service est prévenu si possible). Les données en ligne restent : voir deleteAccount.
 * `cards` (accord « Compte en ligne » retiré) : le résultat dit si le service a confirmé l'effacement de mes cartes dans les cercles ('failed' tant que ce n'est pas confirmé, y compris au dépassement du délai).
 */
export async function leaveCloud(o: { cards?: boolean } = {}): Promise<{ cards: 'none' | 'removed' | 'failed' }> {
  stopAuto(); stopCircles(); stopPush()
  let cards: 'none' | 'removed' | 'failed' = o.cards ? 'failed' : 'none'
  const push = disablePush().catch(() => 'failed') // le repère local « rappels application fermée » est effacé tout de suite ; le service est prévenu pendant que la session est encore lisible
  if (getSession()) {
    const clean = (async () => {
      if (o.cards) { try { cards = (await retractAll()) > 0 ? 'removed' : 'none' } catch { /* reste « failed » : le retrait est mémorisé et reprendra à la prochaine connexion */ } }
      await push
      await signOut()
    })()
    await Promise.race([clean, new Promise<void>(r => setTimeout(r, LEAVE_MS))])
  } else {
    await Promise.race([push, new Promise<void>(r => setTimeout(r, LEAVE_MS))])
    if (o.cards) {
      cards = 'none' // pas de session : rien n'a pu être déposé depuis cet appareil ; un retrait déjà en attente reste mémorisé
      try { if (JSON.parse(localStorage.getItem('believe:circles') ?? 'null')?.retract === true) cards = 'failed' } catch { /* ignoré */ }
    }
  }
  dropSession() // au cas où le délai a été dépassé : la session locale disparaît quand même
  refreshStatus()
  return { cards }
}

/**
 * Supprime le compte en ligne et tout ce qui s'y rattache (instantané, cercles créés, appartenances et cartes, abonnements et rappels), puis le VÉRIFIE en relisant ce que le service garde.
 * `verified` : le service ne garde plus rien ; sinon la suppression est annoncée mais non confirmée.
 * Les données de cet appareil ne sont pas touchées ; la synchronisation, la clé et la session de cet appareil sont retirées.
 */
export async function deleteAccount(): Promise<{ ok: true; verified: boolean } | { ok: false; code: string }> {
  try { await rpc('bl_account_delete') } catch (e) { return { ok: false, code: e instanceof CloudError ? e.code : 'server' } }
  const after = await accountInfo()
  const verified = after.ok && after.info.snap === null && after.info.circles === 0 && after.info.owned === 0 && after.info.subs === 0 && after.info.reminders === 0 && after.info.cards === 0
  stopAuto(); stopCircles(); clearCircles(); stopSync(true); await clearPush(); dropSession(); refreshStatus() // (abonnement et rappels : déjà effacés par le service, il ne reste qu'à retirer l'abonnement du navigateur)
  return { ok: true, verified }
}
