import type { State } from './lib'
import { today } from './lib'

export interface Meal { id: string; d: string; n: string; kcal: number; p: number; g: number; l: number; src: 'manuel' | 'IA' }
export interface Scan { nom: string; kcal: number; proteines: number; glucides: number; lipides: number; conseil: string; incertitude: string }
export interface Recipe { titre: string; minutes: number; kcal: number; proteines: number; glucides: number; lipides: number; ingredients: string[]; etapes: string[] }

const ok = (x: any, max: number) => Number.isFinite(x) && x >= 0 && x <= max
const strs = (a: any) => Array.isArray(a) && a.length > 0 && a.every((s: any) => typeof s === 'string')

export const bmi = (w: number, h: number) => w / ((h / 100) ** 2)
/** Métabolisme de base ESTIMÉ (Mifflin-St Jeor), kcal par jour. */
export const bmr = (p: { w: number; h: number; age: number; sx: 'F' | 'M' }) => Math.round(10 * p.w + 6.25 * p.h - 5 * p.age + (p.sx === 'M' ? 5 : -161))

/** Valide une analyse de plat renvoyée par l'IA : types et plages plausibles, sinon null. */
export const okScan = (x: any): Scan | null =>
  x && typeof x.nom === 'string' && ok(x.kcal, 5000) && ok(x.proteines, 500) && ok(x.glucides, 800) && ok(x.lipides, 500)
    ? { nom: x.nom.slice(0, 80), kcal: Math.round(x.kcal), proteines: Math.round(x.proteines), glucides: Math.round(x.glucides), lipides: Math.round(x.lipides), conseil: String(x.conseil ?? '').slice(0, 400), incertitude: String(x.incertitude ?? '').slice(0, 400) }
    : null

/** Valide des recettes renvoyées par l'IA (1 à 5 acceptées, 3 conservées), sinon null. */
export const okRecipes = (x: any): Recipe[] | null =>
  Array.isArray(x) && x.length >= 1 && x.length <= 5 &&
  x.every((r: any) => r && typeof r.titre === 'string' && ok(r.minutes, 600) && ok(r.kcal, 3000) && ok(r.proteines, 300) && ok(r.glucides, 500) && ok(r.lipides, 300) && strs(r.ingredients) && strs(r.etapes))
    ? x.slice(0, 3).map((r: any) => ({ titre: r.titre.slice(0, 80), minutes: Math.round(r.minutes), kcal: Math.round(r.kcal), proteines: Math.round(r.proteines), glucides: Math.round(r.glucides), lipides: Math.round(r.lipides), ingredients: r.ingredients.slice(0, 20).map(String), etapes: r.etapes.slice(0, 15).map(String) }))
    : null

export const pushMeal = (s: State, m: { n: string; kcal: number; p: number; g: number; l: number }, src: Meal['src']) => {
  s.meals.push({ id: 'm' + Date.now().toString(36) + s.meals.length, d: today(), src, ...m })
}
