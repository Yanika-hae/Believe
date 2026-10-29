// Onglet « Amis » (rubrique 5) : parcours d'interface complets face à l'imitation du service en ligne (FakeCloud : Google simulé + vrai PostgreSQL qui a reçu supabase/schema.sql).
// Chaque personne est un « appareil » : un stockage vide, ses propres copies des modules (voir `mount`). Ce que le service garde est relu dans la base, pas déduit de l'écran.
import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { FakeCloud } from './fakecloud'
import type { State } from './lib'
import { SHARE_ITEMS } from './share'
import { btn, go, mount, reopen, stored, tick, withCrypto } from './testkit'

configure({ asyncUtilTimeout: 4000 }) // la base de test et le chiffrement réels sont plus lents que de simples simulations
let fake: FakeCloud
beforeAll(async () => { fake = await FakeCloud.create() }, 120_000)
afterAll(async () => { await fake.db.close() })
/** Arrête les déclencheurs automatiques de l'appareil précédent (minuteurs, écouteurs) : un test n'agit pas dans le suivant. */
const quiet = async () => { try { const h = await import('./cloudhook'); h.stopCircles(); h.stopSyncAuto() } catch { /* rien de chargé */ } }
beforeEach(async () => { await fake.reset(); sessionStorage.clear(); history.replaceState(null, '', '/'); vi.stubGlobal('fetch', fake.fetch); withCrypto() })
afterEach(async () => {
  await quiet(); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  for (const k of ['clipboard', 'share']) delete (navigator as unknown as Record<string, unknown>)[k]
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); history.replaceState(null, '', '/')
})

const ADA = 'ada@example.org', BEA = 'bea@example.org', CLEO = 'cleo@example.org'
const KEYCODE = '1A2B3C-4D5E6F-1A2B3C-4D5E6F', CODE = /^[0-9A-F]{6}(-[0-9A-F]{6}){3}$/
const me = (name: string) => (s: State) => { s.profile = { g: 'F', name, age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' }; s.consents.cloud = true }
/** Accord « Partage » donné, deux éléments cochés ; des données privées qui ne doivent jamais partir (note, nom d'habitude). */
const SHARE = (s: State) => {
  s.consents.share = true; s.share.vis = { name: true, habits: true }
  s.notes.push({ id: 'n1', cat: 'Rêves', t: 'TITRE-SECRET-N1', b: 'TEXTE-SECRET-N1', c: '2026-03-01T08:00:00.000Z', u: '2026-03-01T08:00:00.000Z' }); s.habits[0].n = 'HABITUDE-SECRETE'
}
const body = () => document.body.textContent ?? ''
const calls = (fn: string) => fake.calls.filter(c => c.fn === fn)
const rows = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await fake.db.query<T>(q, p)).rows
const region = (name: string | RegExp) => within(screen.getByRole('region', { name }))
const cardOf = (h: string | RegExp) => within(screen.getByRole('heading', { name: h }).closest('.card') as HTMLElement)
const openDetails = (summary: string | RegExp) => { (screen.getByText(summary).closest('details') as HTMLDetailsElement).open = true }
const dialog = (name: string) => screen.findByRole('dialog', { name }).then(d => within(d))

/** Connecte cet « appareil » à Google (avant le montage de l'application). */
async function signIn(email: string) {
  const c = await import('./cloud'); let url = ''; c.nav.assign = u => { url = u }
  expect(await c.startGoogle()).toEqual({ ok: true })
  const back = new URL(await fake.google(url, email)); history.replaceState(null, '', back.pathname + back.search + back.hash)
  expect((await c.completeFromUrl()).kind).toBe('ok')
}
/** Ouvre l'onglet Amis (ou une autre adresse) d'une personne déjà connectée à Google ; `pre` s'exécute après la connexion et avant l'ouverture. */
async function as(name: string, email: string, o: { seed?: (s: State) => void; hash?: string; pre?: () => Promise<void> } = {}) {
  await quiet(); cleanup()
  const hash = o.hash ?? '#/5/amis'
  await mount(hash, s => { me(name)(s); o.seed?.(s) }, async () => { await signIn(email); await o.pre?.(); location.hash = hash })
}
/** Crée un cercle en passant par l'écran ; le cercle s'ouvre. */
async function createCircle(name: string, display?: string) {
  const c = cardOf('Créer un cercle')
  fireEvent.change(c.getByLabelText('Nom du cercle'), { target: { value: name } })
  if (display !== undefined) fireEvent.change(c.getByLabelText('Mon nom dans ce cercle'), { target: { value: display } })
  fireEvent.click(c.getByRole('button', { name: 'Créer le cercle' }))
  await screen.findByText(new RegExp('Cercle « ' + name + ' » créé\\.'))
}
/** Crée une invitation (cercle ouvert, créateur) et renvoie son code. */
async function invite(): Promise<string> {
  fireEvent.click(btn('Créer une invitation')); const el = await screen.findByTestId('invite-code'); expect(el.textContent).toMatch(CODE); return el.textContent!
}
const circleId = async (name: string) => (await rows<{ id: string }>('select id from bl.circles where name = $1', [name]))[0].id
/** Un compte créé à la volée devient membre du cercle (avec une carte déposée, si donnée). */
async function addMember(circle: string, email: string, display: string, card?: unknown) {
  const uid = await fake.user(email)
  return (await rows<{ id: string }>('insert into bl.members (circle, uid, display, sharing, card, card_at) values ($1, $2, $3, $4, $5::jsonb, $6) returning id',
    [circle, uid, display, card !== undefined, card === undefined ? null : JSON.stringify(card), card === undefined ? null : new Date().toISOString()]))[0].id
}
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

describe('Amis : accord, service, connexion, invitation reçue par lien', () => {
  it('sans l’accord « Compte en ligne » : carte d’explication et aucune requête ; l’accord donné (et confirmé) ouvre la page', async () => {
    await mount('#/5/amis', s => { s.profile = { g: 'F', name: 'Ada', age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' } })
    expect(screen.getByRole('heading', { name: 'Cercles d’amis (compte en ligne facultatif)' })).toBeTruthy(); expect(body()).toMatch(/Believe fonctionne entièrement sans/); expect(body()).toMatch(/entrer dans un cercle ne partage rien/)
    await tick(30); expect(fake.calls).toHaveLength(0)
    fireEvent.click(btn('J’accepte le compte en ligne')); expect(stored().consents.cloud).toBe(true)
    expect(await screen.findByText('Connectez-vous avec Google pour créer ou rejoindre un cercle.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Aller à l’onglet Compte pour me connecter' }).getAttribute('href')).toBe('#/2/compte')
    expect(fake.calls.every(c => c.path === '/api/cloud-config' || c.fn === 'bl_ping')).toBe(true) // seulement la vérification du service : ni connexion ni donnée
  })

  it('service indisponible, hors ligne, base du service pas prête : un message simple pour chaque cas et aucun écran de cercle n’apparaît', async () => {
    fake.config = { ok: false, missing: ['SUPABASE_URL'], invalid: [] }
    await mount('#/5/amis', me('Ada'))
    expect(await screen.findByText('Les cercles d’amis ne sont pas disponibles pour le moment.')).toBeTruthy(); expect(body()).toMatch(/Ils demandent le compte en ligne \(onglet Compte\)/); expect(body()).not.toMatch(/SUPABASE|README|mode d’emploi|non configuré/)
    expect(screen.queryByRole('button', { name: 'Créer le cercle' })).toBeNull(); expect(screen.queryByText(/Connectez-vous avec Google/)).toBeNull()
    cleanup(); fake.config = FakeCloud.defaultConfig(); fake.offline = true
    await mount('#/5/amis', me('Ada'))
    expect(await screen.findByText(/Hors ligne : impossible de joindre le serveur de Believe/)).toBeTruthy(); expect(screen.queryByText(/ne sont pas disponibles pour le moment/)).toBeNull(); expect(screen.queryByRole('button', { name: 'Créer le cercle' })).toBeNull()
    cleanup(); fake.offline = false
    await as('Ada', ADA, { pre: async () => { fake.failNext = { match: 'bl_circles', status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.bl_circles' } } } })
    expect(await screen.findByText('Les cercles d’amis sont momentanément indisponibles : réessayez plus tard.')).toBeTruthy(); expect(body()).not.toMatch(/SQL|Supabase|README/)
    expect(screen.queryByRole('button', { name: 'Créer le cercle' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Vérifier l’invitation' })).toBeNull()
  })

  it('session expirée : « Connexion expirée », aucune liste de cercles', async () => {
    await as('Ada', ADA, { pre: async () => { fake.expireAccess(); fake.revokeAll() } })
    expect(await screen.findByText(/Connexion expirée ou refusée : reconnectez-vous avec Google \(onglet Compte\)\./)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Créer le cercle' })).toBeNull()
  })

  it('invitation reçue par lien sans être connecté : adresse nettoyée, code gardé dans l’onglet seulement (jamais sur disque ni envoyé), minuscules acceptées', async () => {
    await mount('#/5/amis/' + KEYCODE.toLowerCase(), me('Bea'))
    expect(await screen.findByText('Une invitation vous attend.')).toBeTruthy(); expect(body()).toMatch(/Une invitation vous attend\. Connectez-vous pour la voir/)
    expect(location.hash).toBe('#/5/amis'); expect(JSON.parse(sessionStorage.getItem('believe:invite')!).c).toBe(KEYCODE)
    for (const k of Object.keys(localStorage)) expect(localStorage.getItem(k)!.includes('1A2B3C'), k).toBe(false)
    expect(JSON.stringify(fake.calls)).not.toContain('1A2B3C'); expect(JSON.stringify(fake.calls).toLowerCase()).not.toContain('1a2b3c')
    expect(screen.getByRole('link', { name: 'Aller à l’onglet Compte pour me connecter' })).toBeTruthy()
  })

  it('lien d’invitation abîmé : message clair, rien de gardé', async () => {
    await mount('#/5/amis/abc-123', me('Bea'))
    expect(await screen.findByText('Le lien d’invitation est incomplet ou abîmé : demandez-en un nouveau.')).toBeTruthy(); expect(sessionStorage.getItem('believe:invite')).toBeNull(); expect(location.hash).toBe('#/5/amis')
  })

  it('l’invitation survit à la connexion Google : retour sur Amis, code prérempli, rien de vérifié ni rejoint sans action de la personne', async () => {
    await mount('#/5/amis/' + KEYCODE, me('Bea'))
    await screen.findByText('Une invitation vous attend.')
    const c = await import('./cloud'); let url = ''; c.nav.assign = u => { url = u }
    expect(await c.startGoogle()).toEqual({ ok: true })
    const back = new URL(await fake.google(url, BEA)); history.replaceState(null, '', back.pathname + back.search); cleanup()
    await reopen('') // la page se recharge au retour de Google
    expect(await screen.findByText(/Connecté avec Google : bea@example\.org\. Une invitation à un cercle d’amis vous attend ci-dessous : vérifiez-la avant de décider\. Aucune donnée n’est envoyée/)).toBeTruthy()
    expect(location.hash).toBe('#/5/amis'); expect((await screen.findByLabelText('Code d’invitation') as HTMLInputElement).value).toBe(KEYCODE)
    expect(screen.getByText(/Une invitation vous attend\./)).toBeTruthy(); await tick(50); expect(calls('bl_invite_peek')).toHaveLength(0); expect(calls('bl_invite_accept')).toHaveLength(0)
  })
})

describe('Amis : créer un cercle, inviter, rejoindre', () => {
  it('premier cercle : rien n’est dit avant la réponse du service ; créer ne partage rien ; le service ne reçoit que le nom du cercle et celui de la personne', async () => {
    await as('Ada', ADA, { seed: SHARE })
    expect(await screen.findByText(/Vous n’êtes dans aucun cercle/)).toBeTruthy()
    const c = cardOf('Créer un cercle'); expect((c.getByLabelText('Mon nom dans ce cercle') as HTMLInputElement).value).toBe('Ada'); expect(c.getByRole('button', { name: 'Créer le cercle' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(c.getByLabelText('Nom du cercle'), { target: { value: '  Ma   famille ' } }); fake.failNext = { match: 'bl_circle_create', status: 500 }
    fireEvent.click(c.getByRole('button', { name: 'Créer le cercle' }))
    expect(await screen.findByText(/Le service ne répond pas correctement\./)).toBeTruthy(); expect(body()).not.toMatch(/créé/); expect(await rows('select 1 from bl.circles')).toHaveLength(0)
    fireEvent.click(c.getByRole('button', { name: 'Créer le cercle' }))
    expect(await screen.findByText(/Cercle « Ma famille » créé\. Aucun partage n’est activé/)).toBeTruthy()
    expect(calls('bl_circle_create').at(-1)!.body).toEqual({ p_name: 'Ma famille', p_display: 'Ada' })
    expect(await rows('select sharing, card is null as nocard from bl.members')).toEqual([{ sharing: false, nocard: true }])
    const sec = region('Cercle Ma famille'); expect(sec.getByText('Vous ne partagez rien dans ce cercle.')).toBeTruthy(); expect(sec.getByRole('button', { name: 'Fermer le cercle' }).getAttribute('aria-expanded')).toBe('true')
    expect(await sec.findByText(/\(vous\) · créateur/)).toBeTruthy(); expect(JSON.stringify(fake.calls)).not.toContain('SECRET')
  })

  it('noms refusés sur l’appareil : message, aucune requête de création', async () => {
    await as('Ada', ADA); await screen.findByText(/Vous n’êtes dans aucun cercle/)
    const c = cardOf('Créer un cercle'), n = calls('bl_circle_create').length
    fireEvent.change(c.getByLabelText('Nom du cercle'), { target: { value: 'Famille\u202e' } }); fireEvent.click(c.getByRole('button', { name: 'Créer le cercle' }))
    expect(await screen.findByText(/Nom du cercle invalide : 1 à 40 caractères/)).toBeTruthy(); expect(calls('bl_circle_create').length).toBe(n)
    fireEvent.change(c.getByLabelText('Nom du cercle'), { target: { value: 'Famille' } }); fireEvent.change(c.getByLabelText('Mon nom dans ce cercle'), { target: { value: 'A\u200bda' } }); fireEvent.click(c.getByRole('button', { name: 'Créer le cercle' }))
    expect(await screen.findByText(/Nom invalide : 1 à 30 caractères/)).toBeTruthy(); expect(calls('bl_circle_create').length).toBe(n)
  })

  it('invitation : code montré une fois (le service n’en garde que l’empreinte), lien, copie, partage, révocation', async () => {
    await as('Ada', ADA); await screen.findByText(/Vous n’êtes dans aucun cercle/); await createCircle('Famille')
    expect(await screen.findByText('Aucune invitation en attente.')).toBeTruthy()
    const code = await invite()
    expect(await screen.findByText(/Invitation créée : le code est valable 7 jours et ne sert qu’une fois\./)).toBeTruthy(); expect(body()).toContain('/#/5/amis/' + code)
    const h = (await rows<{ hash: string }>('select hash from bl.invites'))[0].hash; expect(h).not.toContain(code.replace(/-/g, '')); expect(JSON.stringify(fake.calls.filter(c => c.fn !== 'bl_invite_create' && c.fn !== 'bl_invite_peek'))).not.toContain(code)
    expect(await screen.findByText(/Invitations en attente \(1\)/)).toBeTruthy()
    // copie
    const write = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } })
    fireEvent.click(btn('Copier le lien')); expect(await screen.findByText('Lien d’invitation copié dans le presse-papiers.')).toBeTruthy(); expect(write).toHaveBeenCalledWith(location.origin + '/#/5/amis/' + code)
    write.mockRejectedValueOnce(new Error('refusé')); fireEvent.click(btn('Copier le lien')); expect(await screen.findByText('Copie refusée par le navigateur : recopiez le code à la main.')).toBeTruthy()
    // partage : absent, puis annulé, puis fait
    fireEvent.click(btn('Envoyer l’invitation…')); expect(await screen.findByText('Ce navigateur n’a pas de menu de partage : copiez le lien.')).toBeTruthy()
    const share = vi.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AbortError' })).mockResolvedValue(undefined); Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    fireEvent.click(btn('Envoyer l’invitation…')); expect(await screen.findByText('Partage annulé.')).toBeTruthy()
    fireEvent.click(btn('Envoyer l’invitation…')); expect(await screen.findByText(/Le menu de partage s’est fermé : l’invitation a été remise à l’application que vous avez choisie\./)).toBeTruthy()
    expect(share.mock.calls[1][0].text).toContain(location.origin + '/#/5/amis/' + code)
    // révocation : confirmée par le service avant d'être annoncée
    fake.failNext = { match: 'bl_invite_revoke', status: 500 }; fireEvent.click(screen.getByRole('button', { name: /^Révoquer l’invitation du / }))
    expect(await screen.findByText(/Le service ne répond pas correctement\./)).toBeTruthy(); expect(await rows('select 1 from bl.invites')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^Révoquer l’invitation du / })); expect(await screen.findByText('Invitation révoquée : son code ne fonctionne plus.')).toBeTruthy()
    expect(await rows('select 1 from bl.invites')).toHaveLength(0); await waitFor(() => expect(screen.queryByTestId('invite-code')).toBeNull())
  })

  it('une deuxième personne rejoint par le lien : vérification, nom choisi, rien n’est partagé, le code ne sert plus', async () => {
    await as('Ada', ADA); await screen.findByText(/Vous n’êtes dans aucun cercle/); await createCircle('Famille'); const code = await invite()
    await as('Bea', BEA, { hash: '#/5/amis/' + code })
    expect(await screen.findByText('Une invitation vous attend.')).toBeTruthy(); expect(body()).toMatch(/Une invitation vous attend\. Vérifiez-la avant de décider/); expect(location.hash).toBe('#/5/amis')
    expect((screen.getByLabelText('Code d’invitation') as HTMLInputElement).value).toBe(code); expect(calls('bl_invite_peek')).toHaveLength(0)
    fireEvent.click(btn('Vérifier l’invitation'))
    const g = within(await screen.findByRole('group', { name: 'Invitation vérifiée' })); expect(g.getByText('« Famille »')).toBeTruthy(); expect(g.getByText('Ada')).toBeTruthy(); expect(g.getByText(/1 membre pour l’instant/)).toBeTruthy()
    expect((g.getByLabelText('Mon nom dans ce cercle') as HTMLInputElement).value).toBe('Bea'); expect(calls('bl_invite_accept')).toHaveLength(0)
    fireEvent.change(g.getByLabelText('Mon nom dans ce cercle'), { target: { value: 'Béa' } }); fake.failNext = { match: 'bl_invite_accept', status: 500 }; fireEvent.click(g.getByRole('button', { name: 'Rejoindre ce cercle' }))
    expect(await screen.findByText(/Le service ne répond pas correctement\./)).toBeTruthy(); expect(body()).not.toMatch(/Vous avez rejoint/); expect(await rows('select 1 from bl.members')).toHaveLength(1)
    fireEvent.click(g.getByRole('button', { name: 'Rejoindre ce cercle' }))
    expect(await screen.findByText(/Vous avez rejoint « Famille »\. Aucun partage n’est activé/)).toBeTruthy()
    expect(await rows('select display, sharing, card is null as nocard from bl.members order by at')).toEqual([{ display: 'Ada', sharing: false, nocard: true }, { display: 'Béa', sharing: false, nocard: true }])
    expect(sessionStorage.getItem('believe:invite')).toBeNull(); expect(region('Cercle Famille').getByText('Vous ne partagez rien dans ce cercle.')).toBeTruthy()
    expect(await region('Cercle Famille').findByText(/\(vous\)/)).toBeTruthy(); expect((await screen.findAllByText('Béa')).length).toBeGreaterThan(0); expect(screen.queryByRole('button', { name: 'Retirer Ada du cercle' })).toBeNull() // seul le créateur retire
    expect(screen.queryByRole('button', { name: 'Créer une invitation' })).toBeNull() // et seul le créateur invite
    // le code est à usage unique
    await as('Cléo', CLEO, { hash: '#/5/amis/' + code }); fireEvent.click(await screen.findByRole('button', { name: 'Vérifier l’invitation' }))
    expect(await screen.findByText(/Invitation inconnue, expirée ou déjà utilisée\./)).toBeTruthy(); expect(screen.queryByRole('group', { name: 'Invitation vérifiée' })).toBeNull()
  })

  it('code mal formé ou inconnu, déjà membre, cercle complet, refus : chaque cas est dit, rien n’est rejoint', async () => {
    await as('Ada', ADA); await screen.findByText(/Vous n’êtes dans aucun cercle/); await createCircle('Famille'); const code = await invite(); const id = await circleId('Famille')
    // la créatrice vérifie sa propre invitation : « déjà membre », pas de bouton pour rejoindre
    const j = cardOf('Rejoindre un cercle'); fireEvent.change(j.getByLabelText('Code d’invitation'), { target: { value: code } }); fireEvent.click(j.getByRole('button', { name: 'Vérifier l’invitation' }))
    expect(await screen.findByText(/Vous faites déjà partie de ce cercle\./)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Rejoindre ce cercle' })).toBeNull()
    // code mal formé : refusé sur l'appareil, sans requête
    const n = calls('bl_invite_peek').length; fireEvent.change(j.getByLabelText('Code d’invitation'), { target: { value: 'pas un code du tout' } }); fireEvent.click(j.getByRole('button', { name: 'Vérifier l’invitation' }))
    expect(await screen.findByText(/Ce code n’a pas la bonne forme : 24 caractères/)).toBeTruthy(); expect(calls('bl_invite_peek').length).toBe(n)
    // cercle complet
    for (let i = 0; i < 11; i++) await addMember(id, 'm' + i + '@example.org', 'M' + i)
    await as('Bea', BEA, { hash: '#/5/amis/' + code }); fireEvent.click(await screen.findByRole('button', { name: 'Vérifier l’invitation' }))
    expect(await screen.findByText(/Ce cercle est complet \(12 personnes\)/)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Rejoindre ce cercle' })).toBeNull()
    // place libérée : refus de l'invitation
    await rows("delete from bl.members where display = 'M0'"); fireEvent.click(btn('Vérifier l’invitation'))
    const g = within(await screen.findByRole('group', { name: 'Invitation vérifiée' })); fireEvent.click(g.getByRole('button', { name: 'Refuser' }))
    expect(await screen.findByText('Invitation écartée : rien n’a été rejoint.')).toBeTruthy(); expect(sessionStorage.getItem('believe:invite')).toBeNull(); expect(await rows('select 1 from bl.members')).toHaveLength(11)
    expect((screen.getByLabelText('Code d’invitation') as HTMLInputElement).value).toBe('')
  })
})

describe('Amis : partager sa carte', () => {
  it('sans l’accord « Partage » : bouton d’accord ; accordé mais rien de coché : renvoi vers l’onglet Partage ; aucune requête de partage', async () => {
    await as('Ada', ADA); await screen.findByText(/Vous n’êtes dans aucun cercle/); await createCircle('Famille'); const sec = region('Cercle Famille')
    expect(await sec.findByText(/Pour partager, l’accord « Partage avec des amis » est nécessaire/)).toBeTruthy(); expect(sec.queryByRole('button', { name: 'Partager ma carte dans ce cercle…' })).toBeNull()
    fireEvent.click(sec.getByRole('button', { name: 'Donner l’accord « Partage avec des amis »' })); expect(stored().consents.share).toBe(true)
    expect(await screen.findByText('Accord enregistré : Partage avec des amis.')).toBeTruthy()
    expect(sec.getByText(/Aucun élément n’est coché pour vos amis\./)).toBeTruthy(); expect(sec.getByRole('link', { name: 'Choisir ce que mes amis voient' }).getAttribute('href')).toBe('#/5/partage')
    expect(calls('bl_circle_sharing')).toHaveLength(0); expect(calls('bl_circle_card')).toHaveLength(0)
  })

  it('aperçu exact avant de partager ; annuler n’envoie rien ; confirmer dépose exactement la carte montrée, sans donnée privée', async () => {
    await as('Ada', ADA, { seed: SHARE }); await screen.findByText(/Vous n’êtes dans aucun cercle/); await createCircle('Famille'); const sec = region('Cercle Famille')
    fireEvent.click(await sec.findByRole('button', { name: 'Partager ma carte dans ce cercle…' }))
    let d = await dialog('Partager ma carte dans « Famille » ?')
    expect(d.getByRole('group', { name: 'Carte de Ada (vous)' })).toBeTruthy(); expect(d.getByText(/Prénom : Ada/)).toBeTruthy(); expect(d.getByText(/Réussite : \d+ %/)).toBeTruthy(); expect(d.getByText(/Les membres de ce cercle verront/)).toBeTruthy()
    expect(d.getByText(new RegExp('Masqué pour vos amis \\(' + (SHARE_ITEMS.length - 2) + '\\)'))).toBeTruthy(); expect(d.queryByText(/SECRET/)).toBeNull()
    fireEvent.click(d.getByRole('button', { name: 'Annuler' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(calls('bl_circle_sharing')).toHaveLength(0); expect(calls('bl_circle_card')).toHaveLength(0)
    fireEvent.click(sec.getByRole('button', { name: 'Partager ma carte dans ce cercle…' })); d = await dialog('Partager ma carte dans « Famille » ?')
    fake.failNext = { match: 'bl_circle_card', status: 500 }; fireEvent.click(d.getByRole('button', { name: 'Partager cette carte' }))
    expect(await screen.findByText(/Le service ne répond pas correctement\..* Le partage n’a pas été activé\./)).toBeTruthy(); expect(body()).not.toMatch(/Partage activé/)
    expect(await rows('select sharing, card is null as nocard from bl.members')).toEqual([{ sharing: false, nocard: true }]) // jamais « actif » sans carte déposée
    fireEvent.click(await sec.findByRole('button', { name: 'Partager ma carte dans ce cercle…' })); d = await dialog('Partager ma carte dans « Famille » ?'); fireEvent.click(d.getByRole('button', { name: 'Partager cette carte' }))
    expect(await screen.findByText(/Partage activé dans « Famille » : votre carte a été déposée, les membres qui viendront pourront la voir\./)).toBeTruthy()
    const stored1 = await rows<{ sharing: boolean; card: Record<string, unknown> }>('select sharing, card from bl.members'); expect(stored1).toHaveLength(1); expect(stored1[0].sharing).toBe(true)
    expect(Object.keys(stored1[0].card).sort()).toEqual(['d', 'habits', 'v', 'who']); expect(stored1[0].card.who).toBe('Ada'); expect(stored1[0].card.d).toBe(today())
    expect(calls('bl_circle_card').at(-1)!.body).toEqual({ p_circle: await circleId('Famille'), p_card: stored1[0].card })
    expect(JSON.stringify(fake.calls)).not.toMatch(/SECRET/); expect(sec.getByText('Partagée.')).toBeTruthy(); expect(sec.getByText(/Voir la carte de Ada \(telle que le service l’affiche\)/)).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('believe:circles')!)).toEqual({ on: true, retract: false })
  })

  it('« Arrêter de partager » : annoncé seulement après confirmation du service, la carte est effacée du service', async () => {
    await as('Ada', ADA, { seed: SHARE }); await screen.findByText(/Vous n’êtes dans aucun cercle/); await createCircle('Famille'); const sec = region('Cercle Famille')
    fireEvent.click(await sec.findByRole('button', { name: 'Partager ma carte dans ce cercle…' })); fireEvent.click((await dialog('Partager ma carte dans « Famille » ?')).getByRole('button', { name: 'Partager cette carte' }))
    await screen.findByText(/Partage activé dans « Famille »/)
    fake.failNext = { match: 'bl_circle_sharing', status: 500 }; fireEvent.click(await sec.findByRole('button', { name: 'Arrêter de partager dans ce cercle' }))
    expect(await screen.findByText(/Le service ne répond pas correctement\..* Le partage n’est pas arrêté : réessayez\./)).toBeTruthy(); expect(body()).not.toMatch(/Partage arrêté/); expect((await rows<{ sharing: boolean }>('select sharing from bl.members'))[0].sharing).toBe(true)
    fireEvent.click(sec.getByRole('button', { name: 'Arrêter de partager dans ce cercle' }))
    expect(await screen.findByText(/Partage arrêté dans « Famille » : votre carte a été effacée du service\./)).toBeTruthy()
    expect(await rows('select sharing, card is null as nocard, card_at is null as noat from bl.members')).toEqual([{ sharing: false, nocard: true, noat: true }])
    expect(await sec.findByRole('button', { name: 'Partager ma carte dans ce cercle…' })).toBeTruthy(); expect(localStorage.getItem('believe:circles')).toBeNull()
  })

  it('accord « Partage » retiré pendant que je partage : la page le dit, plus de mise à jour ; « Arrêter » efface la carte', async () => {
    await as('Ada', ADA, { seed: SHARE, pre: async () => { const C = await import('./circles'); const c = await C.create('Famille', 'Ada'); await C.startSharing(c.id) } })
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir le cercle' })); const sec = region('Cercle Famille')
    expect(await sec.findByText('Partagée.')).toBeTruthy(); expect(sec.queryByText(/L’accord « Partage avec des amis » est retiré/)).toBeNull()
    await go('#/2/confidentialite'); fireEvent.click(btn('Retirer Partage avec des amis')); expect(stored().consents.share).toBe(false)
    expect(await screen.findByText('Accord retiré : Partage avec des amis. Vos cartes ont été effacées de vos cercles.')).toBeTruthy()
    expect(await rows('select sharing, card is null as nocard from bl.members')).toEqual([{ sharing: false, nocard: true }]); expect(localStorage.getItem('believe:circles')).toBeNull()
  })
})

describe('Amis : les autres membres', () => {
  const card = { v: 1, d: today(), who: 'Bea', habits: { rate: 50, best: 3 }, weight: { from: 70, now: 65, goal: 60 } }
  it('carte d’un membre : lignes vérifiées, sensibles marquées ; nom contenant du code affiché comme texte ; « Actualiser » voit les nouveaux membres', async () => {
    await as('Ada', ADA); await screen.findByText(/Vous n’êtes dans aucun cercle/); await createCircle('Famille'); const id = await circleId('Famille')
    await addMember(id, BEA, '<img src=x onerror=alert(1)>', card)
    fireEvent.click(await screen.findByRole('button', { name: 'Actualiser' })); const sec = region('Cercle Famille')
    expect((await sec.findAllByText('<img src=x onerror=alert(1)>')).length).toBeGreaterThan(0); expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(sec.getByText(/partage sa carte/)).toBeTruthy(); const det = sec.getByText(/Voir la carte de <img src=x onerror=alert\(1\)>/).closest('details') as HTMLDetailsElement; det.open = true
    const g = within(sec.getByRole('group', { name: /Carte de <img/ })); expect(g.getByText('Réussite : 50 %')).toBeTruthy(); expect(g.getByText('Plus longue série en cours : 3 jours')).toBeTruthy()
    const weight = g.getByText(/Départ 70 kg · actuel 65 kg · objectif 60 kg/); expect(weight.className).toBe('sens'); expect(g.getByText('Réussite : 50 %').className).toBe('')
    await addMember(id, CLEO, 'Cléo'); fireEvent.click(sec.getByRole('button', { name: 'Actualiser' })); expect(await sec.findByText('Membres (3)')).toBeTruthy(); expect(await sec.findByText('Cléo')).toBeTruthy(); expect(sec.getByText(/3 membres · votre nom ici/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser mes cercles' })); expect(await sec.findByText('Cléo')).toBeTruthy()
    expect(sec.getByText('Cléo').closest('li')!.textContent).toMatch(/ne partage rien/)
  })

  it('carte refusée par la vérification : jamais montrée, le motif est dit ; le service qui renvoie du texte inattendu n’est pas cru', async () => {
    await as('Ada', ADA); await screen.findByText(/Vous n’êtes dans aucun cercle/); await createCircle('Famille'); const id = await circleId('Famille')
    await addMember(id, BEA, 'Bea', { v: 1, d: today(), evil: '<script>alert(1)</script>', notes: [{ cat: 'TITRE-SECRET', n: 1 }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Actualiser' })); const sec = region('Cercle Famille')
    expect(await sec.findByText(/carte refusée/)).toBeTruthy(); expect(sec.getByText(/Le service a renvoyé une carte que Believe refuse d’afficher/)).toBeTruthy(); expect(sec.queryByText(/Voir la carte de Bea/)).toBeNull()
    expect(body()).not.toMatch(/SECRET|<script>/)
    fake.failNext = { match: 'bl_circle_members', status: 200, body: [{ id: 'oups' }] }; fireEvent.click(sec.getByRole('button', { name: 'Actualiser' }))
    expect(await screen.findByText(/Le service ne répond pas correctement\./)).toBeTruthy()
  })
})

describe('Amis : réglages, retrait, départ, suppression', () => {
  /** Ada (créatrice) et Bea (membre, avec carte) dans « Famille », cercle d'Ada ouvert. */
  async function famille() {
    await as('Ada', ADA, { seed: SHARE }); await screen.findByText(/Vous n’êtes dans aucun cercle/); await createCircle('Famille'); const id = await circleId('Famille')
    await addMember(id, BEA, 'Bea', { v: 1, d: today(), habits: { rate: 40, best: 1 } }); fireEvent.click(await screen.findByRole('button', { name: 'Actualiser' })); await screen.findAllByText('Bea'); return id
  }
  it('retirer un membre : confirmation précise ; annuler ne change rien ; annoncé après confirmation du service ; sa carte est effacée', async () => {
    await famille(); const sec = region('Cercle Famille')
    fireEvent.click(sec.getByRole('button', { name: 'Retirer Bea du cercle' })); let d = await dialog('Retirer Bea ?'); expect(d.getByText(/sa carte y est effacée/)).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: 'Annuler' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(calls('bl_circle_kick')).toHaveLength(0)
    fireEvent.click(sec.getByRole('button', { name: 'Retirer Bea du cercle' })); d = await dialog('Retirer Bea ?'); fake.failNext = { match: 'bl_circle_kick', status: 500 }; fireEvent.click(d.getByRole('button', { name: 'Retirer du cercle' }))
    expect(await screen.findByText(/Le service ne répond pas correctement\./)).toBeTruthy(); expect(body()).not.toMatch(/a été retiré du cercle/); expect(await rows('select 1 from bl.members')).toHaveLength(2)
    fireEvent.click(sec.getByRole('button', { name: 'Retirer Bea du cercle' })); fireEvent.click((await dialog('Retirer Bea ?')).getByRole('button', { name: 'Retirer du cercle' }))
    expect(await screen.findByText('« Bea » a été retiré du cercle : sa carte y est effacée.')).toBeTruthy(); expect(await rows('select display from bl.members')).toEqual([{ display: 'Ada' }]); await waitFor(() => expect(sec.queryByText('Bea')).toBeNull())
  })

  it('renommer le cercle, changer son nom : refus des noms invalides, annonce après le service', async () => {
    await famille(); const sec = region('Cercle Famille'); openDetails('Réglages du cercle')
    fireEvent.change(sec.getByLabelText('Nom du cercle'), { target: { value: 'Les   Dupont ' } }); fireEvent.click(sec.getByRole('button', { name: 'Renommer le cercle' }))
    expect(await screen.findByText('Le cercle s’appelle maintenant « Les Dupont ».')).toBeTruthy(); expect((await rows<{ name: string }>('select name from bl.circles'))[0].name).toBe('Les Dupont'); expect(await screen.findByRole('region', { name: 'Cercle Les Dupont' })).toBeTruthy()
    const s2 = region('Cercle Les Dupont'); fireEvent.change(s2.getByLabelText('Mon nom dans ce cercle (visible de tous les membres)'), { target: { value: 'Ada\u202e' } }); fireEvent.click(s2.getByRole('button', { name: 'Changer mon nom' }))
    expect(await screen.findByText(/Nom invalide : 1 à 30 caractères/)).toBeTruthy(); expect((await rows<{ display: string }>("select display from bl.members where display like 'A%'"))[0].display).toBe('Ada')
    fireEvent.change(s2.getByLabelText('Mon nom dans ce cercle (visible de tous les membres)'), { target: { value: 'Ada L.' } }); fireEvent.click(s2.getByRole('button', { name: 'Changer mon nom' }))
    expect(await screen.findByText('Votre nom dans « Les Dupont » a été changé.')).toBeTruthy(); expect((await rows<{ display: string }>("select display from bl.members where display like 'Ada%'"))[0].display).toBe('Ada L.')
  })

  it('supprimer le cercle : texte d’avertissement, annulation sans effet, suppression annoncée après le service ; cartes et invitations effacées', async () => {
    await famille(); const sec = region('Cercle Famille'); await invite(); openDetails('Réglages du cercle')
    fireEvent.click(sec.getByRole('button', { name: 'Supprimer le cercle…' })); let d = await dialog('Supprimer « Famille » ?'); expect(d.getByText(/Le cercle disparaît/)).toBeTruthy(); expect(d.getByText('pour tous ses membres')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: 'Annuler' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(calls('bl_circle_delete')).toHaveLength(0)
    fireEvent.click(sec.getByRole('button', { name: 'Supprimer le cercle…' })); d = await dialog('Supprimer « Famille » ?'); fake.failNext = { match: 'bl_circle_delete', status: 500 }; fireEvent.click(d.getByRole('button', { name: 'Supprimer pour tous' }))
    expect(await screen.findByText(/Le service ne répond pas correctement\./)).toBeTruthy(); expect(body()).not.toMatch(/supprimé pour tous/); expect(await rows('select 1 from bl.circles')).toHaveLength(1)
    fireEvent.click(sec.getByRole('button', { name: 'Supprimer le cercle…' })); fireEvent.click((await dialog('Supprimer « Famille » ?')).getByRole('button', { name: 'Supprimer pour tous' }))
    expect(await screen.findByText('Cercle « Famille » supprimé pour tous ses membres, cartes comprises.')).toBeTruthy()
    for (const t of ['circles', 'members', 'invites']) expect(await rows('select 1 from bl.' + t), t).toHaveLength(0)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Cercle Famille' })).toBeNull())
  })

  it('quitter un cercle (membre) : confirmation, carte effacée, le cercle disparaît de ma liste ; le créateur ne le peut pas', async () => {
    await famille(); await as('Bea', BEA, { seed: s => { SHARE(s); s.profile!.name = 'Bea' } }); fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir le cercle' })); const sec = region('Cercle Famille')
    expect(await sec.findByText('Ada')).toBeTruthy(); expect(sec.queryByRole('button', { name: 'Supprimer le cercle…' })).toBeNull(); openDetails('Réglages du cercle')
    fireEvent.click(sec.getByRole('button', { name: 'Quitter le cercle…' })); let d = await dialog('Quitter « Famille » ?'); fireEvent.click(d.getByRole('button', { name: 'Annuler' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(calls('bl_circle_leave')).toHaveLength(0)
    fireEvent.click(sec.getByRole('button', { name: 'Quitter le cercle…' })); d = await dialog('Quitter « Famille » ?'); fireEvent.click(d.getByRole('button', { name: 'Quitter le cercle' }))
    expect(await screen.findByText('Vous avez quitté « Famille » : votre carte y est effacée.')).toBeTruthy(); expect(await rows('select display from bl.members')).toEqual([{ display: 'Ada' }])
    expect(await screen.findByText(/Vous n’êtes dans aucun cercle/)).toBeTruthy(); expect(screen.queryByRole('region', { name: 'Cercle Famille' })).toBeNull()
  })
})

describe('Amis : retrait des cartes en attente, accords retirés ailleurs', () => {
  const shared = async () => { const C = await import('./circles'); const c = await C.create('Famille', 'Ada'); await C.startSharing(c.id) }
  it('retrait demandé mais non confirmé : l’alerte reste visible, « Effacer mes cartes maintenant » le termine et le dit après le service', async () => {
    await as('Ada', ADA, { seed: SHARE, pre: async () => { await shared(); localStorage.setItem('believe:circles', JSON.stringify({ on: true, retract: true })); fake.failNext = { match: 'bl_circle_sharing', status: 500 } } })
    expect(await screen.findByText(/Retrait de vos cartes en attente\./)).toBeTruthy(); await tick(300); expect(screen.getByText(/Retrait de vos cartes en attente\./)).toBeTruthy()
    expect((await rows<{ sharing: boolean }>('select sharing from bl.members'))[0].sharing).toBe(true) // le service n'a rien confirmé : la carte est toujours là
    fireEvent.click(btn('Effacer mes cartes maintenant')); expect(await screen.findByText('Vos cartes ont été effacées de 1 cercle.')).toBeTruthy()
    expect(await rows('select sharing, card is null as nocard from bl.members')).toEqual([{ sharing: false, nocard: true }]); await waitFor(() => expect(screen.queryByText(/Retrait de vos cartes en attente\./)).toBeNull()); expect(localStorage.getItem('believe:circles')).toBeNull()
  })

  it('retrait en attente et service joignable : la page le termine toute seule à l’ouverture', async () => {
    await as('Ada', ADA, { seed: SHARE, pre: async () => { await shared(); const s = JSON.parse(localStorage.getItem('believe:v2')!); s.consents.share = false; s.share.vis = {}; localStorage.setItem('believe:v2', JSON.stringify(s)); localStorage.setItem('believe:circles', JSON.stringify({ on: true, retract: true })) } })
    await waitFor(async () => expect(await rows('select sharing, card is null as nocard from bl.members')).toEqual([{ sharing: false, nocard: true }])); await waitFor(() => expect(localStorage.getItem('believe:circles')).toBeNull())
    await waitFor(() => expect(screen.queryByText(/Retrait de vos cartes en attente\./)).toBeNull())
  })

  it('accord « Partage » retiré avec le service injoignable : dit que la carte reste visible ; le retrait est mémorisé et se termine à la reconnexion', async () => {
    await as('Ada', ADA, { seed: SHARE, pre: shared }); await screen.findByText('Cercles d’amis'); await go('#/2/confidentialite')
    fake.offline = true; fireEvent.click(btn('Retirer Partage avec des amis')); expect(stored().consents.share).toBe(false)
    expect(await screen.findByText(/Accord retiré : Partage avec des amis\. Mais le service n’a pas confirmé l’effacement de vos cartes dans vos cercles : elles restent visibles pour l’instant/)).toBeTruthy()
    fake.offline = false; expect((await rows<{ sharing: boolean }>('select sharing from bl.members'))[0].sharing).toBe(true); expect(JSON.parse(localStorage.getItem('believe:circles')!).retract).toBe(true)
    await go('#/5/amis'); await waitFor(async () => expect(await rows('select sharing, card is null as nocard from bl.members')).toEqual([{ sharing: false, nocard: true }])); await waitFor(() => expect(localStorage.getItem('believe:circles')).toBeNull())
  })

  it('accord « Compte en ligne » retiré : cartes effacées PUIS déconnexion ; sans réseau, déconnecté quand même mais l’échec est dit', async () => {
    await as('Ada', ADA, { seed: SHARE, pre: shared }); await screen.findByText('Cercles d’amis'); await go('#/2/confidentialite')
    fireEvent.click(btn('Retirer Compte en ligne')); expect(stored().consents.cloud).toBe(false)
    expect(await screen.findByText('Accord retiré : Compte en ligne. Cet appareil est déconnecté et vos cartes ont été effacées de vos cercles ; vos données locales et celles déjà en ligne sont intactes.')).toBeTruthy()
    expect(await rows('select sharing, card is null as nocard from bl.members')).toEqual([{ sharing: false, nocard: true }]); expect(localStorage.getItem('believe:auth')).toBeNull()
    // sans réseau
    await as('Ada', ADA, { seed: SHARE, pre: async () => { await shared() } }); await go('#/2/confidentialite'); fake.offline = true
    fireEvent.click(btn('Retirer Compte en ligne')); expect(await screen.findByText(/Accord retiré : Compte en ligne\. Cet appareil est déconnecté, mais le service n’a pas confirmé l’effacement de vos cartes dans vos cercles/, undefined, { timeout: 9000 })).toBeTruthy()
    expect(localStorage.getItem('believe:auth')).toBeNull(); expect(JSON.parse(localStorage.getItem('believe:circles')!).retract).toBe(true)
  }, 30_000)

  it('onglet Partage › Révoquer : tout est masqué, l’accord retiré, les cartes des cercles effacées (annoncé après le service)', async () => {
    await as('Ada', ADA, { seed: SHARE, pre: shared, hash: '#/5/partage' }); await screen.findByText('Révoquer')
    fireEvent.click(btn('Révoquer le partage')); fireEvent.click(btn('Confirmer la révocation'))
    expect(stored().consents.share).toBe(false); expect(stored().share.vis).toEqual({}); expect(await screen.findByText('Partage révoqué : tout est masqué, l’accord est retiré et vos cartes ont été effacées de vos cercles d’amis.')).toBeTruthy()
    expect(await rows('select sharing, card is null as nocard from bl.members')).toEqual([{ sharing: false, nocard: true }])
  })
})
