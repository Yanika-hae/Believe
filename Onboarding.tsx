import { useEffect, useState } from 'react'
import type { State } from './lib'
import { Flash } from './ui'
import type { Msg, Upd } from './ui'
import Logo from './Logo'
import { ProfileForm } from './ProfileForm'

const TITLES = ['Bienvenue dans Believe', 'Faisons connaissance', 'Tout est prêt']

/**
 * Accueil guidé du premier lancement, en trois étapes : bienvenue et usage des données, profil, premier verset.
 * Rien n'est obligatoire : « Passer pour l'instant » reste proposé jusqu'à la dernière étape. L'accueil n'est marqué terminé (`onFinish`)
 * qu'à la fin ou au saut ; le profil, lui, n'est enregistré qu'au clic sur « Enregistrer et continuer » et seulement s'il est valide.
 */
export default function Onboarding({ S, upd, onFinish }: { S: State; upd: Upd; onFinish: () => void }) {
  const [st, setSt] = useState(0), [m, setM] = useState<Msg>(null), p = S.profile
  const go = (n: number) => { setM(null); setSt(n) }
  useEffect(() => { document.getElementById('onb-t')?.focus() }, [st]) // le lecteur d'écran annonce le titre de chaque étape
  const skip = <button className="btn alt" onClick={onFinish}>Passer pour l’instant</button>
  return (
    <div className="onb">
      <div className="oh">
        <Logo size={72} />
        <span className="wm">BELIEVE</span>
        <p className="mut" style={{ margin: '14px 0 4px' }}>Étape {st + 1} sur 3</p>
        <div className="onb-dots" aria-hidden="true">{TITLES.map((t, i) => <i key={t} className={i <= st ? 'on' : ''} />)}</div>
      </div>
      <h1 id="onb-t" tabIndex={-1}>{st === 2 && p ? p.name + ', tout est prêt' : TITLES[st]}</h1>
      {st === 0 && (
        <>
          <p>Un espace doux pour avancer chaque jour : foi, habitudes, sport, santé, travail et créativité, au même endroit.</p>
          <div className="card">
            <h2>Vos données restent chez vous</h2>
            <ul>
              <li>Tout est enregistré sur cet appareil, sans compte.</li>
              <li>Rien n’est envoyé sans votre accord : l’IA, la photo d’un plat et le partage avec des amis demandent chacun le vôtre, retirable à tout moment dans les Paramètres.</li>
              <li>Le micro, le mouvement et les notifications ne sont demandés qu’au moment où vous utilisez la fonction ; un refus ne bloque pas le reste.</li>
            </ul>
          </div>
          <div className="row"><button className="btn" onClick={() => go(1)}>Commencer</button>{skip}</div>
        </>
      )}
      {st === 1 && (
        <>
          <p>Votre profil adapte les versets et les accords (Prêt ou Prête), et sert aux repères de santé. Tout reste modifiable dans la rubrique 1.</p>
          <Flash m={m} />
          <ProfileForm S={S} upd={upd} setM={setM} onDone={() => go(2)} cta="Enregistrer et continuer" />
          <div className="row"><button className="btn alt" onClick={() => go(0)}>Retour</button>{skip}</div>
        </>
      )}
      {st === 2 && (
        <>
          <p>{p ? 'Vous êtes prêt' + (p.g === 'F' ? 'e' : '') + ' : voici votre premier verset du jour, puis votre accueil.' : 'Voici votre premier verset du jour, puis votre accueil. Vous pourrez renseigner votre profil quand vous voudrez (rubrique 1).'}</p>
          <div className="card">
            <h2>Pour bien commencer</h2>
            <ul>
              <li>Le bouton + en bas de l’écran ouvre les actions rapides.</li>
              <li>Balayez l’écran vers la gauche ou la droite pour passer d’une section à l’autre ; les boutons de navigation restent toujours visibles.</li>
              <li>L’icône en forme d’œil, en haut, floute vos informations sensibles.</li>
              <li>Les Paramètres (l’engrenage en haut de l’écran) réunissent l’affichage, les accords, le code PIN, le compte en ligne, l’export et la suppression de vos données.</li>
            </ul>
          </div>
          <div className="row"><button className="btn" onClick={onFinish}>Voir mon verset du jour</button><button className="btn alt" onClick={() => go(1)}>Retour</button></div>
        </>
      )}
    </div>
  )
}
