// Logique pure des exercices d'éloquence : 5 exercices de familles différentes par jour, sans répétition rapprochée.
import { EXOS, KIND_KEYS } from './exobank'
import type { ExoItem, ExoKind } from './exobank'
import type { State } from './lib'

export type { ExoItem, ExoKind }
export { EXOS, KINDS } from './exobank'
/** Nombre d'exercices proposés chaque jour. */
export const PER_DAY = 5
/** Un exercice ne revient qu'après au moins 55 autres exercices servis, soit 11 jours : les 55 derniers sont écartés du tirage. */
export const WINDOW = 55
const KEEP = 200, DONE_DAYS = 400
const byId = new Map(EXOS.map(e => [e.id, e]))
export const exoById = (id: string): ExoItem | undefined => byId.get(id)

/** Tire jusqu'à `k` exercices de familles différentes (les familles qui ont le plus d'exercices restants sont favorisées), puis complète avec d'autres exercices si besoin. */
function draw(pool: ExoItem[], k: number, rnd: () => number): ExoItem[] {
  const out: ExoItem[] = [], left = pool.slice(), used = new Set<ExoKind>()
  const rm = (e: ExoItem) => { left.splice(left.indexOf(e), 1); out.push(e) }
  while (out.length < k) {
    const open = KIND_KEYS.filter(x => !used.has(x) && left.some(e => e.k === x))
    if (!open.length) break
    const w = open.map(x => left.filter(e => e.k === x).length), tot = w.reduce((a, b) => a + b, 0)
    let r = rnd() * tot, i = 0
    while (i < open.length - 1 && r >= w[i]) { r -= w[i]; i++ }
    const of = left.filter(e => e.k === open[i])
    used.add(open[i]); rm(of[Math.min(of.length - 1, Math.floor(rnd() * of.length))])
  }
  while (out.length < k && left.length) rm(left[Math.min(left.length - 1, Math.floor(rnd() * left.length))])
  return out
}

/**
 * Exercices du jour (à appeler dans une mise à jour d'état). Le lot du jour est stable : le rouvrir le même jour donne les mêmes exercices, et un jour sans
 * ouverture n'en consomme aucun. Un nouveau jour tire 5 exercices de familles différentes parmi ceux qui ne figurent pas dans les 55 derniers servis.
 * Les identifiants servis sont enregistrés (`exo.seen`, du plus ancien au plus récent) avant l'affichage.
 */
export function ensureDaily(s: State, day: string, rnd: () => number = Math.random): ExoItem[] {
  const cur = s.exo.cur
  if (cur && cur.d === day) return cur.ids.map(id => byId.get(id)).filter((e): e is ExoItem => !!e)
  const known = s.exo.seen.filter(id => byId.has(id)), w = Math.max(0, Math.min(WINDOW, EXOS.length - 2 * PER_DAY))
  const recent = new Set(w ? known.slice(-w) : [])
  const chosen = draw(EXOS.filter(e => !recent.has(e.id)), PER_DAY, rnd)
  s.exo.seen = known.concat(chosen.map(e => e.id)).slice(-KEEP)
  s.exo.cur = { d: day, ids: chosen.map(e => e.id) }
  return chosen
}

/** Marque un exercice du jour comme fait (uniquement sur action explicite). Renvoie true si c'est nouveau. */
export function markDone(s: State, id: string, day: string): boolean {
  if (!byId.has(id) || !s.exo.cur || s.exo.cur.d !== day || !s.exo.cur.ids.includes(id)) return false
  const a = s.exo.done[day] ?? (s.exo.done[day] = [])
  if (a.includes(id)) return false
  a.push(id)
  const ks = Object.keys(s.exo.done).sort()
  while (ks.length > DONE_DAYS) delete s.exo.done[ks.shift()!]
  return true
}
/** Retire la marque « fait » (correction d'un clic involontaire). */
export function unmarkDone(s: State, id: string, day: string): boolean {
  const a = s.exo.done[day]
  if (!a || !a.includes(id)) return false
  s.exo.done[day] = a.filter(x => x !== id)
  if (!s.exo.done[day].length) delete s.exo.done[day]
  return true
}
export const doneOn = (s: State, day: string) => (s.exo.done[day] ?? []).filter(id => byId.has(id)).length
/** Nombre de jours consécutifs (jusqu'à `day`, ou la veille si rien n'est encore fait aujourd'hui) avec au moins un exercice fait. */
export function exoStreak(s: State, day: string, prev: (d: string) => string): number {
  let d = (s.exo.done[day] ?? []).length ? day : prev(day), n = 0
  while ((s.exo.done[d] ?? []).length && n < 3650) { n++; d = prev(d) }
  return n
}
/** Nombre d'exercices différents déjà proposés (sur l'ensemble de la banque). */
export const discovered = (s: State) => new Set(s.exo.seen.filter(id => byId.has(id))).size
