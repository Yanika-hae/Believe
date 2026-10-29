import type { State } from './lib'
import { addD, iso, monday } from './lib'

const D = (d: string) => new Date(d + 'T00:00:00')
/** Série en cours d'une habitude à un jour donné (comme `streak`, mais pour un jour choisi : testable sans dépendre de l'horloge). */
export function streakAt(s: State, id: string, day: string): number {
  let d = D(day), n = 0
  if (!(s.checks[iso(d)] ?? []).includes(id)) d = addD(d, -1)
  while ((s.checks[iso(d)] ?? []).includes(id) && n < 3650) { n++; d = addD(d, -1) }
  return n
}

export interface Bilan {
  start: string; end: string
  /** Nombre de jours écoulés dans la semaine, aujourd'hui compris (1 à 7). */
  elapsed: number
  days: { d: string; pct: number; future: boolean }[]
  /** Réussite des habitudes du lundi à aujourd'hui, en %. */
  rate: number
  /** Habitude la plus cochée cette semaine (nom visible seulement sur l'appareil). */
  top: { n: string; c: number } | null
  steps10k: number
  quizzes: number; exoDays: number; improvs: number; pages: number
  /** Dernière semaine archivée avant celle-ci. */
  prev: { week: string; rate: number } | null
  /** Variation de poids depuis la dernière pesée d'avant la semaine (ou la première de la semaine) ; privé, jamais partagé sans choix explicite. */
  weight: number | null
}

/** Bilan de la semaine (lundi à dimanche) qui contient `day`, calculé uniquement à partir des données de l'appareil. */
export function bilanOf(s: State, day: string): Bilan {
  const m = monday(D(day)), ds = Array.from({ length: 7 }, (_, i) => iso(addD(m, i))), start = ds[0], end = ds[6]
  const elapsed = Math.max(1, ds.indexOf(day) + 1), ids = new Set(s.habits.map(h => h.id)), n = s.habits.length
  const cnt = (d: string) => new Set((s.checks[d] ?? []).filter(id => ids.has(id))).size
  const days = ds.map(d => ({ d, pct: n ? Math.round(100 * cnt(d) / n) : 0, future: d > day }))
  const past = ds.slice(0, elapsed), inWeek = (d: string) => d >= start && d <= day
  const done = past.reduce((a, d) => a + cnt(d), 0)
  let top: Bilan['top'] = null
  for (const h of s.habits) { const c = past.filter(d => (s.checks[d] ?? []).includes(h.id)).length; if (c > 0 && (!top || c > top.c)) top = { n: h.n, c } }
  const pr = s.archives.find(a => a.start < start)
  const kgs = [...s.weights].sort((a, b) => a.d.localeCompare(b.d)), last = [...kgs].reverse().find(w => w.d <= day), before = kgs.filter(w => w.d < start).pop() ?? kgs.find(w => w.d >= start && w.d <= day)
  return {
    start, end, elapsed, days,
    rate: n ? Math.round(100 * done / (n * elapsed)) : 0, top,
    steps10k: past.filter(d => (s.steps[d] ?? 0) >= 10000).length,
    quizzes: s.quiz.hist.filter(q => !q.rev && inWeek(q.d)).length,
    exoDays: past.filter(d => (s.exo.done[d] ?? []).length > 0).length,
    improvs: s.impro.hist.filter(h => inWeek(h.d)).length,
    pages: past.reduce((a, d) => a + (s.pages[d] ?? 0), 0),
    prev: pr ? { week: pr.week, rate: pr.rate } : null,
    weight: last && before && last.d !== before.d ? Math.round(10 * (last.kg - before.kg)) / 10 : null
  }
}
