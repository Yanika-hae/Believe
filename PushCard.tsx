// Rubrique 9 › « Rappels application fermée » (compte en ligne FACULTATIF) : l'accord est demandé ici, au moment de l'usage ; rien n'est déposé sur le service avant le clic sur « Activer ».
// Chargé à la demande depuis src/Reminders.tsx : tant que cette carte n'est pas affichée, aucun code du compte en ligne n'est chargé et aucun appel réseau n'est fait.
import { useEffect, useRef, useState } from 'react'
import { askPermission, permission, when } from './remind'
import type { Perm } from './remind'
import { getConfig, signedIn } from './cloud'
import * as K from './push'
import { Dialog } from './ui'
import type { Msg, P } from './ui'

/** Phrase affichée pour chaque raison d'empêchement ou d'échec. */
export const WHY: Record<K.Why, string> = {
  unsupported: 'Ce navigateur ne permet pas les rappels application fermée.',
  'ios-install': 'Sur iPhone et iPad, ces rappels ne fonctionnent que si Believe est ajouté à l’écran d’accueil (Partager, puis « Sur l’écran d’accueil »), puis ouvert depuis son icône.',
  'consent-notif': 'L’accord « Notifications » n’est pas donné : activez d’abord les rappels, ci-dessus.',
  'consent-cloud': 'L’accord « Compte en ligne » n’est pas donné : donnez-le et connectez-vous (Paramètres, onglet Compte).',
  permission: 'Les notifications du système ne sont pas autorisées dans le navigateur (réglages du site pour les autoriser).',
  signin: 'Vous n’êtes pas (ou plus) connecté au compte en ligne : connectez-vous (Paramètres, onglet Compte).',
  config: 'Les rappels application fermée ne sont pas disponibles pour le moment.',
  vapid: 'Les rappels application fermée ne sont pas disponibles pour le moment.',
  schema: 'Les rappels application fermée sont momentanément indisponibles : réessayez plus tard.',
  worker: 'Les notifications ne sont pas prêtes dans ce navigateur : rechargez Believe (ou ouvrez l’application installée), puis réessayez.',
  subscribe: 'Le navigateur a refusé l’abonnement aux notifications.',
  offline: 'Hors ligne : réessayez au retour du réseau.',
  server: 'Le service ne répond pas correctement : réessayez plus tard.',
  locked: 'Application verrouillée : saisissez votre PIN.',
  data: 'Vos données locales n’ont pas pu être relues : rien n’a été programmé.',
  off: 'Les rappels application fermée ne sont pas activés sur cet appareil.'
}
/** Le planificateur du serveur doit passer chaque minute : au-delà de 5 minutes sans passage, les rappels ne partent plus. */
const STALE_MS = 5 * 60_000
const n = (k: number, one: string, many: string) => k + ' ' + (k > 1 ? many : one)

export default function PushCard({ S }: Pick<P, 'S'>) {
  const [, bump] = useState(0), [perm, setPerm] = useState<Perm>(permission())
  const [st, setSt] = useState<K.Status | null>(null), [sub, setSub] = useState<boolean | null>(null), [cfg, setCfg] = useState<'?' | 'ok' | 'config' | 'vapid'>('?')
  const [ask, setAsk] = useState(false), [wantTitle, setWantTitle] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState<Msg>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const on = K.isOn(), sup = K.support(), signed = signedIn()
  const ready = S.consents.notif && S.consents.cloud && signed
  /** Relit ce que le service garde pour ce compte et l'état de l'abonnement du navigateur. */
  const refresh = async () => {
    if (!K.isOn()) { setSt(null); setSub(null); return }
    const [a, b] = await Promise.all([K.status(), K.subscribed()])
    if (alive.current) { setSt(a); setSub(b) }
  }
  useEffect(() => { void refresh() }, [on, S.consents.notif, S.consents.cloud])
  useEffect(() => { // le service doit être configuré (clés d'envoi comprises) : vérifié seulement si la personne est connectée
    if (!ready) { setCfg('?'); return }
    void getConfig().then(c => { if (alive.current) setCfg(!c.ok ? 'config' : c.cfg.vapid ? 'ok' : 'vapid') })
  }, [ready])
  useEffect(() => { // l'autorisation peut changer dans les réglages du navigateur pendant que la page reste ouverte
    const f = () => setPerm(permission())
    addEventListener('focus', f); document.addEventListener('visibilitychange', f)
    return () => { removeEventListener('focus', f); document.removeEventListener('visibilitychange', f) }
  }, [])

  const fail = (why: K.Why) => setMsg({ e: 1, t: WHY[why] })
  const activate = async () => {
    if (busy) return
    setBusy(true)
    const p = permission() === 'default' ? await askPermission() : permission() // la demande au navigateur part du clic, avant toute autre attente
    setPerm(p)
    const r = await K.enable(wantTitle)
    if (!alive.current) return
    setBusy(false); setAsk(false); bump(x => x + 1)
    if (r.ok) setMsg({ t: 'Rappels application fermée activés sur cet appareil. ' + (r.armed ? n(r.armed, 'rappel est programmé', 'rappels sont programmés') + ' sur le service.' : 'Aucun rappel à programmer pour l’instant : les prochains le seront automatiquement.') })
    else if (K.isOn()) setMsg({ e: 1, t: 'Activé sur cet appareil, mais la programmation n’a pas pu être envoyée. ' + WHY[r.why] + ' Elle sera refaite automatiquement.' })
    else fail(r.why)
    void refresh()
  }
  const off = async () => {
    setBusy(true)
    const o = await K.disable()
    if (!alive.current) return
    setBusy(false); bump(x => x + 1)
    setMsg(o === 'failed' ? { e: 1, t: 'Rappels application fermée désactivés sur cet appareil. Le service n’a pas confirmé la suppression de ce que cet appareil y avait déposé (hors ligne ou déconnecté) : plus rien ne sera affiché ici, et le service supprimera de lui-même les rappels en attente.' } : { t: 'Rappels application fermée désactivés. L’abonnement et les rappels déposés ont été supprimés du service.' })
    void refresh()
  }
  const test = async () => {
    setBusy(true)
    const r = await K.sendTest()
    if (!alive.current) return
    setBusy(false)
    if (r.ok && r.when) setMsg({ t: 'Notification de test programmée pour ' + when(r.when, Date.now()).replace(/^aujourd’hui à /, '') + ' environ. Fermez Believe (ou verrouillez le téléphone) : elle doit arriver dans la minute qui suit l’heure indiquée. Si elle n’arrive pas, vérifiez que les notifications sont autorisées pour Believe dans les réglages de votre téléphone.' })
    else fail(r.ok ? 'server' : r.why)
    void refresh()
  }
  const again = async () => {
    setBusy(true)
    const r = await K.arm(true)
    if (!alive.current) return
    setBusy(false)
    setMsg(r.ok ? { t: r.armed ? n(r.armed, 'rappel programmé', 'rappels programmés') + ' sur le service.' : 'Aucun rappel à programmer pour l’instant.' } : { e: 1, t: WHY[r.why] })
    void refresh()
  }
  const title = async (v: boolean) => {
    const run = K.setTitle(v); bump(x => x + 1) // le réglage est écrit tout de suite : la case montre le nouveau choix pendant l'envoi au service, sans revenir en arrière
    const r = await run
    if (!alive.current) return
    bump(x => x + 1)
    setMsg(r.ok ? { t: v ? 'Le titre des tâches figurera dans les notifications (sauf en mode discret).' : 'Les notifications ne montreront plus le titre des tâches.' } : { e: 1, t: 'Réglage enregistré sur cet appareil, mais la programmation n’a pas pu être envoyée. ' + WHY[r.why] })
  }

  const now = Date.now(), tick = st?.ok ? st.tick : null, age = st?.ok && tick !== null ? now + st.skew - tick : null
  const rows: [boolean, string][] = [
    [S.consents.notif, 'Rappels activés (carte ci-dessus).'],
    [S.consents.cloud && signed, 'Connecté au compte en ligne (accord « Compte en ligne » donné, Paramètres, onglet Compte).'],
    [sup === 'ok', sup === 'ios-install' ? 'Sur iPhone et iPad : Believe doit être ajouté à l’écran d’accueil, puis ouvert depuis son icône.' : sup === 'unsupported' ? 'Navigateur compatible : non (pas de notifications application fermée ici).' : 'Navigateur compatible.']
  ]
  return (
    <div className="card"><h2>Rappels application fermée</h2>
      <p>Pour être prévenu même quand Believe est fermé, votre appareil peut déposer ses prochains rappels sur le compte en ligne, <b>chiffrés sur l’appareil</b>. À l’heure dite, le service les transmet au système de notification de votre navigateur (Google, Apple, Mozilla ou Microsoft). Ni le service ni ce système ne peuvent lire le message : le service connaît seulement l’heure de chaque rappel. Facultatif, désactivable à tout moment.</p>
      {!on && <ul className="mut" aria-label="Ce qu’il faut avant d’activer">
        {rows.map(([ok, t]) => <li key={t}>{ok ? 'Fait' : 'À faire'} : {t}</li>)}
        <li>{perm === 'granted' ? 'Fait' : perm === 'denied' ? 'Bloqué' : 'À faire'} : notifications du système {perm === 'granted' ? 'autorisées.' : perm === 'denied' ? 'refusées dans le navigateur (réglages du site).' : perm === 'unsupported' ? 'indisponibles ici.' : 'autorisées (la demande sera faite à l’activation).'}</li>
        {ready && cfg !== '?' && <li>{cfg === 'ok' ? 'Fait : service disponible.' : WHY[cfg]}</li>}
      </ul>}
      {msg && <p className={msg.e ? 'ko' : 'ok'} role="status">{msg.t}</p>}
      {!on
        ? <div className="row"><button className="btn" disabled={busy || !ready || sup !== 'ok' || perm === 'denied' || perm === 'unsupported' || cfg === 'config' || cfg === 'vapid'} onClick={() => { setWantTitle(false); setAsk(true) }}>Activer sur cet appareil</button></div>
        : <>
          <p>Activé sur cet appareil.{sub === false && <> <b className="ko">L’abonnement du navigateur a disparu</b> : il sera recréé à la prochaine ouverture, ou utilisez « Reprogrammer maintenant ».</>}</p>
          {perm !== 'granted' && <p className="ko">Les notifications du système ne sont plus autorisées dans le navigateur : aucun rappel ne peut arriver tant qu’elles ne le sont pas.</p>}
          {st?.ok && <p className="mut">Appareils abonnés : {st.subs}. Rappels en attente : {st.pending}.</p>}
          {st?.ok && (tick === null || (age !== null && age > STALE_MS)) && <p className="ko">Le service d’envoi des rappels ne répond pas pour le moment : les rappels application fermée ne partiront pas tant qu’il ne fonctionne pas. Les rappels dans l’application restent actifs.</p>}
          {st?.ok && Math.abs(st.skew) > 120_000 && <p className="ko">L’heure de cet appareil diffère de plus de 2 minutes de celle du service : les rappels partiraient trop tôt ou trop tard. Réglez l’heure de l’appareil sur « automatique ».</p>}
          {st && !st.ok && <p className="ko">État du service indisponible : {WHY[st.why]}</p>}
          <label className="rd"><input type="checkbox" checked={K.titleOn()} disabled={busy} onChange={e => void title(e.target.checked)} /> Afficher le titre de la tâche dans la notification</label>
          <p className="mut">{S.discret ? 'Le mode discret est actif : le titre n’est jamais affiché.' : 'Sinon la notification dit seulement « Une tâche arrive à échéance ». Le titre est visible sur l’écran verrouillé du téléphone.'}</p>
          <div className="row">
            <button className="btn alt" disabled={busy} onClick={test}>Envoyer une notification de test</button>
            <button className="btn alt" disabled={busy} onClick={again}>Reprogrammer maintenant</button>
            <button className="btn alt" disabled={busy} onClick={off}>Désactiver sur cet appareil</button>
          </div>
        </>}
      <p className="mut">Astuce : un téléphone en économie d’énergie ou en mode « ne pas déranger » peut retarder une notification. Les 100 prochains rappels (39 jours au plus) sont programmés ; pour une échéance importante, exportez aussi la tâche vers votre agenda (.ics, plus bas).</p>
      <Dialog open={ask} onClose={() => { if (!busy) setAsk(false) }} label="Activer les rappels application fermée">
        <h2 style={{ marginTop: 0 }}>Activer les rappels application fermée</h2>
        <p>Ce qui va se passer, uniquement sur cet appareil :</p>
        <ul>
          <li>votre navigateur crée un abonnement aux notifications pour cet appareil (il peut demander l’autorisation d’afficher des notifications) ;</li>
          <li>pour chaque tâche à venir avec une échéance, Believe chiffre sur l’appareil un message de rappel avec la clé de cet abonnement, puis le dépose sur le compte en ligne avec son heure d’envoi ;</li>
          <li>le service voit l’adresse de l’abonnement, l’heure de chaque rappel et un identifiant de tâche aléatoire, jamais le titre ni le texte, que ni lui ni le système de notification du navigateur ne peuvent lire ;</li>
          <li>la liste est mise à jour quand vous modifiez vos tâches (Believe ouvert) ; la désactiver, retirer l’accord « Notifications » ou « Compte en ligne », ou vous déconnecter supprime l’abonnement et les rappels déposés.</li>
        </ul>
        <label className="rd"><input type="checkbox" checked={wantTitle} onChange={e => setWantTitle(e.target.checked)} /> Afficher le titre de la tâche dans la notification</label>
        <p className="mut">Décoché (conseillé) : la notification dit seulement « Une tâche arrive à échéance ». Coché : le titre s’affiche, y compris sur l’écran verrouillé du téléphone (jamais en mode discret).</p>
        <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={busy} onClick={activate}>Activer</button><button className="btn alt" disabled={busy} onClick={() => setAsk(false)}>Annuler</button></div>
      </Dialog>
    </div>
  )
}
