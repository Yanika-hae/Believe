import { BOOK_HOSTS } from './data'
import { safeUrl } from './schema'
import { getCode, isHtml } from './ai'

// Recherche de livres en ligne par la fonction serveur /api/ext (Open Library, Google Books, Project Gutenberg, LibriVox).
export type Src = 'ol' | 'gb' | 'gu' | 'lv'
export const SRCS: Src[] = ['gu', 'lv', 'ol', 'gb']
export const SRC_NAME: Record<Src, string> = { ol: 'Open Library', gb: 'Google Books', gu: 'Project Gutenberg', lv: 'LibriVox' }
/** Accès légal : free = lecture ou écoute libre, loan = emprunt numérique, preview = extrait, info = fiche seulement. */
export type Acc = 'free' | 'loan' | 'preview' | 'info'
export interface ExtBook { src: Src; id: string; t: string; a: string; y: number | null; l: string; cover: string | null; desc: string; pub: string; url: string; acc: Acc; med: 'text' | 'audio' }
export interface ExtErr { s: Src; e: string }
export interface ExtResult { items: ExtBook[]; errors: ExtErr[] }
/** Échec de la recherche : `message` est le code de l'erreur globale, `errors` le détail par catalogue quand le serveur le donne. */
export class ExtFail extends Error { errors: ExtErr[]; constructor(code: string, errors: ExtErr[] = []) { super(code); this.errors = errors } }

const ID: Record<Src, RegExp> = { ol: /^\/works\/OL\d{1,12}W$/, gb: /^[\w-]{4,30}$/, gu: /^\d{1,9}$/, lv: /^\d{1,9}$/ }
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '')
/** Reçoit la réponse du serveur sans lui faire confiance : champs retypés et bornés, adresses limitées aux domaines autorisés, notices invalides écartées. */
export function parseExt(j: unknown): ExtResult {
  const o = (j && typeof j === 'object' ? j : {}) as { items?: unknown; errors?: unknown }
  const items: ExtBook[] = []
  for (const r of Array.isArray(o.items) ? o.items.slice(0, 64) : []) {
    const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const src = x.src as Src, id = str(x.id, 60), t = str(x.t, 200).trim(), url = safeUrl(x.url, BOOK_HOSTS)
    if (!SRCS.includes(src) || !ID[src].test(id) || !t || !url) continue
    const acc: Acc = x.acc === 'free' || x.acc === 'loan' || x.acc === 'preview' ? x.acc : 'info'
    items.push({
      src, id, t, a: str(x.a, 200).trim(), y: typeof x.y === 'number' && Number.isInteger(x.y) && x.y >= 1 && x.y <= 2100 ? x.y : null, l: x.l === 'fr' || x.l === 'en' ? x.l : '',
      cover: safeUrl(x.cover, BOOK_HOSTS), desc: str(x.desc, 700).trim(), pub: str(x.pub, 80).trim(), url, acc, med: x.med === 'audio' ? 'audio' : 'text'
    })
  }
  return { items, errors: parseErrs(o.errors) }
}
function parseErrs(x: unknown): ExtErr[] {
  const out: ExtErr[] = []
  for (const r of Array.isArray(x) ? x.slice(0, 8) : []) { const e = r as { s?: unknown; e?: unknown }; if (SRCS.includes(e?.s as Src)) out.push({ s: e.s as Src, e: str(e.e, 20) || 'upstream' }) }
  return out
}
/** Explication courte d'un échec d'un catalogue. */
export const SRC_ERR: Record<string, string> = { quota: 'limite de requêtes atteinte', timeout: 'trop long à répondre', network: 'injoignable', upstream: 'service indisponible', invalid: 'réponse illisible' }

/** Interroge les catalogues choisis. Lève une erreur de code : not_configured (fonction absente), offline, cancelled, quota, code, upstream… */
export async function searchBooks(q: string, lang: '' | 'fr' | 'en', srcs: Src[], signal: AbortSignal): Promise<ExtResult> {
  const p = new URLSearchParams({ q, src: srcs.join(',') })
  if (lang) p.set('lang', lang)
  let r: Response
  try {
    const code = getCode()
    r = await fetch('/api/ext?' + p, { headers: code ? { 'x-access-code': code } : {}, signal })
  } catch (e) {
    throw new ExtFail((e as Error).name === 'AbortError' ? 'cancelled' : 'offline')
  }
  if (r.status === 404 || isHtml(r)) throw new ExtFail('not_configured')
  const j = (await r.json().catch(() => null)) as { error?: unknown; errors?: unknown } | null
  if (!j) throw new ExtFail('upstream')
  if (!r.ok) throw new ExtFail(typeof j.error === 'string' ? j.error : 'upstream', parseErrs(j.errors))
  return parseExt(j)
}
