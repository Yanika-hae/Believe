import { useEffect, useState } from 'react'
import { left } from './cal'

/** Minuteur Pomodoro hors de React : il continue quand on change de rubrique. */
export const pm = { mins: 25, st: 'idle' as 'idle' | 'run' | 'pause', end: 0, rest: 25 * 60, finished: false }
const subs = new Set<() => void>()
const bump = () => subs.forEach(f => f())
export function usePomo() {
  const [, setN] = useState(0)
  useEffect(() => { const f = () => setN(n => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  return pm
}
/** Un seul minuteur, hors de React : évite les doubles décomptes quand plusieurs composants observent le Pomodoro. */
let tm: ReturnType<typeof setInterval> | undefined
const stopT = () => { if (tm) clearInterval(tm); tm = undefined }
const tick = () => {
  if (left(pm.end) <= 0) { stopT(); pm.st = 'idle'; pm.rest = pm.mins * 60; pm.finished = true; try { navigator.vibrate([200, 100, 200]) } catch { /* ignoré */ } }
  bump()
}
export const startP = () => { stopT(); pm.end = Date.now() + pm.rest * 1000; pm.st = 'run'; tm = setInterval(tick, 1000); bump() }
export const pauseP = () => { stopT(); pm.rest = left(pm.end); pm.st = 'pause'; bump() }
export const resetP = () => { stopT(); pm.st = 'idle'; pm.rest = pm.mins * 60; bump() }
export const setMins = (m: number) => { if (pm.st === 'idle') { pm.mins = m; pm.rest = m * 60; bump() } }
