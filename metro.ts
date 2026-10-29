import { plan } from './util'

/** Avance de programmation (secondes) : les clics sont déposés dans l'horloge audio un peu à l'avance, ce qui garde un rythme régulier même si l'interface rame. */
export const AHEAD = 0.12
const EVERY = 25

/** Clic doux (sinusoïde brève) ; le premier temps de la mesure est plus aigu et plus fort. */
function click(ctx: AudioContext, t: number, accent: boolean) {
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = 'triangle'; o.frequency.value = accent ? 1320 : 880
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.35, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1)
}

/** Métronome : programme les battements avec l'horloge audio (précise), et prévient l'interface au moment où chaque battement est audible. */
export class Metro {
  bpm = 90
  beats = 4
  sound = true
  onBeat: (beat: number) => void = () => undefined
  private ctx: AudioContext | null = null
  private timer = 0
  private st = { next: 0, beat: 0 }
  private q: { t: number; b: number }[] = []
  get running() { return this.timer !== 0 }

  /** À appeler depuis un geste de l'utilisateur (règle des navigateurs pour l'audio). Renvoie false si l'audio n'est pas disponible. */
  start(): boolean {
    if (this.timer) return true
    const AC = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined
    if (!AC) return false
    try { this.ctx = new AC() } catch { return false }
    void this.ctx.resume?.()
    this.st = { next: this.ctx.currentTime + 0.06, beat: 0 }; this.q = []
    this.timer = window.setInterval(() => this.tick(), EVERY)
    this.tick()
    return true
  }
  /** Un tour de programmation : à appeler à intervalle régulier (public pour les tests). */
  tick() {
    const ctx = this.ctx
    if (!ctx) return
    const r = plan(this.st, ctx.currentTime, AHEAD, this.bpm, this.beats)
    this.st = { next: r.next, beat: r.beat }
    for (const e of r.ev) { if (this.sound) click(ctx, e.t, e.b === 0); this.q.push(e) }
    let last = -1
    while (this.q.length && this.q[0].t <= ctx.currentTime) last = this.q.shift()!.b
    if (last >= 0) this.onBeat(last)
  }
  stop() {
    clearInterval(this.timer); this.timer = 0; this.q = []
    const c = this.ctx; this.ctx = null
    try { void c?.close?.() } catch { /* déjà fermé */ }
  }
}
