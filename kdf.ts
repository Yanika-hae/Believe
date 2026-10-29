// Primitives de chiffrement du navigateur (WebCrypto) : dérivation du PIN, HMAC, HKDF, AES-256-GCM.
// Aucune donnée ne quitte l'appareil ici ; les clés sont des octets que l'appelant garde en mémoire et efface.
const enc = new TextEncoder()
const sub = (): SubtleCrypto => {
  const s = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (!s) throw new Error('crypto')
  return s
}
const B = (u: Uint8Array) => u as unknown as BufferSource
export const rand = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))

/** PBKDF2-SHA-256 : 32 octets dérivés d'un secret saisi (PIN) avec un sel et un nombre d'itérations. */
export async function pbkdf2(secret: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const k = await sub().importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await sub().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: B(salt), iterations: iter }, k, 256))
}
/** HMAC-SHA-256 d'une étiquette de texte : sert à tirer plusieurs clés indépendantes d'une même clé (une étiquette par usage). */
export async function hmac(key: Uint8Array, label: string): Promise<Uint8Array> {
  const k = await sub().importKey('raw', B(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await sub().sign('HMAC', k, enc.encode(label)))
}
/** HKDF-SHA-256 (32 octets) : clé de récupération → clé d'enveloppe. */
export async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<Uint8Array> {
  const k = await sub().importKey('raw', B(ikm), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await sub().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: B(salt), info: enc.encode(info) }, k, 256))
}
/** AES-256-GCM : renvoie iv (12 octets) + texte chiffré + étiquette. `aad` lie le résultat à son usage (un résultat ne s'ouvre pas ailleurs). */
export async function gcmSeal(key: Uint8Array, plain: Uint8Array, aad: string): Promise<Uint8Array> {
  const iv = rand(12), k = await sub().importKey('raw', B(key), 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await sub().encrypt({ name: 'AES-GCM', iv: B(iv), additionalData: B(enc.encode(aad)) }, k, B(plain)))
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12)
  return out
}
/** Ouvre le résultat de gcmSeal ; null si la clé, l'usage (`aad`) ou les données ne correspondent pas. */
export async function gcmOpen(key: Uint8Array, data: Uint8Array, aad: string): Promise<Uint8Array | null> {
  if (data.length < 12 + 16) return null
  try {
    const k = await sub().importKey('raw', B(key), 'AES-GCM', false, ['decrypt'])
    return new Uint8Array(await sub().decrypt({ name: 'AES-GCM', iv: B(data.slice(0, 12)), additionalData: B(enc.encode(aad)) }, k, B(data.slice(12))))
  } catch { return null }
}
/** Comparaison sans sortie anticipée. */
export const same = (a: Uint8Array, b: Uint8Array) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a[i] ?? 0) ^ (b[i] ?? 0); return d === 0 }
