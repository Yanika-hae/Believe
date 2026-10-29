// IndexedDB : enregistrements audio (base BelieveAudioDB, magasins « audios » et « audioMeta »).
// Les données binaires sont stockées en ArrayBuffer (compatible avec tous les navigateurs, y compris Safari).
// Chiffrement activé : titre, catégorie, durée et audio sont chiffrés (AES-256-GCM, clé tirée de la clé de données) ; seul l'identifiant reste lisible.
// Chaque enregistrement dit lui-même s'il est chiffré (champ `e`) : une conversion interrompue en cours de route ne perd rien.
import { hasVault } from './pin'
import { openBytes, sealBytes, unlocked } from './keys'

export const DB_NAME = 'BelieveAudioDB'
const VER = 4
/** Description d'un enregistrement : légère, lue à chaque affichage de la liste (les données audio, elles, sont lues à la demande). */
export interface AudioMeta { id: string; title: string; cat: string; t: number; ms: number; type: string; size: number }
export interface AudioRec extends AudioMeta { data: ArrayBuffer }
/** Enregistrement chiffré : e = description chiffrée, d = audio chiffré (absent dans le magasin des descriptions). */
interface EncMeta { id: string; e: ArrayBuffer }
interface EncAudio extends EncMeta { d: ArrayBuffer }

let dbp: Promise<IDBDatabase> | null = null
/** File des opérations exclusives (désactivation du chiffrement) : un nouvel enregistrement attend la fin de l'opération en cours pour être écrit dans le bon format. */
let chain: Promise<unknown> = Promise.resolve()
export function exclusive<T>(fn: () => Promise<T>): Promise<T> { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p }
export const hasIDB = () => typeof indexedDB !== 'undefined'
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const fin = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('abort')) })

function open(): Promise<IDBDatabase> {
  if (!hasIDB()) return Promise.reject(new Error('unsupported'))
  if (dbp) return dbp
  dbp = new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB_NAME, VER)
    r.onupgradeneeded = () => {
      const db = r.result, tx = r.transaction!
      if (!db.objectStoreNames.contains('audios')) db.createObjectStore('audios', { keyPath: 'id' })
      if (db.objectStoreNames.contains('dishes')) db.deleteObjectStore('dishes') // version 4 : les images de plats ne sont plus enregistrées (le dessin du plat est refait à l'affichage)
      if (!db.objectStoreNames.contains('audioMeta')) { // version 3 : descriptions séparées des données, reconstruites depuis les enregistrements existants
        const m = db.createObjectStore('audioMeta', { keyPath: 'id' })
        tx.objectStore('audios').openCursor().onsuccess = ev => {
          const c = (ev.target as IDBRequest<IDBCursorWithValue | null>).result
          if (!c) return
          const { data, ...meta } = c.value as AudioRec
          m.put({ ...meta, size: data?.byteLength ?? 0 }); c.continue()
        }
      }
    }
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbp = null }; res(db) }
    r.onerror = () => { dbp = null; rej(r.error) }
    r.onblocked = () => { dbp = null; rej(new Error('blocked')) }
  })
  return dbp
}
type Name = 'audios' | 'audioMeta'
const store = async (name: Name, mode: IDBTransactionMode) => { const tx = (await open()).transaction(name, mode); return { tx, os: tx.objectStore(name) } }
const both = async (mode: IDBTransactionMode) => { const tx = (await open()).transaction(['audios', 'audioMeta'], mode); return { tx, a: tx.objectStore('audios'), m: tx.objectStore('audioMeta') } }
const metaOf = (a: Omit<AudioRec, 'size'>): AudioMeta => ({ id: a.id, title: a.title, cat: a.cat, t: a.t, ms: a.ms, type: a.type, size: a.data.byteLength })

const te = new TextEncoder(), td = new TextDecoder()
const aadM = (id: string) => 'believe/audio-meta/' + id, aadD = (id: string) => 'believe/audio-data/' + id
const isEnc = (x: unknown): x is EncMeta => !!x && typeof x === 'object' && 'e' in x
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
/** Empreinte légère d'un enregistrement (pour voir s'il a changé pendant une conversion). */
const fp = (r: AudioRec | EncAudio): string => (isEnc(r) ? 'e' + r.e.byteLength + ':' + ((r as EncAudio).d?.byteLength ?? 0) : 'p' + (r as AudioRec).size + ':' + (r as AudioRec).title + ':' + ((r as AudioRec).data?.byteLength ?? 0))
/** Description lisible d'un enregistrement chiffré, ou null (clé absente, données abîmées ou enregistrement d'un autre identifiant). */
async function metaOfEnc(r: EncMeta): Promise<AudioMeta | null> {
  const b = await openBytes(new Uint8Array(r.e), aadM(r.id))
  if (!b) return null
  try { const m = JSON.parse(td.decode(b)) as AudioMeta; return m && m.id === r.id && typeof m.title === 'string' ? m : null } catch { return null }
}
const sealPair = async (meta: AudioMeta, data: ArrayBuffer): Promise<{ e: ArrayBuffer; d: ArrayBuffer } | null> => {
  const e = await sealBytes(te.encode(JSON.stringify(meta)), aadM(meta.id)), d = await sealBytes(new Uint8Array(data), aadD(meta.id))
  return e && d ? { e: ab(e), d: ab(d) } : null
}

/** Enregistre un audio (données et description dans une seule transaction) ; la promesse n'est tenue qu'une fois la transaction terminée. Chiffrement actif : refusé si l'application est verrouillée. */
export async function putAudio(a: Omit<AudioRec, 'size'>): Promise<void> {
  await chain
  const meta = metaOf(a)
  if (hasVault()) {
    const p = unlocked() ? await sealPair(meta, a.data) : null
    if (!p) throw new Error('locked')
    const { tx, a: os, m } = await both('readwrite'); os.put({ id: a.id, e: p.e, d: p.d } as EncAudio); m.put({ id: a.id, e: p.e } as EncMeta); await fin(tx)
    return
  }
  const { tx, a: os, m } = await both('readwrite'); os.put({ ...a, size: meta.size }); m.put(meta); await fin(tx)
}
/** Descriptions de tous les audios, du plus récent au plus ancien (sans les données). Les enregistrements chiffrés que la clé ne sait pas ouvrir sont ignorés. */
export async function listAudios(): Promise<AudioMeta[]> {
  const { os } = await store('audioMeta', 'readonly'), rows = (await req(os.getAll())) as (AudioMeta | EncMeta)[], out: AudioMeta[] = []
  for (const r of rows) { if (isEnc(r)) { const m = await metaOfEnc(r); if (m) out.push(m) } else out.push(r) }
  return out.sort((a, b) => b.t - a.t)
}
/** Un audio complet, ou undefined s'il n'existe pas (ou s'il est chiffré et illisible). */
export async function getAudio(id: string): Promise<AudioRec | undefined> {
  const { os } = await store('audios', 'readonly'), r = (await req(os.get(id))) as AudioRec | EncAudio | undefined
  if (!r) return undefined
  if (!isEnc(r)) return r as AudioRec
  const m = await metaOfEnc(r), d = (r as EncAudio).d ? await openBytes(new Uint8Array((r as EncAudio).d), aadD(id)) : null
  return m && d ? { ...m, data: ab(d) } : undefined
}
/** Change le titre d'un audio ; renvoie true seulement si la modification est écrite. */
export async function renameAudio(id: string, title: string): Promise<boolean> {
  try {
    const cur = (await req((await store('audios', 'readonly')).os.get(id))) as AudioRec | EncAudio | undefined
    if (!cur) return false
    if (isEnc(cur)) {
      const m = await metaOfEnc(cur), e = m ? await sealBytes(te.encode(JSON.stringify({ ...m, title })), aadM(id)) : null
      if (!m || !e) return false
      const w = await both('readwrite'), now = (await req(w.a.get(id))) as EncAudio | undefined
      if (!now) { w.tx.abort(); return false }
      w.a.put({ ...now, e: ab(e) }); w.m.put({ id, e: ab(e) }); await fin(w.tx); return true
    }
    const { tx, a, m } = await both('readwrite'), rec = (await req(a.get(id))) as AudioRec | undefined
    if (!rec) { tx.abort(); return false }
    const n = { ...rec, title }; a.put(n); m.put(metaOf(n))
    await fin(tx); return true
  } catch { return false }
}
/** Supprime un audio et vérifie qu'il n'existe plus nulle part ; renvoie true seulement si la suppression est confirmée. */
export async function delAudio(id: string): Promise<boolean> {
  const w = await both('readwrite'); w.a.delete(id); w.m.delete(id); await fin(w.tx)
  const r = await both('readonly'); return (await req(r.a.get(id))) === undefined && (await req(r.m.get(id))) === undefined
}
/** Nombre d'enregistrements (pour l'aperçu de la suppression et les tests). */
export async function countIDB(): Promise<{ audios: number }> {
  if (!hasIDB()) return { audios: 0 }
  const a = await store('audios', 'readonly')
  return { audios: await req(a.os.count()) }
}

/** Issue d'une tentative de conversion d'un enregistrement : converti, déjà dans l'état voulu (ou supprimé), impossible, ou modifié pendant le calcul. */
type Step = 'done' | 'same' | 'failed' | 'changed'
async function convertOne(id: string, to: 'enc' | 'plain'): Promise<Step> {
  const rec = (await req((await store('audios', 'readonly')).os.get(id))) as AudioRec | EncAudio | undefined
  if (!rec || isEnc(rec) === (to === 'enc')) return 'same' // déjà dans l'état voulu (ou supprimé entre-temps)
  let next: { a: AudioRec | EncAudio; m: AudioMeta | EncMeta }
  if (to === 'enc') {
    const r = rec as AudioRec, p = await sealPair(metaOf(r), r.data)
    if (!p) return 'failed'
    next = { a: { id, e: p.e, d: p.d }, m: { id, e: p.e } }
  } else {
    const full = await getAudio(id)
    if (!full) return 'failed'
    next = { a: full, m: metaOf(full) }
  }
  const w = await both('readwrite'), now = (await req(w.a.get(id))) as AudioRec | EncAudio | undefined
  if (!now || fp(now) !== fp(rec)) { w.tx.abort(); return now ? 'changed' : 'same' } // modifié ou supprimé entre-temps : on n'écrase jamais la nouvelle version
  w.a.put(next.a); w.m.put(next.m); await fin(w.tx)
  return 'done'
}
/** Nombre de tentatives par enregistrement quand il est modifié pendant sa conversion. */
const TRIES = 3

/**
 * Convertit les enregistrements existants : chiffre (`to` = 'enc') ou déchiffre (`to` = 'plain') chacun, un par un, sans jamais perdre l'original avant l'écriture du nouveau.
 * Un enregistrement modifié pendant son calcul n'est pas écrasé : la conversion repart de sa nouvelle version (3 essais au plus, puis il est compté parmi les échecs).
 * Renvoie le nombre d'enregistrements convertis et ceux qui n'ont pas pu l'être (ils restent tels quels et restent lisibles).
 */
export async function convertAudios(to: 'enc' | 'plain'): Promise<{ done: number; failed: number }> {
  if (!hasIDB()) return { done: 0, failed: 0 }
  let done = 0, failed = 0
  const ids = (await req((await store('audios', 'readonly')).os.getAllKeys())) as string[]
  for (const id of ids) {
    let step: Step = 'changed'
    for (let k = 0; k < TRIES && step === 'changed'; k++) {
      try { step = await convertOne(id, to) } catch { step = 'failed' }
    }
    if (step === 'done') done++
    else if (step !== 'same') failed++ // impossible à convertir, ou encore modifié au dernier essai
  }
  return { done, failed }
}

/** Droit à l'oubli : ferme la connexion puis supprime toute la base ; vrai seulement si la suppression est confirmée. */
export async function wipeIDB(): Promise<boolean> {
  if (!hasIDB()) return true
  try {
    if (dbp) { try { (await dbp).close() } catch { /* déjà fermée */ } dbp = null }
    const ok = await new Promise<boolean>(res => {
      const r = indexedDB.deleteDatabase(DB_NAME), t = setTimeout(() => res(false), 4000) // bloquée par un autre onglet ouvert
      r.onsuccess = () => { clearTimeout(t); res(true) }
      r.onerror = () => { clearTimeout(t); res(false) }
    })
    if (!ok) return false
    const l: { name?: string }[] | null = (indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> }).databases ? await (indexedDB as unknown as { databases: () => Promise<{ name?: string }[]> }).databases() : null
    return !l || !l.some(d => d.name === DB_NAME)
  } catch { return false }
}
/** Convertit un Blob en ArrayBuffer (FileReader si Blob.arrayBuffer est absent). */
export const toBuf = (b: Blob): Promise<ArrayBuffer> =>
  typeof b.arrayBuffer === 'function' ? b.arrayBuffer() : new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result as ArrayBuffer); f.onerror = () => rej(f.error); f.readAsArrayBuffer(b) })
