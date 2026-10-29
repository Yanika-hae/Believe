import { useEffect, useState } from 'react'
import { addD, iso, today } from './lib'
import { Dialog } from './ui'
import type { P } from './ui'
import { EXOS, KINDS, PER_DAY, WINDOW, discovered, ensureDaily, exoById, exoStreak, markDone, unmarkDone } from './exo'
import type { ExoItem, ExoKind } from './exo'
import { TimerBox } from './Timer'
import Listen from './Listen'
import { mmss } from './util'

const TXT_LABEL: Record<ExoKind, string> = { diction: 'Texte à lire à voix haute', articulation: 'Texte à répéter à voix haute', souffle: 'Phrase à dire sur votre souffle', figures: 'Définition et exemple', repartie: 'Situation ou réplique à laquelle répondre', posture: 'Texte' }
const prev = (d: string) => iso(addD(new Date(d + 'T00:00:00'), -1))

function ExoDialog({ e, done, S, upd, setM, onClose }: Pick<P, 'S' | 'upd' | 'setM'> & { e: ExoItem; done: boolean; onClose: () => void }) {
  const [sec, setSec] = useState(e.sec)
  return (
    <>
      <h2 style={{ marginTop: 0 }}>{e.t}</h2>
      <p style={{ margin: '0 0 8px' }}><span className="tag">{KINDS[e.k]}</span> <small className="mut">Durée conseillée : {mmss(e.sec * 1000)}</small>{done && <> <span className="tag">Fait aujourd’hui</span></>}</p>
      {e.txt && <><h3>{TXT_LABEL[e.k]}</h3><blockquote className="exotxt">{e.txt}</blockquote></>}
      <h3>Comment faire</h3>
      <ol className="steps">{e.how.map((x, i) => <li key={i}>{x}</li>)}</ol>
      <p><b>Conseil.</b> {e.tip}</p>
      <h3>Chrono</h3>
      <TimerBox S={S} sec={sec} setSec={setSec} id={'tm-' + e.id} label="Chrono de l’exercice" />
      <Listen S={S} upd={upd} setM={setM} title={'Éloquence : ' + e.t} />
      <div className="row" style={{ marginTop: 14 }}>
        {done
          ? <button className="btn alt" onClick={() => { upd(s => { unmarkDone(s, e.id, today()) }, 'Marque « fait » retirée.') }}>Retirer la marque « fait »</button>
          : <button className="btn" onClick={() => { upd(s => { markDone(s, e.id, today()) }, 'Exercice marqué comme fait : ' + e.t + '.') }}>Marquer comme fait</button>}
        <button className="btn alt" onClick={onClose}>Fermer</button>
      </div>
    </>
  )
}

/** Exercices d'éloquence du jour : 5 exercices de familles différentes, chacun avec son chrono et son auto-écoute. */
export default function ExoTab({ S, upd, setM }: P) {
  const day = today(), [open, setOpen] = useState<string | null>(null)
  useEffect(() => { if (S.exo.cur?.d !== day) upd(s => { ensureDaily(s, day) }, undefined, true) }, [day, S.exo.cur?.d])
  const list = S.exo.cur?.d === day ? S.exo.cur.ids.map(exoById).filter((e): e is ExoItem => !!e) : []
  const doneIds = new Set(S.exo.done[day] ?? []), n = list.filter(e => doneIds.has(e.id)).length, streak = exoStreak(S, day, prev)
  const cur = open ? exoById(open) : undefined
  return (
    <>
      <div className="card">
        <h2>Exercices du jour</h2>
        <p style={{ marginTop: 0 }}>Aujourd’hui : <b>{n} / {list.length || PER_DAY}</b> exercice{n > 1 ? 's' : ''} fait{n > 1 ? 's' : ''}{streak > 0 ? ' · ' + streak + ' jour' + (streak > 1 ? 's' : '') + ' de suite' : ''}. Exercices différents proposés : {discovered(S)} sur {EXOS.length}.</p>
        <progress value={n} max={list.length || PER_DAY} aria-label="Exercices faits aujourd’hui" />
        <p className="mut" style={{ marginBottom: 0 }}><small>{PER_DAY} exercices de familles différentes chaque jour (diction, articulation, souffle, figures de style, répartie, posture vocale). Un exercice ne revient pas avant 11 jours. Chaque exercice a son chrono et une auto-écoute ; « fait » ne se coche que lorsque vous le décidez. Un jour sans ouverture n’utilise aucun exercice.</small></p>
      </div>
      {list.map(e => (
        <article key={e.id} className="card exo" aria-label={'Exercice : ' + e.t}>
          <div className="row" style={{ justifyContent: 'space-between' }}><h3>{e.t}</h3><span className="tag">{KINDS[e.k]}</span></div>
          <p className="mut" style={{ margin: '0 0 8px' }}><small>{mmss(e.sec * 1000)} conseillées{doneIds.has(e.id) ? ' · ✓ fait aujourd’hui' : ''}</small></p>
          <button className="btn alt" aria-label={'Ouvrir l’exercice ' + e.t} onClick={() => setOpen(e.id)}>Ouvrir</button>
        </article>
      ))}
      {!list.length && <div className="card"><p style={{ margin: 0 }} role="status">Préparation des exercices du jour…</p></div>}
      <p className="mut"><small>Mémoire anti-répétition : les {WINDOW} derniers exercices proposés sont écartés du tirage, sur cet appareil.</small></p>
      <Dialog open={!!cur} onClose={() => setOpen(null)} label={cur ? 'Exercice : ' + cur.t : 'Exercice'} sheet>
        {cur && <ExoDialog e={cur} done={doneIds.has(cur.id)} S={S} upd={upd} setM={setM} onClose={() => setOpen(null)} />}
      </Dialog>
    </>
  )
}
