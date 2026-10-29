// Logique pure du quiz de l'Académie : tirage sans répétition, mélange stable des réponses, validation des questions générées par IA.
import { BANK } from './quizbank'
import type { Q } from './quizbank'
import { QCATS } from './data'
import type { QCat } from './data'
import type { GenQ, State } from './lib'
import { norm } from './util'

export { QCATS }
export type { Q, QCat }
/** Nombre de questions d'un quiz (une par catégorie pour le quiz du jour). */
export const PER_QUIZ = 5
/** Nombre maximal de questions générées par IA gardées sur l'appareil. */
export const GEN_MAX = 300
const HIST_MAX = 1000, SEEN_MAX = 5000

const cache = new Map<string, string>()
/**
 * Empreinte d'une question (cyrb53, base 36) calculée sur son texte sans accents, sans casse et sans ponctuation : deux questions qui ne diffèrent
 * que par la mise en forme ont la même empreinte, ce qui permet de repérer un doublon même si son identifiant est différent.
 */
export function qhash(text: string): string {
  const hit = cache.get(text)
  if (hit) return hit
  const s = norm(text).replace(/[^a-z0-9]+/g, ' ').trim()
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const r = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  if (cache.size > 2000) cache.clear()
  cache.set(text, r)
  return r
}

// ---------------------------------------------------------------- réponses : mélange stable
const seedOf = (id: string) => { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
const mulberry32 = (a: number) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
/**
 * Ordre d'affichage des quatre réponses, mélangé de façon déterministe d'après l'identifiant de la question : la bonne réponse n'est pas toujours
 * la même lettre, et la question s'affiche toujours dans le même ordre. `order[k]` : indice d'origine de la réponse affichée en position k ;
 * `ok` : position affichée de la bonne réponse.
 */
export function view(q: Q): { order: number[]; ok: number } {
  const r = mulberry32(seedOf(q.id)), order = [0, 1, 2, 3]
  for (let i = 3; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t }
  return { order, ok: order.indexOf(q.a) }
}

// ---------------------------------------------------------------- banque
/** Toutes les questions disponibles : banque intégrée, puis questions générées par IA gardées sur l'appareil. */
export const allQ = (s: State): Q[] => (s.quiz.gen.length ? BANK.concat(s.quiz.gen.map(g => ({ ...g, ia: true }))) : BANK)
export const qById = (s: State, id: string): Q | undefined => allQ(s).find(q => q.id === id)
const served = (s: State) => ({ seen: new Set(s.quiz.seen), hashes: new Set(s.quiz.hashes) })
const isServed = (q: Q, v: { seen: Set<string>; hashes: Set<string> }) => v.seen.has(q.id) || v.hashes.has(qhash(q.q))
/** Questions jamais servies (ni par identifiant, ni par empreinte du texte). */
export const unseen = (s: State): Q[] => { const v = served(s); return allQ(s).filter(q => !isServed(q, v)) }
/** Questions déjà servies (pour la révision). */
export const seenQs = (s: State): Q[] => { const v = served(s); return allQ(s).filter(q => isServed(q, v)) }
export function remaining(s: State) {
  const u = unseen(s)
  return { total: u.length, byCat: Object.fromEntries(QCATS.map(c => [c, u.filter(q => q.c === c).length])) as Record<QCat, number> }
}

// ---------------------------------------------------------------- quiz en cours
/** Questions du quiz en cours (celles qui n'existent plus sont ignorées). */
export function curQs(s: State): Q[] {
  const cur = s.quiz.cur
  if (!cur) return []
  const m = new Map(allQ(s).map(q => [q.id, q]))
  return cur.ids.map(id => m.get(id)).filter((q): q is Q => !!q)
}
export function progress(s: State) {
  const cur = s.quiz.cur, qs = curQs(s)
  const answered = cur ? qs.filter(q => cur.ans[q.id] !== undefined).length : 0, ok = cur ? qs.filter(q => cur.ans[q.id] === q.a).length : 0
  return { n: qs.length, answered, ok, done: qs.length > 0 && answered === qs.length }
}
/** Vrai si un quiz est commencé et pas terminé. */
export const inProgress = (s: State) => { const p = progress(s); return p.n > 0 && !p.done }

const shuffle = <T,>(a: T[], rnd: () => number): T[] => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = r[i]; r[i] = r[j]; r[j] = t } return r }

export interface StartOpts { cat?: QCat; n?: number; rev?: boolean }
export type Start = { ok: true; n: number } | { ok: false; why: 'encours' | 'epuise' }
/**
 * Démarre un quiz (à appeler dans une mise à jour d'état). Quiz du jour : une question par catégorie, jamais servie auparavant ; si une catégorie est épuisée,
 * les questions manquantes viennent des autres. Les questions sont enregistrées comme « vues » dès leur attribution (identifiant ET empreinte du texte),
 * donc elles ne reviennent jamais, même si le quiz est quitté en cours de route. `rev` : révision de questions déjà vues (ne modifie pas la liste des questions vues).
 */
export function startQuiz(s: State, day: string, o: StartOpts = {}, rnd: () => number = Math.random): Start {
  if (inProgress(s)) return { ok: false, why: 'encours' }
  const n = Math.max(1, Math.min(10, Math.floor(o.n ?? PER_QUIZ)))
  const taken = new Set<string>(), picks: Q[] = []
  const take = (q: Q | undefined) => { if (q && picks.length < n && !taken.has(qhash(q.q))) { taken.add(qhash(q.q)); picks.push(q) } }
  const pool = (o.rev ? seenQs(s) : unseen(s)).filter(q => !o.cat || q.c === o.cat)
  if (!pool.length) return { ok: false, why: 'epuise' }
  if (o.cat || o.rev) { for (const q of shuffle(pool, rnd)) take(q) } else {
    for (const c of shuffle([...QCATS], rnd)) take(shuffle(pool.filter(q => q.c === c), rnd)[0])
    const left = shuffle(pool, rnd)
    const count = (c: QCat) => left.filter(q => q.c === c && !taken.has(qhash(q.q))).length
    while (picks.length < n) { // catégories épuisées : on complète avec celle qui a le plus de questions restantes
      const c = QCATS.reduce<QCat | null>((b, x) => (count(x) > (b ? count(b) : 0) ? x : b), null)
      if (!c) break
      take(left.find(q => q.c === c && !taken.has(qhash(q.q))))
    }
  }
  if (!picks.length) return { ok: false, why: 'epuise' }
  const ids = shuffle(picks, rnd).map(q => q.id)
  if (!o.rev) {
    for (const q of picks) { s.quiz.seen.push(q.id); s.quiz.hashes.push(qhash(q.q)) }
    if (s.quiz.seen.length > SEEN_MAX) s.quiz.seen.splice(0, s.quiz.seen.length - SEEN_MAX)
    if (s.quiz.hashes.length > SEEN_MAX) s.quiz.hashes.splice(0, s.quiz.hashes.length - SEEN_MAX)
  }
  s.quiz.cur = { d: day, ids, ans: {}, ...(o.rev ? { rev: true } : {}) }
  return { ok: true, n: ids.length }
}

/**
 * Enregistre la réponse choisie (indice d'origine 0 à 3). Seule la première réponse compte : elle ne se modifie pas. Quand la dernière question
 * est répondue, le résultat est ajouté une seule fois à l'historique. Renvoie true si la réponse a été prise en compte.
 */
export function answerQ(s: State, id: string, choice: number): boolean {
  const cur = s.quiz.cur
  if (!cur || !cur.ids.includes(id) || !Number.isInteger(choice) || choice < 0 || choice > 3 || cur.ans[id] !== undefined || !qById(s, id)) return false
  cur.ans[id] = choice
  const p = progress(s)
  if (p.done) {
    s.quiz.hist.push({ d: cur.d, n: p.n, ok: p.ok, cats: [...new Set(curQs(s).map(q => q.c))], ...(cur.rev ? { rev: true } : {}) })
    if (s.quiz.hist.length > HIST_MAX) s.quiz.hist.splice(0, s.quiz.hist.length - HIST_MAX)
  }
  return true
}

/** Statistiques de l'historique (les révisions sont comptées à part). */
export function stats(s: State) {
  const real = s.quiz.hist.filter(h => !h.rev), n = real.reduce((a, h) => a + h.n, 0), ok = real.reduce((a, h) => a + h.ok, 0)
  return { runs: real.length, revisions: s.quiz.hist.length - real.length, answered: n, ok, pct: n ? Math.round(100 * ok / n) : null, best: real.reduce((b, h) => Math.max(b, Math.round(100 * h.ok / h.n)), 0) }
}

// ---------------------------------------------------------------- questions générées par IA
const THEME: Record<QCat, string> = {
  Vocabulaire: 'sens de mots, expressions imagées, orthographe et conjugaison',
  Définitions: 'définition de notions, de concepts et de termes savants',
  Rhétorique: 'art de parler en public, figures de style, argumentation, orateurs célèbres',
  'Culture générale': 'histoire, géographie, sciences, arts et littérature',
  Biblique: 'personnages, livres et récits de la Bible (version Louis Segond)'
}
/** Texte envoyé à l'IA pour obtenir des questions (aucune donnée personnelle : seule la catégorie y figure). */
export const genRequest = (cat: QCat) =>
  'Écris 6 questions de quiz à choix multiples, en français, de niveau intermédiaire, sur le thème « ' + cat + ' » (' + THEME[cat] + '). ' +
  'Chaque question a exactement 4 réponses possibles dont une seule est correcte, et une explication d’une ou deux phrases. ' +
  'Utilise uniquement des faits stables et vérifiables, jamais d’actualité. Réponds uniquement avec un tableau JSON, sans aucun texte autour, de la forme : ' +
  '[{"q":"…","o":["…","…","…","…"],"a":0,"e":"…"}] où "a" est l’indice (de 0 à 3) de la bonne réponse.'

const clean = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '').slice(0, max + 1)
/**
 * Contrôle strict de la réponse de l'IA : une question est refusée si sa forme est invalide (texte trop court ou trop long, pas exactement
 * quatre réponses distinctes, indice hors limites, explication absente) ou si elle fait doublon (banque, questions déjà vues ou lot en cours).
 */
export function parseGen(raw: unknown, cat: QCat, s: State): { add: GenQ[]; invalid: number; dup: number } {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { questions?: unknown }).questions) ? (raw as { questions: unknown[] }).questions : []
  const known = new Set(allQ(s).map(q => qhash(q.q))), v = served(s), add: GenQ[] = []
  let invalid = 0, dup = 0
  for (const it of list.slice(0, 12)) {
    const r = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
    const q = clean(r.q, 300), e = clean(r.e, 500), o = Array.isArray(r.o) ? r.o.map(x => clean(x, 140).replace(/^[A-Da-d]\s*[).:-]\s+/, '')) : []
    const ok = q.length >= 12 && q.length <= 300 && o.length === 4 && o.every(x => x.length >= 1 && x.length <= 140) && new Set(o.map(norm)).size === 4 &&
      typeof r.a === 'number' && Number.isInteger(r.a) && r.a >= 0 && r.a <= 3 && e.length >= 10 && e.length <= 500
    if (!ok) { invalid++; continue }
    const h = qhash(q), id = 'g' + h
    if (known.has(h) || v.hashes.has(h) || v.seen.has(id)) { dup++; continue }
    known.add(h)
    add.push({ id, c: cat, q, o, a: r.a as number, e })
  }
  return { add, invalid, dup }
}
/** Ajoute des questions générées à la banque de l'appareil (sans doublon, dans la limite de GEN_MAX) ; renvoie le nombre ajouté. */
export function addGen(s: State, qs: GenQ[]): number {
  const known = new Set(allQ(s).map(q => qhash(q.q)))
  let n = 0
  for (const q of qs) {
    const h = qhash(q.q)
    if (s.quiz.gen.length >= GEN_MAX) break
    if (known.has(h) || s.quiz.hashes.includes(h)) continue
    s.quiz.gen.push(q); known.add(h); n++
  }
  return n
}
