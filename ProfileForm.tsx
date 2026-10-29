import { useState } from 'react'
import type { Lv } from './lib'
import { bmi } from './health'
import { num } from './ui'
import type { Msg, P, Upd } from './ui'

/** Formulaire de profil (rubrique 1 et accueil guidé) : validations, objectif dangereux refusé, enregistrement après confirmation. */
/** `onDone` n'est appelé qu'une fois l'enregistrement confirmé ; `cta` : texte du bouton (« Enregistrer » par défaut). */
export function ProfileForm({ S, upd, setM, onDone, cta = 'Enregistrer' }: { S: P['S']; upd: Upd; setM: (m: Msg) => void; onDone?: () => void; cta?: string }) {
  const p = S.profile
  const [f, setF] = useState<Record<string, string>>({ g: p?.g ?? '', name: p?.name ?? '', age: String(p?.age ?? ''), h: String(p?.h ?? ''), ws: String(p?.ws ?? ''), w: String(p?.w ?? ''), t: String(p?.t ?? ''), lv: p?.lv ?? 'S', sx: p?.sx ?? '' })
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const fi = (k: string, l: string, mode: 'numeric' | 'decimal' | 'text' = 'decimal', sens = false) => (
    <div><label htmlFor={'f' + k}>{l}</label><input id={'f' + k} className={sens ? 'sens' : ''} inputMode={mode} maxLength={40} value={f[k]} onChange={set(k)} /></div>
  )
  const submit = () => {
    const age = num(f.age), h = num(f.h), w = num(f.w), t = num(f.t), ws = num(f.ws)
    const bad = !f.g ? 'Choisissez Femme ou Homme.' : !f.name.trim() ? 'Saisissez votre prénom.'
      : !(age >= 10 && age <= 110) ? 'Âge : de 10 à 110 ans.' : !(h >= 120 && h <= 230) ? 'Taille : de 120 à 230 cm.'
      : !(w >= 30 && w <= 250 && t >= 30 && t <= 250) ? 'Poids : de 30 à 250 kg.' : !f.sx ? 'Choisissez le sexe utilisé dans les formules de santé.'
      : bmi(t, h) < 18.5 ? 'Objectif refusé : ce poids cible correspond à un IMC inférieur à 18,5, jugé dangereux. Choisissez une cible plus haute ou parlez-en à un professionnel de santé.' : ''
    if (bad) return setM({ e: 1, t: bad })
    if (upd(s => { s.profile = { g: f.g as 'F' | 'M', name: f.name.trim().slice(0, 40), age, h, w, t, ws: ws >= 30 ? ws : w, lv: f.lv as Lv, sx: f.sx as 'F' | 'M' } }, 'Profil enregistré.')) onDone?.()
  }
  return (
    <div className="card">
      <label>Profil affiché</label>
      <div className="row">
        <label className="rd"><input type="radio" name="g" value="F" checked={f.g === 'F'} onChange={set('g')} /> Femme</label>
        <label className="rd"><input type="radio" name="g" value="M" checked={f.g === 'M'} onChange={set('g')} /> Homme</label>
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        {fi('name', 'Prénom', 'text')}{fi('age', 'Âge', 'numeric')}{fi('h', 'Taille (cm)')}{fi('ws', 'Poids de départ (kg)', 'decimal', true)}{fi('w', 'Poids actuel (kg)', 'decimal', true)}{fi('t', 'Poids cible (kg)', 'decimal', true)}
        <div><label htmlFor="flv">Niveau sportif</label>
          <select id="flv" value={f.lv} onChange={set('lv')}><option value="S">Sédentaire</option><option value="I">Intermédiaire</option><option value="A">{f.g === 'F' ? 'Active' : f.g === 'M' ? 'Actif' : 'Actif(ve)'}</option></select></div>
        <div><label htmlFor="fsx">Sexe utilisé dans les formules de santé</label>
          <select id="fsx" value={f.sx} onChange={set('sx')}><option value="">Choisir</option><option value="F">Femme</option><option value="M">Homme</option></select></div>
      </div>
      <p style={{ margin: '14px 0 0' }}><button className="btn" onClick={submit}>{cta}</button></p>
    </div>
  )
}
