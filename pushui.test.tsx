// Rubrique 9 › carte « Rappels application fermée » : parcours d'interface complets (src/PushCard.tsx) face à un faux navigateur (abonnement Web Push avec de vraies clés) et à l'imitation du service en ligne
// (FakeCloud : Google simulé + vraie base PostgreSQL qui a reçu supabase/schema.sql). Un message de réussite ne s'affiche qu'une fois la chose confirmée par le service.
import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FakeCloud } from './fakecloud'
import type { State } from './lib'
import { browser } from './testpush'
import type { Br } from './testpush'
import { btn, mount, reopen, stored, tick, withCrypto } from './testkit'

configure({ asyncUtilTimeout: 4000 })
let fake: FakeCloud
beforeAll(async () => { fake = await FakeCloud.create() }, 120_000)
afterAll(async () => { await fake.db.close() })

/** Vendredi 23 octobre 2026, 12 h (heure locale) : seule `Date` est simulée. */
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime(), MIN = 60_000
beforeEach(async () => {
  await fake.reset(); history.replaceState(null, '', '/'); vi.stubGlobal('fetch', fake.fetch); withCrypto()
  vi.useFakeTimers({ toFake: ['Date'], now: NOW }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})
/** Moteurs de rappels (un par montage de l'application) : arrêtés à la fin de chaque test, pour qu'un minuteur resté en attente ne touche pas le test suivant. */
const engines: { stop: () => void }[] = []
const track = async () => { engines.push(await import('./push')) }
afterEach(() => { for (const e of engines.splice(0)) e.stop(); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'serviceWorker'); Reflect.deleteProperty(navigator, 'standalone'); Reflect.deleteProperty(document, 'visibilityState'); history.replaceState(null, '', '/') })

const p2 = (n: number) => String(n).padStart(2, '0')
const at = (ms: number) => { const d = new Date(NOW + ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) }
const TASK = { id: 't1', t: 'Appeler Paul secret', imp: false, due: at(60 * MIN), done: false, p: null }
/** État de départ : accords « Notifications » et « Compte en ligne » donnés, une tâche dans une heure (rappel 30 minutes avant). */
const READY = (s: State) => { s.consents.notif = true; s.consents.cloud = true; s.tasks = [{ ...TASK }] }
const rows = async <T = Record<string, unknown>>(q: string) => (await fake.db.query<T>(q)).rows
const rpcs = (fn: string) => fake.calls.filter(c => c.fn === fn)
const card = () => screen.getByRole('heading', { name: 'Rappels application fermée' }).closest('.card') as HTMLElement
const inCard = () => within(card())
const text = () => card().textContent ?? ''
/** Avertissement affiché quand le service d'envoi n'est pas passé depuis plus de 5 minutes (ou jamais). */
const ALERT = 'Le service d’envoi des rappels ne répond pas pour le moment : les rappels application fermée ne partiront pas tant qu’il ne fonctionne pas. Les rappels dans l’application restent actifs.'
const pref = () => JSON.parse(localStorage.getItem('believe:push') ?? 'null')

/** Connecte cet « appareil » à Google avant le montage (mêmes modules que l'application). */
async function signIn(email = 'ada@example.org') {
  const c = await import('./cloud'); let url = ''; c.nav.assign = u => { url = u }
  expect(await c.startGoogle()).toEqual({ ok: true })
  const back = new URL(await fake.google(url, email)); history.replaceState(null, '', back.pathname + back.search + back.hash)
  expect((await c.completeFromUrl()).kind).toBe('ok')
  history.replaceState(null, '', '/#/9') // le retour de connexion a mis l'adresse sur l'onglet Compte : on rouvre la rubrique 9
}
/** Ouvre la rubrique 9 : navigateur imité installé (ou non), connexion faite (ou non). */
async function open(o: { br?: Br | false; signed?: boolean; seed?: (s: State) => void; config?: Record<string, unknown> } = {}) {
  const br = o.br === false ? null : (o.br ?? browser()).install()
  await mount('#/9', o.seed ?? READY, async () => {
    if (o.signed !== false) await signIn()
    if (o.config) { fake.config = o.config; (await import('./cloud')).forgetConfig() } // le service se révèle mal configuré après la connexion
  })
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Rappels application fermée' })).toBeTruthy()); await track()
  return br as Br
}
/** Active les rappels application fermée par l'interface (fenêtre d'explication comprise). */
async function enable(title = false) {
  fireEvent.click(inCard().getByRole('button', { name: 'Activer sur cet appareil' }))
  const dlg = await screen.findByRole('dialog', { name: 'Activer les rappels application fermée' })
  if (title) fireEvent.click(within(dlg).getByLabelText('Afficher le titre de la tâche dans la notification'))
  await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Activer' })) })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}
const status = () => inCard().findByText(/Appareils abonnés/)

describe('Carte « Rappels application fermée » : ce qui manque avant d’activer', () => {
  it('sans rappels activés ni connexion : liste « À faire », bouton inactif, AUCUNE requête réseau ; le texte explique le chiffrement et le caractère facultatif', async () => {
    await open({ signed: false, seed: s => { s.tasks = [{ ...TASK }] } })
    expect(text()).toMatch(/chiffrés sur l’appareil/); expect(text()).toMatch(/Facultatif, désactivable à tout moment/); expect(text()).toMatch(/Astuce : un téléphone en économie d’énergie/)
    expect(inCard().getByText(/À faire : Rappels activés \(carte ci-dessus\)\./)).toBeTruthy(); expect(inCard().getByText(/À faire : Connecté au compte en ligne/)).toBeTruthy(); expect(inCard().getByText(/Fait : Navigateur compatible\./)).toBeTruthy()
    expect((inCard().getByRole('button', { name: 'Activer sur cet appareil' }) as HTMLButtonElement).disabled).toBe(true)
    await tick(30); expect(fake.calls).toEqual([])
  })

  it('un seul accord manquant suffit à garder le bouton inactif, même connecté et avec un navigateur compatible : « Notifications » (carte ci-dessus), puis « Compte en ligne »', async () => {
    const off = () => (inCard().getByRole('button', { name: 'Activer sur cet appareil' }) as HTMLButtonElement).disabled
    await open({ seed: s => { s.consents.cloud = true; s.tasks = [{ ...TASK }] } }); await tick(30) // « Notifications » manque
    expect(inCard().getByText(/À faire : Rappels activés \(carte ci-dessus\)\./)).toBeTruthy(); expect(inCard().getByText(/Fait : Connecté au compte en ligne/)).toBeTruthy()
    expect(off()).toBe(true); expect(inCard().queryByText(/service disponible/), 'le service n’est pas interrogé tant qu’il manque quelque chose').toBeNull()
    cleanup(); await open({ seed: s => { s.consents.notif = true; s.tasks = [{ ...TASK }] } }); await tick(30) // « Compte en ligne » manque, bien qu'une session existe
    expect(inCard().getByText(/Fait : Rappels activés/)).toBeTruthy(); expect(inCard().getByText(/À faire : Connecté au compte en ligne/)).toBeTruthy()
    expect(off()).toBe(true); expect(inCard().queryByText(/service disponible/)).toBeNull()
  })

  it('accords donnés et connecté : « Fait » partout, bouton actif ; la disponibilité du service est vérifiée (une requête vers notre propre serveur, rien d’autre)', async () => {
    await open()
    await waitFor(() => expect(inCard().getByText('Fait : service disponible.')).toBeTruthy())
    expect(inCard().getByText(/Fait : Rappels activés/)).toBeTruthy(); expect(inCard().getByText(/Fait : Connecté au compte en ligne/)).toBeTruthy(); expect(inCard().getByText(/Fait : notifications du système autorisées\./)).toBeTruthy()
    expect((inCard().getByRole('button', { name: 'Activer sur cet appareil' }) as HTMLButtonElement).disabled).toBe(false)
    expect(fake.calls.filter(c => c.path !== '/api/cloud-config' && !c.path.startsWith('/auth/v1/token'))).toEqual([]); expect(await rows('select * from bl.pushsubs')).toEqual([]) // rien n'est déposé avant le clic
  })

  it('iPhone hors de l’écran d’accueil : le texte dit quoi faire ; navigateur sans Web Push : dit que ce n’est pas possible ; dans les deux cas le bouton reste inactif', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')
    await open({ br: browser({ noPush: true }) })
    expect(inCard().getByText(/À faire : Sur iPhone et iPad : Believe doit être ajouté à l’écran d’accueil, puis ouvert depuis son icône\./)).toBeTruthy()
    expect((inCard().getByRole('button', { name: 'Activer sur cet appareil' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup(); vi.restoreAllMocks(); await open({ br: browser({ noPush: true }) })
    expect(inCard().getByText(/À faire : Navigateur compatible : non \(pas de notifications application fermée ici\)\./)).toBeTruthy(); expect((inCard().getByRole('button', { name: 'Activer sur cet appareil' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('notifications refusées dans le navigateur : « Bloqué », bouton inactif ; pas encore demandées : la demande est annoncée pour l’activation', async () => {
    await open({ br: browser({ perm: 'denied' }) })
    expect(inCard().getByText(/Bloqué : notifications du système refusées dans le navigateur/)).toBeTruthy(); expect((inCard().getByRole('button', { name: 'Activer sur cet appareil' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup(); await open({ br: browser({ perm: 'default' }) })
    expect(inCard().getByText(/À faire : notifications du système autorisées \(la demande sera faite à l’activation\)\./)).toBeTruthy(); expect((inCard().getByRole('button', { name: 'Activer sur cet appareil' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('service indisponible ou clés d’envoi absentes : un message simple, sans variable ni mode d’emploi, bouton inactif', async () => {
    const OFF = 'Les rappels application fermée ne sont pas disponibles pour le moment.'
    await open({ config: { ok: false, missing: ['SUPABASE_URL'], invalid: [] } })
    await waitFor(() => expect(inCard().getByText(OFF)).toBeTruthy()); expect((inCard().getByRole('button', { name: 'Activer sur cet appareil' }) as HTMLButtonElement).disabled).toBe(true)
    expect(text()).not.toMatch(/README|SUPABASE|VAPID|npm run|déploiement|Configuration requise|non configuré/)
    cleanup(); fake.config = FakeCloud.defaultConfig(); await open({ config: { ...FakeCloud.defaultConfig(), vapid: null } })
    await waitFor(() => expect(inCard().getByText(OFF)).toBeTruthy()); expect((inCard().getByRole('button', { name: 'Activer sur cet appareil' }) as HTMLButtonElement).disabled).toBe(true)
    expect(text()).not.toMatch(/README|SUPABASE|VAPID|npm run|déploiement|Configuration requise|non configuré/)
  })
})

describe('Carte « Rappels application fermée » : activer', () => {
  it('la fenêtre explique exactement ce qui sera déposé ; « Annuler » ne fait rien ; le titre n’est pas coché par défaut', async () => {
    const br = await open()
    fireEvent.click(inCard().getByRole('button', { name: 'Activer sur cet appareil' }))
    const dlg = await screen.findByRole('dialog', { name: 'Activer les rappels application fermée' })
    expect(dlg.textContent).toMatch(/votre navigateur crée un abonnement aux notifications pour cet appareil/); expect(dlg.textContent).toMatch(/chiffre sur l’appareil un message de rappel avec la clé de cet abonnement/)
    expect(dlg.textContent).toMatch(/l’heure de chaque rappel et un identifiant de tâche aléatoire, jamais le titre ni le texte/); expect(dlg.textContent).toMatch(/supprime l’abonnement et les rappels déposés/)
    expect((within(dlg).getByLabelText('Afficher le titre de la tâche dans la notification') as HTMLInputElement).checked).toBe(false); expect(dlg.textContent).toMatch(/Décoché \(conseillé\)/)
    fireEvent.click(within(dlg).getByRole('button', { name: 'Annuler' })); expect(screen.queryByRole('dialog')).toBeNull()
    expect(br.subscribe).not.toHaveBeenCalled(); expect(pref()).toBeNull(); expect(await rows('select * from bl.pushsubs')).toEqual([])
    fireEvent.click(inCard().getByRole('button', { name: 'Activer sur cet appareil' })); await screen.findByRole('dialog'); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull() // Échap ferme aussi
  })

  it('pendant l’activation (autorisation du navigateur en attente) : la fenêtre reste ouverte, ses boutons sont inactifs et un second clic ne relance rien ; elle se ferme une fois l’activation finie', async () => {
    const br = browser({ perm: 'default' }); let grant!: (p: NotificationPermission) => void
    const ask = vi.fn(() => new Promise<NotificationPermission>(r => { grant = r }))
    br.install(); vi.stubGlobal('Notification', Object.assign(Object.defineProperty(class {}, 'permission', { get: () => br.perm }), { requestPermission: ask }))
    await mount('#/9', READY, async () => { await signIn() }); await waitFor(() => screen.getByRole('heading', { name: 'Rappels application fermée' })); await track()
    fireEvent.click(inCard().getByRole('button', { name: 'Activer sur cet appareil' }))
    const dlg = await screen.findByRole('dialog', { name: 'Activer les rappels application fermée' })
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Activer' })) }); await waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    const go = within(dlg).getByRole('button', { name: 'Activer' }) as HTMLButtonElement, no = within(dlg).getByRole('button', { name: 'Annuler' }) as HTMLButtonElement
    expect(go.disabled).toBe(true); expect(no.disabled).toBe(true)
    fireEvent.click(go); fireEvent.click(no); fireEvent.click(dlg.parentElement as HTMLElement) // second clic, « Annuler », clic à côté de la fenêtre : rien ne se passe pendant l'activation
    expect(screen.queryByRole('dialog')).not.toBeNull(); expect(ask).toHaveBeenCalledTimes(1); expect(br.subscribe).not.toHaveBeenCalled()
    br.perm = 'granted'; await act(async () => { grant('granted') })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(br.subscribe).toHaveBeenCalledTimes(1); expect(pref()).toMatchObject({ on: true }); expect(await rows('select * from bl.pushsubs')).toHaveLength(1)
  })

  it('activation réussie : message de confirmation APRÈS le service, état « Activé », nombre de rappels réellement programmés, service d’envoi absent signalé simplement, rien de lisible en ligne', async () => {
    const br = await open(); await enable()
    expect(inCard().getByText('Rappels application fermée activés sur cet appareil. 1 rappel est programmé sur le service.')).toBeTruthy()
    expect(inCard().getByText(/^Activé sur cet appareil\./)).toBeTruthy(); expect(pref()).toEqual({ on: true, title: false, test: 0 })
    expect((await status()).textContent).toBe('Appareils abonnés : 1. Rappels en attente : 1.')
    expect(inCard().getByText(ALERT)).toBeTruthy(); expect(text()).not.toMatch(/planificateur|README|supabase\/|Configuration requise|non configuré/)
    const rem = await rows<{ body: string }>('select body from bl.reminders'); expect(rem).toHaveLength(1)
    expect(br.open(rem[0].body)).toEqual({ v: 1, g: 't1', t: 'Believe : rappel', b: 'Une tâche arrive à échéance.', d: null })
    expect(JSON.stringify(await rows('select * from bl.reminders')) + JSON.stringify(fake.calls)).not.toContain('secret')
  })

  it('la ligne d’état distingue les appareils abonnés des rappels en attente : un appareil et trois tâches donnent « Appareils abonnés : 1. Rappels en attente : 3. »', async () => {
    await open({ seed: s => { READY(s); s.tasks.push({ ...TASK, id: 't2', t: 'Deux', due: at(120 * MIN) }, { ...TASK, id: 't3', t: 'Trois', due: at(180 * MIN) }) } }); await enable()
    expect((await status()).textContent).toBe('Appareils abonnés : 1. Rappels en attente : 3.')
    expect(await rows('select * from bl.pushsubs')).toHaveLength(1); expect(await rows('select * from bl.reminders')).toHaveLength(3)
  })

  it('titre coché dans la fenêtre : le message chiffré contient le titre (et lui seul le contient) ; décocher plus tard reprogramme sans titre, avec un message de confirmation', async () => {
    const br = await open(); await enable(true)
    expect(pref().title).toBe(true); expect(br.open((await rows<{ body: string }>('select body from bl.reminders'))[0].body)).toMatchObject({ t: 'Appeler Paul secret', b: null, d: Date.parse(TASK.due) })
    expect((inCard().getByLabelText('Afficher le titre de la tâche dans la notification') as HTMLInputElement).checked).toBe(true)
    const box = inCard().getByLabelText('Afficher le titre de la tâche dans la notification') as HTMLInputElement
    fireEvent.click(box); expect(box.checked, 'la case revient en arrière pendant l’envoi au service').toBe(false) // aussitôt, sans attendre la réponse du service
    await waitFor(() => expect(inCard().getByText('Les notifications ne montreront plus le titre des tâches.')).toBeTruthy()); expect((inCard().getByLabelText('Afficher le titre de la tâche dans la notification') as HTMLInputElement).checked).toBe(false)
    fireEvent.click(inCard().getByLabelText('Afficher le titre de la tâche dans la notification')); expect((inCard().getByLabelText('Afficher le titre de la tâche dans la notification') as HTMLInputElement).checked).toBe(true) // et dans l'autre sens
    await waitFor(() => expect(inCard().getByText('Le titre des tâches figurera dans les notifications (sauf en mode discret).')).toBeTruthy())
    await act(async () => { fireEvent.click(inCard().getByLabelText('Afficher le titre de la tâche dans la notification')) }); await waitFor(() => expect(inCard().getByText('Les notifications ne montreront plus le titre des tâches.')).toBeTruthy())
    expect(pref().title).toBe(false); expect(br.open((await rows<{ body: string }>('select body from bl.reminders'))[0].body).t).toBe('Believe : rappel')
  })

  it('mode discret : le titre n’est jamais envoyé, même coché, et l’écran le dit', async () => {
    const br = await open({ seed: s => { READY(s); s.discret = true } }); await enable(true)
    expect(inCard().getByText('Le mode discret est actif : le titre n’est jamais affiché.')).toBeTruthy(); expect(br.open((await rows<{ body: string }>('select body from bl.reminders'))[0].body).t).toBe('Believe : rappel')
  })

  it('le navigateur est interrogé AU CLIC : l’autorisation est demandée avant toute attente, puis l’activation continue si elle est donnée, et s’arrête si elle est refusée (rien n’est déposé)', async () => {
    const br = browser({ perm: 'default' }); const ask = vi.fn(async () => { br.perm = 'granted'; return 'granted' })
    br.install(); vi.stubGlobal('Notification', Object.assign(Object.defineProperty(class {}, 'permission', { get: () => br.perm }), { requestPermission: ask }))
    await mount('#/9', READY, async () => { await signIn() }); await waitFor(() => screen.getByRole('heading', { name: 'Rappels application fermée' })); await track()
    await enable(); expect(ask).toHaveBeenCalledTimes(1); expect(pref()).toMatchObject({ on: true }); expect(br.subscribe).toHaveBeenCalledTimes(1)
    cleanup(); await fake.reset(); localStorage.clear(); const no = browser({ perm: 'default' }); no.install(); const deny = vi.fn(async () => { no.perm = 'denied'; return 'denied' })
    vi.stubGlobal('Notification', Object.assign(Object.defineProperty(class {}, 'permission', { get: () => no.perm }), { requestPermission: deny }))
    await mount('#/9', READY, async () => { await signIn() }); await waitFor(() => screen.getByRole('heading', { name: 'Rappels application fermée' })); await track()
    await enable(); expect(deny).toHaveBeenCalledTimes(1); expect(inCard().getByText(/Les notifications du système ne sont pas autorisées dans le navigateur/)).toBeTruthy(); expect(pref()).toBeNull(); expect(no.subscribe).not.toHaveBeenCalled()
  })

  it('échec avant la confirmation du service : AUCUN message de réussite, un message précis, rien d’activé, abonnement retiré ; hors ligne, base du service pas prête, abonnement refusé', async () => {
    const br = await open()
    fake.failNext = { match: 'bl_push_register', status: 404, body: { code: 'PGRST202', message: 'x' } }; await enable()
    expect(inCard().getByText('Les rappels application fermée sont momentanément indisponibles : réessayez plus tard.')).toBeTruthy(); expect(text()).not.toMatch(/SQL|schema|README/); expect(inCard().queryByText(/activés sur cet appareil/)).toBeNull(); expect(pref()).toBeNull(); expect(br.sub).toBeNull()
    fake.offline = true; await enable(); expect(inCard().getByText('Hors ligne : réessayez au retour du réseau.')).toBeTruthy(); fake.offline = false; expect(pref()).toBeNull()
    const refuse = browser({ refuse: true }).install(); await enable(); expect(inCard().getByText('Le navigateur a refusé l’abonnement aux notifications.')).toBeTruthy(); expect(pref()).toBeNull(); expect(refuse.sub).toBeNull()
    expect(await rows('select * from bl.pushsubs')).toEqual([]); expect(inCard().getByRole('button', { name: 'Activer sur cet appareil' })).toBeTruthy()
    for (const c of inCard().queryAllByRole('status')) expect(c.className).toBe('ko')
  })

  it('abonné, mais la programmation échoue : le message dit les deux choses (activé ici ; programmation non envoyée, sera refaite), il ne prétend pas que tout est prêt', async () => {
    await open(); fake.failNext = { match: 'bl_push_set', status: 500, body: { message: 'boom' } }; await enable()
    expect(inCard().getByText(/^Activé sur cet appareil, mais la programmation n’a pas pu être envoyée\. Le service ne répond pas correctement : réessayez plus tard\. Elle sera refaite automatiquement\.$/)).toBeTruthy()
    expect(pref()).toMatchObject({ on: true }); expect(inCard().getByText(/^Activé sur cet appareil\./)).toBeTruthy()
  })

  it('sans tâche à programmer : message honnête (aucun rappel pour l’instant), pas « 0 rappel programmé »', async () => {
    await open({ seed: s => { READY(s); s.tasks = [] } }); await enable()
    expect(inCard().getByText('Rappels application fermée activés sur cet appareil. Aucun rappel à programmer pour l’instant : les prochains le seront automatiquement.')).toBeTruthy()
  })
})

describe('Carte « Rappels application fermée » : état, test, reprogrammation, désactivation', () => {
  it('service d’envoi : l’alerte apparaît au-delà de 5 minutes sans passage et disparaît dès qu’il repasse ; écart d’horloge signalé', async () => {
    await open(); await enable(); await status()
    const ran = async (ms: number, alert: boolean) => { await fake.db.query("insert into bl.meta (k, v) values ('tick', $1) on conflict (k) do update set v = excluded.v", [new Date(NOW - ms).toISOString()]); await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Reprogrammer maintenant' })) }); await waitFor(() => expect(!!inCard().queryByText(ALERT)).toBe(alert)) }
    await ran(10 * MIN, true); await ran(2 * MIN, false); await ran(3 * 3600e3, true); await ran(1000, false)
    const real = fake.fetch; vi.stubGlobal('fetch', async (i: RequestInfo | URL, init?: RequestInit) => { const r = await real(i, init); const u = typeof i === 'string' ? i : i instanceof URL ? i.href : i.url; if (!u.includes('bl_push_status')) return r; const j = await r.json(); return new Response(JSON.stringify({ ...j, now: new Date(NOW + 5 * MIN).toISOString() }), { status: 200 }) })
    await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Reprogrammer maintenant' })) }); await waitFor(() => expect(inCard().getByText(/L’heure de cet appareil diffère de plus de 2 minutes de celle du service/)).toBeTruthy())
  })

  it('service d’envoi : la limite est exactement 5 minutes (5 min 00 s : pas d’alerte ; 5 min 01 s : alerte) et un passage tout récent n’alerte pas', async () => {
    await open(); await enable(); await status()
    const ran = async (ms: number, alert: boolean) => { await fake.db.query("insert into bl.meta (k, v) values ('tick', $1) on conflict (k) do update set v = excluded.v", [new Date(NOW - ms).toISOString()]); await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Reprogrammer maintenant' })) }); await waitFor(() => expect(!!inCard().queryByText(ALERT)).toBe(alert)) }
    await ran(5 * MIN + 1000, true); await ran(5 * MIN, false); await ran(5 * MIN + 1000, true); await ran(0, false); await ran(6 * MIN, true); await ran(40_000, false)
    expect(text()).not.toMatch(/Dernier passage|planificateur/)
  })

  it('état du service illisible : la carte le dit au lieu d’afficher de vieux chiffres ; la lecture suivante rétablit l’état', async () => {
    await open(); await enable(); await status()
    fake.failNext = { match: 'bl_push_status', status: 500, body: { message: 'boom' } }
    await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Reprogrammer maintenant' })) })
    const ko = await inCard().findByText('État du service indisponible : Le service ne répond pas correctement : réessayez plus tard.'); expect(ko.className).toBe('ko'); expect(inCard().queryByText(/Appareils abonnés/)).toBeNull()
    await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Reprogrammer maintenant' })) }); await status()
    expect(inCard().queryByText(/État du service indisponible/)).toBeNull()
  })

  it('quand un accord change, la carte relit l’état du service : elle ne garde pas un état périmé (et ne relit rien tant que rien ne change)', async () => {
    localStorage.clear(); vi.resetModules(); browser().install(); await signIn()
    localStorage.setItem('believe:push', JSON.stringify({ on: true, title: false, test: 0 }))
    const { DEF } = await import('./lib'), { default: PushCard } = await import('./PushCard')
    const s = DEF(); s.consents.notif = true; s.consents.cloud = true
    const r = render(<PushCard S={s} />); await status()
    const reads = () => rpcs('bl_push_status').length; expect(reads()).toBe(1)
    const withConsents = (notif: boolean, cloud: boolean) => ({ ...s, consents: { ...s.consents, notif, cloud } })
    r.rerender(<PushCard S={withConsents(false, true)} />); await waitFor(() => expect(reads()).toBe(2)) // « Notifications » retiré
    r.rerender(<PushCard S={withConsents(false, false)} />); await waitFor(() => expect(reads()).toBe(3)) // puis « Compte en ligne »
    r.rerender(<PushCard S={withConsents(false, false)} />); await tick(30); expect(reads(), 'rien n’a changé : pas de nouvelle lecture').toBe(3)
  })

  it('réponse incohérente au test (« programmé » sans heure) : message d’erreur du service, aucune date inventée', async () => {
    await open(); await enable(); const K = await import('./push'); vi.spyOn(K, 'sendTest').mockResolvedValue({ ok: true, armed: 0, at: 0 })
    await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Envoyer une notification de test' })) })
    const m = await inCard().findByText('Le service ne répond pas correctement : réessayez plus tard.'); expect(m.className).toBe('ko'); expect(text()).not.toMatch(/Invalid Date|programmée pour/)
  })

  it('« Envoyer une notification de test » : programmé 45 s plus tard avec le message de test, message d’instruction honnête (pas « envoyée »)', async () => {
    const br = await open(); await enable()
    await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Envoyer une notification de test' })) })
    const m = await inCard().findByText(/^Notification de test programmée pour 12:00 environ\./); expect(m.textContent).toMatch(/elle doit arriver dans la minute qui suit l’heure indiquée/); expect(m.textContent).toMatch(/vérifiez que les notifications sont autorisées pour Believe dans les réglages de votre téléphone/); expect(m.textContent).not.toMatch(/planificateur/); expect(m.className).toBe('ok')
    const rem = await rows<{ ref: string; body: string }>("select ref, body from bl.reminders where ref = 'test'"); expect(rem).toHaveLength(1); expect(br.open(rem[0].body)).toMatchObject({ t: 'Believe : test', b: 'Les rappels application fermée fonctionnent.' })
    fake.offline = true; await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Envoyer une notification de test' })) }); await inCard().findByText('Hors ligne : réessayez au retour du réseau.')
  })

  it('« Reprogrammer maintenant » : le nombre de rappels programmés vient du service ; erreur claire hors ligne', async () => {
    await open(); await enable()
    await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Reprogrammer maintenant' })) }); await inCard().findByText('1 rappel programmé sur le service.')
    fake.offline = true; await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Reprogrammer maintenant' })) }); await inCard().findByText('Hors ligne : réessayez au retour du réseau.')
  })

  it('« Désactiver sur cet appareil » : le service confirme la suppression de l’abonnement et des rappels, l’abonnement du navigateur est retiré, la carte revient à « Activer »', async () => {
    const br = await open(); await enable(); const sub = br.sub!
    await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Désactiver sur cet appareil' })) })
    await inCard().findByText('Rappels application fermée désactivés. L’abonnement et les rappels déposés ont été supprimés du service.')
    expect(pref()).toBeNull(); expect(sub.unsubscribe).toHaveBeenCalledTimes(1); expect(await rows('select * from bl.pushsubs')).toEqual([]); expect(await rows('select * from bl.reminders')).toEqual([])
    expect(inCard().getByRole('button', { name: 'Activer sur cet appareil' })).toBeTruthy(); expect(inCard().queryByRole('button', { name: 'Désactiver sur cet appareil' })).toBeNull()
  })

  it('désactiver hors ligne : arrêté ici quand même, mais le message dit que le service n’a PAS confirmé, et ce qu’il fera lui-même', async () => {
    await open(); await enable(); fake.offline = true
    await act(async () => { fireEvent.click(inCard().getByRole('button', { name: 'Désactiver sur cet appareil' })) })
    const m = await inCard().findByText(/Le service n’a pas confirmé la suppression/); expect(m.className).toBe('ko'); expect(m.textContent).toMatch(/plus rien ne sera affiché ici, et le service supprimera de lui-même les rappels en attente/)
    expect(pref()).toBeNull(); expect(inCard().getByRole('button', { name: 'Activer sur cet appareil' })).toBeTruthy()
  })

  it('l’abonnement du navigateur a disparu, ou les notifications ne sont plus autorisées : l’écran le dit au lieu d’afficher « tout va bien »', async () => {
    const br = await open(); await enable(); await status()
    br.sub = null; for (const e of engines.splice(0)) e.stop(); cleanup(); await reopen('#/9'); await track() // réouverture : mêmes données, le navigateur a oublié l'abonnement
    await waitFor(() => expect(inCard().getByText(/L’abonnement du navigateur a disparu/)).toBeTruthy())
    br.perm = 'denied'; await act(async () => { dispatchEvent(new Event('focus')) }); expect(inCard().getByText(/Les notifications du système ne sont plus autorisées dans le navigateur : aucun rappel ne peut arriver tant qu’elles ne le sont pas\./)).toBeTruthy()
  })
})

describe('Retirer un accord ou désactiver les rappels : les rappels application fermée s’arrêtent aussi', () => {
  it('carte « Rappels » › « Désactiver les rappels » : accord retiré ET rappels application fermée supprimés (abonnement, rappels déposés), message qui le dit', async () => {
    const br = await open(); await enable(); const sub = br.sub!
    await act(async () => { fireEvent.click(btn('Désactiver les rappels')) })
    await screen.findByText('Rappels désactivés, y compris les rappels application fermée : l’abonnement et les rappels déposés ont été supprimés du service.')
    expect(stored().consents.notif).toBe(false); expect(pref()).toBeNull(); expect(sub.unsubscribe).toHaveBeenCalled(); expect(await rows('select * from bl.pushsubs')).toEqual([]); expect(await rows('select * from bl.reminders')).toEqual([])
  })

  it('carte « Rappels » › « Désactiver les rappels » sans rappels application fermée : message d’origine, aucun appel au service', async () => {
    await open({ signed: false }); fireEvent.click(btn('Désactiver les rappels')); await tick(20)
    expect(screen.getByText(/^Rappels désactivés\. Pour retirer aussi l’autorisation du navigateur/)).toBeTruthy(); expect(fake.calls).toEqual([])
  })

  it('rubrique 5 › Consentements › Retirer « Notifications » : les rappels application fermée sont désactivés et le message le dit ; hors ligne il dit que le service n’a pas confirmé', async () => {
    const br = await open(); await enable()
    location.hash = '#/2/confidentialite'; await tick(20); await waitFor(() => screen.getByRole('button', { name: 'Retirer Notifications' }))
    await act(async () => { fireEvent.click(btn('Retirer Notifications')) })
    await screen.findByText('Accord retiré : Notifications. Les rappels application fermée sont désactivés : l’abonnement et les rappels déposés ont été supprimés du service.')
    expect(stored().consents.notif).toBe(false); expect(pref()).toBeNull(); expect(br.sub).toBeNull(); expect(await rows('select * from bl.reminders')).toEqual([])
    // hors ligne
    cleanup(); await fake.reset(); localStorage.clear(); const b2 = browser(); await open({ br: b2 }); await enable(); fake.offline = true
    location.hash = '#/2/confidentialite'; await tick(20); await waitFor(() => screen.getByRole('button', { name: 'Retirer Notifications' }))
    await act(async () => { fireEvent.click(btn('Retirer Notifications')) })
    const m = await screen.findByText(/Accord retiré : Notifications\. Les rappels application fermée sont arrêtés sur cet appareil, mais le service n’a pas confirmé la suppression de ceux déjà déposés/); expect(m.className).toBe('ko'); expect(pref()).toBeNull()
  })

  it('rubrique 5 › Retirer « Compte en ligne » : déconnecté, abonnement et rappels supprimés avant la fin de la session', async () => {
    const br = await open(); await enable()
    location.hash = '#/2/confidentialite'; await tick(20); await waitFor(() => screen.getByRole('button', { name: 'Retirer Compte en ligne' }))
    await act(async () => { fireEvent.click(btn('Retirer Compte en ligne')) }); await waitFor(() => expect(stored().consents.cloud).toBe(false))
    await waitFor(async () => { expect(await rows('select * from bl.reminders')).toEqual([]) }); expect(pref()).toBeNull(); expect(br.sub).toBeNull(); expect(await rows('select * from bl.pushsubs')).toEqual([])
    const order = fake.calls.map(c => c.fn ?? c.path.split('?')[0]); expect(order.indexOf('bl_push_unregister')).toBeLessThan(order.findIndex(p => p.startsWith('/auth/v1/logout')))
  })
})

describe('Rappels locaux : l’heure exacte', () => {
  it('le rappel d’une tâche est programmé à l’heure exacte (et non au prochain contrôle de 30 s) : le minuteur sonne à 12:01:00 et la bannière apparaît, une seule fois', async () => {
    const st = vi.spyOn(window, 'setTimeout')
    vi.stubGlobal('Notification', Object.defineProperty(class {}, 'permission', { get: () => 'denied' }))
    await mount('#/9', s => { s.consents.notif = true; s.tasks = [{ ...TASK, t: 'Réunion', due: at(31 * MIN) }] }) // échéance 12:31 ; rappel 30 minutes avant = 12:01:00
    expect(screen.queryByText('Rappel de tâche')).toBeNull()
    const exact = st.mock.calls.filter(c => c[1] === 60_250) // 60 s jusqu'à 12:01:00, plus 250 ms de marge
    expect(exact.length, 'un minuteur à l’heure exacte du rappel').toBe(1)
    vi.setSystemTime(NOW + 60_000 + 250); await act(async () => { (exact[0][0] as () => void)() })
    const ban = screen.getByText('Rappel de tâche').closest('.ban') as HTMLElement; expect(within(ban).getAllByText(/Réunion : échéance aujourd’hui à 12:31/)).toHaveLength(1)
    expect(stored().tasks[0].r).toBe(at(31 * MIN)) // rappel donné : marqué sur la tâche
    st.mockClear(); await tick(20); expect(st.mock.calls.filter(c => typeof c[1] === 'number' && c[1] > 3600_000)).toEqual([]) // plus aucun minuteur lointain pour cette tâche
  })

  it('délai trop long pour un minuteur (plus de 24 jours) ou aucune tâche à venir : aucun minuteur exact (le contrôle de 30 s reste le filet)', async () => {
    const st = vi.spyOn(window, 'setTimeout'); vi.stubGlobal('Notification', undefined)
    await mount('#/9', s => { s.consents.notif = true; s.tasks = [{ ...TASK, t: 'Lointaine', due: at(40 * 86400e3) }, { ...TASK, id: 't2', t: 'Terminée', due: at(60 * MIN), done: true }] })
    expect(st.mock.calls.filter(c => typeof c[1] === 'number' && c[1] > 3600_000)).toEqual([])
  })
})
