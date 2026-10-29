import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { State } from './lib'
import type { P, Upd } from './ui'
import { CHECK_MS, LEADS, LEAD_LABEL, askPermission, dueReminders, notify, permission, remindAt, when } from './remind'
import type { Lead, Perm } from './remind'
import { disablePush, pushOn } from './cloudhook'

/** Carte « Rappels application fermée » : chargée à la demande (elle utilise le code du compte en ligne, inutile tant que la rubrique 9 n'est pas affichée). */
const PushCard = lazy(() => import('./PushCard'))

/** Rappel affiché dans l'application : tâche et échéance pour laquelle il a été donné. */
export interface Rem { id: string; t: string; due: string }
const keyOf = (id: string, due: string | null) => id + '|' + due

/**
 * Surveille les échéances pendant que l'application est ouverte (au démarrage, à l'heure exacte du prochain rappel, toutes les 30 s, au retour au premier plan, à chaque changement de tâche ou de réglage).
 * Au premier plan : bannière dans l'application. En arrière-plan ou sous l'écran du PIN : notification du système si le navigateur l'autorise (sans le titre de la tâche en mode discret
 * ou sous le PIN) ; si elle n'est pas possible, rien n'est marqué : le rappel s'affiche au retour dans l'application. Un rappel n'est marqué « donné » sur la tâche qu'une fois réellement affiché ;
 * `seen` empêche de le redemander pendant que l'affichage est en cours.
 */
export function useReminders(S: State, upd: Upd, locked: boolean) {
  const [items, setItems] = useState<Rem[]>([])
  const seen = useRef(new Set<string>()), sref = useRef(S), lref = useRef(locked), uref = useRef(upd)
  sref.current = S; lref.current = locked; uref.current = upd
  useEffect(() => {
    const run = () => {
      const s = sref.current
      if (!s.consents.notif) return
      const list = dueReminders(s.tasks, Date.now(), s.settings.remind).filter(t => !seen.current.has(keyOf(t.id, t.due)))
      if (!list.length) return
      const front = document.visibilityState === 'visible' && !lref.current
      const masked = s.discret || lref.current
      const mark = (ts: typeof list) => uref.current(st => { for (const t of ts) { const x = st.tasks.find(y => y.id === t.id); if (x) x.r = t.due as string } }, undefined, true)
      for (const t of list) seen.current.add(keyOf(t.id, t.due))
      if (front) { setItems(prev => [...prev, ...list.map(t => ({ id: t.id, t: t.t, due: t.due as string }))]); mark(list); return }
      void Promise.all(list.map(t => notify(masked ? 'Believe : rappel' : t.t, masked ? 'Une tâche arrive à échéance.' : 'Échéance ' + when(t.due as string, Date.now()), t.id))).then(oks => {
        list.forEach((t, i) => { if (!oks[i]) seen.current.delete(keyOf(t.id, t.due)) }) // refusée par le navigateur : à retenter, ou à montrer au retour dans l'application
        const done = list.filter((_, i) => oks[i]); if (done.length) mark(done)
      })
    }
    /** Prochain moment de rappel (l'heure exacte : le contrôle de 30 s ne sert plus que de filet de sécurité). Au-delà de 24 jours, ou sans tâche à venir, rien n'est programmé. */
    let exact: ReturnType<typeof setTimeout> | undefined
    const plan = () => {
      const s = sref.current, now = Date.now()
      if (!s.consents.notif) return
      let next = Infinity
      for (const t of s.tasks) {
        if (t.done || !t.due || t.r === t.due) continue
        const at = remindAt(t, s.settings.remind)
        if (Number.isFinite(at) && at > now && at < next) next = at
      }
      if (next - now < 2 ** 31 - 1) exact = setTimeout(() => { run(); plan() }, next - now + 250)
    }
    run(); plan()
    const id = setInterval(run, CHECK_MS)
    document.addEventListener('visibilitychange', run)
    return () => { clearInterval(id); clearTimeout(exact); document.removeEventListener('visibilitychange', run) }
  }, [S.tasks, S.consents.notif, S.settings.remind, S.discret, locked])
  return { items: S.consents.notif ? items : [], clear: () => setItems([]) }
}

/** Bandeau des rappels affichés dans l'application. La zone annoncée aux lecteurs d'écran est toujours présente : seul son contenu apparaît. */
export function RemindBanner({ items, discret, onClose }: { items: Rem[]; discret: boolean; onClose: () => void }) {
  return (
    <div role="status" aria-live="polite">
      {items.length > 0 && (
        <div className="ban rem">
          <b>{items.length > 1 ? 'Rappels de tâches' : 'Rappel de tâche'}</b>
          <ul>{items.map(i => <li key={keyOf(i.id, i.due)}>{discret ? 'Une tâche arrive à échéance' : i.t} : échéance {when(i.due, Date.now())}</li>)}</ul>
          <span className="row"><a className="chip" href="#/9">Ouvrir les tâches</a><button className="chip" onClick={onClose}>Fermer les rappels</button></span>
        </div>
      )}
    </div>
  )
}

const PERM_TXT: Record<Perm, string> = {
  granted: 'Notifications du système : autorisées.',
  default: 'Notifications du système : pas encore autorisées.',
  denied: 'Notifications du système : refusées dans le navigateur (réglages du site pour les autoriser). Les rappels s’affichent dans Believe.',
  unsupported: 'Notifications du système : indisponibles ici (sur iPhone, ajoutez d’abord Believe à l’écran d’accueil). Les rappels s’affichent dans Believe.'
}
const ENABLED: Record<Perm, string> = {
  granted: 'Rappels activés. Les notifications du système sont autorisées.',
  denied: 'Rappels activés dans l’application. Le navigateur a refusé les notifications du système : les rappels s’afficheront dans Believe.',
  default: 'Rappels activés dans l’application. Les notifications du système ne sont pas encore autorisées : vous pouvez le faire avec le bouton ci-dessous.',
  unsupported: 'Rappels activés dans l’application. Les notifications du système ne sont pas disponibles ici : les rappels s’afficheront dans Believe.'
}

/** Carte « Rappels » de la rubrique 9 : accord demandé ici, au moment de l'usage ; le refus du navigateur ne bloque pas les rappels dans l'application. */
export function RemindCard({ S, upd, setM }: Pick<P, 'S' | 'upd' | 'setM'>) {
  const [perm, setPerm] = useState<Perm>(permission())
  useEffect(() => { // l'autorisation peut changer dans les réglages du navigateur pendant que la page reste ouverte
    const f = () => setPerm(permission())
    addEventListener('focus', f); document.addEventListener('visibilitychange', f)
    return () => { removeEventListener('focus', f); document.removeEventListener('visibilitychange', f) }
  }, [])
  const on = S.consents.notif
  const enable = async () => {
    const p = permission() === 'default' ? await askPermission() : permission() // la demande au navigateur part du clic, avant toute attente
    setPerm(p); upd(s => { s.consents.notif = true }, ENABLED[p])
  }
  const disable = () => {
    const had = pushOn() // les rappels application fermée dépendent de l'accord « Notifications » : ils s'arrêtent avec lui
    if (!upd(s => { s.consents.notif = false }, 'Rappels désactivés. Pour retirer aussi l’autorisation du navigateur, utilisez les réglages du site dans le navigateur.')) return
    if (had) void disablePush().then(o => setM(o === 'failed'
      ? { e: 1, t: 'Rappels désactivés. Les rappels application fermée sont arrêtés sur cet appareil, mais le service n’a pas confirmé la suppression de ceux déjà déposés : plus rien ne sera affiché ici, et le service les supprimera de lui-même.' }
      : { t: 'Rappels désactivés, y compris les rappels application fermée : l’abonnement et les rappels déposés ont été supprimés du service.' }))
  }
  const allow = async () => { const p = await askPermission(); setPerm(p); setM(p === 'granted' ? { t: 'Notifications du système autorisées.' } : { e: 1, t: PERM_TXT[p] }) }
  const test = async () => {
    const ok = await notify('Believe : test', 'Les rappels de tâches fonctionnent.', 'test')
    setPerm(permission())
    setM(ok ? { t: 'Notification de test envoyée. Si vous ne la voyez pas, vérifiez les réglages de notification de l’appareil.' } : { e: 1, t: 'Aucune notification du système possible pour l’instant (non autorisée ou indisponible) : les rappels s’afficheront dans Believe.' })
  }
  return (
    <>
    <div className="card"><h2>Rappels</h2>
      <p>Believe peut vous rappeler une tâche avant son échéance. Le calcul se fait sur votre appareil, sans serveur : <b>un rappel n’est donné que pendant que Believe est ouvert</b> (au premier plan, ou en arrière-plan tant que le navigateur le garde actif). Application fermée, rien ne sonne, sauf si vous activez la carte « Rappels application fermée » plus bas (facultatif, avec le compte en ligne) ; l’export .ics, dont le rappel est géré par votre agenda, reste possible.</p>
      {!on
        ? <div className="row"><button className="btn" onClick={enable}>Activer les rappels</button></div>
        : <>
          <div className="row">
            <label htmlFor="rl" style={{ margin: 0 }}>Prévenir</label>
            <select id="rl" style={{ width: 'auto' }} value={S.settings.remind} onChange={e => { const v = +e.target.value as Lead; upd(s => { s.settings.remind = v }, 'Rappel réglé : ' + LEAD_LABEL[v].toLowerCase() + '.') }}>{LEADS.map(n => <option key={n} value={n}>{LEAD_LABEL[n]}</option>)}</select>
          </div>
          <p className="mut">{PERM_TXT[perm]}</p>
          <div className="row">
            {perm === 'default' && <button className="btn" onClick={allow}>Autoriser les notifications du système</button>}
            <button className="btn alt" onClick={test}>Tester une notification</button>
            <button className="btn alt" onClick={disable}>Désactiver les rappels</button>
          </div>
        </>}
    </div>
    <Suspense fallback={null}><PushCard S={S} /></Suspense>
    </>
  )
}
