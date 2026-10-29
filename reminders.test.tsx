import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DEF } from './lib'
import type { State } from './lib'
import { RemindBanner, useReminders } from './Reminders'
import { btn, mount, reopen, stored, tick, type, withCrypto } from './testkit'

/** Vendredi 23 octobre 2026, midi : l'horloge est figée ici (seule `Date` est simulée) et avancée à la main. */
const NOW = new Date(2026, 9, 23, 12, 0, 0)
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); Reflect.deleteProperty(document, 'visibilityState'); Reflect.deleteProperty(document, 'hidden') })

const p2 = (n: number) => String(n).padStart(2, '0')
/** Date « AAAA-MM-JJTHH:mm » (heure locale) située `min` minutes après midi. */
const local = (min: number) => { const d = new Date(NOW.getTime() + min * 60000); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) }
const task = (id: string, t: string, due: string | null, o: Record<string, unknown> = {}) => ({ id, t, imp: false, due, done: false, p: null, ...o })
const seed = (f: (s: State) => void = () => {}) => (s: State) => { s.consents.notif = true; s.tasks = [task('t1', 'Appeler Paul', local(20))]; f(s) }
const vis = (v: 'visible' | 'hidden') => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' }) }
const clock = () => vi.useFakeTimers({ toFake: ['Date'], now: NOW })
const later = (min: number) => vi.setSystemTime(new Date(NOW.getTime() + min * 60000))
/** Fait comme le retour au premier plan : le navigateur signale le changement de visibilité. */
const back = async () => { act(() => { document.dispatchEvent(new Event('visibilitychange')) }); await tick() }

interface Made { title: string; opt: NotificationOptions }
/** Faux objet Notification du navigateur : autorisation de départ, réponse à la demande d'autorisation (modifiable), notifications créées. `none` : navigateur sans notifications. */
function notif(perm: NotificationPermission | 'none', ask: NotificationPermission = 'granted') {
  const made: Made[] = [], st = { ask }
  if (perm === 'none') { vi.stubGlobal('Notification', undefined); return { made, st, req: vi.fn() } }
  const req = vi.fn(async () => { N.permission = st.ask; return st.ask })
  class N { static permission = perm as NotificationPermission; static requestPermission = req; constructor(title: string, opt: NotificationOptions) { made.push({ title, opt }) } }
  vi.stubGlobal('Notification', N)
  return { made, st, req }
}
/** Contrôle de 30 s : on appelle la fonction enregistrée auprès de setInterval, comme le ferait le navigateur. */
const every30 = (si: { mock: { calls: unknown[][] } }) => { const c = si.mock.calls.filter(x => x[1] === 30000); expect(c.length).toBeGreaterThan(0); act(() => { (c[c.length - 1][0] as () => void)() }) }
const banner = () => screen.queryByText(/^Rappels? de tâches?$/)

describe('Rubrique 9 : rappels de tâches (locaux, application ouverte)', () => {
  it('au premier plan : une tâche entrée dans son délai de rappel s’affiche dans une bannière (titre, échéance), la marque « rappelée » est enregistrée, sans doublon, et le rappel ne revient pas après réouverture', async () => {
    clock(); notif('none'); vis('visible')
    await mount('#/4', seed())
    const ban = screen.getByText('Rappel de tâche').closest('.ban') as HTMLElement
    expect(within(ban).getByText('Appeler Paul : échéance aujourd’hui à 12:20')).toBeTruthy(); expect(within(ban).getByRole('link', { name: 'Ouvrir les tâches' }).getAttribute('href')).toBe('#/9')
    expect(stored().tasks[0].r).toBe(local(20))
    await back(); await tick(); expect(screen.getAllByText(/Appeler Paul/)).toHaveLength(1) // pas de doublon
    fireEvent.click(btn('Fermer les rappels')); expect(banner()).toBeNull()
    cleanup(); await reopen('#/4'); expect(banner()).toBeNull() // marque conservée : pas de second rappel
  })

  it('la zone annoncée aux lecteurs d’écran est toujours présente (vide sans rappel), pour que l’apparition d’un rappel soit annoncée', async () => {
    clock(); notif('none'); vis('visible')
    await mount('#/4', s => { s.consents.notif = true })
    const live = document.querySelector('div[role="status"][aria-live="polite"]') as HTMLElement; expect(live).toBeTruthy(); expect(live.textContent).toBe('')
    cleanup(); await mount('#/4', seed()); const l2 = document.querySelector('div[role="status"][aria-live="polite"]') as HTMLElement; expect(l2.textContent).toContain('Appeler Paul')
  })

  it('l’heure du rappel arrive pendant que l’application est ouverte : le contrôle de 30 s affiche la bannière (rien avant l’heure)', async () => {
    clock(); notif('none'); vis('visible'); const si = vi.spyOn(window, 'setInterval')
    await mount('#/4', s => { s.consents.notif = true; s.tasks = [task('t1', 'Appeler Paul', local(60))] }) // échéance 13:00, rappel à 12:30
    expect(banner()).toBeNull(); expect(stored().tasks[0].r).toBeUndefined()
    later(29); every30(si); expect(banner()).toBeNull(); expect(stored().tasks[0].r).toBeUndefined() // 12:29
    later(30); every30(si); expect(screen.getByText('Appeler Paul : échéance aujourd’hui à 13:00')).toBeTruthy(); expect(stored().tasks[0].r).toBe(local(60)) // 12:30
  })

  it('sans accord « Notifications » rien n’est rappelé ; tâche terminée, sans échéance ou échue depuis plus de 12 h : rien non plus ; échue depuis moins de 12 h : rappelée', async () => {
    clock(); const n = notif('granted'); vis('visible')
    await mount('#/4', s => { s.tasks = [task('t1', 'A', local(10))] })
    expect(banner()).toBeNull(); expect(n.made).toHaveLength(0); expect(stored().tasks[0].r).toBeUndefined()
    cleanup()
    await mount('#/4', s => { s.consents.notif = true; s.tasks = [task('t2', 'Finie', local(10), { done: true }), task('t3', 'Sans échéance', null), task('t4', 'Très en retard', local(-13 * 60)), task('t5', 'Un peu en retard', local(-11 * 60))] })
    const items = [...document.querySelectorAll('.rem li')].map(li => li.textContent); expect(items).toEqual(['Un peu en retard : échéance aujourd’hui à 01:00'])
    expect(stored().tasks.map((t: { id: string; r?: string }) => [t.id, t.r ?? null])).toEqual([['t2', null], ['t3', null], ['t4', null], ['t5', local(-11 * 60)]])
  })

  it('en arrière-plan avec l’autorisation du navigateur : notification du système (titre, échéance, étiquette, lien), marquée une fois affichée ; ni bannière ni doublon au retour', async () => {
    clock(); const n = notif('granted'); vis('hidden')
    await mount('#/4', seed()); await tick()
    expect(n.made).toHaveLength(1); expect(n.made[0].title).toBe('Appeler Paul'); expect(n.made[0].opt).toMatchObject({ body: 'Échéance aujourd’hui à 12:20', tag: 't1', data: { url: '/#/9' }, lang: 'fr' })
    expect(stored().tasks[0].r).toBe(local(20)); expect(banner()).toBeNull()
    vis('visible'); await back(); expect(n.made).toHaveLength(1); expect(banner()).toBeNull()
  })

  it('en arrière-plan sans autorisation (par défaut, refusée ou notifications absentes) : rien n’est marqué ni perdu, la bannière s’affiche au retour dans l’application', async () => {
    for (const perm of ['default', 'denied', 'none'] as const) {
      clock(); const n = notif(perm); vis('hidden')
      await mount('#/4', seed()); await tick()
      expect(n.made).toHaveLength(0); expect(stored().tasks[0].r).toBeUndefined(); expect(banner()).toBeNull()
      vis('visible'); await back(); expect(screen.getByText('Appeler Paul : échéance aujourd’hui à 12:20')).toBeTruthy(); expect(stored().tasks[0].r).toBe(local(20))
      cleanup(); vi.unstubAllGlobals(); vi.useRealTimers()
    }
  })

  it('notification acceptée à tort puis refusée par le navigateur (constructeur qui échoue) : le rappel n’est pas marqué, il apparaît dans l’application au retour', async () => {
    clock(); vis('hidden')
    class N { static permission: NotificationPermission = 'granted'; constructor() { throw new TypeError('Illegal constructor') } }
    vi.stubGlobal('Notification', N)
    await mount('#/4', seed()); await tick()
    expect(stored().tasks[0].r).toBeUndefined(); expect(banner()).toBeNull()
    vis('visible'); await back(); expect(screen.getByText(/Appeler Paul/)).toBeTruthy(); expect(stored().tasks[0].r).toBe(local(20))
  })

  it('un rappel en cours d’affichage n’est pas redemandé par un contrôle qui arrive entre-temps (une seule notification)', async () => {
    clock(); notif('granted'); vis('hidden')
    const shown: string[] = []; let release: (r: unknown) => void = () => {}
    const getRegistration = vi.fn(() => new Promise(res => { release = res }))
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration } })
    try {
      await mount('#/4', seed()); await tick()
      expect(getRegistration).toHaveBeenCalledTimes(1); expect(stored().tasks[0].r).toBeUndefined() // affichage en attente du service worker
      await back(); await back(); expect(getRegistration).toHaveBeenCalledTimes(1) // les contrôles suivants ne relancent pas le même rappel
      await act(async () => { release({ showNotification: async (title: string) => void shown.push(title) }) }); await tick()
      expect(shown).toEqual(['Appeler Paul']); expect(stored().tasks[0].r).toBe(local(20))
    } finally { Reflect.deleteProperty(navigator, 'serviceWorker') }
  })

  it('changer le délai du rappel agit aussitôt (sans attendre le contrôle suivant) ; l’autorisation modifiée dans le navigateur est reprise au retour sur la page', async () => {
    clock(); const n = notif('default'); vis('visible')
    await mount('#/9', s => { s.consents.notif = true; s.tasks = [task('t1', 'Appeler Paul', local(100))] }) // échéance 13:40
    expect(banner()).toBeNull(); expect(screen.getByText('Notifications du système : pas encore autorisées.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Prévenir'), { target: { value: '120' } }); expect(screen.getByText('Appeler Paul : échéance aujourd’hui à 13:40')).toBeTruthy()
    n.st.ask = 'granted'; ;(globalThis.Notification as unknown as { permission: string }).permission = 'granted'
    act(() => { window.dispatchEvent(new Event('focus')) }); expect(screen.getByText('Notifications du système : autorisées.')).toBeTruthy()
  })

  it('le détecteur contrôle aussi tout seul au retour au premier plan, sans dépendre d’un changement d’état de l’application', async () => {
    clock(); notif('none'); vis('hidden')
    const S = DEF(); S.consents.notif = true; S.tasks = [task('t1', 'Appeler Paul', local(60))]
    const Probe = () => { const r = useReminders(S, () => true, false); return <RemindBanner items={r.items} discret={false} onClose={r.clear} /> }
    render(<Probe />); expect(banner()).toBeNull()
    later(40); vis('visible'); act(() => { document.dispatchEvent(new Event('visibilitychange')) }); expect(screen.getByText('Appeler Paul : échéance aujourd’hui à 13:00')).toBeTruthy()
  })

  it('mode discret : ni la notification du système ni la bannière ne montrent le titre de la tâche', async () => {
    clock(); const n = notif('granted'); vis('hidden')
    await mount('#/4', seed(s => { s.discret = true })); await tick()
    expect(n.made).toHaveLength(1); expect(n.made[0].title).toBe('Believe : rappel'); expect(n.made[0].opt.body).toBe('Une tâche arrive à échéance.'); expect(JSON.stringify(n.made)).not.toContain('Paul')
    cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); clock(); notif('none'); vis('visible')
    await mount('#/4', seed(s => { s.discret = true })); expect(screen.getByText('Une tâche arrive à échéance : échéance aujourd’hui à 12:20')).toBeTruthy(); expect(document.body.textContent).not.toContain('Appeler Paul')
  })

  it('sous l’écran du PIN : notification neutre (sans titre), aucune bannière après le déverrouillage', async () => {
    clock(); withCrypto(); const n = notif('granted'); vis('visible')
    await mount('#/4', seed(), async () => { await (await import('./pin')).setPin('4821', 1, 1000) }); await tick()
    expect(screen.getByRole('dialog', { name: 'Saisissez votre PIN' })).toBeTruthy(); expect(n.made).toHaveLength(1); expect(n.made[0].title).toBe('Believe : rappel'); expect(JSON.stringify(n.made)).not.toContain('Paul'); expect(document.body.textContent).not.toContain('Appeler Paul')
    for (const c of '4821') fireEvent.click(btn(c))
    expect(await screen.findByText('Bienvenue')).toBeTruthy(); expect(banner()).toBeNull(); expect(n.made).toHaveLength(1)
  })

  it('« Désactiver les rappels » retire la bannière et l’accord ; plus aucun rappel ensuite', async () => {
    clock(); notif('none'); vis('visible')
    await mount('#/9', seed()); expect(screen.getByText('Rappel de tâche')).toBeTruthy()
    fireEvent.click(btn('Désactiver les rappels')); expect(banner()).toBeNull(); expect(stored().consents.notif).toBe(false); expect(screen.getByText(/Rappels désactivés\. Pour retirer aussi l’autorisation du navigateur/)).toBeTruthy(); expect(btn('Activer les rappels')).toBeTruthy()
    await back(); expect(banner()).toBeNull()
  })

  it('carte « Rappels » : l’accord et l’autorisation du navigateur sont demandés au clic ; autorisation donnée, délai réglable', async () => {
    clock(); const n = notif('default', 'granted'); vis('visible')
    await mount('#/9')
    expect(screen.getByText(/un rappel n’est donné que pendant que Believe est ouvert/)).toBeTruthy(); expect(screen.getByText(/Application fermée, rien ne sonne/)).toBeTruthy(); expect(n.req).not.toHaveBeenCalled(); expect(stored().consents.notif).toBe(false)
    await act(async () => { fireEvent.click(btn('Activer les rappels')) }); await tick()
    expect(n.req).toHaveBeenCalledTimes(1); expect(stored().consents.notif).toBe(true); expect(screen.getByText('Rappels activés. Les notifications du système sont autorisées.')).toBeTruthy(); expect(screen.getByText('Notifications du système : autorisées.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Autoriser les notifications du système' })).toBeNull(); expect((screen.getByLabelText('Prévenir') as HTMLSelectElement).value).toBe('30')
    expect([...(screen.getByLabelText('Prévenir') as HTMLSelectElement).options].map(o => o.text)).toEqual(['À l’heure de l’échéance', '10 minutes avant', '30 minutes avant', '1 heure avant', '2 heures avant'])
    fireEvent.change(screen.getByLabelText('Prévenir'), { target: { value: '60' } }); expect(stored().settings.remind).toBe(60); expect(screen.getByText('Rappel réglé : 1 heure avant.')).toBeTruthy()
  })

  it('carte « Rappels » : navigateur qui refuse, qui ne répond pas, déjà refusé ou sans notifications — les rappels restent actifs dans l’application, jamais bloqués', async () => {
    clock(); vis('visible')
    let n = notif('default', 'denied'); await mount('#/9')
    await act(async () => { fireEvent.click(btn('Activer les rappels')) }); await tick()
    expect(stored().consents.notif).toBe(true); expect(screen.getByText('Rappels activés dans l’application. Le navigateur a refusé les notifications du système : les rappels s’afficheront dans Believe.')).toBeTruthy(); expect(screen.getByText(/refusées dans le navigateur \(réglages du site pour les autoriser\)/)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Autoriser les notifications du système' })).toBeNull()
    cleanup(); vi.unstubAllGlobals(); n = notif('default', 'default'); await mount('#/9')
    await act(async () => { fireEvent.click(btn('Activer les rappels')) }); await tick()
    expect(screen.getByText(/Les notifications du système ne sont pas encore autorisées : vous pouvez le faire avec le bouton ci-dessous\./)).toBeTruthy(); n.st.ask = 'granted'
    await act(async () => { fireEvent.click(btn('Autoriser les notifications du système')) }); await tick()
    expect(n.req).toHaveBeenCalledTimes(2); expect(screen.getByText('Notifications du système autorisées.')).toBeTruthy(); expect(screen.getByText('Notifications du système : autorisées.')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Autoriser les notifications du système' })).toBeNull()
    cleanup(); vi.unstubAllGlobals(); n = notif('denied'); await mount('#/9')
    await act(async () => { fireEvent.click(btn('Activer les rappels')) }); await tick(); expect(n.req).not.toHaveBeenCalled(); expect(stored().consents.notif).toBe(true) // déjà refusé : on ne redemande pas
    cleanup(); vi.unstubAllGlobals(); notif('none'); await mount('#/9')
    await act(async () => { fireEvent.click(btn('Activer les rappels')) }); await tick()
    expect(stored().consents.notif).toBe(true); expect(screen.getByText('Rappels activés dans l’application. Les notifications du système ne sont pas disponibles ici : les rappels s’afficheront dans Believe.')).toBeTruthy(); expect(screen.getByText(/indisponibles ici \(sur iPhone, ajoutez d’abord Believe à l’écran d’accueil\)/)).toBeTruthy()
  })

  it('« Tester une notification » : envoyée si le navigateur l’autorise, sinon un message clair', async () => {
    clock(); vis('visible'); const n = notif('granted')
    await mount('#/9', s => { s.consents.notif = true })
    await act(async () => { fireEvent.click(btn('Tester une notification')) }); await tick()
    expect(n.made).toHaveLength(1); expect(n.made[0].title).toBe('Believe : test'); expect(n.made[0].opt.body).toBe('Les rappels de tâches fonctionnent.'); expect(screen.getByText(/Notification de test envoyée\. Si vous ne la voyez pas, vérifiez les réglages de notification de l’appareil\./)).toBeTruthy()
    cleanup(); vi.unstubAllGlobals(); const m = notif('default')
    await mount('#/9', s => { s.consents.notif = true })
    await act(async () => { fireEvent.click(btn('Tester une notification')) }); await tick()
    expect(m.made).toHaveLength(0); const msg = screen.getByText(/Aucune notification du système possible pour l’instant/); expect(msg.className).toBe('ko')
  })

  it('tâche créée dans son délai de rappel : elle ne sonne pas aussitôt ; une échéance lointaine annonce « rappel prévu » puis « rappel donné » ; rien d’annoncé si les rappels sont désactivés', async () => {
    clock(); notif('none'); vis('visible'); const si = vi.spyOn(window, 'setInterval')
    await mount('#/9', s => { s.consents.notif = true })
    type('Intitulé', 'Rendez-vous'); type('Échéance (facultative)', local(10)); fireEvent.click(btn('Ajouter'))
    expect(stored().tasks[0].r).toBe(local(10)); expect(banner()).toBeNull(); expect(screen.getByText(/rappel donné/)).toBeTruthy(); expect(screen.queryByText(/rappel prévu/)).toBeNull()
    type('Intitulé', 'Réunion'); type('Échéance (facultative)', local(180)); fireEvent.click(btn('Ajouter'))
    expect(stored().tasks.find((t: { t: string }) => t.t === 'Réunion').r).toBeUndefined(); expect(screen.getByText(/rappel prévu aujourd’hui à 14:30/)).toBeTruthy()
    later(150); every30(si); expect(screen.getByText('Réunion : échéance aujourd’hui à 15:00')).toBeTruthy(); expect(screen.getAllByText(/rappel donné/)).toHaveLength(2); expect(screen.queryByText(/rappel prévu/)).toBeNull()
    fireEvent.click(btn('Désactiver les rappels')); expect(screen.queryByText(/rappel donné|rappel prévu/)).toBeNull()
  })

  it('l’accord « Notifications » de la rubrique 5 décrit le fonctionnement réel et reste retirable', async () => {
    clock(); notif('none'); vis('visible')
    await mount('#/2/confidentialite', s => { s.consents.notif = true })
    expect(screen.getByText(/Rappels de tâches avant leur échéance, pendant que l’application est ouverte : dans l’application, et par notification du système si le navigateur l’autorise\. Rien n’est envoyé à un serveur, sauf si vous activez en plus les « Rappels application fermée » \(rubrique 9, avec le compte en ligne\) : retirer cet accord les désactive et supprime les rappels déposés\./)).toBeTruthy()
    fireEvent.click(btn('Retirer Notifications')); expect(stored().consents.notif).toBe(false)
  })

  it('la politique de confidentialité décrit les rappels : calcul sur l’appareil, sans serveur de notifications, texte neutre en mode discret ou sous le PIN, rien envoyé', async () => {
    await mount('#/legal')
    const row = screen.getByText('Rappels de tâches (si vous les activez)').closest('tr')!
    expect(row.textContent).toContain('sans serveur de notifications'); expect(row.textContent).toContain('texte neutre en mode discret ou sous l’écran du PIN'); expect(row.cells[2].textContent).toBe('Non')
  })
})
