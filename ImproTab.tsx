import { useEffect, useRef, useState } from 'react'
import { today } from './lib'
import type { P } from './ui'
import { askAI, errText } from './ai'
import { DURATIONS, IMPRO_TOTAL, current, decode, drawSubject, finishImpro } from './impro'
import type { Subject } from './impro'
import { TimerView, chime, useCountdown } from './Timer'
import Listen from './Listen'
import { mmss } from './util'

const dayFr = (d: string) => { const x = new Date(d + 'T00:00:00'); return isNaN(+x) ? d : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) }
/** Texte envoyé à l'IA pour un conseil : le sujet affiché et une consigne, rien d'autre (aucune donnée personnelle). */
export const adviceRequest = (sub: Subject) =>
  'Je m’entraîne à improviser à voix haute. ' + sub.text + '\n\nDonne-moi un conseil bref et concret (cinq phrases au plus) : comment ouvrir, comment organiser mon propos en trois temps, comment conclure. N’écris pas le discours à ma place.'

/** Conseil Believe AI sur demande : le texte exact est montré, et rien n'est envoyé sans accord ni clic. Le conseil n'est pas enregistré. */
function Advice({ sub, S, upd }: Pick<P, 'S' | 'upd'> & { sub: Subject }) {
  const [open, setOpen] = useState(false), [wait, setWait] = useState(false), [out, setOut] = useState(''), [err, setErr] = useState('')
  const ctl = useRef<AbortController | null>(null)
  useEffect(() => () => ctl.current?.abort(), [])
  const sent = adviceRequest(sub)
  const send = async () => {
    const c = new AbortController(); ctl.current = c; setWait(true); setErr(''); setOut('')
    try { setOut((await askAI('eloquence', [{ role: 'user', content: sent }], '', c.signal)).text) } catch (e) {
      const m = (e as Error).message
      if (m !== 'cancelled') setErr(errText(m))
    } finally { setWait(false) }
  }
  return (
    <>
      <button className="btn alt" aria-expanded={open} onClick={() => setOpen(!open)}>Conseil Believe AI</button>
      {open && (
        <div className="ai" style={{ flexBasis: '100%' }}>
          {out
            ? <>
              <span className="tag">Généré par IA</span>
              <p>{out}</p>
              <p className="mut"><small>Conseil écrit par une IA, à adapter à votre façon de parler. Il n’est pas enregistré et disparaît quand vous changez de sujet.</small></p></>
            : <>
              <b>Ce qui sera envoyé à l’IA (Google Gemini, via le serveur Believe)</b>
              <pre className="send" tabIndex={0} aria-label="Texte exact qui sera envoyé">{sent}</pre>
              <p className="mut"><small>Seul ce texte part : ni votre profil, ni vos enregistrements. Rien n’est envoyé tant que vous n’appuyez pas sur le bouton.</small></p>
              {err && <p className="ko" role="alert">{err}</p>}
              {wait
                ? <div className="row"><span role="status">Believe AI écrit…</span><button className="btn alt" onClick={() => ctl.current?.abort()}>Arrêter d’attendre la réponse</button></div>
                : S.consents.ai
                  ? <button className="btn" onClick={send}>Envoyer ce sujet à l’IA</button>
                  : <button className="btn" onClick={() => upd(s => { s.consents.ai = true }, 'Accord enregistré : Believe AI.')}>Donner mon accord pour l’IA</button>}</>}
        </div>
      )}
    </>
  )
}

/** Un sujet à traiter : sujet et difficulté, minuteur réglable, auto-écoute, conseil IA sur demande, enregistrement dans l'historique sur clic. */
function Session({ sub, S, upd, setM }: Pick<P, 'S' | 'upd' | 'setM'> & { sub: Subject }) {
  const [sec, setSec] = useState(120)
  const t = useCountdown(sec, () => chime(S))
  const recorded = S.impro.hist.some(h => h.id === sub.id), lock = t.run || (t.used && !t.over)
  const finish = () => {
    const el = t.elapsed
    if (upd(s => { finishImpro(s, today(), el) }, 'Improvisation enregistrée dans l’historique : ' + (el ? 'durée ' + mmss(el * 1000) : 'chrono non utilisé') + ', difficulté ' + sub.diff + ' sur 5.')) t.reset()
  }
  return (
    <>
      <div className="card" role="region" aria-label="Sujet d’improvisation">
        <h2>Votre sujet</h2>
        <blockquote className="exotxt">{sub.text}</blockquote>
        <p style={{ margin: '8px 0 2px' }}><b>Difficulté : {sub.diff} / 5</b> ({sub.label}) <span className="dots" aria-hidden="true">{'●'.repeat(sub.diff)}{'○'.repeat(5 - sub.diff)}</span></p>
        <p className="mut" style={{ margin: 0 }}><small>Pourquoi cette note : {sub.why}.</small></p>
      </div>
      <div className="card">
        <h2>Chrono</h2>
        <div className="chips wrap" role="group" aria-label="Durée de l’improvisation">
          {DURATIONS.map(d => <button key={d} className="chip" aria-pressed={sec === d} disabled={lock} onClick={() => setSec(d)}>{d / 60} min</button>)}
        </div>
        <TimerView t={t} sec={sec} setSec={setSec} id="tm-impro" label="Chrono de l’improvisation" max={900} />
        <Listen S={S} upd={upd} setM={setM} title={'Improvisation : ' + sub.theme} />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" disabled={recorded} onClick={finish}>{recorded ? '✓ Enregistrée dans l’historique' : 'J’ai terminé cette improvisation'}</button>
          <Advice sub={sub} S={S} upd={upd} />
        </div>
      </div>
    </>
  )
}

export default function ImproTab({ S, upd, setM }: P) {
  const sub = current(S), h = S.impro.hist, last = h.slice(-10).reverse()
  const tot = h.reduce((a, x) => a + x.sec, 0), rated = h.filter((x): x is typeof x & { diff: number } => x.diff !== null), avg = rated.length ? rated.reduce((a, x) => a + x.diff, 0) / rated.length : 0
  return (
    <>
      <div className="card">
        <h2>Improvisation infinie</h2>
        <p style={{ marginTop: 0 }}>À chaque fois, un sujet que vous n’avez pas encore reçu : {IMPRO_TOTAL.toLocaleString('fr-FR')} sujets différents sont possibles. Choisissez une durée, parlez à voix haute, puis écoutez-vous. Chaque sujet porte sa note de difficulté, et vous pouvez demander un conseil à Believe AI.</p>
        <button className="btn" onClick={() => { upd(s => { drawSubject(s) }) }}>{sub ? 'Nouveau sujet' : 'Obtenir un sujet'}</button>
        <p className="mut" style={{ marginBottom: 0 }}><small>Les 1 000 derniers sujets tirés sont mémorisés sur cet appareil et ne reviennent pas ; un thème n’est jamais repris dans les trois tirages suivants. Un sujet passé sans être terminé ne revient pas non plus.</small></p>
      </div>
      {sub && <Session key={sub.id} sub={sub} S={S} upd={upd} setM={setM} />}
      <div className="card">
        <h2>Mes improvisations</h2>
        {h.length
          ? <p style={{ marginTop: 0 }}>{h.length} improvisation{h.length > 1 ? 's' : ''} enregistrée{h.length > 1 ? 's' : ''} · temps chronométré : {mmss(tot * 1000)}{rated.length ? ' · difficulté moyenne : ' + avg.toFixed(1).replace('.', ',') + ' / 5' : ''}.</p>
          : <p style={{ marginTop: 0 }}>Aucune improvisation enregistrée pour le moment. Elle s’ajoute ici quand vous appuyez sur « J’ai terminé ».</p>}
        {last.length > 0 && <ul className="hist" aria-label="Dernières improvisations">
          {last.map((x, i) => <li key={i}><b>{dayFr(x.d)}</b> : {decode(x.id)?.theme ?? 'sujet retiré de la banque'} <span className="mut"><small>· {x.diff !== null ? 'difficulté ' + x.diff + ' / 5' : 'difficulté non notée'} · {x.sec ? mmss(x.sec * 1000) : 'chrono non utilisé'}</small></span></li>)}
        </ul>}
      </div>
    </>
  )
}
