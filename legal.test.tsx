// Informations légales : le texte est comparé au code (accords, services contactés, durées, limites, éléments partageables) pour qu'aucune divergence ne passe inaperçue.
import { cleanup, render, screen, within } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { go, mount } from './testkit'
import { FREE_NOTE } from './ai'
import { LEGAL_VERSION } from './legal'
import { MAX_ITEMS, HORIZON_MS } from './push'
import { PIN_MAX, PIN_MIN } from './pin'
import { NEVER_SHARED, SHARE_ITEMS } from './share'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const norm = (t: string) => t.replace(/\s+/g, ' ').trim()
/** Texte entier de la page, ou d'une de ses trois sections. */
const page = () => norm(document.body.textContent ?? '')
const section = (titre: string) => norm([...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent === titre)!.textContent ?? '')
const DEV = /Opérationnelle|Partielle|Non implémentée|non configur|Configuration requise|README|ce déploiement|propre déploiement|mode d’emploi|fluidité|double format|TikTok|Instagram|\bFPS\b/i

afterEach(() => { cleanup(); vi.doUnmock('./legal'); vi.resetModules() })

describe('Informations légales : contenu et cohérence avec l’application', () => {
  it('trois sections, version à jour, hébergeur nommé ; aucun éditeur ni contact tant qu’ils ne sont pas renseignés ; lien de retour vers les Paramètres', async () => {
    await mount('#/legal')
    expect(screen.getByRole('heading', { level: 1, name: 'Informations légales' })).toBeTruthy()
    expect(LEGAL_VERSION).toBe('28 octobre 2026'); expect(page()).toContain('Version du 28 octobre 2026.')
    expect([...document.querySelectorAll('details > summary')].map(s => s.textContent)).toEqual(['Conditions d’utilisation', 'Politique de confidentialité', 'Transparence sur l’intelligence artificielle'])
    expect(page()).toContain('Hébergeur : Vercel Inc.'); expect(page()).toContain('Supabase Inc.')
    expect(page()).not.toMatch(/Éditeur :|Contact :/); expect(page()).not.toContain('Pour toute demande qui ne se règle pas'); expect(page()).toContain('l’éditeur de Believe, qui a choisi l’hébergeur et sa région')
    const back = screen.getByRole('link', { name: 'Retour aux Paramètres' }); expect(back.getAttribute('href')).toBe('#/2/confidentialite')
  })

  it('éditeur et contact renseignés : affichés en tête, cités comme responsable du traitement et pour les demandes de droits', async () => {
    vi.resetModules(); vi.doMock('./legal', () => ({ LEGAL_VERSION: '1 janvier 2030', PUBLISHER: { nom: 'Ada Lovelace', contact: 'ada@exemple.test', hebergeur: 'Hôte Test' } }))
    const { default: Legal } = await import('./LegalPage')
    render(<Legal />)
    const t = page()
    expect(t).toContain('Version du 1 janvier 2030.'); expect(t).toContain('Éditeur : Ada Lovelace.'); expect(t).toContain('Contact : ada@exemple.test.'); expect(t).toContain('Hébergeur : Hôte Test.')
    expect(t).toContain('le responsable du traitement est l’éditeur de Believe (Ada Lovelace)'); expect(t).toContain('Pour toute demande qui ne se règle pas dans l’application : ada@exemple.test.')
  })

  it('plus aucune trace de la position GPS ni de l’ancien numéro de rubrique des réglages ; aucun vocabulaire de mise en place', async () => {
    await mount('#/legal')
    const t = page()
    expect(t).not.toMatch(/GPS|géolocalis|tracé|\bposition\b|séance GPS/i); expect(t).not.toMatch(/rubrique 5/i); expect(t).not.toMatch(DEV)
  })

  it('l’écran allumé : chaque fonction qui garde l’écran allumé (comptage des pas, métronome, prompteur, enregistrement) est citée, et plus aucune « séance » n’est évoquée', async () => {
    const users = readdirSync(join(process.cwd(), 'src')).filter(f => /\.tsx?$/.test(f) && !/\.test\./.test(f) && f !== 'wake.ts' && /\blockScreen\(\)/.test(read('src/' + f))).sort()
    expect(users).toEqual(['MetroTab.tsx', 'Prompter.tsx', 'Sport.tsx', 'rec.ts']) // une cinquième fonction qui garde l'écran allumé doit être ajoutée au texte puis ici
    await mount('#/legal')
    const t = section('Politique de confidentialité')
    expect(t).toContain('l’écran peut rester allumé pendant le comptage, le métronome, le prompteur ou un enregistrement, sans rien collecter')
    expect(t).not.toContain('pendant une séance')
  })

  it('les neuf accords du texte sont exactement ceux de Paramètres › Confidentialité, tous refusés par défaut', async () => {
    await mount('#/2/confidentialite')
    const card = screen.getByRole('heading', { name: 'Consentements' }).closest('.card') as HTMLElement
    const reglages = within(card).getAllByRole('button', { name: /^Donner / }).map(b => b.getAttribute('aria-label')!.replace(/^Donner /, ''))
    expect(reglages).toHaveLength(9); expect(within(card).queryAllByRole('button', { name: /^Retirer / })).toHaveLength(0)
    cleanup(); await mount('#/legal')
    const liste = [...document.querySelectorAll('details')[1].querySelectorAll('ul')[0].querySelectorAll('li > b')].map(b => b.textContent)
    expect(liste).toEqual(reglages)
    expect(section('Politique de confidentialité')).toContain('tous sont refusés par défaut')
  })

  it('chaque service contacté par l’application est nommé : sites autorisés par la politique de sécurité (vercel.json) et fonctions serveur', async () => {
    const csp = (JSON.parse(read('vercel.json')).headers[0].headers as { key: string; value: string }[]).find(h => h.key === 'Content-Security-Policy')!.value
    const dir = (n: string) => csp.split(';').map(s => s.trim()).find(s => s.startsWith(n + ' '))!.split(' ').slice(1).filter(x => x.startsWith('https://')).map(x => x.slice(8))
    const NOM: Record<string, string> = {
      '*.supabase.co': 'Supabase', 'www.youtube-nocookie.com': 'youtube-nocookie.com', 'openlibrary.org': 'Open Library', '*.openlibrary.org': 'Open Library', 'archive.org': 'Internet Archive', '*.archive.org': 'Internet Archive',
      'books.google.com': 'Google Books', 'play.google.com': 'Google Books', 'www.google.com': 'Google Books', 'gutenberg.org': 'Project Gutenberg', '*.gutenberg.org': 'Project Gutenberg', 'gutendex.com': 'Gutendex', '*.gutendex.com': 'Gutendex',
      'librivox.org': 'LibriVox', '*.librivox.org': 'LibriVox', 'wikisource.org': 'Wikisource', '*.wikisource.org': 'Wikisource', 'wikimedia.org': 'Wikisource', '*.wikimedia.org': 'Wikisource', 'classics.mit.edu': 'sites que vous ouvrez vous-même'
    }
    const hotes = [...dir('connect-src'), ...dir('frame-src'), ...dir('img-src')]
    expect(hotes.length).toBeGreaterThan(15)
    await mount('#/legal'); const t = page()
    for (const h of hotes) { expect(NOM[h], 'hôte sans nom dans le test : ' + h).toBeTruthy(); expect(t, h).toContain(NOM[h]) }
    for (const n of ['Gemini', 'YouTube', 'Google Agenda', 'Vercel', 'Supabase', 'Apple', 'Mozilla', 'Microsoft', 'BibleGateway', 'Wikisource', 'CNIL']) expect(t, n).toContain(n)
    // les fonctions serveur (api/*.ts) n'appellent que ces services externes, tous nommés dans le texte
    const APPELE: Record<string, string> = {
      'generativelanguage.googleapis.com': 'Gemini', 'www.googleapis.com': 'YouTube', 'openlibrary.org': 'Open Library', 'covers.openlibrary.org': 'Open Library', 'archive.org': 'Internet Archive', 'books.google.com': 'Google Books',
      'gutendex.com': 'Gutendex', 'www.gutenberg.org': 'Project Gutenberg', 'librivox.org': 'LibriVox'
    }
    const appels = [...new Set(readdirSync(join(process.cwd(), 'api')).filter(f => f.endsWith('.ts')).flatMap(f => [...read('api/' + f).matchAll(/https:\/\/([a-z.]+)\//g)].map(m => m[1])))].sort()
    expect(appels).toEqual(Object.keys(APPELE).sort())
    for (const h of appels) expect(t, h).toContain(APPELE[h])
  })

  it('les chiffres du texte sont ceux du code et de la base : invitation 7 jours, 12 membres, 100 rappels sur 39 jours, abonnement 90 jours, rappel 1 jour, compteur 48 heures, PIN 4 à 12 chiffres', async () => {
    const sql = read('supabase/schema.sql'), ai = read('api/ai.ts')
    expect(sql).toMatch(/interval '7 days'/); expect(sql).toMatch(/>= 12 then raise exception 'bl:full'/); expect(sql).toMatch(/interval '90 days'/); expect(sql).toMatch(/at < now\(\) - interval '1 day'/); expect(ai).toMatch(/\['EXPIRE', key, 172800\]/)
    expect(MAX_ITEMS).toBe(100); expect(HORIZON_MS).toBe(39 * 86400e3); expect([PIN_MIN, PIN_MAX]).toEqual([4, 12])
    await mount('#/legal'); const t = page()
    expect(t).toContain('valable 7 jours, à usage unique'); expect(t).toContain('une invitation expire au bout de 7 jours'); expect(t).toContain('12 personnes au plus'); expect(t).toContain('(12 au plus)')
    expect(t).toContain('(100 au plus, 39 jours au plus)'); expect(t).toContain('un abonnement resté 90 jours sans servir est supprimé'); expect(t).toContain('au plus tard un jour après son heure')
    expect(t).toContain('cette empreinte y est gardée 48 heures'); expect(t).toContain('PIN de 4 à 12 chiffres')
  })

  it('l’IA : l’avertissement sur l’offre gratuite est le même que dans les accords ; huit fonctions, autant que d’appels dans le code ; aucune image de plat par IA', async () => {
    const src = readdirSync(join(process.cwd(), 'src')).filter(f => /\.tsx?$/.test(f) && !/\.test\.|^ai\.ts$|^testkit|^fakecloud/.test(f))
    const appels = src.flatMap(f => [...read('src/' + f).matchAll(/\b(askAI|askJSON)\(/g)].map(() => f))
    expect(appels).toHaveLength(8)
    await mount('#/legal'); const t = page(), ia = section('Transparence sur l’intelligence artificielle')
    expect(ia).toContain('L’IA intervient dans huit fonctions')
    for (const phrase of ['vos messages et les réponses peuvent servir à améliorer ses produits', 'Cette API est réservée aux personnes de 18 ans et plus']) { expect(FREE_NOTE).toContain(phrase); expect(t).toContain(phrase) }
    expect(t).toContain('Believe n’utilise que l’offre gratuite de l’API Gemini'); expect(ia).toContain('aucune IA n’intervient, rien n’est envoyé')
    for (const f of ['la conversation', 'photo de plat', 'les recettes', 'fiche de synthèse d’un livre', 'les questions de quiz', 'sujet d’improvisation', 'note de cauchemar', 'verset du jour']) expect(ia, f).toContain(f)
  })

  it('le partage : chaque élément sensible et chaque élément jamais partageable du code est cité dans le texte', async () => {
    await mount('#/legal'); const t = section('Politique de confidentialité')
    const DIT: Record<string, string> = { weight: 'poids', weightPct: 'progression vers l’objectif de poids', cycle: 'cycle ou récupération', food: 'calories et repas du jour', prayers: 'sujets de prière', notes: 'nombre de notes par catégorie' }
    const sens = SHARE_ITEMS.filter(i => i.sens).map(i => i.k as string)
    expect(sens.sort()).toEqual(Object.keys(DIT).sort())
    for (const k of sens) expect(t, k).toContain(DIT[k])
    expect(t).toContain('ne sont montrées qu’après votre confirmation, une par une')
    const jamais: [string, string][] = [['titres de vos notes', 'texte et titres des notes'], ['enregistrements audio', 'enregistrements audio'], ['vos photos', 'photos'], ['échanges avec l’IA', 'échanges avec l’IA'], ['code PIN', 'PIN'], ['détail de vos pesées', 'détail de vos pesées'], ['gratitudes', 'gratitudes'], ['nom de vos habitudes', 'nom de vos habitudes']]
    for (const [code, texte] of jamais) { expect(NEVER_SHARED.join(' '), code).toContain(code); expect(t, texte).toContain(texte) }
    expect(t).toMatch(/Ne sont jamais partageables : texte et titres des notes, enregistrements audio, photos, échanges avec l’IA, PIN, gratitudes, nom de vos habitudes, détail de vos pesées\./)
    expect(t).toContain('12 personnes au plus, toutes invitées par le créateur'); expect(t).toContain('Une personne qui voit votre carte peut en faire une capture d’écran')
  })

  it('les droits s’exercent dans l’application : chaque bouton cité existe vraiment dans Paramètres, Amis ou Compte', async () => {
    await mount('#/legal'); const t = section('Politique de confidentialité')
    for (const b of ['Tout supprimer', 'Quitter le cercle', 'Arrêter de partager', 'Supprimer mon compte en ligne', 'Effacer mes données de santé', 'Afficher les couvertures', 'Afficher le titre']) expect(t, b).toContain(b)
    cleanup(); await mount('#/2/donnees'); expect(screen.getByRole('button', { name: 'Tout supprimer' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Générer l’export' })).toBeTruthy()
    cleanup(); await mount('#/2/confidentialite'); expect(screen.getByRole('button', { name: 'Effacer mes données de santé' })).toBeTruthy()
    const code = read('src/CirclesPage.tsx') + read('src/CloudPage.tsx') + read('src/PushCard.tsx') + read('src/BookParts.tsx')
    for (const b of ['Quitter le cercle', 'Arrêter de partager', 'Supprimer mon compte en ligne', 'Afficher les couvertures', 'Afficher le titre']) expect(code, b).toContain(b)
    await go('#/legal')
  })
})
