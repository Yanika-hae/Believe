import { useEffect, useRef, useState } from 'react'
import { haptic, useCommit } from './ui'
import type { P } from './ui'
import { Metro } from './metro'
import { lockScreen, unlockScreen } from './wake'
import { BPM_MAX, BPM_MIN, clampBpm, tapBpm, tempoName } from './util'

const BEATS = [2, 3, 4, 6] as const

/** Métronome : tempo réglable (30 à 240), mesure à 2, 3, 4 ou 6 temps avec premier temps accentué, frappe du tempo. S'arrête quand l'application quitte l'écran. */
export default function MetroTab({ S, upd }: P) {
  const [bpm, setBpm] = useState(S.prompter.bpm), [beats, setBeats] = useState<number>(S.prompter.beats), [on, setOn] = useState(false), [beat, setBeat] = useState(-1), [msg, setMsg] = useState('')
  useCommit(bpm, S.prompter.bpm, v => upd(s => { s.prompter.bpm = v }, undefined, true))
  useCommit(beats, S.prompter.beats, v => upd(s => { s.prompter.beats = v as 2 | 3 | 4 | 6 }, undefined, true))
  const m = useRef<Metro | null>(null), taps = useRef<number[]>([]), locked = useRef(false)
  if (!m.current) m.current = new Metro()
  m.current.bpm = bpm; m.current.beats = beats; m.current.sound = S.settings.sounds
  m.current.onBeat = b => { setBeat(b); haptic(S, b === 0 ? 14 : 6) }

  const stop = (note = '') => {
    m.current?.stop(); setOn(false); setBeat(-1); setMsg(note)
    if (locked.current) { locked.current = false; unlockScreen() }
  }
  const start = () => {
    setMsg('')
    if (!m.current!.start()) return setMsg('Le son n’est pas disponible sur ce navigateur : le métronome ne peut pas démarrer.')
    setOn(true); if (!locked.current) { locked.current = true; lockScreen() }
  }
  useEffect(() => {
    const vis = () => { if (document.hidden && m.current?.running) stop('Métronome arrêté : l’application a quitté l’écran.') }
    document.addEventListener('visibilitychange', vis)
    return () => { document.removeEventListener('visibilitychange', vis); stop() }
  }, [])
  const tap = () => { const t = Date.now(); taps.current = [...taps.current.filter(x => t - x < 2000), t].slice(-8); const b = tapBpm(taps.current); if (b) setBpm(b) }

  return (
    <div className="card"><h2>Métronome</h2>
      <p className="bpm" aria-live="off"><b>{bpm}</b> <span className="mut">battements/min · {tempoName(bpm)}</span></p>
      <div className="bdots" aria-hidden="true">{Array.from({ length: beats }, (_, i) => <i key={i} className={(i === 0 ? 'acc ' : '') + (i === beat ? 'on' : '')} />)}</div>
      <div className="row" style={{ margin: '10px 0' }}>
        <button className="btn" aria-pressed={on} onClick={() => (on ? stop() : start())}>{on ? 'Arrêter' : 'Démarrer'}</button>
        <button className="btn alt" onClick={tap}>Frapper le tempo</button>
      </div>
      <label htmlFor="bpm">Tempo : {bpm} battements par minute</label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button className="chip" aria-label="Diminuer le tempo de 1" onClick={() => setBpm(clampBpm(bpm - 1))}>−</button>
        <input id="bpm" type="range" min={BPM_MIN} max={BPM_MAX} value={bpm} aria-valuetext={bpm + ' battements par minute, ' + tempoName(bpm)} onChange={e => setBpm(clampBpm(+e.target.value))} />
        <button className="chip" aria-label="Augmenter le tempo de 1" onClick={() => setBpm(clampBpm(bpm + 1))}>+</button>
      </div>
      <div className="chips wrap" role="group" aria-label="Temps par mesure" style={{ marginTop: 8 }}>
        {BEATS.map(b => <button key={b} className="chip" aria-pressed={beats === b} onClick={() => setBeats(b)}>{b} temps</button>)}
      </div>
      {!S.settings.sounds && <p className="mut" role="status">Les sons sont désactivés : le métronome n’indique le rythme que par l’affichage{S.settings.haptics ? ' et la vibration (Android)' : ''}. <button className="chip" onClick={() => upd(s => { s.settings.sounds = true }, 'Sons activés.')}>Activer les sons</button></p>}
      {msg && <p className="ko" role="status">{msg}</p>}
      <p className="mut"><small>Le métronome s’arrête si vous quittez l’écran : un navigateur ne peut pas garder un son précis en arrière-plan.</small></p>
    </div>
  )
}
