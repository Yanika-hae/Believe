import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { VF, VM } from './verses'
import { btn, iso, mount, reopen, stored, tick, type, withCrypto } from './testkit'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

const today = () => iso(new Date())
const first = (s: { ui: { onboard: boolean; verseDay: string | null } }) => { s.ui.onboard = false; s.ui.verseDay = null }
const h1 = () => screen.getByRole('heading', { level: 1 }).textContent
const win = () => screen.queryByRole('dialog', { name: 'Verset du jour' })
const fill = () => {
  fireEvent.click(screen.getByRole('radio', { name: 'Femme' })); type('Prénom', 'Ada'); type('Âge', '30'); type('Taille (cm)', '170'); type('Poids de départ (kg)', '71'); type('Poids actuel (kg)', '65'); type('Poids cible (kg)', '60')
  fireEvent.change(screen.getByLabelText('Sexe utilisé dans les formules de santé'), { target: { value: 'F' } })
}

describe('Rubriques 1 et 2 : accueil guidé du premier lancement', () => {
  it('trois étapes : bienvenue et données, profil, premier verset ; le titre de chaque étape reçoit le focus, rien n’est enregistré avant la fin', async () => {
    await mount('#/4', first)
    expect(h1()).toBe('Bienvenue dans Believe'); expect(document.activeElement?.id).toBe('onb-t'); expect(screen.getByText('Étape 1 sur 3')).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull(); expect(screen.queryByRole('link', { name: /Actions rapides|IA/ })).toBeNull() // pas de navigation tant que l’accueil guidé n’est pas fini
    expect(screen.getByText(/Tout est enregistré sur cet appareil, sans compte/)).toBeTruthy(); expect(screen.getByText(/ne sont demandés qu’au moment où vous utilisez la fonction/)).toBeTruthy()
    expect(stored().ui.onboard).toBe(false); expect(win()).toBeNull()
    fireEvent.click(btn('Commencer')); expect(h1()).toBe('Faisons connaissance'); expect(document.activeElement?.id).toBe('onb-t'); expect(screen.getByText('Étape 2 sur 3')).toBeTruthy()
    fireEvent.click(btn('Enregistrer et continuer')); expect(screen.getByText('Choisissez Femme ou Homme.')).toBeTruthy(); expect(h1()).toBe('Faisons connaissance'); expect(stored().profile).toBeNull()
    fill(); type('Poids cible (kg)', '40'); fireEvent.click(btn('Enregistrer et continuer')); expect(screen.getByText(/Objectif refusé/)).toBeTruthy(); expect(h1()).toBe('Faisons connaissance'); expect(stored().profile).toBeNull() // les contrôles du profil s’appliquent aussi ici
    type('Poids cible (kg)', '60'); fireEvent.click(btn('Enregistrer et continuer'))
    expect(h1()).toBe('Ada, tout est prêt'); expect(screen.getByText('Étape 3 sur 3')).toBeTruthy(); expect(screen.getByText(/Vous êtes prête : voici votre premier verset du jour/)).toBeTruthy()
    expect(stored().profile).toMatchObject({ name: 'Ada', g: 'F', w: 65, t: 60, ws: 71 }); expect(stored().ui.onboard).toBe(false) // profil gardé, accueil guidé pas encore terminé
    fireEvent.click(btn('Voir mon verset du jour'))
    expect(stored().ui.onboard).toBe(true); expect(screen.getByText('Bonjour Ada')).toBeTruthy(); expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeTruthy()
    const d = win()!; expect(d).toBeTruthy(); expect(VF.some(v => within(d).queryByText('« ' + v[1] + ' »'))).toBe(true) // le premier verset est celui du profil
    fireEvent.click(within(d).getByRole('button', { name: 'Continuer' })); expect(win()).toBeNull(); expect(stored().ui.verseDay).toBe(today())
  })

  it('profil Homme : accord masculin et verset de la liste Homme', async () => {
    await mount('#/4', first)
    fireEvent.click(btn('Commencer')); fireEvent.click(screen.getByRole('radio', { name: 'Homme' })); type('Prénom', 'Léo'); type('Âge', '30'); type('Taille (cm)', '180'); type('Poids de départ (kg)', '85'); type('Poids actuel (kg)', '80'); type('Poids cible (kg)', '75')
    fireEvent.change(screen.getByLabelText('Sexe utilisé dans les formules de santé'), { target: { value: 'M' } }); fireEvent.click(btn('Enregistrer et continuer'))
    expect(screen.getByText(/Vous êtes prêt : voici/)).toBeTruthy(); fireEvent.click(btn('Voir mon verset du jour'))
    expect(screen.getByText('Prêt pour aujourd’hui ?')).toBeTruthy(); expect(VM.some(v => within(win()!).queryByText('« ' + v[1] + ' »'))).toBe(true)
  })

  it('« Passer pour l’instant » à chaque étape : aucun profil enregistré, l’application s’ouvre et le verset du jour s’affiche', async () => {
    await mount('#/4', first)
    fireEvent.click(btn('Passer pour l’instant')); expect(stored().ui.onboard).toBe(true); expect(stored().profile).toBeNull()
    expect(screen.getByText('Bienvenue')).toBeTruthy(); expect(screen.getByText('Renseignez votre profil pour recevoir des versets adaptés.')).toBeTruthy()
    expect([...VF, ...VM].some(v => within(win()!).queryByText('« ' + v[1] + ' »'))).toBe(true) // sans profil : liste complète
    cleanup(); await mount('#/4', first); fireEvent.click(btn('Commencer')); type('Prénom', 'Ada') // saisie non enregistrée
    fireEvent.click(btn('Passer pour l’instant')); expect(stored().profile).toBeNull(); expect(stored().ui.onboard).toBe(true); expect(win()).toBeTruthy()
    cleanup(); await mount('#/4', first); fireEvent.click(btn('Commencer')); fill(); fireEvent.click(btn('Enregistrer et continuer')); expect(h1()).toBe('Ada, tout est prêt')
    expect(btn('Retour')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Passer pour l’instant' })).toBeNull() // à la dernière étape, le bouton principal suffit
  })

  it('« Retour » revient à l’étape précédente ; le profil déjà enregistré préremplit le formulaire', async () => {
    await mount('#/4', first)
    fireEvent.click(btn('Commencer')); fireEvent.click(btn('Retour')); expect(h1()).toBe('Bienvenue dans Believe')
    fireEvent.click(btn('Commencer')); fill(); fireEvent.click(btn('Enregistrer et continuer')); expect(h1()).toBe('Ada, tout est prêt')
    fireEvent.click(btn('Retour')); expect(h1()).toBe('Faisons connaissance'); expect((screen.getByLabelText('Prénom') as HTMLInputElement).value).toBe('Ada'); expect((screen.getByRole('radio', { name: 'Femme' }) as HTMLInputElement).checked).toBe(true)
  })

  it('fermer l’application en cours de route : sans profil enregistré, l’accueil guidé reprend à la première étape ; avec un profil enregistré, l’application s’ouvre directement, verset du jour compris', async () => {
    await mount('#/4', first); fireEvent.click(btn('Commencer')); type('Prénom', 'Ada') // saisie jamais enregistrée
    cleanup(); await reopen('#/4'); expect(h1()).toBe('Bienvenue dans Believe'); expect(screen.getByText('Étape 1 sur 3')).toBeTruthy(); expect(stored().ui.onboard).toBe(false)
    fireEvent.click(btn('Commencer')); expect((screen.getByLabelText('Prénom') as HTMLInputElement).value).toBe(''); fill(); fireEvent.click(btn('Enregistrer et continuer')) // profil enregistré, puis l’application est fermée à l’étape 3
    cleanup(); await reopen('#/4'); expect(screen.getByText('Bonjour Ada')).toBeTruthy(); expect(screen.queryByText('Étape 1 sur 3')).toBeNull(); expect(stored().ui.onboard).toBe(true)
    expect(win()).toBeTruthy(); fireEvent.click(within(win()!).getByRole('button', { name: 'Continuer' })) // un profil existe : il n’y a rien à refaire, et le verset du jour n’est pas perdu
    cleanup(); await reopen('#/4'); expect(screen.getByText('Bonjour Ada')).toBeTruthy(); expect(win()).toBeNull()
  })

  it('un utilisateur existant ne revoit jamais l’accueil guidé (état déjà marqué) ; les liens de la page ne le contournent pas', async () => {
    await mount('#/6'); expect(screen.queryByText('Étape 1 sur 3')).toBeNull(); expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeTruthy()
    cleanup(); await mount('#/6', first); expect(h1()).toBe('Bienvenue dans Believe'); expect(location.hash).toBe('#/6') // même une adresse profonde passe d’abord par l’accueil guidé
  })

  it('PIN oublié = tout effacer : l’accueil guidé revient au lancement suivant, mais pas dans la foulée de l’effacement', async () => {
    withCrypto()
    await mount('#/4', s => { s.profile = { g: 'F', name: 'Ada', age: 30, h: 170, w: 65, t: 60, ws: 71, lv: 'I', sx: 'F' } }, async () => { await (await import('./pin')).setPin('4821', 1, 1000) })
    fireEvent.click(btn('PIN oublié ?')); fireEvent.click(btn('Effacer et réinitialiser'))
    expect(await screen.findByText('Bienvenue')).toBeTruthy(); expect(screen.queryByText('Étape 1 sur 3')).toBeNull(); expect(win()).toBeNull() // pas d’accueil guidé ni de verset juste après l’effacement
    cleanup(); await tick(10); expect(localStorage.getItem('believe:v2')).toBeNull() // plus aucune donnée
    await reopen('#/4'); expect(h1()).toBe('Bienvenue dans Believe'); expect(screen.getByText('Étape 1 sur 3')).toBeTruthy()
  })
})
