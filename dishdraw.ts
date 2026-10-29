// Dessin d'un plat fait sur l'appareil à partir du titre et des ingrédients d'une recette : aucun envoi, aucune IA, aucun coût.
// C'est un dessin schématique (formes et couleurs par famille d'ingrédients), pas une photo ; le même plat donne toujours le même dessin.

export type Kind =
  | 'egg' | 'potato' | 'orange' | 'tomato' | 'berry' | 'lemon' | 'avocado' | 'fruit' | 'bean' | 'leaf' | 'purple' | 'white' | 'cheese' | 'onion' | 'mushroom'
  | 'grain' | 'pasta' | 'meat' | 'fish' | 'nut' | 'oil' | 'olive' | 'spice' | 'broth' | 'other'

export type Prim =
  | { t: 'c'; x: number; y: number; r: number; f: string; s?: string; o?: number }
  | { t: 'e'; x: number; y: number; rx: number; ry: number; rot: number; f: string; s?: string; o?: number }
  | { t: 'r'; x: number; y: number; w: number; h: number; rot: number; f: string; s?: string; rx?: number }
  | { t: 'p'; d: string; f: string; s?: string; w?: number; o?: number }
export interface Dish { bowl: boolean; kinds: Kind[]; prims: Prim[] }

/** Texte sans accent ni majuscule, mots séparés par une espace (« Œufs durs » → « oeufs durs »). */
export const norm = (s: string) => s.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const w = (src: string) => new RegExp('\\b(?:' + src + ')\\b')

/** Familles d'ingrédients, de la plus précise à la plus générale : un ingrédient appartient à la première famille qui le reconnaît (« pommes de terre » avant « pommes », « huile d'olive » avant « olives »). */
export const RULES: [Kind, RegExp][] = [
  ['egg', w('oeufs?|omelettes?')],
  ['potato', w('pommes? de terre|patates?(?! douces?)|frites?|gratins?')],
  ['orange', w('carottes?|potirons?|potimarrons?|courges?|butternuts?|patates? douces?|citrouilles?|abricots?|mangues?|oranges?|clementines?|papayes?')],
  ['oil', w('huiles?|vinaigres?|vinaigrettes?|sauces?|miel|sirops?|moutardes?|tamari|pesto|tahini|capres?|beurres? de \\w+')],
  ['olive', w('olives?')],
  ['bean', w('pois chiches?|lentilles?|haricots? (?:rouges?|blancs?|noirs?|secs?)|feves?|soja|edamames?|flageolets?|houmous|hummus|falafels?')],
  ['purple', w('aubergines?|choux? rouges?|figues?')],
  ['tomato', w('tomates?|poivrons?|radis|betteraves?|piments?|ketchup|coulis')],
  ['berry', w('fraises?|framboises?|cerises?|myrtilles?|groseilles?|mures?|fruits? rouges?|cassis|grenades?|raisins?')],
  ['lemon', w('citrons?|limes?|pamplemousses?')],
  ['avocado', w('avocats?|guacamole')],
  ['fruit', w('pommes?|poires?|bananes?|ananas|kiwis?|melons?|peches?|nectarines?|pasteques?|prunes?|dattes?')],
  ['white', w('choux? fleurs?|navets?|panais|celeri rave')],
  ['onion', w('oignons?|echalotes?|ails?|cives?')],
  ['mushroom', w('champignons?|cepes?|girolles?|shiitake|pleurotes?')],
  ['leaf', w('epinards?|salades?|laitues?|roquette|mache|choux?|kale|persil|basilic|coriandre|menthe|ciboulette|herbes?|brocolis?|courgettes?|concombres?|haricots? verts?|petits? pois|pois|asperges?|celeri|poireaux?|fenouil|artichauts?|endives?|cresson|aneth|romarin|thym|origan|blettes?|pak choi|germes?|jeunes? pousses?')],
  ['cheese', w('feta|mozzarella|fromages?|chevre|parmesan|emmental|comte|gruyere|ricotta|burrata|camembert|brie|roquefort|halloumi|tofu|yaourts?|yogourts?|skyr|cremes?|lait|beurre')],
  ['pasta', w('pates|spaghettis?|tagliatelles?|penne|macaronis?|nouilles?|vermicelles?|lasagnes?|raviolis?|fusilli|linguine')],
  ['grain', w('riz|quinoa|semoule|couscous|boulgour|ble|orge|avoine|flocons?|millet|sarrasin|polenta|pains?|tartines?|galettes?|tortillas?|wraps?|pita|crackers?|biscottes?')],
  ['meat', w('poulets?|dindes?|boeufs?|veau|porc|agneau|jambon|lardons?|saucisses?|canard|steaks?|viandes?|bacon|escalopes?|merguez|chorizo|hachee?|boulettes?')],
  ['fish', w('saumon|thon|cabillaud|poissons?|crevettes?|sardines?|maquereaux?|truites?|merlu|moules?|calamars?|homard|crabe|surimi|anchois|dorade|colin|lotte|haddock|huitres?')],
  ['nut', w('noix|amandes?|noisettes?|cacahuetes?|pistaches?|graines?|sesame|tournesol|pignons?|cajou|chia|lin|pepins?')],
  ['spice', w('sel|poivre|cumin|curry|curcuma|cannelle|gingembre|muscade|epices?|paprika|safran|vanille')],
  ['broth', w('bouillons?|eau|fonds?')]
]
/** Texte d'un ingrédient : tout ce qui n'est pas un texte compte pour vide. */
const txt = (x: unknown) => (typeof x === 'string' ? x : '')
/** Famille d'un ingrédient (texte libre). */
export const kindOf = (ingredient: string): Kind => { const n = norm(txt(ingredient)); return RULES.find(([, re]) => re.test(n))?.[0] ?? 'other' }

/** Générateur pseudo-aléatoire déterministe (mulberry32) et empreinte de texte (FNV-1a). */
export const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

const pick = <T,>(a: readonly T[], r: () => number) => a[Math.floor(r() * a.length) % a.length]
const rot = (r: () => number) => Math.round(r() * 360)
type Draw = (x: number, y: number, r: () => number) => Prim[]
const disc = (x: number, y: number, rr: number, f: string, s?: string): Prim => ({ t: 'c', x, y, r: rr, f, s })
const oval = (x: number, y: number, rx: number, ry: number, a: number, f: string, s?: string, o?: number): Prim => ({ t: 'e', x, y, rx, ry, rot: a, f, s, o })

/** Dessin d'un morceau de chaque famille (autour du point x, y). */
const DRAW: Record<Kind, Draw> = {
  egg: (x, y, r) => [oval(x, y, 11, 8.5, rot(r), '#fffdf7', '#e8e2d2'), disc(x + 0.5, y, 4.2, '#f4bb1f'), disc(x - 1, y - 1.2, 1.2, '#fbe08a')],
  potato: (x, y, r) => [{ t: 'r', x: x - 5, y: y - 5, w: 10, h: 10, rot: rot(r), f: pick(['#eccb74', '#e3bd5c', '#f1d98c'], r), s: '#c99a3a' }],
  orange: (x, y, r) => [disc(x, y, 5.6, pick(['#ef8a22', '#f39a36'], r), '#d36f10'), disc(x, y, 2.2, '#f8b765')],
  tomato: (x, y, r) => [disc(x, y, 6.2, pick(['#d7402c', '#e2553c'], r), '#a82a1a'), oval(x - 1.5, y - 1.8, 2.4, 1.4, 320, '#f2937e', undefined, 0.8)],
  berry: (x, y, r) => [disc(x, y, 3.8, pick(['#c2264a', '#8b2a8f', '#3f4ea8'], r)), disc(x - 1, y - 1, 0.9, '#ffffff', undefined)],
  lemon: (x, y) => [disc(x, y, 7, '#f5d63a', '#d9b414'), disc(x, y, 5.2, '#fbec8a'), { t: 'p', d: `M${x} ${y - 5}V${y + 5}M${x - 5} ${y}H${x + 5}M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x + 3.5} ${y - 3.5}L${x - 3.5} ${y + 3.5}`, f: 'none', s: '#f5d63a', w: 0.8 }],
  avocado: (x, y, r) => [oval(x, y, 10, 7.5, rot(r), '#4f8a2e', '#355f1f'), oval(x, y, 8, 5.7, 0, '#cfe08a'), disc(x, y, 3.6, '#8a5a2b')],
  fruit: (x, y, r) => [disc(x, y, 6, pick(['#d94b3d', '#9ac84a', '#f3b73a'], r), '#9a3a22'), { t: 'p', d: `M${x} ${y - 5}q2 -4 5 -4`, f: 'none', s: '#4a7c2a', w: 1.2 }],
  bean: (x, y, r) => [oval(x, y, 4, 2.8, rot(r), pick(['#d3a966', '#c1884a', '#b5623f'], r)), oval(x + 6, y + 3, 3.8, 2.6, rot(r), pick(['#d3a966', '#c1884a'], r)), oval(x - 5, y + 4, 3.6, 2.5, rot(r), '#d9b878')],
  leaf: (x, y, r) => { const a = rot(r); return [oval(x, y, 11, 5.5, a, pick(['#4f9e3b', '#3a8a32', '#78b946'], r), '#2f6f28'), oval(x, y, 8.5, 0.45, a, '#2f6f28', undefined, 0.6)] },
  purple: (x, y, r) => [oval(x, y, 7, 5, rot(r), '#5d3b78', '#3d2352'), oval(x - 1, y - 1, 3, 1.6, 330, '#8c64a8', undefined, 0.8)],
  white: (x, y, r) => [disc(x, y, 6, '#f4f1e6', '#d9d4c2'), disc(x - 2, y - 1, 2.6, '#fbfaf3'), disc(x + 2.5, y + 2, 2.2, '#ece7d6'), oval(x, y + 5, 2, 1, rot(r), '#e3ddc8', undefined, 0.6)],
  cheese: (x, y, r) => [{ t: 'r', x: x - 5, y: y - 5, w: 10, h: 10, rot: rot(r), f: '#fbf5df', s: '#e4d9b0' }, disc(x - 1.5, y - 1, 1, '#eadfba')],
  onion: (x, y, r) => [disc(x, y, 6.5, 'none', '#c9a2cf'), disc(x, y, 4.2, 'none', '#d8bde0'), disc(x, y, 2, 'none', '#ead9ee'), oval(x + 8, y + 3, 3, 1.4, rot(r), '#f1e6d0')],
  mushroom: (x, y, r) => [{ t: 'p', d: `M${x - 7} ${y + 1}a7 6 0 0 1 14 0z`, f: pick(['#cfa56f', '#b98d57'], r), s: '#8f6a38' }, { t: 'r', x: x - 2, y: y + 1, w: 4, h: 5, rot: 0, f: '#efe3c8', s: '#d4c3a0' }],
  grain: (x, y, r) => [oval(x, y, 10, 6, rot(r), '#efe0b0', '#ddc98a', 0.9), oval(x - 3, y - 2, 1.4, 0.7, 20, '#fff8dc'), oval(x + 3, y + 1, 1.4, 0.7, 160, '#fff8dc'), oval(x + 1, y - 3, 1.3, 0.7, 70, '#fff8dc'), oval(x - 2, y + 3, 1.3, 0.7, 110, '#fff8dc')],
  pasta: (x, y, r) => { const c = pick(['#eccf7a', '#e5c161'], r); return [{ t: 'p', d: `M${x - 9} ${y}c3 -7 6 -7 9 0s6 7 9 0`, f: 'none', s: c, w: 3.2 }, { t: 'p', d: `M${x - 8} ${y + 4}c3 -6 6 -6 9 0s6 6 8 0`, f: 'none', s: c, w: 2.8, o: 0.9 }] },
  meat: (x, y, r) => [{ t: 'r', x: x - 8, y: y - 5.5, w: 16, h: 11, rot: rot(r), f: pick(['#a35c36', '#8e4a2b', '#b87445'], r), s: '#6e3519', rx: 3 }, { t: 'p', d: `M${x - 5} ${y - 2}l7 -3M${x - 4} ${y + 2}l8 -3`, f: 'none', s: '#d9a070', w: 0.9 }],
  fish: (x, y, r) => [oval(x, y, 10, 5.5, rot(r), pick(['#f2907a', '#f4a08a'], r), '#c9674f'), { t: 'p', d: `M${x - 5} ${y - 4}l2 8M${x - 1} ${y - 5}l2 10M${x + 3} ${y - 4}l2 8`, f: 'none', s: '#fbd3c6', w: 0.9 }],
  nut: (x, y, r) => [oval(x, y, 3.2, 2.2, rot(r), '#9a6a35', '#6e4721'), oval(x + 5, y + 3, 3, 2.1, rot(r), '#b07d44'), oval(x - 4, y + 4, 2.8, 2, rot(r), '#8a5c2c')],
  oil: (x, y, r) => [{ t: 'p', d: `M${x - 10} ${y}c4 -6 8 6 12 0s8 -5 10 1`, f: 'none', s: '#e6a817', w: 2, o: 0.75 }, disc(x + 4, y - 4, 1.2, '#f3c24a')],
  olive: (x, y, r) => [oval(x, y, 4.2, 3.2, rot(r), '#3d4a2b', '#222b17'), disc(x + 0.6, y, 1.2, '#b8554a')],
  spice: (x, y, r) => [disc(x - 4, y, 0.9, '#5a3a22'), disc(x + 1, y - 3, 0.8, '#7a4b25'), disc(x + 4, y + 2, 0.9, '#3d2a18'), disc(x - 1, y + 3, 0.8, '#2f7d32')],
  broth: () => [],
  other: (x, y, r) => [disc(x, y, 5, pick(['#d9c08a', '#c9a96a', '#e0cfa0'], r), '#a8884a')]
}
/** Ordre de dessin : les fonds (féculents, sauces) d'abord, les garnitures par-dessus. */
const LAYER: Kind[] = ['broth', 'grain', 'pasta', 'potato', 'bean', 'meat', 'fish', 'white', 'purple', 'orange', 'tomato', 'leaf', 'mushroom', 'avocado', 'cheese', 'fruit', 'lemon', 'berry', 'onion', 'egg', 'nut', 'olive', 'oil', 'spice', 'other']

const LIQUID: Partial<Record<Kind, string>> = { orange: '#eb9a3b', tomato: '#d9533a', leaf: '#86b872', bean: '#cfa56a', white: '#efe3c3', cheese: '#f0e4c4', potato: '#ecd49a', purple: '#9a6b9c', mushroom: '#c9a77c', meat: '#b9794d', fish: '#eea58f' }

/** Dessin du plat : familles reconnues (titre et ingrédients) et formes à tracer dans un cadre de 240 × 180. */
export function dishArt(title: string, ingredients: readonly string[]): Dish {
  const t = norm(txt(title)), count = new Map<Kind, number>(), order: Kind[] = []
  const add = (k: Kind, n = 1) => { if (!count.has(k)) order.push(k); count.set(k, (count.get(k) ?? 0) + n) }
  for (const i of ingredients.slice(0, 20)) { const k = kindOf(txt(i)); if (k !== 'other' || norm(txt(i)) !== '') add(k) }
  for (const [k, re] of RULES) if (re.test(t)) add(k)
  if (!order.some(k => k !== 'broth' && k !== 'spice')) add('other')
  const soup = /\b(?:soupes?|veloutes?|potages?|bouillons?|chili|curry|ragouts?|dahl|daal|porridge|creme de)\b/.test(t), salad = /\bsalades?\b/.test(t), bowl = soup || salad
  const r = rng(hash(t + '|' + ingredients.slice(0, 20).map(i => norm(txt(i))).join('|'))), prims: Prim[] = []
  // table
  prims.push({ t: 'r', x: 0, y: 0, w: 240, h: 180, rot: 0, f: '#e2cda6' })
  for (const y of [36, 72, 108, 144]) prims.push({ t: 'p', d: `M0 ${y}H240`, f: 'none', s: '#d4bb8e', w: 1, o: 0.7 })
  // assiette ou bol
  const R = bowl ? 74 : 72
  prims.push(oval(122, 96, R, R - 2, 0, '#000000', undefined, 0.12))
  prims.push(disc(120, 90, R, bowl ? '#f3efe6' : '#fbfaf7', bowl ? '#cfc8b8' : '#e1ded6'))
  prims.push(disc(120, 90, R - 15, bowl ? (soup ? LIQUID[order.find(k => LIQUID[k]) ?? 'other'] ?? '#e8c88a' : '#f8f5ec') : '#ffffff', bowl ? '#d8d0bc' : '#ece9e1'))
  // morceaux répartis en spirale (angle d'or), mélangés entre familles
  const kinds = order.filter(k => k !== 'broth').slice(0, 8), pieces: Kind[] = []
  kinds.forEach(k => { const n = k === 'spice' ? 1 : Math.max(2, Math.min(7, 2 + 2 * (count.get(k) ?? 1))); for (let i = 0; i < n; i++) pieces.push(k) })
  for (let i = pieces.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pieces[i], pieces[j]] = [pieces[j], pieces[i]] }
  const lim = R - 28, placed = pieces.map((k, i) => { const a = i * 2.39996 + r() * 0.6, d = lim * Math.sqrt((i + 0.6) / pieces.length); return { k, x: 120 + d * Math.cos(a), y: 90 + d * Math.sin(a) } })
  placed.sort((a, b) => LAYER.indexOf(a.k) - LAYER.indexOf(b.k))
  for (const p of placed) prims.push(...DRAW[p.k](Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, r))
  return { bowl, kinds, prims }
}
