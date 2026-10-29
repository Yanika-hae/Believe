import { bmi, bmr } from './health'
import { Flash } from './ui'
import type { P } from './ui'
import { BadgeList } from './BilanPage'
import { ProfileForm } from './ProfileForm'

export default function ProfilePage({ S, upd, m, setM }: P) {
  const p = S.profile
  const est = p && (() => {
    const b = bmr(p), imc = bmi(p.w, p.h).toFixed(1)
    return <div className="card"><h2>Estimations</h2><p className="sens">IMC actuel : {imc}. Métabolisme de base : environ {b} kcal par jour.</p><p className="mut">Calculs par formule (Mifflin-St Jeor, sexe « {p.sx === 'M' ? 'Homme' : 'Femme'} » choisi ci-dessus), pas des mesures. Ils ne remplacent pas un avis médical.</p></div>
  })()
  return (
    <>
      <h1>Identité et profil</h1>
      <Flash m={m} />
      <ProfileForm S={S} upd={upd} setM={setM} />
      {est}
      <BadgeList S={S} />
    </>
  )
}
