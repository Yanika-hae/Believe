// Clés de chiffrement gardées EN MÉMOIRE seulement tant que l'application est déverrouillée (jamais écrites en clair).
// Une clé de données aléatoire (DK) donne deux clés indépendantes : état (chiffrement synchrone XChaCha20-Poly1305, aussi pour les petits secrets comme le code d'accès
// et la session du compte en ligne) et fichiers (audio : AES-256-GCM). Verrouiller efface tout.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { b64u, unb64u } from './b64'
import { gcmOpen, gcmSeal, hmac, rand } from './kdf'

/** Début de toute donnée chiffrée par l'application dans le stockage local. */
export const ENV = 'BLV1.'
export interface Keys { dk: Uint8Array; state: Uint8Array; blob: Uint8Array }
let K: Keys | null = null
const te = new TextEncoder(), td = new TextDecoder()

export const isEnv = (s: unknown): s is string => typeof s === 'string' && s.startsWith(ENV)
export const unlocked = () => K !== null
/** Calcule les clés d'usage à partir de la clé de données (sans les installer). */
export async function deriveKeys(dk: Uint8Array): Promise<Keys> {
  return { dk: dk.slice(), state: await hmac(dk, 'believe/v1/state'), blob: await hmac(dk, 'believe/v1/blob') }
}
const wipe = (k: Keys) => { k.dk.fill(0); k.state.fill(0); k.blob.fill(0) }
/** Installe les clés (instantané) ; les précédentes sont effacées. */
export function installKeys(k: Keys) { const old = K; K = k; if (old && old !== k) wipe(old) }
export async function openKeys(dk: Uint8Array) { installKeys(await deriveKeys(dk)) }
/** Verrouille : les clés sont effacées de la mémoire. */
export function closeKeys() { if (K) wipe(K); K = null }
/** Copie de la clé de données (pour la ré-envelopper avec un autre PIN) ; null si verrouillé. */
export const dkCopy = (): Uint8Array | null => (K ? K.dk.slice() : null)

/** Chiffre un texte (synchrone) : « BLV1. » + base64url(nonce de 24 octets + texte chiffré + étiquette). `aad` lie le texte à son emplacement. null si verrouillé. */
export function seal(plain: string, aad: string): string | null {
  if (!K) return null
  const nonce = rand(24), c = xchacha20poly1305(K.state, nonce, te.encode(aad)).encrypt(te.encode(plain))
  const out = new Uint8Array(24 + c.length); out.set(nonce); out.set(c, 24)
  return ENV + b64u(out)
}
/** Déchiffre un texte produit par seal ; null si verrouillé, falsifié, tronqué ou destiné à un autre emplacement. */
export function unseal(env: string, aad: string): string | null {
  if (!K || !isEnv(env)) return null
  try {
    const d = unb64u(env.slice(ENV.length))
    if (d.length < 24 + 16) return null
    return td.decode(xchacha20poly1305(K.state, d.slice(0, 24), te.encode(aad)).decrypt(d.slice(24)))
  } catch { return null }
}
/** Chiffre des octets (fichiers) avec AES-256-GCM ; null si verrouillé. */
export async function sealBytes(data: Uint8Array, aad: string): Promise<Uint8Array | null> { return K ? gcmSeal(K.blob, data, aad) : null }
export async function openBytes(data: Uint8Array, aad: string): Promise<Uint8Array | null> { return K ? gcmOpen(K.blob, data, aad) : null }
