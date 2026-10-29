import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as RPE, WheelEvent as RWE } from 'react'
import { useCommit } from './ui'
import type { P } from './ui'
import { lockScreen, unlockScreen } from './wake'
import { stepScroll } from './util'

const SPEED: [number, number] = [5, 300], SIZE: [number, number] = [14, 96]
const label = (v: number) => (v < 30 ? 'très lent' : v < 60 ? 'lent' : v < 110 ? 'moyen' : v < 180 ? 'rapide' : 'très rapide')

/** Prompteur : le texte défile à la vitesse choisie ; vitesse et taille se règlent en direct. Le texte est conservé sur l'appareil. */
export default function Prompter({ S, upd }: P) {
  const [text, setText] = useState(S.prompter.text), [speed, setSpeed] = useState(S.prompter.speed), [size, setSize] = useState(S.prompter.size)
  const [run, setRun] = useState(false), [full, setFull] = useState(false), [end, setEnd] = useState(false), [pend, setPend] = useState(''), [dur, setDur] = useState(0)
  useCommit(text, S.prompter.text, v => upd(s => { s.prompter.text = v }, undefined, true))
  useCommit(speed, S.prompter.speed, v => upd(s => { s.prompter.speed = v }, undefined, true))
  useCommit(size, S.prompter.size, v => upd(s => { s.prompter.size = v }, undefined, true))
  const pos = useRef(0), inner = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), sp = useRef(speed), drag = useRef<{ y: number; p: number } | null>(null)
  sp.current = speed
  const apply = () => { if (inner.current) inner.current.style.transform = 'translate3d(0,' + -pos.current + 'px,0)' }
  const maxPos = () => Math.max(0, (inner.current?.offsetHeight ?? 0) - (stage.current?.clientHeight ?? 0))
  const move = (p: number) => { pos.current = Math.min(maxPos(), Math.max(0, p)); apply() }

  useEffect(() => {
    if (!run) return
    lockScreen()
    let raf = 0, last = performance.now()
    const loop = () => {
      const now = performance.now() // même horloge au départ et à chaque image
      const r = stepScroll(pos.current, now - last, sp.current, maxPos()); last = now; pos.current = r.pos; apply()
      if (r.done) { setRun(false); setEnd(true); return }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); unlockScreen() }
  }, [run])
  useEffect(() => { const m = maxPos(); setDur(m > 0 ? Math.round(m / speed) : 0) }, [text, size, speed, full])
  /** En plein écran, la zone de lecture occupe tout l'espace libre : sa hauteur réelle règle la position de la ligne de lecture. */
  useLayoutEffect(() => {
    const el = stage.current
    if (!full || !el) return
    const set = () => el.style.setProperty('--th', el.clientHeight + 'px')
    set()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null
    ro?.observe(el); addEventListener('resize', set)
    return () => { ro?.disconnect(); removeEventListener('resize', set); el.style.removeProperty('--th') }
  }, [full])
  useEffect(() => {
    if (!full) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    document.addEventListener('keydown', k)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [full])

  const toggle = () => { if (run) return setRun(false); if (end || pos.current >= maxPos()) { pos.current = 0; apply() } setEnd(false); setRun(true) }
  const restart = () => { setRun(false); setEnd(false); pos.current = 0; apply() }
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const notes = S.notes.filter(n => n.b.trim()).sort((a, b) => Date.parse(b.u) - Date.parse(a.u)).slice(0, 100)
  const target = notes.find(n => n.id === pend)

  const bar = (
    <div className="tele-bar">
      <div className="row">
        <button className="btn" onClick={toggle}>{run ? 'Pause' : end ? 'Relire depuis le début' : pos.current > 0 ? 'Reprendre' : 'Démarrer'}</button>
        <button className="btn alt" onClick={restart}>Revenir au début</button>
        <button className="btn alt" aria-pressed={full} onClick={() => setFull(!full)}>{full ? 'Quitter le plein écran' : 'Plein écran'}</button>
      </div>
      <div className="grid2" style={{ marginTop: 8 }}>
        <div><label htmlFor="ps">Vitesse : {speed} px/s ({label(speed)})</label>
          <input id="ps" type="range" min={SPEED[0]} max={SPEED[1]} step={5} value={speed} aria-valuetext={speed + ' pixels par seconde, ' + label(speed)} onChange={e => setSpeed(+e.target.value)} /></div>
        <div><label htmlFor="pz">Taille du texte : {size} px</label>
          <input id="pz" type="range" min={SIZE[0]} max={SIZE[1]} step={2} value={size} onChange={e => setSize(+e.target.value)} /></div>
      </div>
    </div>
  )
  return (
    <>
      {!full && <div className="card"><h2>Votre texte</h2>
        <label htmlFor="pt">Texte à lire</label>
        <textarea id="pt" rows={6} maxLength={20000} value={text} onChange={e => { setText(e.target.value); setEnd(false) }} placeholder="Écrivez ou collez un discours, un chant, un poème…" />
        <p className="mut" style={{ margin: '4px 0 8px' }}><small>{words} mot{words > 1 ? 's' : ''}{dur > 0 ? ', environ ' + Math.floor(dur / 60) + ' min ' + String(dur % 60).padStart(2, '0') + ' s à cette vitesse' : ''}. Conservé sur cet appareil.</small></p>
        {notes.length > 0 && <><label htmlFor="pn">Charger une de mes notes</label>
          <select id="pn" value="" onChange={e => { if (!e.target.value) return; if (!text.trim()) { setText(notes.find(n => n.id === e.target.value)!.b); restart() } else setPend(e.target.value) }}>
            <option value="">Choisir une note…</option>{notes.map(n => <option key={n.id} value={n.id}>{(n.t || n.b.slice(0, 40)) + ' (' + n.cat + ')'}</option>)}</select></>}
        {target && <p className="row" role="alert"><span>Remplacer le texte actuel par « {target.t || target.b.slice(0, 40)} » ?</span>
          <button className="btn" onClick={() => { setText(target.b); setPend(''); restart() }}>Remplacer</button><button className="btn alt" onClick={() => setPend('')}>Annuler</button></p>}
      </div>}
      <div className={full ? 'telewrap full' : 'telewrap'} style={full ? undefined : { ['--th' as string]: 'min(52vh, 460px)' }}>
        <div ref={stage} className="tele" data-noswipe tabIndex={0} role="region" aria-label="Zone de lecture du prompteur. Espace : démarrer ou mettre en pause."
          onPointerDown={(e: RPE) => { drag.current = { y: e.clientY, p: pos.current }; try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* ignoré */ } }}
          onPointerMove={(e: RPE) => { const d = drag.current; if (d) move(d.p - (e.clientY - d.y)) }}
          onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
          onWheel={(e: RWE) => move(pos.current + e.deltaY)}
          onKeyDown={e => { if (e.key === ' ' ) { e.preventDefault(); toggle() } else if (e.key === 'ArrowDown') { e.preventDefault(); move(pos.current + size * 1.5) } else if (e.key === 'ArrowUp') { e.preventDefault(); move(pos.current - size * 1.5) } }}>
          <div ref={inner} className="tele-in" style={{ fontSize: size }}>{text || 'Écrivez ou collez votre texte pour le faire défiler ici.'}</div>
        </div>
        {end && <p className="ok" role="status" style={{ margin: '6px 0' }}>Fin du texte.</p>}
        {bar}
      </div>
    </>
  )
}
