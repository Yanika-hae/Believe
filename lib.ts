import { BOOK_HOSTS, CATS, DH, NOTE_CATS, QCATS, ROLES, ROLE_PREFIX, SHARE_KEYS, VF, VM } from './data'
import type { NoteCat, QCat, Role, Verse } from './data'
import type { Meal } from './health'
import type { Task } from './cal'
import * as V from './schema'
import { closeKeys, isEnv, seal, unlocked, unseal } from './keys'
import { hasVault } from './pin'
export * from './data'

export type Lv = 'S' | 'I' | 'A'
export interface Habit { id: string; n: string; c: string; k?: Role }
export interface Profile { g: 'F' | 'M'; name: string; age: number; h: number; w: number; t: number; ws: number; lv: Lv; sx: 'F' | 'M' }
export interface Archive { week: string; start: string; rate: number; n: number; per: Record<string, number> }
export interface Note { id: string; cat: NoteCat; t: string; b: string; c: string; u: string }
/** Sujet du mur de prières : `c` date de création, `a` date d'exaucement (null tant que la prière n'est pas exaucée) ; `k: 'g'` : gratitude (jamais exaucée, jamais partagée). */
export interface Prayer { id: string; t: string; c: string; a: string | null; k?: 'g' }
export type BookSrc = 'cat' | 'ol' | 'gb' | 'gu' | 'lv' | 'perso'
/** Fiche de lecture générée par IA à la demande de l'utilisateur, gardée avec le livre (m : modèle utilisé, d : date de génération). */
export interface Fiche { idee: string; points: string[]; retenir: string; pour: string; fia: string; m: string; d: string }
/** Livre de « Mes livres » : `page` est le marque-page, `desc` le descriptif du catalogue d'origine (envoyé à l'IA seulement si l'utilisateur demande une fiche), `f` la fiche de lecture gardée. */
export interface MyBook { id: string; t: string; a: string; src: BookSrc; ref: string; cover: string | null; url: string | null; total: number | null; page: number; st: 'lire' | 'cours' | 'fini'; desc?: string; f?: Fiche | null }
/** Marque-page de l'habitude « 20 pages de cours » : intitulé libre, page atteinte et pages lues par jour. */
export interface Course { n: string; page: number; days: Record<string, number> }
/** `cloud` : compte en ligne facultatif (connexion Google, synchronisation, cercles d'amis, rappels application fermée) ; chaque usage a en plus son propre réglage. */
export interface Consents { ai: boolean; photo: boolean; health: boolean; motion: boolean; mic: boolean; speech: boolean; notif: boolean; share: boolean; cloud: boolean }
export type CK = keyof Consents
/** `remind` : minutes avant l'échéance d'une tâche pour le rappel (0 = à l'heure). */
export interface Settings { theme: 'auto' | 'light' | 'dark' | 'oled'; motion: 'auto' | 'reduced'; haptics: boolean; sounds: boolean; remind: 0 | 10 | 30 | 60 | 120 }
export interface Prompter { text: string; speed: number; size: number; bpm: number; beats: 2 | 3 | 4 | 6 }
/** Un quiz terminé : date de début, nombre de questions, bonnes réponses, catégories abordées ; `rev` : quiz de révision (questions déjà vues). */
export interface QuizRun { d: string; n: number; ok: number; cats: string[]; rev?: boolean }
/** Question générée par IA et gardée sur l'appareil (`o` : les 4 réponses, `a` : indice de la bonne). */
export interface GenQ { id: string; c: QCat; q: string; o: string[]; a: number; e: string }
/**
 * Quiz de l'Académie. `seen` : identifiants des questions déjà servies ; `hashes` : empreintes de leur texte (contrôle des doublons même si l'identifiant diffère) ;
 * `cur` : quiz en cours ou terminé (`ans` : indice d'origine de la réponse choisie) ; `gen` : questions générées par IA.
 */
export interface Quiz { seen: string[]; hashes: string[]; hist: QuizRun[]; cur: { d: string; ids: string[]; ans: Record<string, number>; rev?: boolean } | null; gen: GenQ[] }
export interface Exo { seen: string[]; cur: { d: string; ids: string[] } | null; done: Record<string, string[]> }
/** Improvisation : `seen` sujets déjà proposés (identifiants de combinaisons), `cur` sujet affiché, `hist` improvisations terminées. */
export interface Impro { seen: string[]; hist: { d: string; id: string; diff: number | null; sec: number }[]; cur: string | null }
/** Suivi facultatif de la rubrique 8. `starts` : débuts des règles (suivi du cycle) ; `en` : énergie du jour de 1 à 5 (suivi du cycle) ; `rec` : récupération nerveuse, force et vitalité du jour, de 1 à 5 (suivi de la récupération). Les notes des deux suivis sont gardées séparément : changer de suivi n'en efface ni n'en confond aucune. */
export interface Cycle { mode: 'off' | 'cycle' | 'recup'; starts: string[]; rec: Record<string, [number, number, number]>; en: Record<string, number> }
export interface State {
  v: 2; profile: Profile | null; habits: Habit[]; checks: Record<string, string[]>; weekStart: string | null
  archives: Archive[]; discret: boolean; verse: { d: string; i: number } | null; consents: Consents
  steps: Record<string, number>
  weights: { d: string; kg: number }[]; water: Record<string, number>; sleep: Record<string, number>; meals: Meal[]
  tasks: Task[]; pomos: Record<string, number>; playlist: { id: string; t: string; k: 'danse' | 'louange' }[]
  notes: Note[]; prompter: Prompter; prayers: Prayer[]; books: MyBook[]; pages: Record<string, number>; course: Course
  quiz: Quiz; exo: Exo; impro: Impro; cycle: Cycle
  /** ui.covers : afficher les couvertures de livres hébergées par des sites tiers (désactivé par défaut : ces sites verraient l'adresse IP). */
  share: { vis: Record<string, boolean> }; settings: Settings; ui: { onboard: boolean; verseDay: string | null; covers: boolean }
}

/** Clé de l'état courant (v2). L'ancienne clé v1 est lue une fois pour migrer, puis retirée : un retour à une ancienne version ne peut pas écraser les données v2. */
export const KEY = 'believe:v2'
export const KEY1 = 'believe:v1'
export const KEY_BAK = 'believe:illisible'
export const DEF = (): State => ({
  v: 2, profile: null, habits: DH.map((h, i) => ({ id: 'h' + (i + 1), n: h[0], c: h[1], k: h[2] })), checks: {},
  weekStart: null, archives: [], discret: false, verse: null,
  consents: { ai: false, photo: false, health: false, motion: false, mic: false, speech: false, notif: false, share: false, cloud: false },
  steps: {}, weights: [], water: {}, sleep: {}, meals: [], tasks: [], pomos: {}, playlist: [],
  notes: [], prompter: { text: '', speed: 40, size: 32, bpm: 90, beats: 4 }, prayers: [], books: [], pages: {}, course: { n: '', page: 0, days: {} },
  quiz: { seen: [], hashes: [], hist: [], cur: null, gen: [] }, exo: { seen: [], cur: null, done: {} }, impro: { seen: [], hist: [], cur: null },
  cycle: { mode: 'off', starts: [], rec: {}, en: {} }, share: { vis: {} },
  settings: { theme: 'auto', motion: 'auto', haptics: true, sounds: true, remind: 30 }, ui: { onboard: false, verseDay: null, covers: false }
})

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
export const addD = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const monday = (d: Date) => addD(d, -((d.getDay() + 6) % 7))
export const today = () => iso(new Date())
/** Semaine ISO 8601 (lundi→dimanche) : [année ISO, numéro]. Calcul en UTC pour ignorer le changement d'heure. */
export const isoWk = (d: Date): [number, number] => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const y = t.getUTCFullYear()
  return [y, Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)]
}
export const dayIdx = () => {
  const n = new Date()
  return Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() - new Date(n.getFullYear(), 0, 0).getTime()) / 864e5)
}
let seq = 0
/** Identifiant court, distinct même si deux éléments sont créés dans la même milliseconde. */
export const uid = (p: string) => p + Date.now().toString(36) + (seq++ % 1296).toString(36) + Math.random().toString(36).slice(2, 5)
/** Habitude d'un rôle : trouvée par son rôle (qui survit au renommage), à défaut par le début de son nom d'origine (données plus anciennes). */
export const habitOf = (s: { habits: Habit[] }, role: Role): Habit | undefined => s.habits.find(h => h.k === role) ?? s.habits.find(h => !h.k && h.n.startsWith(ROLE_PREFIX[role]))
/** Coche l'habitude d'un rôle pour un jour ; renvoie true si elle vient d'être cochée (jamais décochée automatiquement). */
export const markHabit = (s: State, role: Role, k = today()): boolean => {
  const h = habitOf(s, role)
  if (!h) return false
  const a = s.checks[k] ?? (s.checks[k] = [])
  if (a.includes(h.id)) return false
  a.push(h.id); return true
}

// ---------------------------------------------------------------- schéma de l'état (v2)
const fin = V.num()
const parsable: V.V = (x, p) => (typeof x === 'string' && !isNaN(Date.parse(x)) ? null : p + ' : date attendue')
const link = V.nul(V.httpsUrl(BOOK_HOSTS))
const DAYKEY = /^\d{4}-\d{2}-\d{2}$/
const tri: V.V = (x, p) => (Array.isArray(x) && x.length === 3 && x.every(n => Number.isInteger(n) && n >= 1 && n <= 5) ? null : p + ' : trois notes de 1 à 5 attendues')
const fiche = V.obj({ idee: V.str(800), points: V.arr(V.str(400), 8), retenir: V.str(600), pour: V.str(300), fia: V.str(500), m: V.str(100), d: V.day })
const choice = V.str(140, 1)
const genQ = V.obj({ id: V.str(40, 1), c: V.lit(...QCATS), q: V.str(300, 5), o: V.tup(choice, choice, choice, choice), a: V.int(0, 3), e: V.str(500) })
const shareKey = new RegExp('^(' + SHARE_KEYS.join('|') + ')$')
const schema = V.obj({
  v: V.lit(2),
  profile: V.nul(V.obj({ g: V.lit('F', 'M'), name: V.str(100), age: fin, h: fin, w: fin, t: fin, ws: fin, lv: V.opt(V.lit('S', 'I', 'A')), sx: V.lit('F', 'M') })),
  habits: V.arr(V.obj({ id: V.str(80, 1), n: V.str(200), c: V.lit(...CATS), k: V.opt(V.lit(...ROLES)) }), 500),
  checks: V.rec(V.arr(V.str(80), 500)),
  weekStart: V.nul(V.str(20)),
  archives: V.arr(V.obj({ week: V.str(40), start: V.str(40), rate: fin, n: fin, per: V.rec(fin, 500) }), 2000),
  discret: V.bool,
  verse: V.nul(V.obj({ d: V.str(20), i: V.int(0, 100000) })),
  consents: V.obj({ ai: V.bool, photo: V.bool, health: V.bool, motion: V.bool, mic: V.bool, speech: V.bool, notif: V.bool, share: V.bool, cloud: V.bool }),
  steps: V.rec(fin),
  weights: V.arr(V.obj({ d: V.str(40), kg: fin }), 10000),
  water: V.rec(fin), sleep: V.rec(fin),
  meals: V.arr(V.obj({ id: V.str(80), d: V.str(40), n: V.str(200), kcal: fin, p: fin, g: fin, l: fin, src: V.opt(V.lit('manuel', 'IA')) }), 20000),
  tasks: V.arr(V.obj({ id: V.str(80), t: V.str(300), imp: V.bool, done: V.bool, due: V.nul(parsable), p: V.opt(V.nul(V.lit(1, 2, 3, 4))), r: V.opt(V.str(40)) }), 5000),
  pomos: V.rec(fin),
  playlist: V.arr(V.obj({ id: V.pat(/^[A-Za-z0-9_-]{11}$/), t: V.str(300), k: V.lit('danse', 'louange') }), 100),
  notes: V.arr(V.obj({ id: V.str(80, 1), cat: V.lit(...NOTE_CATS), t: V.str(120), b: V.str(20000), c: V.stamp, u: V.stamp }), 3000),
  prompter: V.obj({ text: V.str(20000), speed: V.num(5, 300), size: V.num(14, 96), bpm: V.num(30, 240), beats: V.lit(2, 3, 4, 6) }),
  prayers: V.arr(V.obj({ id: V.str(80, 1), t: V.str(500, 1), c: V.day, a: V.nul(V.day), k: V.opt(V.lit('g')) }), 1000),
  books: V.arr(V.obj({ id: V.str(80, 1), t: V.str(200, 1), a: V.str(200), src: V.lit('cat', 'ol', 'gb', 'gu', 'lv', 'perso'), ref: V.str(200), cover: link, url: link, total: V.nul(V.int(1, 50000)), page: V.int(0, 50000), st: V.lit('lire', 'cours', 'fini'), desc: V.opt(V.str(700)), f: V.opt(V.nul(fiche)) }), 500),
  pages: V.rec(V.num(0, 100000), 5000),
  course: V.obj({ n: V.str(120), page: V.int(0, 50000), days: V.rec(V.num(0, 100000), 5000) }),
  quiz: V.obj({
    seen: V.arr(V.str(40), 5000), hashes: V.arr(V.str(24), 5000),
    hist: V.arr(V.obj({ d: V.day, n: V.int(1, 100), ok: V.int(0, 100), cats: V.arr(V.str(40), 10), rev: V.opt(V.bool) }), 1000),
    cur: V.nul(V.obj({ d: V.day, ids: V.arr(V.str(40), 20), ans: V.rec(V.int(0, 3), 20), rev: V.opt(V.bool) })),
    gen: V.arr(genQ, 300)
  }),
  exo: V.obj({ seen: V.arr(V.str(40), 1000), cur: V.nul(V.obj({ d: V.day, ids: V.arr(V.str(40), 20) })), done: V.rec(V.arr(V.str(40), 30), 2000) }),
  impro: V.obj({ seen: V.arr(V.str(32), 1000), hist: V.arr(V.obj({ d: V.day, id: V.str(32), diff: V.nul(V.int(1, 5)), sec: V.num(0, 7200) }), 1000), cur: V.nul(V.str(32)) }),
  cycle: V.obj({ mode: V.lit('off', 'cycle', 'recup'), starts: V.arr(V.day, 400), rec: V.rec(tri, 4000, DAYKEY), en: V.rec(V.int(1, 5), 4000, DAYKEY) }),
  share: V.obj({ vis: V.rec(V.bool, 20, shareKey) }),
  settings: V.obj({ theme: V.lit('auto', 'light', 'dark', 'oled'), motion: V.lit('auto', 'reduced'), haptics: V.bool, sounds: V.bool, remind: V.lit(0, 10, 30, 60, 120) }),
  ui: V.obj({ onboard: V.bool, verseDay: V.nul(V.day), covers: V.bool })
})
/** Premier défaut d'un état (message avec le chemin du champ), ou null s'il est valide. */
export const why = (o: unknown): string | null => schema(o, 'état')
/** Validation stricte d'un état v2 (import JSON ou stockage local) : toute structure inattendue est refusée. */
export const valid = (o: unknown): o is State => why(o) === null

const NEST = ['consents', 'settings', 'prompter', 'quiz', 'exo', 'impro', 'cycle', 'share', 'ui', 'course'] as const
/** Attribue un rôle aux habitudes qui n'en ont pas encore (données antérieures aux rôles), d'après le début de leur nom d'origine ; un seul exemplaire par rôle. */
const giveRoles = (hs: unknown) => {
  if (!Array.isArray(hs)) return
  const taken = new Set(hs.map(h => (V.isObj(h) ? h.k : undefined)))
  for (const r of ROLES) {
    if (taken.has(r)) continue
    const h = hs.find(x => V.isObj(x) && typeof x.n === 'string' && x.k === undefined && x.n.startsWith(ROLE_PREFIX[r]))
    if (h) h.k = r
  }
}
/**
 * Convertit un document v1 ou v2 en état v2 valide. Seules les clés connues sont reprises, les champs
 * absents reçoivent leur valeur par défaut. En cas d'échec, `err` nomme le premier champ fautif.
 */
export function convert(o: unknown): { s: State | null; err: string | null } {
  if (!V.isObj(o) || (o.v !== 1 && o.v !== 2)) return { s: null, err: 'version 1 ou 2 requise' }
  const out = DEF() as unknown as Record<string, unknown>
  const base = DEF() as unknown as Record<string, unknown>
  for (const k of Object.keys(base)) if (k !== 'v' && o[k] !== undefined) out[k] = o[k]
  for (const k of NEST) if (V.isObj(o[k])) out[k] = { ...(base[k] as object), ...(o[k] as object) }
  if (V.isObj(out.consents)) delete out.consents.gps // données d'une ancienne version : l'accord « position » n'existe plus (les séances GPS enregistrées ne sont pas reprises non plus : seules les clés connues le sont)
  if (o.v === 1 || V.isObj(out.profile)) out.ui = { ...(out.ui as object), onboard: true } // données existantes (ancienne version, import, profil déjà rempli) : pas d'accueil guidé
  if (Array.isArray(out.habits)) out.habits = JSON.parse(JSON.stringify(out.habits)) // copie : le document d'origine n'est jamais modifié
  giveRoles(out.habits)
  out.v = 2
  const err = why(out)
  return err ? { s: null, err } : { s: out as unknown as State, err: null }
}
export const migrate = (o: unknown): State | null => convert(o).s

/**
 * Lit l'état enregistré. Si les données sont chiffrées et que l'application est verrouillée, `locked` vaut true et l'état rendu est vide (l'écran du PIN s'affiche) :
 * rien n'est lu ni écrit tant que le PIN n'est pas saisi.
 */
export function load(): { s: State; err: string | null; migrated: boolean; locked?: boolean } {
  try {
    const r2 = localStorage.getItem(KEY), raw = r2 ?? localStorage.getItem(KEY1)
    if (raw === null) return { s: DEF(), err: null, migrated: false }
    let text: string | null = raw
    if (isEnv(raw)) {
      if (!unlocked() && hasVault()) return { s: DEF(), err: null, migrated: false, locked: true }
      text = unlocked() ? unseal(raw, KEY) : null
    }
    let s: State | null = null
    if (text !== null) { try { s = migrate(JSON.parse(text)) } catch { s = null } }
    if (s) return { s, err: null, migrated: r2 === null }
    try { localStorage.setItem(KEY_BAK, raw) } catch { /* copie impossible */ }
    return { s: DEF(), err: isEnv(raw) ? 'Données chiffrées illisibles (clé absente ou données abîmées) : une copie brute est conservée. Valeurs par défaut utilisées.' : 'Données illisibles : une copie brute est conservée (Paramètres, onglet Données). Valeurs par défaut utilisées.', migrated: false }
  } catch {
    return { s: DEF(), err: 'Stockage local indisponible : valeurs par défaut utilisées, rien ne sera conservé.', migrated: false }
  }
}
/**
 * Enregistre l'état. Données chiffrées : chiffrement avant écriture ; si l'application est verrouillée, rien n'est écrit (renvoie false) pour ne jamais remplacer
 * des données chiffrées par un état vide. Sans chiffrement actif, des clés restées en mémoire sont effacées (autre onglet ayant désactivé le chiffrement).
 */
export function save(s: State): boolean {
  let out = JSON.stringify(s)
  if (hasVault()) {
    if (!unlocked()) return false
    const e = seal(out, KEY)
    if (e === null) return false
    out = e
  } else if (unlocked()) closeKeys()
  try { localStorage.setItem(KEY, out) } catch { return false }
  try { localStorage.removeItem(KEY1) } catch { /* ancienne copie conservée */ }
  return true
}
/** Clés « believe: » présentes dans le stockage local. */
export const bKeys = () => { const r: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('believe:')) r.push(k) } return r }
/** Droit à l'oubli (stockage local) : efface TOUTES les clés « believe: » puis vérifie qu'il n'en reste aucune. */
export function wipeLocal(): boolean {
  try { bKeys().forEach(k => localStorage.removeItem(k)); return bKeys().length === 0 } catch { return false }
}

/** Archive une semaine (jamais écrasée si déjà archivée). */
export function archive(s: State, m: Date) {
  const st = iso(m)
  if (s.archives.some(a => a.start === st)) return
  const per: Record<string, number> = {}
  let tot = 0
  s.habits.forEach(h => {
    let c = 0
    for (let i = 0; i < 7; i++) if ((s.checks[iso(addD(m, i))] ?? []).includes(h.id)) c++
    per[h.n] = c; tot += c
  })
  const [y, w] = isoWk(m)
  s.archives.push({ week: y + '-S' + pad(w), start: st, rate: s.habits.length ? Math.round(100 * tot / (s.habits.length * 7)) : 0, n: tot, per })
  s.archives.sort((a, b) => b.start.localeCompare(a.start))
}
/** Changement de semaine : archive chaque semaine écoulée avant d'avancer weekStart. */
export function roll(s: State) {
  const ms = iso(monday(new Date()))
  if (s.weekStart && s.weekStart < ms) {
    let m = new Date(s.weekStart + 'T00:00:00'), k = 0
    while (iso(m) < ms && k++ < 104) { archive(s, m); m = addD(m, 7) }
  }
  s.weekStart = ms
}

export const dayPct = (s: State, k: string) => {
  const c = (s.checks[k] ?? []).filter(id => s.habits.some(h => h.id === id)).length
  return s.habits.length ? Math.round(100 * c / s.habits.length) : 0
}
export function streak(s: State, id: string) {
  let d = new Date(), n = 0
  if (!(s.checks[iso(d)] ?? []).includes(id)) d = addD(d, -1)
  while ((s.checks[iso(d)] ?? []).includes(id) && n < 3650) { n++; d = addD(d, -1) }
  return n
}
/** Versets proposés : ceux du profil choisi, ou la liste complète tant qu'aucun profil n'est renseigné. */
export const vlist = (s: State): readonly Verse[] => (s.profile ? (s.profile.g === 'F' ? VF : VM) : [...VF, ...VM])
export const curVerse = (s: State) => {
  const l = vlist(s), i = s.verse && s.verse.d === today() ? s.verse.i : dayIdx()
  return l[i % l.length]
}
export const gauge = (p: Profile | null) => {
  if (!p) return null
  const t = p.ws - p.t
  return t > 0 ? Math.max(0, Math.min(100, Math.round(100 * (p.ws - p.w) / t))) : null
}
