// Clés lisibles à recopier : 20 octets aléatoires écrits en 32 lettres et chiffres (A–Z, 2–7) par groupes de 4 (clé de récupération du PIN, clé de synchronisation).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
/** 20 octets → « XXXX-XXXX-… » (8 groupes de 4). */
export function b32Text(u: Uint8Array): string {
  let bits = '', out = ''
  for (const x of u) bits += x.toString(2).padStart(8, '0')
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]
  return out.match(/.{4}/g)!.join('-')
}
/** Relit une clé saisie (espaces, tirets et minuscules tolérés) ; null si elle n'a pas la bonne forme. */
export function b32Parse(t: string): Uint8Array | null {
  const c = String(t ?? '').toUpperCase().replace(/[\s-]+/g, '')
  if (!/^[A-Z2-7]{32}$/.test(c)) return null
  let bits = ''
  for (const ch of c) bits += B32.indexOf(ch).toString(2).padStart(5, '0')
  const out = new Uint8Array(20)
  for (let i = 0; i < 20; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  return out
}
