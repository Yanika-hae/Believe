import { today } from './lib'
import type { P } from './ui'
import { BADGES, earnedBadges } from './badges'
import { bilanOf } from './bilan'
import { DN } from './util'

const D = (d: string) => new Date(d + 'T00:00:00')
const short = (d: string) => { const x = D(d); return isNaN(+x) ? d : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) }
const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
const pl = (n: number, a: string, b: string) => n + ' ' + (n > 1 ? b : a)

/** Badges avec leur critère écrit en toutes lettres : obtenus, puis à obtenir. Chacun est calculé à partir des données de l'appareil. */
export function BadgeList({ S }: Pick<P, 'S'>) {
  const got = new Set(earnedBadges(S).map(b => b.id))
  return (
    <div className="card">
      <h2>Mes badges</h2>
      <p className="mut" style={{ marginTop: 0 }}>{got.size} badge{got.size > 1 ? 's' : ''} sur {BADGES.length}. Chaque badge se calcule sur vos données réelles ; aucun ne dépend de votre poids, de votre cycle, de vos repas, de vos prières ou de vos notes.</p>
      <ul className="badges" aria-label="Badges">
        {BADGES.map(b => (
          <li key={b.id} className={got.has(b.id) ? 'got' : 'todo'}>
            <b>{b.t}</b> <span className={got.has(b.id) ? 'ok' : 'mut'}>{got.has(b.id) ? '✓ Obtenu' : 'À obtenir'}</span><br />
            <small className="mut">{b.d}</small>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Bilan hebdomadaire : semaine en cours (lundi à aujourd'hui), comparaison à la dernière semaine archivée, badges. Tout est calculé sur l'appareil. */
export default function Bilan({ S }: P) {
  const day = today(), b = bilanOf(S, day)
  const delta = b.prev ? b.rate - b.prev.rate : null
  return (
    <>
      <div className="card">
        <h2>Bilan de la semaine</h2>
        <p className="mut" style={{ marginTop: 0 }}>Du {short(b.start)} au {short(b.end)} : {pl(b.elapsed, 'jour écoulé', 'jours écoulés')} sur 7, aujourd’hui compris.</p>
        {S.habits.length
          ? <>
            <p style={{ fontSize: '1.15rem' }}><b>{b.rate} %</b> de réussite des habitudes
              {b.prev ? <> · semaine archivée précédente ({b.prev.week}) : {b.prev.rate} %, soit {delta === 0 ? 'le même niveau' : (delta! > 0 ? '+' : '−') + Math.abs(delta!) + ' points'}.</> : <> · pas encore de semaine archivée à comparer.</>}</p>
            <div className="bars" role="img" aria-label={'Part d’habitudes validées par jour : ' + b.days.map((d, i) => DN[i] + (d.future ? ' à venir' : ' ' + d.pct + ' %')).join(', ')}>
              {b.days.map((d, i) => <div key={d.d}><i style={{ height: d.pct * 0.7, opacity: d.future ? 0.25 : 1 }} />{DN[i]}</div>)}
            </div>
            {b.top && <p className="mut"><small>Habitude la plus régulière cette semaine : « {b.top.n} » ({pl(b.top.c, 'jour', 'jours')} sur {b.elapsed}).</small></p>}
          </>
          : <p>Aucune habitude pour le moment : ajoutez-en dans la rubrique 6.</p>}
        <ul className="sum" aria-label="Autres chiffres de la semaine" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li>10 000 pas atteints : {pl(b.steps10k, 'jour', 'jours')}</li>
          <li>Académie : {pl(b.quizzes, 'quiz terminé', 'quiz terminés')}, exercices faits {pl(b.exoDays, 'jour', 'jours')}, {pl(b.improvs, 'improvisation', 'improvisations')}</li>
          <li>Lecture : {pl(b.pages, 'page lue', 'pages lues')}</li>
          {b.weight !== null && <li className="sens">Poids : {b.weight > 0 ? '+' : b.weight < 0 ? '−' : ''}{fr(Math.abs(b.weight))} kg depuis la dernière pesée d’avant la semaine</li>}
        </ul>
        <p className="mut"><small>Rien de ce bilan n’est partagé sans votre choix : vous cochez, élément par élément, ce que vos amis peuvent voir.</small></p>
        <a className="btn alt" href="#/5/partage">Choisir ce que mes amis voient</a>
      </div>
      <div className="card">
        <h2>Semaines archivées</h2>
        {S.archives.length
          ? <ul className="hist" aria-label="Semaines archivées">{S.archives.slice(0, 8).map(a => <li key={a.start}><b>{a.week}</b> <span className="mut"><small>(du {short(a.start)})</small></span> : {a.rate} % <progress value={a.rate} max={100} aria-label={'Réussite de la semaine ' + a.week} style={{ verticalAlign: 'middle', marginLeft: 6 }} /></li>)}</ul>
          : <p className="mut" style={{ margin: 0 }}>Une semaine est archivée automatiquement le lundi suivant. Elle apparaîtra ici.</p>}
      </div>
      <BadgeList S={S} />
    </>
  )
}
