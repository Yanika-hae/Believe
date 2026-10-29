import { useEffect, useRef, useState } from 'react'
import { BOOK_BY_ID, bookLinks } from './books'
import type { Fiche } from './lib'
import type { MyBook } from './lib'
import { askJSON, errText } from './ai'
import { GOAL, MAX_BOOKS, SRC_LABEL, ST_LABEL, addBook, current, ficheAsk, ficheFrom, ficheSpeech, keepFiche, manual, pagesToday, pct, removeBook, setStatus, setTotal, whyNot } from './reading'
import { canSay } from './ui'
import type { P } from './ui'
import { Cover, CoverToggle, Ext, useTalk } from './BookParts'
import { PageForm } from './Bookmark'
import Detail from './BookDetail'
import { Dialog } from './ui'

/** Affichage d'une fiche de lecture écrite par l'IA. */
function FicheView({ f }: { f: Fiche }) {
  return (
    <>
      <span className="tag">Généré par IA</span> <small className="mut">Modèle : {f.m}, le {f.d}</small>
      <h4>Idée centrale</h4><p>{f.idee}</p>
      <h4>Points clés</h4><ul style={{ margin: '0 0 4px', paddingLeft: 20 }}>{f.points.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {f.retenir && <><h4>À retenir</h4><p>{f.retenir}</p></>}
      {f.pour && <><h4>Pour qui</h4><p>{f.pour}</p></>}
      {f.fia && <><h4>Fiabilité de cette fiche</h4><p>{f.fia}</p></>}
      <p className="mut"><small>Fiche écrite par une IA, dans ses propres mots, sans reprise du livre. Elle peut contenir des erreurs ou des approximations : vérifiez avant de vous y fier.</small></p>
    </>
  )
}

/** Fiche de synthèse par Believe AI : le texte exact envoyé est montré avant l'envoi, qui n'a lieu qu'après accord et clic ; la fiche n'est gardée qu'à la demande. */
function FicheBox({ b, S, upd }: { b: MyBook; S: P['S']; upd: P['upd'] }) {
  const [st, setSt] = useState<'idle' | 'ask' | 'wait' | 'got'>('idle'), [draft, setDraft] = useState<Fiche | null>(null), [err, setErr] = useState(''), [del, setDel] = useState(false)
  const ctl = useRef<AbortController | null>(null), talk = useTalk()
  useEffect(() => () => ctl.current?.abort(), [])
  const sent = ficheAsk(b)
  const send = async () => {
    const c = new AbortController(); ctl.current = c; setSt('wait'); setErr('')
    try {
      const r = await askJSON('book', sent, undefined, c.signal)
      const f = ficheFrom(r.data, r.model)
      if (!f) { setErr(errText('invalid')); setSt('ask'); return }
      setDraft(f); setSt('got')
    } catch (e) {
      const m = (e as Error).message
      if (m !== 'cancelled') setErr(errText(m))
      setSt('ask')
    }
  }
  const keep = () => { if (draft && upd(s => { keepFiche(s, b.id, draft) }, 'Fiche gardée avec le livre.')) { setSt('idle'); setDraft(null) } }
  const shown = st === 'got' ? draft : st === 'idle' ? b.f ?? null : null
  return (
    <div className="ai" aria-label={'Fiche de synthèse de ' + b.t}>
      {shown && <FicheView f={shown} />}
      {st === 'idle' && (
        <div className="row">
          {b.f
            ? <>
              {canSay && <button className="chip" onClick={() => talk.start(ficheSpeech(b.f!), 'fr-FR')}>Écouter la fiche</button>}
              {talk.on && <button className="chip" onClick={talk.stop}>Arrêter la lecture</button>}
              <button className="chip" aria-label={'Refaire la fiche de ' + b.t} onClick={() => setSt('ask')}>Refaire la fiche</button>
              {del
                ? <><button className="chip" aria-label={'Confirmer la suppression de la fiche de ' + b.t} onClick={() => { if (upd(s => { keepFiche(s, b.id, null) }, 'Fiche supprimée.')) setDel(false) }}>Confirmer la suppression</button><button className="chip" onClick={() => setDel(false)}>Annuler</button></>
                : <button className="chip" aria-label={'Supprimer la fiche de ' + b.t} onClick={() => setDel(true)}>Supprimer la fiche</button>}
            </>
            : <button className="btn alt" aria-label={'Créer une fiche de synthèse (IA) : ' + b.t} onClick={() => setSt('ask')}>Créer une fiche de synthèse (IA)</button>}
        </div>
      )}
      {(st === 'ask' || st === 'wait') && (
        <>
          <b>Ce qui sera envoyé à l’IA (Google Gemini, via le serveur Believe)</b>
          <pre className="send" tabIndex={0} aria-label="Texte exact qui sera envoyé">{sent}</pre>
          <p className="mut"><small>Seuls le titre, l’auteur et, s’il existe, le descriptif du catalogue partent : ni votre profil, ni vos notes, ni votre progression. Rien n’est envoyé tant que vous n’appuyez pas sur le bouton. La fiche est rédigée par l’IA dans ses propres mots, sans copier le livre.</small></p>
          {err && <p className="ko" role="alert">{err}</p>}
          {st === 'wait'
            ? <div className="row"><span role="status">Believe AI rédige la fiche…</span><button className="btn alt" onClick={() => ctl.current?.abort()}>Arrêter d’attendre la réponse</button></div>
            : <div className="row">
              {S.consents.ai
                ? <button className="btn" onClick={send}>Envoyer à l’IA</button>
                : <button className="btn" onClick={() => upd(s => { s.consents.ai = true }, 'Accord enregistré : Believe AI.')}>Donner mon accord pour l’IA</button>}
              <button className="btn alt" onClick={() => { setSt('idle'); setErr('') }}>Annuler</button>
            </div>}
        </>
      )}
      {st === 'got' && (
        <div className="row">
          <button className="btn" onClick={keep}>Garder la fiche avec le livre</button>
          <button className="btn alt" onClick={() => { setSt('idle'); setDraft(null) }}>Fermer sans garder</button>
        </div>
      )}
    </div>
  )
}

function Card({ b, S, upd, setM }: { b: MyBook; S: P['S']; upd: P['upd']; setM: P['setM'] }) {
  const [del, setDel] = useState(false), [tot, setTot] = useState(b.total === null ? '' : String(b.total)), [sheet, setSheet] = useState(false)
  useEffect(() => { setTot(b.total === null ? '' : String(b.total)) }, [b.total])
  const cat = b.src === 'cat' ? BOOK_BY_ID.get(b.ref) : undefined, p = pct(b)
  const saveTotal = () => {
    const probe = setTotal(JSON.parse(JSON.stringify(S)), b.id, tot)
    if (!probe.ok) return setM({ e: 1, t: probe.why })
    upd(s => { setTotal(s, b.id, tot) }, tot.trim() ? 'Nombre de pages enregistré.' : 'Nombre de pages effacé.')
  }
  return (
    <article className="card bk" aria-label={'Mon livre : ' + b.t}>
      <Cover S={S} title={b.t} id={b.id} url={b.cover} />
      <div>
        <h3>{b.t}</h3>
        <p className="mut" style={{ margin: '2px 0 6px' }}>{b.a || 'Auteur non indiqué'} · {SRC_LABEL[b.src]}</p>
        <label htmlFor={'st-' + b.id}>Statut</label>
        <select id={'st-' + b.id} aria-label={'Statut de ' + b.t} value={b.st} onChange={e => upd(s => { setStatus(s, b.id, e.target.value as MyBook['st']) }, 'Statut : ' + ST_LABEL[e.target.value as MyBook['st']] + '.')}>
          {(Object.keys(ST_LABEL) as MyBook['st'][]).map(k => <option key={k} value={k}>{ST_LABEL[k]}</option>)}
        </select>
        <p style={{ margin: '10px 0 2px' }}>{b.total ? <>Page <b>{b.page}</b> sur {b.total} ({p} %)</> : <>Page <b>{b.page}</b></>}</p>
        {b.total ? <progress value={b.page} max={b.total} aria-label={'Avancement de ' + b.t} /> : null}
        <div style={{ marginTop: 10 }}>
          <PageForm S={S} upd={upd} idp={'mb-' + b.id} to={{ k: 'book', id: b.id }} page={b.page} role="livre" label={b.t} />
        </div>
        <details>
          <summary>Nombre de pages du livre</summary>
          <div className="row">
            <label className="sr" htmlFor={'tt-' + b.id}>Nombre de pages de {b.t}</label>
            <input id={'tt-' + b.id} type="number" inputMode="numeric" min={1} step={1} value={tot} placeholder="inconnu" onChange={e => setTot(e.target.value)} style={{ width: 120 }} />
            <button className="btn alt" aria-label={'Enregistrer le nombre de pages de ' + b.t} onClick={saveTotal}>Enregistrer</button>
          </div>
          <p className="mut"><small>Facultatif : avec le nombre de pages, Believe affiche l’avancement et passe le livre à « Terminé » à la dernière page.</small></p>
        </details>
        <div className="row" style={{ margin: '6px 0' }}>
          {cat && <button className="chip" aria-label={'Voir le résumé de ' + b.t} onClick={() => setSheet(true)}>Voir le résumé</button>}
          {cat ? bookLinks(cat).filter(l => l.k !== 'find').slice(0, 1).map(l => <Ext key={l.url} href={l.url}>{l.label}</Ext>) : b.url ? <Ext href={b.url}>Ouvrir sur {SRC_LABEL[b.src]}</Ext> : null}
        </div>
        {b.desc && <details><summary>Descriptif du catalogue</summary><p>{b.desc}</p></details>}
        <FicheBox b={b} S={S} upd={upd} />
        <div className="row" style={{ marginTop: 8 }}>
          {del
            ? <><button className="chip" aria-label={'Confirmer le retrait de ' + b.t} onClick={() => { upd(s => { removeBook(s, b.id) }, '« ' + b.t + ' » retiré de Mes livres. Vos pages lues restent comptées.') }}>Confirmer le retrait</button><button className="chip" onClick={() => setDel(false)}>Annuler</button></>
            : <button className="chip" aria-label={'Retirer de Mes livres : ' + b.t} onClick={() => setDel(true)}>Retirer de Mes livres</button>}
        </div>
      </div>
      {cat && <Dialog open={sheet} onClose={() => setSheet(false)} label={'Fiche du livre ' + cat.t} sheet><Detail b={cat} S={S} upd={upd} onClose={() => setSheet(false)} /></Dialog>}
    </article>
  )
}

function Add({ S, upd, setM }: Pick<P, 'S' | 'upd' | 'setM'>) {
  const [t, setT] = useState(''), [a, setA] = useState(''), [n, setN] = useState('')
  const submit = () => {
    const r = manual(t, a, n)
    if (!r.ok) return setM({ e: 1, t: r.why })
    const why = whyNot(S, r.b)
    if (why) return setM({ e: 1, t: why })
    if (upd(s => { addBook(s, r.b) }, '« ' + r.b.t + ' » ajouté à Mes livres.')) { setT(''); setA(''); setN('') }
  }
  return (
    <details className="card">
      <summary>Ajouter un livre à la main</summary>
      <form aria-label="Ajouter un livre" noValidate onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="grid2">
          <div><label htmlFor="ab-t">Titre</label><input id="ab-t" maxLength={200} value={t} onChange={e => setT(e.target.value)} /></div>
          <div><label htmlFor="ab-a">Auteur (facultatif)</label><input id="ab-a" maxLength={200} value={a} onChange={e => setA(e.target.value)} /></div>
          <div><label htmlFor="ab-n">Nombre de pages (facultatif)</label><input id="ab-n" type="number" inputMode="numeric" min={1} step={1} value={n} onChange={e => setN(e.target.value)} /></div>
        </div>
        <p style={{ marginBottom: 0 }}><button type="submit" className="btn">Ajouter le livre</button></p>
      </form>
    </details>
  )
}

/** Onglet « Mes livres » : liste personnelle reliée au marque-page de l'habitude « 20 pages de mon livre ». */
export default function MyBooks({ S, upd, setM }: P) {
  const [flt, setFlt] = useState<'' | MyBook['st']>(''), [lim, setLim] = useState(10)
  const n = (st: MyBook['st']) => S.books.filter(b => b.st === st).length
  const list = S.books.filter(b => !flt || b.st === flt), pb = pagesToday(S), cur = current(S)
  return (
    <>
      <div className="card">
        <h2>Mes livres</h2>
        <p style={{ marginTop: 0 }}>Aujourd’hui : <b>{pb} / {GOAL} pages</b>{pb >= GOAL ? ' ✓ objectif atteint' : ''}. La liste est reliée au marque-page de l’habitude « 20 pages de mon livre » (<a href="#/6">rubrique Habitudes</a>) : les pages saisies ici ou là sont les mêmes.</p>
        <progress value={Math.min(pb, GOAL)} max={GOAL} aria-label="Pages de livre lues aujourd’hui" />
        {cur && <p className="mut" style={{ marginBottom: 0 }}>Livre proposé au marque-page : {cur.t}.</p>}
      </div>
      <Add S={S} upd={upd} setM={setM} />
      {S.books.some(b => b.cover) && <div className="card"><CoverToggle S={S} upd={upd} /></div>}
      <div className="chips wrap" role="group" aria-label="Filtrer Mes livres par statut">
        <button className="chip" aria-pressed={flt === ''} onClick={() => { setFlt(''); setLim(10) }}>Tous ({S.books.length})</button>
        {(Object.keys(ST_LABEL) as MyBook['st'][]).map(k => <button key={k} className="chip" aria-pressed={flt === k} onClick={() => { setFlt(k); setLim(10) }}>{ST_LABEL[k]} ({n(k)})</button>)}
      </div>
      <p className="mut" role="status" style={{ margin: '4px 0' }}>{list.length} livre{list.length > 1 ? 's' : ''}. Limite : {MAX_BOOKS}.</p>
      {list.slice(0, lim).map(b => <Card key={b.id} b={b} S={S} upd={upd} setM={setM} />)}
      {!list.length && <div className="card"><p style={{ margin: 0 }}>{S.books.length ? 'Aucun livre avec ce statut.' : 'Aucun livre pour le moment. Ajoutez-en un depuis le catalogue, depuis la recherche en ligne ou à la main.'}</p></div>}
      {list.length > lim && <p><button className="btn alt" onClick={() => setLim(lim + 10)}>Afficher plus ({list.length - lim} restants)</button></p>}
    </>
  )
}
