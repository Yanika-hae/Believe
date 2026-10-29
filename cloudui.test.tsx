// Onglet « Compte » (rubrique 5) : parcours d'interface complets face à l'imitation du service en ligne (FakeCloud : Google simulé + vrai PostgreSQL qui a reçu supabase/schema.sql).
// Chaque test repart d'un stockage vide ; « un autre appareil » = un autre stockage et d'autres copies des modules (voir `mount`).
import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { FakeCloud } from './fakecloud'
import type { State } from './lib'
import { btn, go, mount, reopen, stored, tick, type, withCrypto } from './testkit'

configure({ asyncUtilTimeout: 4000 }) // la base de test et le chiffrement réel sont plus lents que de simples simulations
let fake: FakeCloud
beforeAll(async () => { fake = await FakeCloud.create() }, 120_000)
afterAll(async () => { await fake.db.close() })
beforeEach(async () => { await fake.reset(); history.replaceState(null, '', '/'); vi.stubGlobal('fetch', fake.fetch); withCrypto() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); history.replaceState(null, '', '/') })

const ADA = (s: State) => { s.profile = { g: 'F', name: 'Ada', age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' } }
const BEA = (s: State) => { s.profile = { g: 'F', name: 'Bea', age: 41, h: 165, w: 58, t: 58, ws: 58, lv: 'I', sx: 'F' } }
const withNote = (s: State, id = 'n1') => { s.notes.push({ id, cat: 'Rêves', t: 'Titre ' + id, b: 'secret-' + id, c: '2026-03-01T08:00:00.000Z', u: '2026-03-01T08:00:00.000Z' }) }
const CLOUD = (s: State) => { s.consents.cloud = true }
const KEYRE = /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/
const snaps = async () => (await fake.db.query<{ rev: number; blob: string; dev: string | null }>('select rev::int as rev, blob, dev from bl.snaps')).rows

/** Avant le montage de l'application : connecte cet « appareil » à Google (et active la synchronisation si demandé). Renvoie la clé de synchronisation. */
async function prior(o: { email?: string; sync?: boolean } = {}): Promise<string | null> {
  const c = await import('./cloud'); let url = ''; c.nav.assign = u => { url = u }
  expect(await c.startGoogle()).toEqual({ ok: true })
  const back = new URL(await fake.google(url, o.email ?? 'ada@example.org')); history.replaceState(null, '', back.pathname + back.search + back.hash)
  expect((await c.completeFromUrl()).kind).toBe('ok')
  if (!o.sync) return null
  const y = await import('./sync'), r = await y.enableSync()
  if (!r.ok || r.mode !== 'created') throw new Error('activation : ' + JSON.stringify(r))
  return r.key
}
/** Ouvre l'onglet Compte d'un appareil déjà connecté. */
const device = (seed: (s: State) => void, o: { email?: string; sync?: boolean } = {}) => {
  const out: { key: string | null } = { key: null }
  return mount('#/2/compte', s => { CLOUD(s); seed(s) }, async () => { out.key = await prior(o) }).then(() => out)
}
const more = () => { const d = screen.getByText('Plus d’options').closest('details') as HTMLDetailsElement; d.open = true }
const key = () => screen.getByTestId('synckey').textContent!
const closeKey = async (first: boolean) => {
  if (first) fireEvent.click(screen.getByLabelText(/J’ai conservé cette clé/))
  fireEvent.click(btn(first ? 'Terminer' : 'Fermer')); await tick()
  expect(screen.queryByRole('dialog', { name: 'Votre clé de synchronisation' })).toBeNull()
}
const enterKey = async (k: string) => { type('Clé de synchronisation', k); fireEvent.click(btn('Valider la clé')); await tick(30) }
const body = () => document.body.textContent ?? ''
const rpcs = (fn: string) => fake.calls.filter(c => c.fn === fn)

describe('Compte en ligne : accord, configuration, connexion', () => {
  it('sans accord : une carte d’explication, aucune requête ; l’accord enregistré (confirmé) ouvre l’onglet', async () => {
    await mount('#/2/compte', ADA)
    expect(screen.getByRole('heading', { name: 'Compte en ligne (facultatif)' })).toBeTruthy(); expect(body()).toMatch(/fonctionne entièrement sans compte/); expect(body()).toMatch(/Accord retirable à tout moment/)
    expect(screen.queryByRole('button', { name: 'Se connecter avec Google' })).toBeNull(); await tick(30); expect(fake.calls).toHaveLength(0)
    fireEvent.click(btn('J’accepte le compte en ligne')); expect(stored().consents.cloud).toBe(true); expect(screen.getByText('Accord enregistré : Compte en ligne (facultatif).')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Se connecter avec Google' })).toBeTruthy()
    expect(fake.calls.map(c => c.path)).toEqual(['/api/cloud-config', '/rest/v1/rpc/bl_ping']) // vérification du service seulement : ni authentification ni donnée
  })

  it('service indisponible : un message simple, sans nom de variable ni mode d’emploi ; « Réessayer » après correction', async () => {
    fake.config = { ok: false, missing: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'], invalid: [] }
    await mount('#/2/compte', s => { ADA(s); CLOUD(s) })
    expect(await screen.findByText(/Le compte en ligne n’est pas disponible pour le moment\. Tout le reste de Believe fonctionne sans lui\./)).toBeTruthy(); expect(body()).not.toMatch(/SUPABASE|schema\.sql|Redirect URLs|Vercel|variable|README|non configuré|Configuration requise/)
    expect(screen.queryByRole('button', { name: 'Se connecter avec Google' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Activer la synchronisation' })).toBeNull()
    fake.config = { ok: false, missing: [], invalid: ['SUPABASE_URL'] }; fireEvent.click(btn('Réessayer')); expect(await screen.findByText(/Le compte en ligne n’est pas disponible pour le moment\./)).toBeTruthy(); expect(body()).not.toMatch(/SUPABASE|invalides/)
    fake.config = FakeCloud.defaultConfig(); fireEvent.click(btn('Réessayer')); expect(await screen.findByRole('button', { name: 'Se connecter avec Google' })).toBeTruthy(); expect(screen.queryByText(/pas disponible pour le moment/)).toBeNull()
  })

  it('hors ligne : message distinct (ce n’est pas « non configuré ») et nouvel essai', async () => {
    fake.offline = true
    await mount('#/2/compte', s => { ADA(s); CLOUD(s) })
    expect(await screen.findByText(/Hors ligne : impossible de joindre le serveur/)).toBeTruthy(); expect(screen.queryByText(/pas disponible pour le moment/)).toBeNull()
    fake.offline = false; fireEvent.click(btn('Réessayer')); expect(await screen.findByRole('button', { name: 'Se connecter avec Google' })).toBeTruthy()
  })

  it('base du service pas prête : un message simple, sans parler de script ni de projet', async () => {
    fake.failNext = { match: 'bl_ping', status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.bl_ping' } }
    await mount('#/2/compte', s => { ADA(s); CLOUD(s) })
    expect(await screen.findByText('Le compte en ligne est momentanément indisponible : réessayez plus tard.')).toBeTruthy(); expect(body()).not.toMatch(/SQL|schema|README/)
  })

  it('connexion Google de bout en bout : redirection avec empreinte PKCE, retour avec le code, session enregistrée, adresse nettoyée, aucune donnée envoyée', async () => {
    await mount('#/2/compte', s => { ADA(s); CLOUD(s) })
    const c = await import('./cloud'); let url = ''; c.nav.assign = u => { url = u }
    fireEvent.click(await screen.findByRole('button', { name: 'Se connecter avec Google' })); await waitFor(() => expect(url).not.toBe(''))
    expect(new URL(url).pathname).toBe('/auth/v1/authorize')
    const back = new URL(await fake.google(url)); history.replaceState(null, '', back.pathname + back.search); cleanup()
    await reopen('') // la page se recharge au retour de Google
    expect(await screen.findByText(/Connecté avec Google : ada@example\.org\. Aucune donnée n’est envoyée tant que vous n’avez pas activé la synchronisation ou un partage\./)).toBeTruthy()
    expect(location.search).toBe(''); expect(location.hash).toBe('#/2/compte'); expect(localStorage.getItem('believe:auth-pending')).toBeNull(); expect(JSON.parse(localStorage.getItem('believe:auth')!).email).toBe('ada@example.org')
    expect(screen.getByText('ada@example.org')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Activer la synchronisation' })).toBeTruthy(); expect(rpcs('bl_snap_put')).toHaveLength(0); expect(rpcs('bl_snap_get')).toHaveLength(0)
    expect(screen.getByRole('heading', { level: 1, name: 'Paramètres' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Compte', pressed: true })).toBeTruthy()
  })

  it('retour de connexion sans l’accord : rien n’est échangé, l’adresse et le secret gardé sont effacés', async () => {
    const c0 = await (async () => { await mount('#/4', ADA); return await import('./cloud') })(); let url = ''; c0.nav.assign = u => { url = u }
    // L'accord est donné le temps de préparer la demande, puis retiré avant le retour.
    expect((await c0.beginSignIn(location.origin + '/')).ok).toBe(true); const b = await c0.beginSignIn(location.origin + '/'); if (!b.ok) throw new Error('x'); url = b.url
    const back = new URL(await fake.google(url)); history.replaceState(null, '', back.pathname + back.search); cleanup()
    const before = fake.calls.length; await reopen('')
    expect(await screen.findByText(/Retour de connexion Google ignoré : l’accord « Compte en ligne » n’est pas donné/)).toBeTruthy()
    expect(fake.calls.slice(before).some(c => c.path.includes('/auth/v1/token'))).toBe(false); expect(location.search).toBe(''); expect(localStorage.getItem('believe:auth-pending')).toBeNull(); expect(localStorage.getItem('believe:auth')).toBeNull()
  })

  it('refus de Google : message clair, pas de session, onglet Compte ouvert', async () => {
    await mount('#/4', s => { ADA(s); CLOUD(s) }); cleanup()
    history.replaceState(null, '', '/?error=access_denied&error_code=access_denied&error_description=Acc%C3%A8s+refus%C3%A9+par+la+personne')
    await reopen('')
    expect(await screen.findByText(/Connexion non terminée\. Google ou le service a refusé la connexion \(« Accès refusé par la personne »\)/)).toBeTruthy(); expect(location.search).toBe(''); expect(localStorage.getItem('believe:auth')).toBeNull()
    expect(await screen.findByRole('button', { name: 'Se connecter avec Google' })).toBeTruthy()
  })

  it('code reçu sans demande faite sur cet appareil : « aucune connexion n’avait été demandée », rien d’enregistré', async () => {
    await mount('#/4', s => { ADA(s); CLOUD(s) }); cleanup()
    history.replaceState(null, '', '/?code=abcdefgh12345678'); await reopen('')
    expect(await screen.findByText(/Aucune connexion n’avait été demandée sur cet appareil/)).toBeTruthy(); expect(localStorage.getItem('believe:auth')).toBeNull(); expect(rpcs('bl_ping').length).toBeLessThanOrEqual(1)
  })

  it('se déconnecter : le service est prévenu, la session locale disparaît, les données (locales et en ligne) sont intactes', async () => {
    await device(ADA, { sync: true }); expect(await screen.findByText('À jour.')).toBeTruthy()
    fireEvent.click(btn('Se déconnecter de cet appareil')); expect(await screen.findByText(/Déconnecté sur cet appareil\. Vos données locales et les données en ligne sont intactes\./)).toBeTruthy()
    expect(localStorage.getItem('believe:auth')).toBeNull(); expect(fake.calls.some(c => c.path.startsWith('/auth/v1/logout') && c.path.includes('scope=local'))).toBe(true)
    expect(await snaps()).toHaveLength(1); expect(stored().profile.name).toBe('Ada'); expect(await screen.findByRole('button', { name: 'Se connecter avec Google' })).toBeTruthy()
    expect(screen.getByText(/Connectez-vous avec Google \(carte « Connexion »\) pour utiliser la synchronisation/)).toBeTruthy()
  })
})

describe('Compte en ligne : activation, clé, envoi', () => {
  it('premier appareil : la clé est montrée, à confirmer avant de continuer ; les données partent chiffrées et la clé ne part jamais', async () => {
    await device(s => { ADA(s); withNote(s) })
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la synchronisation' }))
    const dlg = await screen.findByRole('dialog', { name: 'Votre clé de synchronisation' }); const k = key()
    expect(k).toMatch(KEYRE); expect(dlg.textContent).toMatch(/nécessaire pour ouvrir vos données sur un autre appareil/); expect(dlg.textContent).toMatch(/le service ne la reçoit jamais/)
    expect(btn('Terminer').hasAttribute('disabled')).toBe(true); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog', { name: 'Votre clé de synchronisation' })).toBeTruthy() // Échap ne ferme pas avant confirmation
    await closeKey(true)
    expect(await screen.findByText('À jour.')).toBeTruthy(); const rows = await snaps(); expect(rows).toHaveLength(1); expect(rows[0].blob).toMatch(/^BLS1\./)
    const wire = JSON.stringify(fake.calls); for (const t of ['"Ada"', 'secret-n1', 'Titre n1', k, k.replace(/-/g, '')]) expect(wire).not.toContain(t) // ni les données, ni la clé, ne passent en clair (« "Ada" » avec ses guillemets : trois lettres seules pourraient apparaître par hasard dans du texte chiffré)
    expect(rows[0].dev).toMatch(/\S/); expect(JSON.parse(localStorage.getItem('believe:sync')!)).toMatchObject({ on: true, rev: 1 })
    expect(screen.getByText(/Appareil : .*Version en ligne connue : 1/)).toBeTruthy()
  })

  it('« Afficher ma clé » : même clé qu’à la création ; avec un PIN, il est redemandé (refus si faux, essais comptés)', async () => {
    const o = await device(ADA, { sync: true }); expect(await screen.findByText('À jour.')).toBeTruthy()
    fireEvent.click(btn('Afficher ma clé')); await screen.findByRole('dialog', { name: 'Votre clé de synchronisation' }); expect(key()).toBe(o.key); await closeKey(false)
    const pin = await import('./pin'); expect(await pin.setPin('4821', 1, 1000)).toBe(true)
    fireEvent.click(btn('Afficher ma clé')); await screen.findByRole('dialog', { name: 'Saisissez votre PIN' }); expect(screen.queryByTestId('synckey')).toBeNull()
    type('PIN', '1111'); fireEvent.click(btn('Afficher la clé')); expect(await screen.findByText(/PIN incorrect\. Il reste 4 essais/)).toBeTruthy(); expect(screen.queryByTestId('synckey')).toBeNull()
    type('PIN', '4821'); fireEvent.click(btn('Afficher la clé')); await screen.findByRole('dialog', { name: 'Votre clé de synchronisation' }); expect(key()).toBe(o.key)
  })

  it('la clé et la session sont enregistrées chiffrées quand le chiffrement par le PIN est actif', async () => {
    await device(ADA, { sync: true }); expect(await screen.findByText('À jour.')).toBeTruthy()
    const ops = await import('./vaultops'); const r = await ops.enableVault('4821', 1, 1000); if (!r.ok) throw new Error(r.why)
    for (const k of ['believe:auth', 'believe:synckey']) expect(localStorage.getItem(k)!.startsWith('BLV1.'), k).toBe(true)
    const c = await import('./cloud'); expect(c.getSession()?.email).toBe('ada@example.org') // lisible tant que l'application est ouverte
    fireEvent.click(btn('Afficher ma clé')); await screen.findByRole('dialog', { name: 'Saisissez votre PIN' })
  })

  it('une modification faite dans l’application est envoyée après un court délai de calme (déclenchement automatique)', async () => {
    await device(ADA, { sync: true }); expect(await screen.findByText('À jour.')).toBeTruthy(); expect((await snaps())[0].rev).toBe(1)
    await go('#/4/prieres'); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    type('Sujet de prière', 'Pour la paix'); fireEvent.click(btn('Ajouter au mur')); await act(async () => { await Promise.resolve() })
    expect((await snaps())[0].rev).toBe(1) // pas d'envoi immédiat : on attend que la saisie se calme
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000) }); await vi.waitFor(async () => { expect((await snaps())[0].rev).toBe(2) }, { timeout: 5000, interval: 50 })
  })

  it('« Synchroniser maintenant » : confirmation seulement après vérification ; hors ligne, l’erreur est dite et rien n’est annoncé « à jour »', async () => {
    await device(ADA, { sync: true }); expect(await screen.findByText('À jour.')).toBeTruthy()
    fake.offline = true; fireEvent.click(btn('Synchroniser maintenant')); expect(await screen.findByText(/Hors ligne : la synchronisation reprendra au retour du réseau/)).toBeTruthy(); expect(screen.queryByText('Synchronisé : cet appareil et la version en ligne sont d’accord.')).toBeNull()
    fake.offline = false; fireEvent.click(btn('Synchroniser maintenant')); expect(await screen.findByText('Synchronisé : cet appareil et la version en ligne sont d’accord.')).toBeTruthy()
  })
})

describe('Compte en ligne : second appareil, clé et conflits', () => {
  /** Appareil A : données Ada + une note, synchronisé ; renvoie la clé. Puis « on change d'appareil » : stockage vide, nouveaux modules. */
  const first = async () => {
    const a = await device(s => { ADA(s); withNote(s) }, { sync: true }); expect(await screen.findByText('À jour.')).toBeTruthy(); cleanup(); return a.key!
  }

  it('appareil vide : la clé demandée est vérifiée (mauvaise forme, mauvaise clé, bonne clé) et les données arrivent sans redémarrer', async () => {
    const k = await first()
    await device(() => {}) // appareil B, vide
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la synchronisation' }))
    expect(await screen.findByText(/Des données existent déjà en ligne pour ce compte/)).toBeTruthy(); expect(screen.queryByRole('dialog', { name: 'Votre clé de synchronisation' })).toBeNull()
    await enterKey('ABCD-EFGH'); expect(await screen.findByText(/Cette clé n’a pas la bonne forme/)).toBeTruthy(); expect(localStorage.getItem('believe:synckey')).toBeNull()
    await enterKey('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'); expect(await screen.findByText(/Cette clé n’ouvre pas les données en ligne/)).toBeTruthy(); expect(localStorage.getItem('believe:synckey')).toBeNull() // jamais enregistrée tant qu'elle n'ouvre rien
    await enterKey(k.toLowerCase().replace(/-/g, ' ')); expect(await screen.findByText('Clé acceptée : vos données sont synchronisées.')).toBeTruthy()
    expect(stored().profile.name).toBe('Ada'); expect(stored().notes.map((n: { id: string }) => n.id)).toEqual(['n1']); expect(localStorage.getItem('believe:synckey')).toBeTruthy()
    await go('#/4'); expect(await screen.findByText('Bonjour Ada')).toBeTruthy() // l'application affiche les données reçues sans rechargement
    expect(await snaps()).toHaveLength(1); expect((await snaps())[0].rev).toBe(1) // la réception n'a rien renvoyé
  })

  it('appareil avec d’autres données : deux versions affichées côte à côte ; « Utiliser la version en ligne » les remplace, avec copie de sécurité', async () => {
    const k = await first()
    await device(s => { BEA(s); withNote(s, 'b1'); withNote(s, 'b2') })
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la synchronisation' })); await screen.findByText(/Des données existent déjà/); await enterKey(k)
    const card = await screen.findByRole('group', { name: 'Conflit de synchronisation' }); expect(card.textContent).toMatch(/Cet appareil contient déjà des données différentes de celles du compte en ligne/)
    expect(within(card).getByText('Cet appareil')).toBeTruthy(); expect(within(card).getByText('En ligne')).toBeTruthy(); expect(card.textContent).toMatch(/Profil : Bea/); expect(card.textContent).toMatch(/Profil : Ada/); expect(card.textContent).toMatch(/2 notes/); expect(card.textContent).toMatch(/1 note\b/)
    expect(stored().profile.name).toBe('Bea') // rien n'est remplacé avant le choix
    expect((await snaps())[0].rev).toBe(1)
    fireEvent.click(btn('Utiliser la version en ligne')); expect(await screen.findByText(/Les données en ligne ont remplacé celles de cet appareil\. Une copie de sécurité de vos anciennes données est gardée ci-dessous\./)).toBeTruthy()
    expect(stored().profile.name).toBe('Ada'); expect(stored().notes).toHaveLength(1); expect(screen.queryByRole('group', { name: 'Conflit de synchronisation' })).toBeNull()
    const bak = screen.getByRole('heading', { name: 'Copie de sécurité avant remplacement' }).closest('.card') as HTMLElement; expect(bak.textContent).toMatch(/les données de cet appareil, juste avant qu’elles soient remplacées par la version en ligne/)
    const y = await import('./sync'); expect(y.getBackup()?.s.profile?.name).toBe('Bea'); expect(y.getBackup()?.s.notes).toHaveLength(2)
    fireEvent.click(within(bak).getByRole('button', { name: 'Supprimer la copie' })); expect(screen.getByText('Copie de sécurité supprimée.')).toBeTruthy(); expect(y.getBackup()).toBeNull(); expect(localStorage.getItem('believe:syncbak')).toBeNull()
  })

  it('« Garder cet appareil » : la version en ligne est remplacée (copie de sécurité de l’ancienne) et les autres appareils la reçoivent', async () => {
    const k = await first()
    await device(s => { BEA(s); withNote(s, 'b1') })
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la synchronisation' })); await screen.findByText(/Des données existent déjà/); await enterKey(k); await screen.findByRole('group', { name: 'Conflit de synchronisation' })
    fireEvent.click(btn('Garder cet appareil et remplacer la version en ligne')); expect(await screen.findByText(/Les données de cet appareil ont remplacé la version en ligne\. Une copie de sécurité de l’ancienne version en ligne est gardée ci-dessous\./)).toBeTruthy()
    expect(stored().profile.name).toBe('Bea'); expect((await snaps())[0].rev).toBe(2); expect(screen.getByText(/la version en ligne, juste avant qu’elle soit remplacée par les données de cet appareil/)).toBeTruthy()
    expect(await screen.findByText('À jour.')).toBeTruthy()
  })

  it('décider plus tard : un bandeau sur les autres pages (absent sur l’onglet Compte), rien n’est envoyé ni remplacé', async () => {
    const k = await first()
    await device(s => { BEA(s); withNote(s, 'b1') })
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la synchronisation' })); await screen.findByText(/Des données existent déjà/); await enterKey(k); await screen.findByRole('group', { name: 'Conflit de synchronisation' })
    expect(screen.queryByText(/Synchronisation : deux versions différentes/)).toBeNull() // pas de bandeau sur l'onglet Compte lui-même
    await go('#/4'); const ban = await screen.findByText(/Synchronisation : deux versions différentes, choisissez celle à garder\./); expect(ban.closest('a')!.getAttribute('href')).toBe('#/2/compte')
    expect(stored().profile.name).toBe('Bea'); expect((await snaps())[0].rev).toBe(1)
    await go('#/2/compte'); await screen.findByRole('group', { name: 'Conflit de synchronisation' }); expect(screen.queryByText(/Synchronisation : deux versions différentes/)).toBeNull()
  })

  it('clé perdue : « Repartir de zéro » demande confirmation, efface la version en ligne et publie cet appareil avec une nouvelle clé', async () => {
    const k = await first()
    await device(s => { BEA(s); withNote(s, 'b1') })
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la synchronisation' })); await screen.findByText(/Des données existent déjà/)
    fireEvent.click(btn('Je n’ai plus la clé')); const dlg = await screen.findByRole('dialog', { name: 'Repartir de zéro (clé perdue)' }); expect(dlg.textContent).toMatch(/La version en ligne actuelle sera perdue définitivement/)
    fireEvent.click(within(dlg).getByRole('button', { name: 'Annuler' })); expect((await snaps())[0].rev).toBe(1) // annuler ne touche à rien
    fireEvent.click(btn('Je n’ai plus la clé')); fireEvent.click(btn('Effacer la version en ligne et repartir'))
    await screen.findByRole('dialog', { name: 'Votre clé de synchronisation' }); const k2 = key(); expect(k2).toMatch(KEYRE); expect(k2).not.toBe(k); await closeKey(true)
    expect(await screen.findByText('À jour.')).toBeTruthy(); const rows = await snaps(); expect(rows).toHaveLength(1); expect(rows[0].rev).toBeGreaterThan(1) // la numérotation ne revient jamais en arrière
    expect(stored().profile.name).toBe('Bea')
  })
})

describe('Compte en ligne : options, suppression', () => {
  it('changer la clé : confirmation expliquant l’effet, nouvelle clé montrée, ancienne clé refusée', async () => {
    const o = await device(ADA, { sync: true }); await screen.findByText('À jour.'); more()
    fireEvent.click(btn('Changer la clé')); const dlg = await screen.findByRole('dialog', { name: 'Changer la clé de synchronisation' }); expect(dlg.textContent).toMatch(/Les autres appareils ne pourront plus synchroniser tant que vous n’y aurez pas saisi la nouvelle clé/)
    fireEvent.click(within(dlg).getByRole('button', { name: 'Annuler' })); expect(localStorage.getItem('believe:synckey')).toBeTruthy(); expect((await snaps())[0].rev).toBe(1) // annuler ne change rien
    fireEvent.click(btn('Changer la clé')); const dlg2 = await screen.findByRole('dialog', { name: 'Changer la clé de synchronisation' }); fireEvent.click(within(dlg2).getByRole('button', { name: 'Changer la clé' }))
    await screen.findByRole('dialog', { name: 'Votre clé de synchronisation' }); const k2 = key(); expect(k2).toMatch(KEYRE); expect(k2).not.toBe(o.key); await closeKey(true)
    expect((await snaps())[0].rev).toBe(2)
    const y = await import('./sync'), { b32Parse } = await import('./b32'), blob = (await snaps())[0].blob
    expect(await y.openSnap(b32Parse(o.key!)!, blob)).toMatchObject({ ok: false, why: 'key' }); expect((await y.openSnap(b32Parse(k2)!, blob)).ok).toBe(true)
  })

  it('arrêter ici : cet appareil oublie la clé et n’envoie plus rien ; données locales et en ligne intactes ; la reprise redemande la clé', async () => {
    const o = await device(ADA, { sync: true }); await screen.findByText('À jour.'); more()
    fireEvent.click(btn('Arrêter ici')); const dlg = await screen.findByRole('dialog', { name: 'Arrêter la synchronisation sur cet appareil' }); fireEvent.click(within(dlg).getByRole('button', { name: 'Arrêter' }))
    expect(await screen.findByText(/Synchronisation arrêtée sur cet appareil \(clé oubliée ici\)\. Les données en ligne et celles de cet appareil sont intactes\./)).toBeTruthy()
    expect(localStorage.getItem('believe:sync')).toBeNull(); expect(localStorage.getItem('believe:synckey')).toBeNull(); expect(await snaps()).toHaveLength(1); expect(stored().profile.name).toBe('Ada')
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la synchronisation' })); expect(await screen.findByText(/Des données existent déjà en ligne pour ce compte/)).toBeTruthy()
    await enterKey(o.key!); expect(await screen.findByText('Clé acceptée : vos données sont synchronisées.')).toBeTruthy()
  })

  it('arrêter en gardant la clé : « Reprendre la synchronisation » sans la redemander', async () => {
    await device(ADA, { sync: true }); await screen.findByText('À jour.'); more()
    fireEvent.click(btn('Arrêter ici')); const dlg = await screen.findByRole('dialog', { name: 'Arrêter la synchronisation sur cet appareil' }); fireEvent.click(within(dlg).getByRole('checkbox')); fireEvent.click(within(dlg).getByRole('button', { name: 'Arrêter' }))
    expect(await screen.findByText(/\(clé conservée\)/)).toBeTruthy(); expect(localStorage.getItem('believe:synckey')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Reprendre la synchronisation' })); expect(await screen.findByText('Synchronisation reprise.')).toBeTruthy(); expect(await screen.findByText('À jour.')).toBeTruthy()
  })

  it('supprimer les données en ligne : confirmation, version en ligne supprimée, synchronisation arrêtée, données locales intactes', async () => {
    await device(s => { ADA(s); withNote(s) }, { sync: true }); await screen.findByText('À jour.'); more()
    fireEvent.click(btn('Supprimer les données en ligne')); const dlg = await screen.findByRole('dialog', { name: 'Supprimer les données en ligne' }); expect(dlg.textContent).toMatch(/Vos données locales ne sont pas touchées/)
    fireEvent.click(within(dlg).getByRole('button', { name: 'Annuler' })); expect(await snaps()).toHaveLength(1)
    fireEvent.click(btn('Supprimer les données en ligne')); fireEvent.click(btn('Supprimer définitivement'))
    expect(await screen.findByText(/Version en ligne supprimée et synchronisation arrêtée sur cet appareil\. Vos données locales sont intactes\./)).toBeTruthy()
    expect(await snaps()).toHaveLength(0); expect(localStorage.getItem('believe:sync')).toBeNull(); expect(stored().notes).toHaveLength(1)
  })

  it('« Ce que le service garde » : liste exacte ; suppression du compte confirmée, vérifiée, appareil déconnecté, données locales intactes', async () => {
    await device(s => { ADA(s); withNote(s) }, { sync: true }); await screen.findByText('À jour.')
    fireEvent.click(btn('Voir ce que le service garde de moi'))
    expect(await screen.findByText(/Instantané chiffré : .*\(version 1\)/)).toBeTruthy(); expect(body()).toMatch(/Cercles d’amis : 0 \(dont 0 créé par vous\) ; cartes partagées : 0/); expect(body()).toMatch(/Abonnements aux rappels : 0 ; rappels programmés : 0/)
    fireEvent.click(btn('Supprimer mon compte en ligne')); const dlg = await screen.findByRole('dialog', { name: 'Supprimer mon compte en ligne' }); expect(dlg.textContent).toMatch(/Vos données sur cet appareil et sur vos autres appareils ne sont pas touchées/)
    fireEvent.click(within(dlg).getByRole('button', { name: 'Annuler' })); expect((await fake.db.query('select 1 from auth.users')).rows).toHaveLength(1)
    fireEvent.click(btn('Supprimer mon compte en ligne')); fireEvent.click(btn('Supprimer définitivement'))
    expect(await screen.findByText(/Compte en ligne supprimé \(vérifié : le service ne garde plus rien\)/)).toBeTruthy()
    expect((await fake.db.query('select 1 from auth.users')).rows).toHaveLength(0); expect(await snaps()).toHaveLength(0)
    expect(localStorage.getItem('believe:auth')).toBeNull(); expect(localStorage.getItem('believe:sync')).toBeNull(); expect(localStorage.getItem('believe:synckey')).toBeNull(); expect(stored().notes).toHaveLength(1)
    expect(await screen.findByRole('button', { name: 'Se connecter avec Google' })).toBeTruthy()
  })

  it('suppression du compte hors ligne : rien n’est supprimé, rien n’est annoncé, la session reste', async () => {
    await device(ADA, { sync: true }); await screen.findByText('À jour.')
    fireEvent.click(btn('Supprimer mon compte en ligne')); fake.offline = true; fireEvent.click(btn('Supprimer définitivement'))
    expect(await screen.findByText('Hors ligne : le compte n’a pas été supprimé.')).toBeTruthy(); fake.offline = false
    expect((await fake.db.query('select 1 from auth.users')).rows).toHaveLength(1); expect(localStorage.getItem('believe:auth')).toBeTruthy(); expect(await snaps()).toHaveLength(1)
  })
})

describe('Compte en ligne : retrait de l’accord, effacement, verrouillage', () => {
  it('retirer l’accord dans Confidentialité : enregistré tout de suite, cet appareil déconnecté, plus aucune requête ; l’onglet Compte redemande l’accord', async () => {
    await device(ADA, { sync: true }); await screen.findByText('À jour.')
    await go('#/2/confidentialite'); expect(body()).toMatch(/Compte en ligne : donné/)
    fireEvent.click(btn('Retirer Compte en ligne')); expect(stored().consents.cloud).toBe(false)
    expect(await screen.findByText('Accord retiré : Compte en ligne. Cet appareil est déconnecté ; vos données locales et celles déjà en ligne sont intactes.')).toBeTruthy()
    expect(localStorage.getItem('believe:auth')).toBeNull(); expect(await snaps()).toHaveLength(1); const n = fake.calls.length
    await go('#/2/compte'); expect(screen.getByRole('heading', { name: 'Compte en ligne (facultatif)' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Synchroniser maintenant' })).toBeNull(); await tick(50); expect(fake.calls.length).toBe(n)
  })

  it('« Tout supprimer » (droit à l’oubli) : cet appareil est déconnecté du service puis tout est effacé ; ce qui est en ligne n’est pas effacé, et le dit', async () => {
    await device(ADA, { sync: true }); await screen.findByText('À jour.')
    await go('#/2/donnees'); expect(body()).toMatch(/Compte en ligne : ce bouton déconnecte cet appareil mais n’efface pas ce qui est déposé en ligne/)
    fireEvent.click(btn('Tout supprimer')); fireEvent.click(btn('Confirmer la suppression définitive'))
    expect(await screen.findByText(/Toutes les données Believe de cet appareil sont supprimées \(vérifié\).*Cet appareil est déconnecté du compte en ligne ; ce qui y est déposé n’a pas été effacé\./)).toBeTruthy()
    expect(fake.calls.some(c => c.path.startsWith('/auth/v1/logout'))).toBe(true); expect(Object.keys(localStorage).filter(k => k.startsWith('believe:'))).toEqual([]); expect(await snaps()).toHaveLength(1)
  })
})
