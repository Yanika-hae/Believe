// Codage base64 et base64 « URL » (sans remplissage) des octets : clés, sels, enveloppes chiffrées, messages push.
const LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const table = (fin: string) => Uint8Array.from(LETTRES + fin, c => c.charCodeAt(0))
const STD = table('+/'), URL = table('-_')
/** Valeur de chaque caractère des deux alphabets (les autres ne servent jamais : le texte est contrôlé avant le décodage). */
const VAL = new Uint8Array(128)
for (let i = 0; i < 64; i++) { VAL[STD[i]] = i; VAL[URL[i]] = i }
const ASCII = new TextDecoder(), OCTETS = new TextEncoder()

/**
 * Écrit les caractères dans un tampon, puis le convertit en texte d'un seul coup : un assemblage caractère par caractère est
 * 15 à 45 fois plus lent (les données chiffrées de plusieurs centaines de Ko sont recodées à chaque enregistrement).
 */
function encode(u: Uint8Array, T: Uint8Array, pad: boolean): string {
  const n = u.length, full = n - (n % 3), o = new Uint8Array(Math.ceil(n / 3) * 4)
  let j = 0
  for (let i = 0; i < full; i += 3) {
    const v = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2]
    o[j++] = T[v >> 18]; o[j++] = T[(v >> 12) & 63]; o[j++] = T[(v >> 6) & 63]; o[j++] = T[v & 63]
  }
  const r = n - full
  if (r === 1) { const v = u[full] << 16; o[j++] = T[v >> 18]; o[j++] = T[(v >> 12) & 63]; if (pad) { o[j++] = 61; o[j++] = 61 } }
  else if (r === 2) { const v = (u[full] << 16) | (u[full + 1] << 8); o[j++] = T[v >> 18]; o[j++] = T[(v >> 12) & 63]; o[j++] = T[(v >> 6) & 63]; if (pad) o[j++] = 61 }
  return ASCII.decode(o.subarray(0, j))
}
export const b64 = (u: Uint8Array): string => encode(u, STD, true)
export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), c => c.charCodeAt(0))
export const b64u = (u: Uint8Array): string => encode(u, URL, false)
/** Décode du base64 « URL » avec ou sans remplissage ; lève une erreur si le texte n'est pas du base64. */
export const unb64u = (s: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error('base64')
  const a = OCTETS.encode(s) // texte contrôlé : un octet par caractère
  let n = a.length
  while (n > 0 && a[n - 1] === 61) n--
  if (n % 4 === 1) throw new Error('base64')
  const out = new Uint8Array(Math.floor((n * 3) / 4))
  let j = 0, i = 0
  for (; i + 4 <= n; i += 4) {
    const v = (VAL[a[i]] << 18) | (VAL[a[i + 1]] << 12) | (VAL[a[i + 2]] << 6) | VAL[a[i + 3]]
    out[j++] = v >> 16; out[j++] = (v >> 8) & 255; out[j++] = v & 255
  }
  if (n - i === 2) out[j++] = ((VAL[a[i]] << 18) | (VAL[a[i + 1]] << 12)) >> 16
  else if (n - i === 3) { const v = (VAL[a[i]] << 18) | (VAL[a[i + 1]] << 12) | (VAL[a[i + 2]] << 6); out[j++] = v >> 16; out[j++] = (v >> 8) & 255 }
  return out
}
