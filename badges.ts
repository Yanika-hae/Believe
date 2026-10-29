import type { State } from './lib'

/** Plus longue suite de jours consécutifs parmi des dates AAAA-MM-JJ (calcul en UTC : le changement d'heure ne casse pas une série). */
export function longestRun(days: Iterable<string>): number {
  const u = [...new Set(days)].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).sort((a, b) => a - b)
  let best = 0, run = 0
  for (let i = 0; i < u.length; i++) { run = i > 0 && u[i] - u[i - 1] === 864e5 ? run + 1 : 1; if (run > best) best = run }
  return best
}
/** Jours où au moins une habitude existante a été cochée. */
export const checkedDays = (s: State) => Object.keys(s.checks).filter(d => (s.checks[d] ?? []).some(id => s.habits.some(h => h.id === id)))

export interface Badge { id: string; t: string; d: string; ok: (s: State) => boolean }
/**
 * Badges : chacun est calculé à partir de vos données réelles, avec un critère écrit en toutes lettres. Aucun ne dépend d'une donnée sensible
 * (poids, cycle, repas, prières, notes) : un badge partagé ne peut donc pas en révéler une.
 */
export const BADGES: Badge[] = [
  { id: 'debut', t: 'Premier pas', d: 'Cocher une habitude pour la première fois.', ok: s => checkedDays(s).length > 0 },
  { id: 'serie7', t: 'Sept jours de suite', d: 'Cocher au moins une habitude pendant 7 jours consécutifs.', ok: s => longestRun(checkedDays(s)) >= 7 },
  { id: 'serie30', t: 'Trente jours de suite', d: 'Cocher au moins une habitude pendant 30 jours consécutifs.', ok: s => longestRun(checkedDays(s)) >= 30 },
  { id: 'semaine', t: 'Semaine éclatante', d: 'Terminer une semaine (archivée) avec au moins 80 % de réussite.', ok: s => s.archives.some(a => a.rate >= 80) },
  { id: 'pas', t: 'Dix mille pas', d: 'Atteindre 10 000 pas en une journée.', ok: s => Object.values(s.steps).some(n => n >= 10000) },
  { id: 'livre', t: 'Livre terminé', d: 'Marquer un livre de « Mes livres » comme terminé.', ok: s => s.books.some(b => b.st === 'fini') },
  { id: 'quiz5', t: 'Sans faute', d: 'Obtenir tout juste à un quiz de 5 questions.', ok: s => s.quiz.hist.some(q => !q.rev && q.n >= 5 && q.ok === q.n) },
  { id: 'quiz10', t: 'Esprit curieux', d: 'Terminer 10 quiz.', ok: s => s.quiz.hist.filter(q => !q.rev).length >= 10 },
  { id: 'exo7', t: 'Voix posée', d: 'Faire au moins un exercice d’éloquence pendant 7 jours consécutifs.', ok: s => longestRun(Object.keys(s.exo.done).filter(d => (s.exo.done[d] ?? []).length > 0)) >= 7 },
  { id: 'impro10', t: 'Improvisateur', d: 'Terminer 10 improvisations.', ok: s => s.impro.hist.length >= 10 }
]
export const earnedBadges = (s: State): Badge[] => BADGES.filter(b => b.ok(s))
