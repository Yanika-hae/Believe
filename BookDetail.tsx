import { useState } from 'react'
import { bookLinks, readAloud } from './books'
import type { Book, Lang } from './books'
import { addBook, fromCatalog, inList, whyNot } from './reading'
import { canSay } from './ui'
import type { P } from './ui'
import { Ext, LNAME, useTalk } from './BookParts'

/** Fiche d'un livre du catalogue intégré : résumé original, citation vérifiée (domaine public), liens légaux, lecture vocale. */
export default function Detail({ b, S, upd, onClose }: { b: Book; S: P['S']; upd: P['upd']; onClose: () => void }) {
  const talk = useTalk(), [msg, setMsg] = useState<{ e?: 1; t: string } | null>(null)
  const mb = fromCatalog(b), have = inList(S, mb.id), links = bookLinks(b)
  const add = () => {
    const why = whyNot(S, mb)
    if (why) return setMsg({ e: 1, t: why })
    if (upd(s => { addBook(s, mb) }, undefined, true)) setMsg({ t: 'Ajouté à Mes livres : retrouvez-le dans l’onglet « Mes livres » et dans le marque-page des habitudes.' })
  }
  const speak = (l: Lang) => { const r = readAloud(b, l); talk.start(r.text, r.tag) }
  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 2 }}>{b.t}</h2>
      {b.alt && <p className="mut" style={{ margin: 0 }}>{b.alt}</p>}
      <p className="mut" style={{ margin: '4px 0 8px' }}>{b.a}, {b.y}</p>
      <div className="row" style={{ gap: 6 }}>
        <span className="tag">{b.c}</span>{b.l.map(l => <span className="tag" key={l}>{LNAME[l]}</span>)}
        <span className="tag">{b.pd ? 'Domaine public' : 'Sous droits d’auteur (variable selon les pays)'}</span>
      </div>
      <h3>Idée centrale</h3><p style={{ marginTop: 0 }}>{b.idee}</p>
      <h3>Points clés</h3><ul style={{ marginTop: 0, paddingLeft: 20 }}>{b.pts.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <h3>À retenir</h3><p style={{ marginTop: 0 }}>{b.retenir}</p>
      <h3 lang="en">In English</h3><p lang="en" style={{ marginTop: 0 }}>{b.en}</p>
      <h3>Citation courte vérifiée</h3>
      {b.q.length
        ? b.q.map((x, i) => <blockquote className="qt" lang={x.l} key={i}>« {x.t} »<footer>{x.r}. Source : {x.s}.</footer></blockquote>)
        : <p className="mut" style={{ marginTop: 0 }}>Aucune citation : {b.pd ? 'aucune n’a été vérifiée pour cette œuvre.' : 'l’œuvre est encore protégée par le droit d’auteur, Believe n’en reproduit pas d’extrait.'}</p>}
      <h3>Lire ou écouter légalement</h3>
      <ul style={{ marginTop: 0, paddingLeft: 20 }}>{links.map(l => <li key={l.url}><Ext href={l.url}>{l.label}</Ext></li>)}</ul>
      <p className="mut" style={{ marginTop: 0 }}><small>{b.pd ? 'Œuvre dans le domaine public : seules des sources légales sont proposées. Les liens de recherche mènent à des catalogues extérieurs.' : 'Œuvre protégée : Believe ne propose ni texte, ni téléchargement, seulement une recherche d’édition ou d’emprunt dans un catalogue public.'}</small></p>
      {canSay && (
        <>
          <h3>Lecture vocale</h3>
          <div className="row">
            <button className="btn alt" onClick={() => speak('fr')}>Écouter le résumé (français)</button>
            <button className="btn alt" lang="en" onClick={() => speak('en')}>Listen to the summary (English)</button>
            {talk.on && <button className="btn" onClick={talk.stop}>Arrêter la lecture</button>}
          </div>
          <p className="mut" style={{ margin: '4px 0 0' }}><small>Voix de votre appareil : aucun texte n’est envoyé.</small></p>
        </>
      )}
      <div className="row" style={{ marginTop: 14 }}>
        {have ? <><span className="tag">Dans Mes livres</span><a className="btn alt" href="#/12/mes-livres" onClick={onClose}>Voir Mes livres</a></> : <button className="btn" onClick={add}>Ajouter à Mes livres</button>}
        <button className="btn alt" onClick={onClose}>Fermer</button>
      </div>
      {msg && <p className={msg.e ? 'ko' : 'ok'} role={msg.e ? 'alert' : 'status'}>{msg.t}</p>}
      <p className="mut" style={{ marginBottom: 0 }}><small>Résumé original rédigé pour Believe, sans reprise du texte du livre. Il simplifie l’essentiel et ne remplace pas la lecture.</small></p>
    </div>
  )
}
