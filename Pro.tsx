import { useState } from 'react'
import { today } from './lib'
import { clock } from './util'
import { QL, gcal, ics, left, quad } from './cal'
import { pauseP, resetP, setMins, startP, usePomo } from './pomo'
import type { Task } from './cal'
import type { P } from './ui'
import { remindAt, startsReminded, when } from './remind'
import { RemindCard } from './Reminders'

/** Tâches montrées d'abord dans chaque liste, et par clic sur « Afficher plus » : la page reste rapide avec des centaines de tâches. */
const PAGE = 20
/** Format de l'échéance, créé une seule fois (le recréer à chaque tâche ralentit beaucoup l'affichage d'une longue liste). */
const DUE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function ProPage({ S, upd, m, setM }: P) {
  const pomo = usePomo(), [t, setT] = useState(''), [imp, setImp] = useState(false), [due, setDue] = useState(''), [pend, setPend] = useState<string | null>(null)
  const [lim, setLim] = useState<Record<string, number>>({})
  const cap = (k: string) => lim[k] ?? PAGE
  /** Une liste de tâches, limitée à ce qui a été demandé, suivie de son bouton « Afficher plus » s'il en reste. */
  const slice = (k: string, l: Task[]) => (
    <>
      {l.slice(0, cap(k)).map(Row)}
      {l.length > cap(k) && <p><button className="btn alt" onClick={() => setLim({ ...lim, [k]: cap(k) + PAGE })}>Afficher plus ({l.length - cap(k)} restantes)</button></p>}
    </>
  )
  const now = Date.now(), tasks = S.tasks, rem = pomo.st === 'run' ? left(pomo.end) : pomo.rest
  const add = () => {
    const x = t.trim().slice(0, 100)
    if (!x) return setM({ e: 1, t: 'Saisissez un intitulé.' })
    if (due && isNaN(new Date(due).getTime())) return setM({ e: 1, t: 'Date invalide.' })
    setT(''); setImp(false); setDue('')
    const r = startsReminded(due || null, Date.now(), S.settings.remind) ? due : undefined // échéance déjà dans le délai de rappel : la personne la regarde, rien ne sonne aussitôt
    upd(s => { s.tasks.push({ id: 't' + Date.now().toString(36) + s.tasks.length, t: x, imp, due: due || null, done: false, p: null, ...(r ? { r } : {}) }) }, 'Tâche ajoutée.')
  }
  const patch = (id: string, f: (x: Task) => void) => upd(s => { const x = s.tasks.find(y => y.id === id); if (x) f(x) })
  const file = () => new File([ics(tasks)], 'believe-taches.ics', { type: 'text/calendar' })
  const dl = () => {
    if (!tasks.some(x => x.due && !x.done)) return setM({ e: 1, t: 'Aucune tâche active avec échéance à exporter.' })
    const u = URL.createObjectURL(file()), a = document.createElement('a')
    a.href = u; a.download = 'believe-taches.ics'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000)
    setM({ t: 'Téléchargement du fichier .ics lancé : ouvrez-le pour l’ajouter à votre agenda. C’est un export, pas une synchronisation.' })
  }
  const share = async () => {
    try {
      const f = file()
      if (!navigator.canShare || !navigator.canShare({ files: [f] })) return setM({ e: 1, t: 'Partage de fichier indisponible sur cet appareil : utilisez le téléchargement.' })
      await navigator.share({ files: [f], title: 'Tâches Believe' })
    } catch { /* partage annulé */ }
  }
  /** Texte sur le rappel d'une tâche : prévu (avec son heure) ou déjà donné ; rien si les rappels sont désactivés. */
  const plan = (x: Task) => {
    if (!S.consents.notif || x.done || !x.due) return ''
    if (x.r === x.due) return ', rappel donné'
    const at = remindAt(x, S.settings.remind)
    return at > now ? ', rappel prévu ' + when(at, now) : ''
  }
  const Row = (x: Task) => (
    <div className="li" key={x.id} style={{ alignItems: 'flex-start' }}>
      <span><label className="rd" style={{ margin: 0 }}><input type="checkbox" checked={x.done} onChange={() => patch(x.id, y => { y.done = !y.done })} /> <b>{x.t}</b></label><br />
        <small className="mut">{x.due ? 'Échéance : ' + DUE.format(new Date(x.due)) : 'Sans échéance'}{x.p ? ', quadrant choisi' : ', classement automatique'}{plan(x)}</small></span>
      <span className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="chip" aria-pressed={x.imp} onClick={() => patch(x.id, y => { y.imp = !y.imp })}>Important</button>
        <select aria-label="Quadrant" value={x.p ?? 0} style={{ width: 'auto', minHeight: 34 }} onChange={e => patch(x.id, y => { y.p = e.target.value === '0' ? null : (+e.target.value as 1 | 2 | 3 | 4) })}><option value={0}>Auto</option>{[1, 2, 3, 4].map(n => <option key={n} value={n}>P{n}</option>)}</select>
        {x.due && <a className="chip" href={gcal(x)} target="_blank" rel="noopener noreferrer">Google Agenda</a>}
        {pend === x.id ? <button className="chip" onClick={() => { setPend(null); upd(s => { s.tasks = s.tasks.filter(y => y.id !== x.id) }, 'Tâche supprimée.') }}>Confirmer</button> : <button className="cb" style={{ color: 'var(--mut)' }} aria-label={'Supprimer ' + x.t} onClick={() => setPend(x.id)}>✕</button>}
      </span>
    </div>
  )
  const done = tasks.filter(x => x.done)
  return (
    <>
      <h1>Professionnel et calendrier</h1>
      {m && <p className={m.e ? 'ko' : 'ok'} role="status">{m.t}</p>}
      <div className="card"><h2>Pomodoro</h2>
        <div className="chips" role="group" aria-label="Durée">{[25, 45].map(x => <button key={x} className="chip" aria-pressed={pomo.mins === x} disabled={pomo.st !== 'idle'} onClick={() => setMins(x)}>{x} min</button>)}</div>
        <p style={{ fontSize: '2.2rem', margin: '4px 0' }}><b>{clock(rem)}</b></p>
        <div className="row">{pomo.st === 'run' ? <button className="btn alt" onClick={pauseP}>Pause</button> : <button className="btn" onClick={startP}>{pomo.st === 'pause' ? 'Reprendre' : 'Démarrer'}</button>}<button className="btn alt" onClick={resetP}>Réinitialiser</button></div>
        <p className="mut">Sessions terminées aujourd’hui : {S.pomos[today()] ?? 0}. Le minuteur continue quand vous changez de rubrique ; le navigateur peut retarder l’alerte si l’écran est verrouillé.</p></div>
      <div className="card"><h2>Nouvelle tâche</h2>
        <div className="row">
          <input aria-label="Intitulé" placeholder="Intitulé de la tâche" maxLength={100} style={{ flex: '2 1 180px', width: 'auto' }} value={t} onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
          <input type="datetime-local" aria-label="Échéance (facultative)" style={{ flex: '1 1 170px', width: 'auto' }} value={due} onChange={e => setDue(e.target.value)} />
          <label className="rd" style={{ margin: 0 }}><input type="checkbox" checked={imp} onChange={e => setImp(e.target.checked)} /> Importante</label>
          <button className="btn" onClick={add}>Ajouter</button>
        </div>
        <p className="mut">Le quadrant se calcule seul (urgent = échéance dans moins de 48 h ou dépassée) ; vous pouvez le forcer sur chaque tâche.</p></div>
      <RemindCard S={S} upd={upd} setM={setM} />
      {[1, 2, 3, 4].map(n => {
        const l = tasks.filter(x => !x.done && quad(x, now) === n).sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'))
        return <div key={n}><h2>P{n}, {QL[n]}</h2>{l.length ? slice('p' + n, l) : <p className="mut">Rien ici.</p>}</div>
      })}
      {done.length > 0 && <><h2>Terminées ({done.length})</h2>{slice('done', done)}</>}
      <h2>Agenda</h2>
      <div className="row"><button className="btn alt" onClick={dl}>Exporter en .ics</button>{'canShare' in navigator && <button className="btn alt" onClick={share}>Partager le fichier</button>}</div>
      <p className="mut">Le fichier contient les tâches actives avec échéance (rappel 30 min avant) pour Apple Agenda, Google Agenda et Android. Aucune synchronisation automatique : il faut ouvrir le fichier. Le lien « Google Agenda » d’une tâche ouvre un événement prérempli.</p>
    </>
  )
}
