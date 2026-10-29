import type { State } from './lib'
import type { P } from './ui'

const THEMES: [State['settings']['theme'], string][] = [['auto', 'Suivre le système'], ['light', 'Clair'], ['dark', 'Sombre'], ['oled', 'Noir OLED']]

/** Affichage (thème, animations, vibration, sons) et installation sur le téléphone : premier onglet des Paramètres. */
export function Display({ S, upd, inst }: P & { inst: (() => void) | null }) {
  return (
    <>
      <div className="card"><h2>Affichage</h2>
        <div role="radiogroup" aria-label="Thème">{THEMES.map(([k, t]) => <label className="rd" key={k}><input type="radio" name="theme" checked={S.settings.theme === k} onChange={() => upd(s => { s.settings.theme = k })} /> {t}</label>)}</div>
        <label className="rd" style={{ marginTop: 10 }}><input type="checkbox" checked={S.settings.motion === 'reduced'} onChange={e => upd(s => { s.settings.motion = e.target.checked ? 'reduced' : 'auto' })} /> Réduire les animations</label>
        <label className="rd"><input type="checkbox" checked={S.settings.haptics} onChange={e => upd(s => { s.settings.haptics = e.target.checked })} /> Retour haptique (vibration légère sur Android)</label>
        <label className="rd"><input type="checkbox" checked={S.settings.sounds} onChange={e => upd(s => { s.settings.sounds = e.target.checked })} /> Sons (métronome, fin de minuteur)</label>
        <p className="mut">La vibration n’est pas disponible sur iPhone. Si votre système demande moins d’animations, Believe le respecte sans réglage.</p></div>
      <div className="card"><h2>Installer sur le téléphone</h2>
        <p className="mut">Android (Chrome) : menu ⋮, puis « Installer l’application ». iPhone et iPad (Safari) : Partager, puis « Sur l’écran d’accueil ».</p>
        {inst && <button className="btn" onClick={inst}>Installer maintenant</button>}</div>
    </>
  )
}
