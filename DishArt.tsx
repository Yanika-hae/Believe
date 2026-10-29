import { useMemo } from 'react'
import { dishArt } from './dishdraw'
import type { Prim } from './dishdraw'

const sw = (p: { s?: string }) => (p.s ? 0.8 : undefined)
const shape = (p: Prim, i: number) => {
  switch (p.t) {
    case 'c': return <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={p.f} stroke={p.s} strokeWidth={sw(p)} opacity={p.o} />
    case 'e': return <ellipse key={i} cx={p.x} cy={p.y} rx={p.rx} ry={p.ry} fill={p.f} stroke={p.s} strokeWidth={sw(p)} opacity={p.o} transform={p.rot ? 'rotate(' + p.rot + ' ' + p.x + ' ' + p.y + ')' : undefined} />
    case 'r': return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx} fill={p.f} stroke={p.s} strokeWidth={sw(p)} transform={p.rot ? 'rotate(' + p.rot + ' ' + (p.x + p.w / 2) + ' ' + (p.y + p.h / 2) + ')' : undefined} />
    case 'p': return <path key={i} d={p.d} fill={p.f} stroke={p.s} strokeWidth={p.w ?? 0.8} opacity={p.o} strokeLinecap="round" />
  }
}

/** Dessin du plat d'une recette, fait sur l'appareil (aucun envoi, aucune IA) : voir src/dishdraw.ts. */
export default function DishArt({ title, ingredients }: { title: string; ingredients: readonly string[] }) {
  const d = useMemo(() => dishArt(title, ingredients), [title, ingredients])
  return <svg className="dishart" viewBox="0 0 240 180" role="img" aria-label={'Dessin du plat (schéma fait par l’application, pas une photo) : ' + title}>{d.prims.map(shape)}</svg>
}
