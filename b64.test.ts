// @vitest-environment node
// Codage base64 : mêmes résultats que la référence de Node pour toutes les longueurs, mêmes refus que le codage précédent.
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { b64, b64u, unb64, unb64u } from './b64'

const bytes = (n: number) => new Uint8Array(randomBytes(n))
const ref = (u: Uint8Array, url: boolean) => Buffer.from(u).toString(url ? 'base64url' : 'base64')
const hex = (u: Uint8Array) => Buffer.from(u).toString('hex')

describe('Base64 : encodage', () => {
  it('donne le même texte que Buffer pour chaque longueur de 0 à 300 octets : avec « = » pour b64, sans pour b64u', () => {
    for (let n = 0; n <= 300; n++) { const u = bytes(n); expect(b64(u)).toBe(ref(u, false)); expect(b64u(u)).toBe(ref(u, true)) }
  })

  it('couvre tous les octets possibles, et le reste de la division par 3 (0, 1 et 2) ; « + » et « / » deviennent « - » et « _ » en version URL', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    for (let n = 252; n <= 256; n++) { expect(b64(all.subarray(0, n))).toBe(ref(all.subarray(0, n), false)); expect(b64u(all.subarray(0, n))).toBe(ref(all.subarray(0, n), true)) }
    const u = Uint8Array.of(0xfb, 0xff, 0xbf)
    expect(b64(u)).toBe('+/+/'); expect(b64u(u)).toBe('-_-_')
    expect(b64u(bytes(2000))).toMatch(/^[A-Za-z0-9_-]*$/)
  })

  it('un texte vide donne un texte vide ; une longueur non multiple de 3 est complétée par « = » (b64) ou laissée telle quelle (b64u)', () => {
    expect(b64(new Uint8Array(0))).toBe(''); expect(b64u(new Uint8Array(0))).toBe('')
    expect(b64(Uint8Array.of(65))).toBe('QQ=='); expect(b64u(Uint8Array.of(65))).toBe('QQ')
    expect(b64(Uint8Array.of(65, 66))).toBe('QUI='); expect(b64u(Uint8Array.of(65, 66))).toBe('QUI')
    expect(b64(Uint8Array.of(65, 66, 67))).toBe('QUJD'); expect(b64u(Uint8Array.of(65, 66, 67))).toBe('QUJD')
  })

  it('un gros contenu (1 Mo) est codé comme la référence', () => {
    const u = bytes(1_000_003)
    expect(b64(u)).toBe(ref(u, false)); expect(b64u(u)).toBe(ref(u, true))
  })
})

describe('Base64 : décodage', () => {
  it('refait exactement les octets de départ : de 0 à 300 octets, et 1 Mo', () => {
    for (let n = 0; n <= 300; n++) { const u = bytes(n); expect(hex(unb64u(b64u(u)))).toBe(hex(u)); expect(hex(unb64(b64(u)))).toBe(hex(u)) }
    const g = bytes(1_000_003); expect(Buffer.compare(Buffer.from(unb64u(b64u(g))), Buffer.from(g))).toBe(0)
  })

  it('accepte le texte avec ou sans remplissage, même un « = » de trop ou de moins (comme avant), et le texte vide', () => {
    expect(hex(unb64u('QQ'))).toBe('41'); expect(hex(unb64u('QQ=='))).toBe('41'); expect(hex(unb64u('QQ='))).toBe('41')
    expect(hex(unb64u('QUI'))).toBe('4142'); expect(hex(unb64u('QUI='))).toBe('4142'); expect(hex(unb64u('QUI=='))).toBe('4142')
    expect(hex(unb64u('QUJD'))).toBe('414243'); expect(hex(unb64u('QUJD='))).toBe('414243')
    expect(unb64u('')).toHaveLength(0); expect(unb64u('==')).toHaveLength(0)
  })

  it('accepte « - » et « _ » (alphabet URL) mais refuse « + » et « / » : un texte standard n’est pas du base64 URL', () => {
    expect(hex(unb64u('-_-_'))).toBe('fbffbf')
    for (const s of ['+/+/', 'ab+d', 'ab/d']) expect(() => unb64u(s), s).toThrow('base64')
  })

  it('refuse tout autre caractère (espace, saut de ligne, lettre accentuée, point), un « = » au milieu, plus de deux « = » et une longueur impossible', () => {
    for (const s of ['QU JD', 'QUJD\n', ' QUJD', 'QUJé', 'QU.D', 'QU=D', '=QUJD', 'QQ===', 'Q', 'Q=', 'QUJDR', 'QUJDR='])
      expect(() => unb64u(s), JSON.stringify(s)).toThrow('base64')
  })

  it('les bits de fin non nuls sont ignorés comme avant (QR donne le même octet que QQ)', () => {
    expect(hex(unb64u('QR'))).toBe('41'); expect(hex(unb64u('QUJ'))).toBe('4142')
  })

  it('unb64 (base64 standard) décode le texte rempli et refuse un texte invalide', () => {
    expect(hex(unb64('QQ=='))).toBe('41'); expect(hex(unb64('+/+/'))).toBe('fbffbf')
    expect(() => unb64('QU*D')).toThrow()
  })
})
