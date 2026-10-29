import { markHabit, today, uid } from './lib'
import type { BookSrc, Fiche, MyBook, State } from './lib'
import type { Book } from './books'
import type { ExtBook } from './ext'
import { norm } from './util'

// Logique pure de « Mes livres » et des marque-pages (livre, cours) : aucune dépendance à React, testée par npm run audit.
/** Objectif quotidien des habitudes « 20 pages de mon livre » et « 20 pages de cours ». */
export const GOAL = 20
export const MAX_BOOKS = 500, MAX_DAY = 1000, MAX_PAGE = 50000, KEEP_DAYS = 4000
export const SRC_LABEL: Record<BookSrc, string> = { cat: 'Catalogue Believe', ol: 'Open Library', gb: 'Google Books', gu: 'Project Gutenberg', lv: 'LibriVox', perso: 'Ajouté à la main' }
export const ST_LABEL = { lire: 'À lire', cours: 'En cours', fini: 'Terminé' } as const

export interface Done { ok: true; added: number; today: number; page: number | null; marked: boolean; finished: boolean; title: string }
export interface Fail { ok: false; why: string }
const fail = (why: string): Fail => ({ ok: false, why })

// ---------------------------------------------------------------- création d'un livre
export const fromCatalog = (b: Book): MyBook => ({ id: 'cat:' + b.id, t: b.t, a: b.a, src: 'cat', ref: b.id, cover: null, url: null, total: null, page: 0, st: 'lire' })
/** Livre issu d'une recherche en ligne : seules les informations officielles du catalogue sont gardées (jamais le texte du livre). */
export const fromExt = (e: ExtBook): MyBook => ({ id: (e.src + ':' + e.id).slice(0, 80), t: e.t.slice(0, 200), a: e.a.slice(0, 200), src: e.src, ref: e.id.slice(0, 200), cover: e.cover, url: e.url, total: null, page: 0, st: 'lire', desc: e.desc.slice(0, 700) })
/** Livre saisi à la main : titre obligatoire, auteur et nombre de pages facultatifs. */
export function manual(t: string, a: string, total: string): { ok: true; b: MyBook } | Fail {
  const title = t.trim(), n = total.trim() === '' ? null : Number(total.trim())
  if (!title) return fail('Indiquez le titre du livre.')
  if (title.length > 200 || a.trim().length > 200) return fail('Titre ou auteur trop long (200 caractères au plus).')
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > MAX_PAGE)) return fail('Le nombre de pages doit être un entier entre 1 et ' + MAX_PAGE + ', ou rester vide.')
  return { ok: true, b: { id: uid('b'), t: title, a: a.trim(), src: 'perso', ref: '', cover: null, url: null, total: n, page: 0, st: 'lire' } }
}
/** Ajoute le livre en tête de la liste. Refus si le même livre y est déjà (même identifiant, ou même titre et même auteur pour un livre saisi à la main). */
export function addBook(s: State, b: MyBook): { ok: true } | Fail {
  if (s.books.some(x => x.id === b.id)) return fail('Ce livre est déjà dans Mes livres.')
  if (b.src === 'perso' && s.books.some(x => norm(x.t) === norm(b.t) && norm(x.a) === norm(b.a))) return fail('Un livre de même titre et de même auteur est déjà dans Mes livres.')
  if (s.books.length >= MAX_BOOKS) return fail('Limite de ' + MAX_BOOKS + ' livres atteinte : retirez-en un avant d’en ajouter.')
  s.books.unshift(b); return { ok: true }
}
/** Raison pour laquelle l'ajout serait refusé (null s'il est possible), sans toucher à l'état : sert à écrire le message avant l'enregistrement. */
export const whyNot = (s: State, b: MyBook): string | null => { const r = addBook({ books: [...s.books] } as State, b); return r.ok ? null : r.why }
export const removeBook = (s: State, id: string) => { s.books = s.books.filter(b => b.id !== id) }
export const inList = (s: { books: MyBook[] }, id: string) => s.books.some(b => b.id === id)
export const bookById = (s: { books: MyBook[] }, id: string) => s.books.find(b => b.id === id)
/** Livre proposé par défaut au marque-page : le premier « en cours », sinon le premier « à lire ». */
export const current = (s: { books: MyBook[] }): MyBook | undefined => s.books.find(b => b.st === 'cours') ?? s.books.find(b => b.st === 'lire')
export const pct = (b: MyBook): number | null => (b.total ? Math.min(100, Math.round(100 * b.page / b.total)) : null)

export function setStatus(s: State, id: string, st: MyBook['st']) { const b = bookById(s, id); if (b) b.st = st }
/** Fixe (ou efface avec une valeur vide) le nombre de pages d'un livre. */
export function setTotal(s: State, id: string, raw: string): { ok: true } | Fail {
  const b = bookById(s, id)
  if (!b) return fail('Livre introuvable.')
  const n = raw.trim() === '' ? null : Number(raw.trim())
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > MAX_PAGE)) return fail('Le nombre de pages doit être un entier entre 1 et ' + MAX_PAGE + ', ou rester vide.')
  if (n !== null && n < b.page) return fail('Le livre ne peut pas avoir moins de pages (' + n + ') que la page atteinte (' + b.page + ').')
  b.total = n; settle(b); return { ok: true }
}
/** Après un changement de page : un livre commencé passe « en cours », un livre arrivé à sa dernière page passe « terminé » (jamais l'inverse sans action de l'utilisateur). */
function settle(b: MyBook) {
  if (b.total && b.page >= b.total) b.st = 'fini'
  else if (b.page > 0 && b.st === 'lire') b.st = 'cours'
}

// ---------------------------------------------------------------- pages lues
/** Ajoute `n` pages (négatif : correction) à un jour du carnet, sans descendre sous 0 ; les plus anciens jours sont oubliés au-delà de KEEP_DAYS. Renvoie le total du jour. */
function bump(days: Record<string, number>, day: string, n: number): number {
  const v = Math.max(0, (days[day] ?? 0) + n)
  if (v) days[day] = v; else delete days[day]
  const ks = Object.keys(days)
  if (ks.length > KEEP_DAYS) ks.sort().slice(0, ks.length - KEEP_DAYS).forEach(k => { delete days[k] })
  return v
}
export const pagesToday = (s: State, day = today()) => s.pages[day] ?? 0
export const coursePagesToday = (s: State, day = today()) => s.course.days[day] ?? 0

/** Cible d'une lecture : un livre de la liste, le cours, ou « un autre livre » (pages comptées sans marque-page). */
export type Target = { k: 'book'; id: string } | { k: 'course' } | { k: 'free' }
/** Action : « j'ai lu n pages » (le marque-page avance de n) ou « je suis à la page P » (l'écart avec l'ancienne page est compté si `count`). */
export type Act = { t: 'read'; n: number } | { t: 'at'; page: number; count: boolean }

/**
 * Applique une lecture à l'état et renvoie le résultat. Les pages du jour atteignent GOAL : l'habitude correspondante (« 20 pages de mon livre » ou « 20 pages de cours ») est cochée,
 * par son rôle, donc même renommée. Une habitude jamais décochée automatiquement. Ne modifie rien si le résultat est un refus.
 */
export function act(s: State, to: Target, a: Act, day = today()): Done | Fail {
  const book = to.k === 'book' ? bookById(s, to.id) : undefined
  if (to.k === 'book' && !book) return fail('Livre introuvable.')
  const days = to.k === 'course' ? s.course.days : s.pages, role = to.k === 'course' ? 'cours' : 'livre'
  const pos = book ? book.page : to.k === 'course' ? s.course.page : null // marque-page actuel (null : pas de marque-page)
  const max = book ? book.total ?? MAX_PAGE : MAX_PAGE
  let delta: number, count = true, next = pos
  if (a.t === 'read') {
    if (!Number.isInteger(a.n) || a.n < 1 || a.n > MAX_DAY) return fail('Indiquez un nombre de pages entre 1 et ' + MAX_DAY + '.')
    if (pos !== null) {
      if (pos >= max) return fail('Vous êtes déjà à la dernière page de ce livre.')
      delta = Math.min(a.n, max - pos); next = pos + delta
    } else delta = a.n
  } else {
    if (pos === null) return fail('Cette action demande un marque-page.')
    if (!Number.isInteger(a.page) || a.page < 0 || a.page > max) return fail('La page doit être un nombre entier entre 0 et ' + max + '.')
    delta = a.page - pos; next = a.page; count = a.count
    if (count && Math.abs(delta) > MAX_DAY) return fail('L’écart (' + Math.abs(delta) + ' pages) dépasse ' + MAX_DAY + ' : décochez « Compter ces pages » pour seulement déplacer le marque-page.')
  }
  if (book && next !== null) { book.page = next; settle(book) }
  if (to.k === 'course' && next !== null) s.course.page = next
  const added = count ? delta : 0
  const total = count && added !== 0 ? bump(days, day, added) : days[day] ?? 0
  const marked = added > 0 && total >= GOAL && markHabit(s, role, day)
  return { ok: true, added, today: total, page: next, marked, finished: !!book && book.st === 'fini' && next === book.total, title: book ? book.t : to.k === 'course' ? s.course.n || 'Cours' : 'Lecture' }
}
/** Essai à blanc : le résultat qu'aurait l'action, sans toucher à l'état (sert à écrire le message de confirmation avant l'enregistrement). */
export function probe(s: State, to: Target, a: Act, day = today()): Done | Fail { return act(JSON.parse(JSON.stringify(s)) as State, to, a, day) }

const pl = (n: number, w: string) => n + ' ' + w + (Math.abs(n) > 1 ? 's' : '')
/** Message de confirmation, écrit seulement une fois l'enregistrement confirmé. `habit` : nom (éventuellement renommé) de l'habitude cochée. */
export function doneText(d: Done, habit: string | undefined): string {
  const head = d.added > 0 ? '+ ' + pl(d.added, 'page') + ' lue' + (d.added > 1 ? 's' : '') + '.' : d.added < 0 ? pl(-d.added, 'page') + ' retirée' + (d.added < -1 ? 's' : '') + ' du total du jour.' : d.page !== null ? 'Marque-page déplacé à la page ' + d.page + '.' : 'Aucune page ajoutée.'
  return head + ' Aujourd’hui : ' + d.today + '/' + GOAL + '.' + (d.marked ? ' Habitude « ' + (habit ?? '') + ' » cochée pour aujourd’hui.' : '') + (d.finished ? ' Livre terminé : bravo !' : '')
}
export function setCourseName(s: State, n: string): { ok: true } | Fail {
  const t = n.trim()
  if (t.length > 120) return fail('Intitulé trop long (120 caractères au plus).')
  s.course.n = t; return { ok: true }
}

// ---------------------------------------------------------------- fiche de lecture par IA
/** Texte exact envoyé à l'IA pour une fiche : le titre, l'auteur et, s'il existe, le descriptif officiel du catalogue. Rien d'autre. */
export function ficheAsk(b: Pick<MyBook, 't' | 'a' | 'src' | 'desc'>): string {
  return 'Livre : « ' + b.t + ' »\nAuteur : ' + (b.a || 'inconnu') + (b.desc ? '\nDescriptif du catalogue (' + SRC_LABEL[b.src] + ') : ' + b.desc : '') + '\nRédige la fiche de synthèse de ce livre.'
}
/** Fiche reçue de l'IA, nettoyée et bornée ; null si elle est inutilisable (idée centrale absente ou moins de deux points). */
export function ficheFrom(raw: unknown, model: string, d = today()): Fiche | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const txt = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const idee = txt(o.idee, 800), points = (Array.isArray(o.points) ? o.points : []).map(x => txt(x, 400)).filter(Boolean).slice(0, 8)
  if (!idee || points.length < 2) return null
  return { idee, points, retenir: txt(o.retenir, 600), pour: txt(o.pour_qui, 300), fia: txt(o.fiabilite, 500), m: txt(model, 100) || 'inconnu', d }
}
export const ficheSpeech = (f: Fiche) => f.idee + ' ' + f.points.join(' ') + (f.retenir ? ' ' + f.retenir : '')
export function keepFiche(s: State, id: string, f: Fiche | null) { const b = bookById(s, id); if (b) b.f = f }
