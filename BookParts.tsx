import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { State } from './lib'
import { sayAll, stopSay } from './ui'
import type { Upd } from './ui'
import { highlight } from './util'

// Éléments communs à la Bibliothèque (catalogue, recherche en ligne) et à Mes livres.
import type { Lang } from './books'
export const LNAME: Record<Lang, string> = { fr: 'Français', en: 'English' }
const TONES = 6
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h }
/** Deux initiales du titre (sans article ni petit mot) pour la couverture de remplacement. */
const SMALL = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'de', 'du', 'des', 'd', 'et', 'ou', 'a', 'à', 'au', 'aux', 'en', 'pour', 'sur', 'the', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for'])
export const initials = (t: string) => {
  const all = t.split(/[\s’'\-:;,.!?«»"()]+/).filter(x => /\p{L}/u.test(x)), w = all.filter(x => !SMALL.has(x.toLowerCase()))
  const k = w.length ? w : all
  return ((k[0] ?? t.trim())[0] ?? '?').toUpperCase() + (k[1] ? k[1][0].toUpperCase() : '')
}
/**
 * Couverture : image du catalogue seulement si l'utilisateur a activé les couvertures (le site qui l'héberge voit alors son adresse IP, sans référent), sinon une tuile colorée
 * aux initiales du livre. Une image qui ne charge pas retombe sur la tuile.
 */
export function Cover({ S, title, id, url }: { S: State; title: string; id: string; url: string | null }) {
  const [bad, setBad] = useState(false)
  if (url && S.ui.covers && !bad) return <img className="cov" src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" width={64} height={92} onError={() => setBad(true)} />
  return <span className={'cov t' + (hash(id) % TONES)} aria-hidden="true">{initials(title)}</span>
}

/** Réglage « afficher les couvertures » (désactivé par défaut) avec son explication. */
export function CoverToggle({ S, upd }: { S: State; upd: Upd }) {
  return (
    <div>
      <label className="rd" htmlFor="cov-toggle"><input id="cov-toggle" type="checkbox" checked={S.ui.covers} onChange={e => upd(s => { s.ui.covers = e.target.checked }, e.target.checked ? 'Couvertures affichées.' : 'Couvertures masquées.')} />Afficher les couvertures des livres</label>
      <p className="mut" style={{ margin: '2px 0 0' }}><small>Les couvertures viennent directement des sites des catalogues (Open Library, Google Books, Project Gutenberg, LibriVox) : ils voient alors votre adresse IP, sans savoir d’où vous venez. Désactivé par défaut ; le reste de la recherche fonctionne sans.</small></p>
    </div>
  )
}

/** Lien vers un site extérieur : nouvel onglet, sans transmettre l'adresse de l'application ni donner accès à la page d'origine. */
export const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true"> ↗</span><span className="sr"> (s’ouvre dans un nouvel onglet)</span></a>
)
/** Texte avec les mots recherchés surlignés. */
export const marked = (text: string, ts: string[]) => highlight(text, ts).map((s, i) => (s.m ? <mark key={i}>{s.t}</mark> : s.t))

/** Lecture vocale : démarre et arrête la synthèse de l'appareil (aucune donnée envoyée), s'arrête seule à la fin du texte et quand on quitte l'écran. */
export function useTalk() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => { try { if (!speechSynthesis.speaking && !speechSynthesis.pending) setOn(false) } catch { setOn(false) } }, 500)
    return () => clearInterval(t)
  }, [on])
  useEffect(() => stopSay, [])
  return { on, start: (text: string, lang: string) => { sayAll(text, lang); setOn(true) }, stop: () => { stopSay(); setOn(false) } }
}
