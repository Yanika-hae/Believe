// Improvisation infinie : un sujet = un thème + une forme + une contrainte facultative + un public facultatif. Les combinaisons sont tirées sans répétition.
import type { State } from './lib'

type D = 0 | 1 | 2 | 3
/** Thèmes : [texte, difficulté 1 à 3]. 1 : concret et personnel ; 2 : idée ou valeur ; 3 : question de réflexion. */
const THEMES: [string, D][] = [
  ['Votre objet préféré', 1], ['Un souvenir d’enfance', 1], ['Votre plat préféré', 1], ['Une journée idéale', 1], ['Un lieu où vous vous sentez bien', 1],
  ['Le plus beau cadeau que vous ayez reçu', 1], ['Un métier que vous admirez', 1], ['Votre saison préférée', 1], ['Une personne qui vous a inspiré', 1], ['Un voyage que vous aimeriez faire', 1],
  ['Un animal que vous aimez', 1], ['Votre matinée parfaite', 1], ['Un livre ou un film qui vous a marqué', 1], ['Un petit geste qui change une journée', 1], ['Un talent que vous aimeriez avoir', 1],
  ['Un objet du quotidien dont on ne peut pas se passer', 1], ['Votre quartier ou votre village', 1], ['Une chanson qui vous donne de l’énergie', 1], ['Un jeu de votre enfance', 1], ['Un repas partagé entre amis ou en famille', 1],
  ['La patience', 2], ['Le courage au quotidien', 2], ['Pourquoi il faut lire', 2], ['La valeur d’une promesse tenue', 2], ['Apprendre de ses erreurs', 2],
  ['La gratitude', 2], ['Le pardon', 2], ['Que veut dire réussir ?', 2], ['Le rôle d’un mentor', 2], ['Le silence', 2],
  ['La générosité', 2], ['Le temps que l’on prend pour soi', 2], ['La discipline et la liberté', 2], ['Pourquoi s’entraîner chaque jour', 2], ['La confiance en soi', 2],
  ['L’amitié', 2], ['Le pouvoir des mots', 2], ['L’espérance dans les moments difficiles', 2], ['Savoir dire non', 2], ['La simplicité', 2],
  ['Faut-il toujours dire la vérité ?', 3], ['Le progrès rend-il l’homme meilleur ?', 3], ['Peut-on apprendre à être courageux ?', 3], ['La liberté a-t-elle des limites ?', 3], ['L’art est-il utile ?', 3],
  ['Vaut-il mieux avoir raison ou être en paix ?', 3], ['Le talent compte-t-il plus que le travail ?', 3], ['La lenteur est-elle une force ?', 3], ['Faut-il tout pardonner ?', 3], ['L’échec est-il un maître ?', 3],
  ['Que doit-on aux générations futures ?', 3], ['Le doute est-il une faiblesse ?', 3], ['Faut-il craindre le changement ?', 3], ['Peut-on être heureux seul ?', 3], ['L’éloquence est-elle un don ou un apprentissage ?', 3],
  ['Être fidèle à soi-même, est-ce rester immobile ?', 3], ['La foi et la raison s’opposent-elles ?', 3], ['Ce qui reste quand le bruit s’arrête', 3], ['Le luxe de prendre son temps', 3], ['La parole donnée vaut-elle un contrat ?', 3]
]
/** Formes : [consigne, difficulté 0 à 2]. */
const FORMATS: [string, D][] = [
  ['Traitez ce sujet sous forme de courte histoire.', 0], ['Expliquez ce sujet comme à un enfant de huit ans.', 0], ['Présentez ce sujet en trois points : un, deux, trois.', 0], ['Parlez-en comme à un ami proche.', 0], ['Illustrez votre propos avec un seul exemple vécu.', 0],
  ['Commencez par une question qui surprend.', 1], ['Présentez ce sujet comme une annonce à la radio.', 1], ['Défendez votre point de vue comme un avocat devant un jury.', 1], ['Gardez un ton calme et posé du début à la fin.', 1], ['Faites-en un petit discours de remerciement.', 1],
  ['Commencez par la fin, puis racontez comment on y arrive.', 2], ['Opposez deux points de vue, puis choisissez-en un.', 2]
]
/** Contraintes : [consigne, difficulté 0 à 2] ; la première (vide) signifie « aucune ». */
const CONSTRAINTS: [string, D][] = [
  ['', 0],
  ['Gardez un rythme lent, avec de vraies pauses.', 1], ['Terminez par une question au public.', 1], ['Utilisez au moins une comparaison.', 1], ['Marquez une pause d’une seconde après votre phrase d’ouverture.', 1],
  ['Utilisez une anaphore : trois phrases qui commencent pareil.', 2], ['Utilisez la règle de trois au moins une fois.', 2], ['Évitez « euh » et « du coup ».', 2], ['Faites des phrases de dix mots au plus.', 2], ['Utilisez une métaphore et une antithèse.', 2], ['Terminez par une phrase de moins de sept mots.', 2]
]
/** Publics : [texte, difficulté 0 à 1] ; le premier (vide) signifie « aucun public précisé ». */
const AUDIENCES: [string, D][] = [
  ['', 0], ['Imaginez-vous devant des collégiens.', 0], ['Imaginez-vous devant des collègues.', 0], ['Imaginez-vous lors d’un mariage.', 0], ['Imaginez-vous face à un ami qui doute.', 0],
  ['Imaginez-vous devant un jury attentif.', 1], ['Imaginez-vous devant une salle de mille personnes.', 1], ['Imaginez-vous au micro d’une radio.', 1], ['Imaginez-vous face à des inconnus dans un train.', 1]
]

export const IMPRO_TOTAL = THEMES.length * FORMATS.length * CONSTRAINTS.length * AUDIENCES.length
const SEEN_MAX = 1000, HIST_MAX = 1000
export const DIFF_LABEL = ['', 'Facile', 'Accessible', 'Moyen', 'Exigeant', 'Très exigeant']
export const DURATIONS = [60, 120, 180, 300]

export interface Subject { id: string; theme: string; format: string; constraint: string; audience: string; text: string; diff: number; label: string; why: string }

const enc = (t: number, f: number, c: number, a: number) => [t, f, c, a].map(n => n.toString(36)).join('.')
/** Reconstruit un sujet depuis son identifiant, ou null si l'identifiant n'a pas de sens. */
export function decode(id: string): Subject | null {
  const m = /^([0-9a-z]+)\.([0-9a-z]+)\.([0-9a-z]+)\.([0-9a-z]+)$/.exec(id)
  if (!m) return null
  const [t, f, c, a] = m.slice(1).map(x => parseInt(x, 36))
  const T = THEMES[t], F = FORMATS[f], C = CONSTRAINTS[c], A = AUDIENCES[a]
  if (!T || !F || !C || !A || enc(t, f, c, a) !== id) return null
  const sum = T[1] + F[1] + C[1] + A[1], diff = 1 + Math.round((sum - 1) * 4 / 7)
  const why = [['', 'thème concret', 'thème d’idées', 'thème de réflexion'][T[1]], ['format simple', 'format travaillé', 'format exigeant'][F[1]], C[0] ? (C[1] === 1 ? 'contrainte légère' : 'contrainte technique') : 'sans contrainte', A[0] ? (A[1] ? 'public impressionnant' : 'public familier') : 'public libre'].join(', ')
  return { id, theme: T[0], format: F[0], constraint: C[0], audience: A[0], text: ['Sujet : ' + (/[?.!…]$/.test(T[0]) ? T[0] : T[0] + '.'), F[0], C[0], A[0]].filter(Boolean).join(' '), diff, label: DIFF_LABEL[diff], why }
}

/**
 * Tire un nouveau sujet (à appeler dans une mise à jour d'état) : combinaison jamais proposée, avec un thème différent des trois derniers sujets.
 * L'identifiant est enregistré dans `impro.seen` (les 1 000 derniers sont gardés) et devient le sujet courant.
 */
export function drawSubject(s: State, rnd: () => number = Math.random): Subject {
  const seen = new Set(s.impro.seen), recent = new Set(s.impro.seen.slice(-3).map(x => parseInt(x.split('.')[0], 36)))
  const r = (n: number) => Math.min(n - 1, Math.floor(rnd() * n))
  let id = ''
  for (let i = 0; i < 200 && (!id || seen.has(id)); i++) {
    let t = r(THEMES.length)
    for (let k = 0; k < 20 && recent.has(t); k++) t = r(THEMES.length)
    id = enc(t, r(FORMATS.length), r(CONSTRAINTS.length), r(AUDIENCES.length))
  }
  s.impro.seen.push(id)
  if (s.impro.seen.length > SEEN_MAX) s.impro.seen.splice(0, s.impro.seen.length - SEEN_MAX)
  s.impro.cur = id
  return decode(id)!
}
/** Sujet courant (tiré une première fois si besoin) : identifiant conservé d'une ouverture à l'autre. */
export const current = (s: State): Subject | null => (s.impro.cur ? decode(s.impro.cur) : null)

/** Enregistre une improvisation terminée (uniquement sur action explicite) : sujet courant, difficulté, durée réelle en secondes. */
export function finishImpro(s: State, day: string, sec: number): boolean {
  const sub = current(s)
  if (!sub) return false
  s.impro.hist.push({ d: day, id: sub.id, diff: sub.diff, sec: Math.max(0, Math.min(7200, Math.round(sec))) })
  if (s.impro.hist.length > HIST_MAX) s.impro.hist.splice(0, s.impro.hist.length - HIST_MAX)
  return true
}
