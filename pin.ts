// PIN de 4 à 12 chiffres. Il verrouille l'interface ; s'il est associé au chiffrement, il protège aussi la clé qui chiffre les données (voir vaultops.ts).
// Dérivation PBKDF2-SHA-256 avec un sel aléatoire, puis deux clés indépendantes tirées par HMAC : une empreinte de contrôle (stockée) et une clé d'enveloppe (jamais stockée).
// Tentatives limitées, blocage conservé après rechargement. Un seul enregistrement « believe:pin » contient tout : le PIN, ses réglages et, si le chiffrement est actif, la clé de données enveloppée.
import { b64, unb64 } from './b64'
import { gcmOpen, hmac, pbkdf2, rand, same } from './kdf'
import { openKeys } from './keys'

export const PIN_KEY = 'believe:pin'
/** Itérations des PIN sans chiffrement (premières versions comprises) et du chiffrement des données. */
export const ITER = 210_000
export const VAULT_ITER = 600_000
/** Échecs permis avant le premier blocage ; chaque échec suivant double la durée (30 s, 1 min, 2 min… plafonné à 15 min). */
export const FREE = 5
export const PIN_MIN = 4
export const PIN_MAX = 12
/**
 * s : sel, h : empreinte de contrôle, i : itérations, f : échecs, u : fin du blocage, a : verrouillage automatique (minutes).
 * k = 2 : empreinte tirée par HMAC (les enregistrements sans k sont ceux des premières versions : empreinte PBKDF2 directe, PIN à 4 chiffres).
 * n : nombre de chiffres du PIN. w : clé de données enveloppée par le PIN ; r, rs : la même enveloppée par la clé de récupération (et son sel).
 */
export interface PinRec { s: string; h: string; i: number; f: number; u: number; a: number; k?: 2; n?: number; w?: string; r?: string; rs?: string }
/** Délais de verrouillage automatique proposés, en minutes (0 = dès que l'application quitte l'écran). */
export const AUTO = [0, 1, 5, 15]
export const CHECK = 'believe/pin-check', KEK = 'believe/pin-kek', AAD_W = 'believe/w'

const sane = (o: unknown): o is PinRec => {
  const r = o as PinRec
  if (!r || typeof r !== 'object' || typeof r.s !== 'string' || typeof r.h !== 'string' || !Number.isInteger(r.i) || r.i < 1 || r.i > 10_000_000) return false
  if (!Number.isFinite(r.f) || r.f < 0 || !Number.isFinite(r.u) || !AUTO.includes(r.a)) return false
  if (r.k !== undefined && r.k !== 2) return false
  if (r.n !== undefined && !(Number.isInteger(r.n) && r.n >= PIN_MIN && r.n <= PIN_MAX)) return false
  const wraps = [r.w, r.r, r.rs], have = wraps.filter(x => x !== undefined).length
  return have === 0 || (have === 3 && r.k === 2 && wraps.every(x => typeof x === 'string'))
}
/** Enregistrement du PIN, ou null s'il n'existe pas ou s'il est illisible. */
export function readPin(): PinRec | null {
  try { const r = localStorage.getItem(PIN_KEY); if (!r) return null; const o = JSON.parse(r); return sane(o) ? o : null } catch { return null }
}
export const writePin = (r: PinRec) => { try { localStorage.setItem(PIN_KEY, JSON.stringify(r)); return true } catch { return false } }
export const hasPin = () => readPin() !== null
/** Vrai si les données sont chiffrées (la clé de données est enveloppée dans l'enregistrement du PIN). */
export const hasVault = () => !!readPin()?.w
export const validPin = (p: unknown): p is string => typeof p === 'string' && new RegExp('^\\d{' + PIN_MIN + ',' + PIN_MAX + '}$').test(p)
/** Nombre de chiffres attendus à l'écran de verrouillage. */
export const pinLen = () => readPin()?.n ?? 4

/** Empreinte de contrôle d'une clé maître (sortie de PBKDF2). */
export const checkOf = async (m: Uint8Array) => b64(await hmac(m, CHECK))
/** Clé d'enveloppe de la clé de données, tirée de la même clé maître. */
export const kekOf = (m: Uint8Array) => hmac(m, KEK)
export const unwrapDk = async (kek: Uint8Array, w: string) => { try { return await gcmOpen(kek, unb64(w), AAD_W) } catch { return null } }

/** Met l'enregistrement à jour seulement s'il est encore celui qu'on a lu (même PIN) : un changement fait entre-temps n'est jamais écrasé. */
function patch(base: PinRec, f: Partial<PinRec>): boolean {
  const cur = readPin()
  if (!cur || cur.s !== base.s || cur.h !== base.h) return false
  return writePin({ ...cur, ...f })
}

/** Définit (ou remplace) le PIN sans chiffrement ; renvoie false si le chiffrement du navigateur ou le stockage est indisponible, ou si les données sont chiffrées (utiliser vaultops). */
export async function setPin(pin: string, auto: number, iter = ITER): Promise<boolean> {
  if (!validPin(pin) || !AUTO.includes(auto) || hasVault()) return false
  try {
    const salt = rand(16)
    return writePin({ s: b64(salt), h: await checkOf(await pbkdf2(pin, salt, iter)), i: iter, f: 0, u: 0, a: auto, k: 2, n: pin.length })
  } catch { return false }
}
export function setAuto(auto: number): boolean {
  const r = readPin()
  return !!r && AUTO.includes(auto) && writePin({ ...r, a: auto })
}
/** Supprime le PIN ; refusé tant que les données sont chiffrées (désactiver le chiffrement d'abord : sinon la clé serait perdue). */
export function removePin(): boolean {
  if (hasVault()) return false
  try { localStorage.removeItem(PIN_KEY) } catch { /* ignoré */ }
  return !hasPin()
}
/** Durée de blocage (ms) après le n-ième échec. */
export const lockMs = (fails: number) => (fails < FREE ? 0 : Math.min(900, 30 * 2 ** (fails - FREE)) * 1000)
/** Millisecondes restantes avant la fin du blocage (0 si aucun). */
export const waitMs = (now = Date.now()) => Math.max(0, (readPin()?.u ?? 0) - now)

/**
 * Vérifie un PIN. Le compteur d'échecs est enregistré AVANT la vérification (fermer la page en cours de calcul
 * ne remet rien à zéro). Pendant un blocage, aucun essai n'est examiné, même avec le bon PIN.
 * Si le chiffrement est actif, un bon PIN ouvre aussi la clé de données (en mémoire) ; `broken` : le PIN est bon mais la clé enveloppée est illisible (utiliser la clé de récupération).
 */
export async function verifyPin(pin: string): Promise<{ ok: boolean; wait: number; left: number; broken?: boolean }> {
  const r = readPin()
  if (!r) return { ok: true, wait: 0, left: FREE }
  const now = Date.now()
  if (r.u > now) return { ok: false, wait: r.u - now, left: 0 }
  const f = r.f + 1
  if (!patch(r, { f })) return { ok: false, wait: 0, left: 0 } // stockage indisponible : pas d'essai non comptabilisé
  let good = false, dk: Uint8Array | null = null, broken = false
  try {
    if (validPin(pin)) {
      const m = await pbkdf2(pin, unb64(r.s), r.i)
      good = r.k === 2 ? same(await hmac(m, CHECK), unb64(r.h)) : same(m, unb64(r.h))
      if (good && r.w) { dk = await unwrapDk(await kekOf(m), r.w); broken = !dk }
    }
  } catch { good = false }
  if (good) {
    patch(r, { f: 0, u: 0 })
    if (broken) return { ok: false, wait: 0, left: FREE, broken: true }
    if (dk) await openKeys(dk)
    return { ok: true, wait: 0, left: FREE }
  }
  const wait = lockMs(f)
  patch(r, { f, u: wait ? Date.now() + wait : 0 })
  return { ok: false, wait, left: Math.max(0, FREE - f) }
}
