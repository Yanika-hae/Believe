import { useId } from 'react'

/** Logo Believe : couronne dorée ornée de joyaux, flamme au centre (animation coupée en mouvement réduit). `size` : largeur en pixels (40 par défaut, dans l'en-tête). */
export default function Logo({ size = 40 }: { size?: number }) {
  const id = useId().replace(/[^A-Za-z0-9]/g, '') // identifiants propres à chaque logo : un dégradé reste utilisable même si un autre logo est masqué
  const gold = 'url(#' + id + 'a)', fire = 'url(#' + id + 'b)'
  return (
    <svg className="logo" width={size} height={Math.round(size * 0.9)} style={{ width: size, height: Math.round(size * 0.9) }} viewBox="0 0 64 56" role="img" aria-label="Logo Believe : couronne et flamme">
      <defs>
        <linearGradient id={id + 'a'} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd86b" /><stop offset="1" stopColor="#ff8a3d" /></linearGradient>
        <linearGradient id={id + 'b'} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#6d4cff" /><stop offset="1" stopColor="#ff3d8b" /></linearGradient>
      </defs>
      <path d="M6 44 10 14 24 28 32 8 40 28 54 14 58 44Z" fill={gold} /><rect x="6" y="44" width="52" height="7" rx="3.5" fill={gold} />
      {[[10, 12], [32, 6], [54, 12]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.4" fill="#fff6dc" stroke="#ff8a3d" strokeWidth="1.2" />)}
      {[20, 32, 44].map(x => <circle key={x} cx={x} cy="47.5" r="1.8" fill="#fff6dc" />)}
      <g className="flame"><path d="M32 41C23 35 28 27 32 19 36 27 41 35 32 41Z" fill={fire} /><path d="M32 39C28 35 30 31 32 27 34 31 36 35 32 39Z" fill="#fff" fillOpacity=".92" /></g>
    </svg>
  )
}
