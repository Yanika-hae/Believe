export type Kind = 'danse' | 'louange'
export const FILTERS: Record<Kind, string[]> = { danse: ['Gospel Dance', 'Afro', 'Cardio', 'Urban'], louange: ['Matin', 'Adoration', 'Chœur Gospel', 'Piano Prière'] }
const ID = /^[A-Za-z0-9_-]{11}$/

/** Identifiant de vidéo YouTube extrait d'une adresse (youtu.be, watch, shorts, embed, live, music) ou d'un identifiant nu ; sinon null. */
export const ytId = (s: string): string | null => {
  const t = s.trim()
  if (ID.test(t)) return t
  try {
    const u = new URL(/^https?:\/\//.test(t) ? t : 'https://' + t), h = u.hostname.replace(/^(www|m|music)\./, '')
    if (h === 'youtu.be') { const v = u.pathname.slice(1, 12); return ID.test(v) ? v : null }
    if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v') ?? (/^\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/.exec(u.pathname)?.[2] ?? '')
      return ID.test(v) ? v : null
    }
  } catch { /* pas une adresse */ }
  return null
}
export const ytQuery = (kind: Kind, f: string, text: string) => [kind === 'danse' ? f + ' danse' : 'louange ' + f, text.trim()].filter(Boolean).join(' ').slice(0, 100)
/** Lecteur intégré sans cookies de suivi ; l'identifiant est validé avant toute construction d'adresse. */
export const embed = (id: string, auto: boolean) => {
  if (!ID.test(id)) throw new Error('identifiant invalide')
  return 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&playsinline=1' + (auto ? '&autoplay=1' : '')
}
