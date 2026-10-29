import { useState } from 'react'
import { CATS, addD, dayPct, iso, isoWk, monday, streak, today, uid } from './lib'
import type { Habit } from './lib'
import { DN, Dialog, Flash } from './ui'
import type { P } from './ui'
import { BookmarkCards } from './Bookmark'
import Icon from './icons'

/** Fenêtre « Modifier l'habitude » (nom et catégorie). L'identifiant, les cases déjà cochées, les séries et le rôle (podomètre, marque-page…) sont conservés : seul le nom change. */
function EditHabit({ h, S, upd, onClose }: { h: Habit; S: P['S']; upd: P['upd']; onClose: () => void }) {
  const [n, setN] = useState(h.n), [c, setC] = useState(h.c), [er, setEr] = useState(''), cats = CATS.includes(h.c) ? CATS : [h.c, ...CATS]
  const save = () => {
    const v = n.trim().slice(0, 60)
    if (!v) return setEr('Saisissez un nom d’habitude.')
    if (!S.habits.some(x => x.id === h.id)) return setEr('Cette habitude n’existe plus.')
    if (S.habits.some(x => x.id !== h.id && x.n.toLowerCase() === v.toLowerCase())) return setEr('Cette habitude existe déjà.')
    if (v === h.n && c === h.c) return onClose()
    if (upd(s => { const x = s.habits.find(y => y.id === h.id); if (x) { x.n = v; x.c = c } }, 'Habitude modifiée : ' + v + '.')) onClose() // la fenêtre ne se ferme qu'une fois l'enregistrement confirmé
  }
  return (
    <Dialog open onClose={onClose} label={'Modifier l’habitude : ' + h.n}>
      <h2 style={{ marginTop: 0 }}>Modifier l’habitude</h2>
      <label htmlFor="hn">Nom</label>
      <input id="hn" maxLength={60} value={n} onChange={e => { setN(e.target.value); setEr('') }} onKeyDown={e => { if (e.key === 'Enter') save() }} />
      <label htmlFor="hc" style={{ marginTop: 8 }}>Catégorie</label>
      <select id="hc" value={c} onChange={e => setC(e.target.value)}>{cats.map(x => <option key={x}>{x}</option>)}</select>
      <p className="mut">Les cases déjà cochées, les séries et l’historique sont conservés.</p>
      {er && <p className="ko" role="alert">{er}</p>}
      <div className="row"><button className="btn" onClick={save}>Enregistrer</button><button className="btn alt" onClick={onClose}>Annuler</button></div>
    </Dialog>
  )
}

export default function Habits({ S, upd, m, setM }: P) {
  const [flt, setFlt] = useState('Tous'), [pend, setPend] = useState<string | null>(null), [ren, setRen] = useState<Habit | null>(null), [nn, setNn] = useState(''), [nc, setNc] = useState<string>(CATS[0]), [lim, setLim] = useState(12)
  const mon = monday(new Date()), days = [0, 1, 2, 3, 4, 5, 6].map(i => addD(mon, i)), t = today(), w = isoWk(mon)[1]
  const fm = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  const range = 'du ' + fm(days[0]) + ' au ' + fm(days[6]) // « oct. » porte déjà son point : on n'en ajoute pas un second en fin de phrase
  const hs = S.habits.filter(h => flt === 'Tous' || h.c === flt), el = days.filter(d => iso(d) <= t).length
  let tot = 0
  S.habits.forEach(h => days.forEach(d => { if (iso(d) <= t && (S.checks[iso(d)] ?? []).includes(h.id)) tot++ }))
  const rate = S.habits.length && el ? Math.round(100 * tot / (S.habits.length * el)) : 0
  const tog = (id: string, k: string) => upd(s => { const a = s.checks[k] ?? (s.checks[k] = []), i = a.indexOf(id); if (i < 0) a.push(id); else a.splice(i, 1); if (!a.length) delete s.checks[k] })
  const add = () => {
    const n = nn.trim().slice(0, 60)
    if (!n) return setM({ e: 1, t: 'Saisissez un nom d’habitude.' })
    if (S.habits.some(h => h.n.toLowerCase() === n.toLowerCase())) return setM({ e: 1, t: 'Cette habitude existe déjà.' })
    setNn(''); upd(s => { s.habits.push({ id: uid('h'), n, c: nc }) }, 'Habitude ajoutée.')
  }
  return (
    <>
      <h1>Habitudes</h1>
      <p className="mut">Semaine {w}, {range}{range.endsWith('.') ? '' : '.'}<br />Réussite sur les jours écoulés : <b>{rate} %</b></p>
      <Flash m={m} />
      <div className="chips" role="group" aria-label="Filtrer par catégorie">{['Tous', ...CATS].map(c => <button key={c} className="chip" aria-pressed={flt === c} onClick={() => setFlt(c)}>{c}</button>)}</div>
      {hs.map(h => (
        <div className="hc" key={h.id}>
          <div className="hh">
            <div><b>{h.n}</b>{pend === h.id
              ? <button className="chip" onClick={() => { setPend(null); upd(s => { s.habits = s.habits.filter(x => x.id !== h.id) }, 'Habitude retirée, l’historique est conservé.') }}>Confirmer le retrait</button>
              : <small className="mut">{h.c}, série {streak(S, h.id)} j</small>}</div>
            <div className="hx">
              {pend !== h.id && <button className="hb" aria-label={'Renommer ' + h.n} onClick={() => setRen(h)}><Icon n="note" size={20} /></button>}
              <button className="hb" aria-label={'Retirer ' + h.n} onClick={() => setPend(pend === h.id ? null : h.id)}><Icon n={pend === h.id ? 'refresh' : 'close'} size={20} /></button>
            </div>
          </div>
          <div className="hw">
            {days.map((d, i) => { const k = iso(d), on = (S.checks[k] ?? []).includes(h.id); return (
              <div key={k}><span className={'hd' + (k === t ? ' now' : '')}>{DN[i]}<br />{d.getDate()}</span>
                <button className="cb" aria-pressed={on} disabled={k > t} aria-label={h.n + ', ' + DN[i]} onClick={() => tog(h.id, k)}>{on && <Icon n="tick" size={20} strokeWidth={3} />}</button></div>
            ) })}
          </div>
        </div>
      ))}
      {!hs.length && <p className="mut">Aucune habitude dans cette catégorie.</p>}
      {ren && <EditHabit key={ren.id} h={ren} S={S} upd={upd} onClose={() => setRen(null)} />}
      <BookmarkCards S={S} upd={upd} />
      <div className="card"><h2>Ajouter une habitude</h2>
        <div className="row">
          <input placeholder="Nom de l’habitude" maxLength={60} aria-label="Nom de l’habitude" style={{ flex: '1 1 180px', width: 'auto' }} value={nn} onChange={e => setNn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
          <select aria-label="Catégorie" style={{ width: 'auto' }} value={nc} onChange={e => setNc(e.target.value)}>{CATS.map(c => <option key={c}>{c}</option>)}</select>
          <button className="btn" onClick={add}>Ajouter</button>
        </div>
      </div>
      <h2>Cette semaine</h2>
      <div className="bars" role="img" aria-label="Part d’habitudes validées par jour">{days.map((d, i) => <div key={i}><i style={{ height: dayPct(S, iso(d)) * 0.7, opacity: iso(d) > t ? 0.25 : 1 }} />{DN[i]}</div>)}</div>
      <h2>Historique des semaines</h2>
      {S.archives.length ? S.archives.slice(0, lim).map(a => (
        <div className="li" style={{ display: 'block' }} key={a.start}><b>{a.week}</b> (début le {a.start}) : {a.n ? a.rate + ' %' : 'aucune validation enregistrée'}
          {a.n > 0 && <><br /><small className="mut">{Object.entries(a.per).map(([n, c]) => n + ' ' + c + '/7').join(', ')}</small></>}</div>
      )) : <p className="mut">Aucune semaine archivée pour l’instant : la première le sera automatiquement après le prochain lundi.</p>}
      {S.archives.length > lim && <p><button className="btn alt" onClick={() => setLim(lim + 12)}>Afficher plus ({S.archives.length - lim} restantes)</button></p>}
    </>
  )
}
