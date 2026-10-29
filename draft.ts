import type { State } from './lib'

/** Copie profonde d'une valeur JSON (un nombre, un texte ou un booléen se copie de lui-même). */
const copy = <T,>(v: T): T => (v !== null && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v)

/**
 * Copie de travail de l'état pour une modification. Chaque rubrique (clé de premier niveau : notes, habitudes, repas…) n'est recopiée qu'à son premier accès,
 * en lecture comme en écriture : une action qui touche deux rubriques n'en recopie que deux, au lieu de la totalité des données (plus d'un Mo après des années d'usage).
 * `fin()` rend l'état modifié ; les rubriques jamais touchées y sont partagées, telles quelles, avec l'état de départ, qui n'est jamais modifié.
 */
export function copie(base: State): { s: State; fin: () => State } {
  const cur = new Map<string, unknown>(), mine = new Set<string>(), d: Record<string, unknown> = {}
  for (const k of Object.keys(base)) {
    cur.set(k, (base as unknown as Record<string, unknown>)[k])
    Object.defineProperty(d, k, {
      enumerable: true,
      configurable: true,
      get: () => { if (!mine.has(k)) { cur.set(k, copy(cur.get(k))); mine.add(k) } return cur.get(k) },
      set: (x: unknown) => { cur.set(k, x); mine.add(k) }
    })
  }
  const fin = (): State => {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(d)) out[k] = Object.getOwnPropertyDescriptor(d, k)!.get ? cur.get(k) : d[k]
    return out as unknown as State
  }
  return { s: d as unknown as State, fin }
}
