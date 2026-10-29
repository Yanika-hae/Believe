import { useEffect, useMemo, useRef, useState } from 'react'
import { BCATS, searchBooksLocal } from './books'
import type { Book, Lang } from './books'
import { ExtFail, SRCS, SRC_ERR, SRC_NAME, searchBooks } from './ext'
import type { Acc, ExtBook, ExtResult, Src } from './ext'
import { ERR } from './ai'
import { addBook, fromCatalog, fromExt, inList, whyNot } from './reading'
import { Dialog, Flash, Tabs, useTab } from './ui'
import type { P } from './ui'
import { excerpt, terms } from './util'
import { Cover, CoverToggle, LNAME, marked } from './BookParts'
import Detail from './BookDetail'
import MyBooks from './MyBooks'

const LANGS: [Lang | '', string][] = [['', 'Toutes les langues'], ['fr', 'Français'], ['en', 'English']]
const MIN_Q = 2

type Online = { st: 'idle' } | { st: 'wait' } | { st: 'done'; q: string; res: ExtResult } | { st: 'err'; q: string; msg: string }

/** Explication d'un échec de recherche en ligne, en français, avec la marche à suivre quand elle existe. */
function extErr(f: ExtFail): string {
  const c = f.message
  if (c === 'not_configured') return 'La recherche de livres n’est pas disponible pour le moment. Le catalogue intégré reste disponible.'
  if (c === 'bad_request') return 'Saisissez au moins deux lettres.'
  if (c === 'quota' && !f.errors.length) return ERR.quota
  if (c === 'offline' || c === 'daily' || c === 'code' || c === 'origin') return ERR[c]
  const det = f.errors.map(e => SRC_NAME[e.s] + ' : ' + (SRC_ERR[e.e] ?? 'indisponible')).join(' ; ')
  return 'Aucun catalogue n’a répondu' + (det ? ' (' + det + ')' : '') + '. Réessayez dans un instant.'
}

// ---------------------------------------------------------------- catalogue intégré
function Tile({ b, ts, S, upd, setM, open }: { b: Book; ts: string[]; S: P['S']; upd: P['upd']; setM: P['setM']; open: () => void }) {
  const mb = fromCatalog(b), have = inList(S, mb.id)
  const add = () => {
    const why = whyNot(S, mb)
    if (why) return setM({ e: 1, t: why })
    upd(s => { addBook(s, mb) }, '« ' + b.t + ' » ajouté à Mes livres.')
  }
  return (
    <article className="card bk" aria-label={'Livre : ' + b.t}>
      <Cover S={S} title={b.t} id={b.id} url={null} />
      <div>
        <h3>{marked(b.t, ts)}</h3>
        {b.alt && <p className="mut" style={{ margin: 0 }}><small>{marked(b.alt, ts)}</small></p>}
        <p className="mut" style={{ margin: '2px 0 6px' }}>{marked(b.a, ts)}, {b.y}</p>
        <div className="row" style={{ gap: 6 }}>
          <span className="tag">{b.c}</span>{b.l.map(l => <span className="tag" key={l}>{LNAME[l]}</span>)}{b.pd && <span className="tag">Domaine public</span>}
        </div>
        <p style={{ margin: '8px 0' }}>{marked(excerpt(b.idee, ts, 170), ts)}</p>
        <div className="row">
          <button className="btn" aria-label={'Ouvrir la fiche de ' + b.t} onClick={open}>Ouvrir la fiche</button>
          {have ? <a className="tag" href="#/12/mes-livres">Dans Mes livres</a> : <button className="chip" aria-label={'Ajouter à Mes livres : ' + b.t} onClick={add}>Ajouter à Mes livres</button>}
        </div>
      </div>
    </article>
  )
}

function Catalogue({ S, upd, setM, q, hits, online }: Pick<P, 'S' | 'upd' | 'setM'> & { q: string; hits: ReturnType<typeof searchBooksLocal>; online: () => void }) {
  const [ci, setCi] = useState(0), [sel, setSel] = useState<Book | null>(null), [lim, setLim] = useState(12)
  const ts = terms(q)
  const items = ['Toutes (' + hits.length + ')', ...BCATS.map(c => c + ' (' + hits.filter(h => h.b.c === c).length + ')')]
  const list = hits.filter(h => ci === 0 || h.b.c === BCATS[ci - 1])
  return (
    <>
      <Tabs items={items} v={ci} set={i => { setCi(i); setLim(12) }} label="Filtrer le catalogue par catégorie" S={S}>
        <p className="mut" role="status" style={{ margin: '4px 0' }}>{list.length} livre{list.length > 1 ? 's' : ''}{ts.length ? ' pour « ' + q.trim() + ' »' : ''}.</p>
        {list.slice(0, lim).map(h => <Tile key={h.b.id} b={h.b} ts={ts} S={S} upd={upd} setM={setM} open={() => setSel(h.b)} />)}
        {!list.length && <div className="card"><p style={{ margin: 0 }}>{ts.length ? 'Aucun livre du catalogue intégré ne correspond.' : 'Aucun livre dans cette catégorie.'}</p></div>}
        {list.length > lim && <p><button className="btn alt" onClick={() => setLim(lim + 12)}>Afficher plus ({list.length - lim} restants)</button></p>}
      </Tabs>
      {ts.length > 0 && (
        <div className="card"><p style={{ marginTop: 0 }}>Un livre introuvable ici ? Cherchez « {q.trim()} » dans les catalogues publics en ligne.</p>
          <button className="btn" onClick={online} disabled={q.trim().length < MIN_Q}>Chercher en ligne</button></div>
      )}
      <Dialog open={!!sel} onClose={() => setSel(null)} label={sel ? 'Fiche du livre ' + sel.t : 'Fiche du livre'} sheet>{sel && <Detail b={sel} S={S} upd={upd} onClose={() => setSel(null)} />}</Dialog>
    </>
  )
}

// ---------------------------------------------------------------- recherche en ligne
const RANK: Record<Acc, number> = { free: 0, loan: 1, preview: 2, info: 3 }
/** Mention de l'accès légal d'une notice, en clair. */
function access(e: ExtBook): string {
  if (e.acc === 'free') {
    if (e.med === 'audio') return 'Écoute libre : livre audio du domaine public, lu par des bénévoles (LibriVox).'
    if (e.src === 'gu') return 'Lecture libre : domaine public aux États-Unis selon Project Gutenberg. La règle peut être différente dans votre pays.'
    if (e.src === 'gb') return 'Lecture libre : Google indique un livre du domaine public ou entièrement consultable.'
    return 'Lecture libre : accès public indiqué par Open Library (Internet Archive).'
  }
  if (e.acc === 'loan') return 'Emprunt numérique possible (compte gratuit Open Library / Internet Archive requis). Le livre reste protégé.'
  if (e.acc === 'preview') return 'Extrait consultable seulement : le livre complet reste protégé.'
  return 'Fiche seulement : pas de texte libre. Cherchez le livre en bibliothèque ou en librairie.'
}
const VERB = (e: ExtBook) => (e.acc === 'free' ? (e.med === 'audio' ? 'Écouter' : 'Lire gratuitement') : e.acc === 'loan' ? 'Voir l’emprunt' : e.acc === 'preview' ? 'Voir l’extrait' : 'Voir la fiche') + ' sur ' + SRC_NAME[e.src]

function ExtCard({ e, S, upd, setM }: { e: ExtBook; S: P['S']; upd: P['upd']; setM: P['setM'] }) {
  const [more, setMore] = useState(false)
  const mb = fromExt(e), have = inList(S, mb.id), long = e.desc.length > 220
  const add = () => {
    const why = whyNot(S, mb)
    if (why) return setM({ e: 1, t: why })
    upd(s => { addBook(s, mb) }, '« ' + e.t + ' » ajouté à Mes livres.')
  }
  return (
    <article className="card bk" aria-label={'Résultat : ' + e.t}>
      <Cover S={S} title={e.t} id={mb.id} url={e.cover} />
      <div>
        <h3>{e.t}</h3>
        <p className="mut" style={{ margin: '2px 0 6px' }}>{e.a || 'Auteur non indiqué'}{e.y ? ', ' + e.y : ''}</p>
        <div className="row" style={{ gap: 6 }}>
          <span className="tag">{SRC_NAME[e.src]}</span>{e.med === 'audio' && <span className="tag">Livre audio</span>}{e.l && <span className="tag">{LNAME[e.l as Lang]}</span>}
          {e.pub && e.pub !== SRC_NAME[e.src] && <span className="tag">{e.pub}</span>}
        </div>
        {e.desc && <p style={{ margin: '8px 0 2px' }}>{more || !long ? e.desc : e.desc.slice(0, 220).trimEnd() + '…'}</p>}
        {long && <button className="chip" aria-expanded={more} aria-label={(more ? 'Réduire' : 'Lire tout') + ' le descriptif de ' + e.t} onClick={() => setMore(!more)}>{more ? 'Réduire' : 'Lire tout'}</button>}
        {e.desc && <p className="mut" style={{ margin: '2px 0 0' }}><small>Descriptif fourni par {e.src === 'gb' ? 'l’éditeur, via Google Books' : SRC_NAME[e.src]}.</small></p>}
        <p style={{ margin: '8px 0' }}><b>{access(e)}</b></p>
        <div className="row">
          <a className="btn" href={e.url} target="_blank" rel="noopener noreferrer" aria-label={VERB(e) + ' : ' + e.t + ' (nouvel onglet)'}>{VERB(e)} <span aria-hidden="true">↗</span></a>
          {have ? <a className="tag" href="#/12/mes-livres">Dans Mes livres</a> : <button className="chip" aria-label={'Ajouter à Mes livres : ' + e.t} onClick={add}>Ajouter à Mes livres</button>}
        </div>
      </div>
    </article>
  )
}

function OnlineTab({ S, upd, setM, q, on, go, cancel, srcs, setSrcs }: Pick<P, 'S' | 'upd' | 'setM'> & { q: string; on: Online; go: () => void; cancel: () => void; srcs: Src[]; setSrcs: (s: Src[]) => void }) {
  const items = useMemo(() => (on.st === 'done' ? [...on.res.items].sort((a, b) => RANK[a.acc] - RANK[b.acc]) : []), [on])
  const ok = q.trim().length >= MIN_Q && srcs.length > 0
  return (
    <>
      <div className="card">
        <h2>Chercher dans les catalogues publics</h2>
        <p style={{ marginTop: 0 }}>Open Library, Google Books, Project Gutenberg et LibriVox donnent les informations officielles d’un livre : titre, auteur, couverture, descriptif, lien légal de lecture ou d’écoute. Believe n’héberge aucun livre : il affiche la fiche et vous renvoie vers la source.</p>
        <p className="mut"><small>Ce qui est envoyé : uniquement le texte saisi dans la barre de recherche et la langue choisie, au serveur Believe qui interroge les catalogues. Jamais votre profil ni vos données. Rien ne part tant que vous n’appuyez pas sur « Chercher en ligne ».</small></p>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
          <legend className="mut" style={{ fontSize: '.85rem', padding: 0 }}>Catalogues interrogés</legend>
          {SRCS.map(s => (
            <label className="rd" key={s} htmlFor={'src-' + s}><input id={'src-' + s} type="checkbox" checked={srcs.includes(s)} onChange={e => setSrcs(SRCS.filter(x => (x === s ? e.target.checked : srcs.includes(x))))} />{SRC_NAME[s]}</label>
          ))}
        </fieldset>
        <CoverToggle S={S} upd={upd} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={go} disabled={!ok || on.st === 'wait'}>Chercher « {q.trim() || '…'} » en ligne</button>
          {on.st === 'wait' && <button className="btn alt" onClick={cancel}>Annuler la recherche</button>}
        </div>
        {q.trim().length < MIN_Q && <p className="mut" style={{ marginBottom: 0 }}><small>Saisissez au moins deux lettres dans la barre de recherche, en haut de la page.</small></p>}
        {srcs.length === 0 && <p className="ko" role="alert" style={{ marginBottom: 0 }}>Choisissez au moins un catalogue.</p>}
      </div>
      <div role="status" aria-live="polite">
        {on.st === 'wait' && <p className="mut">Recherche en cours dans les catalogues…</p>}
        {on.st === 'err' && <p className="ko" role="alert">{on.msg}</p>}
        {on.st === 'done' && (
          <>
            <p className="mut">{items.length} résultat{items.length > 1 ? 's' : ''} pour « {on.q} ». Les accès libres sont classés en premier.</p>
            {on.res.errors.length > 0 && <p className="ko">Certains catalogues n’ont pas répondu : {on.res.errors.map(e => SRC_NAME[e.s] + ' (' + (SRC_ERR[e.e] ?? 'indisponible') + ')').join(', ')}. Les autres résultats s’affichent ci-dessous.</p>}
          </>
        )}
      </div>
      {items.map(e => <ExtCard key={e.src + e.id} e={e} S={S} upd={upd} setM={setM} />)}
      {on.st === 'done' && !items.length && <div className="card"><p style={{ margin: 0 }}>Aucun résultat dans ces catalogues. Essayez un titre plus court, le nom de l’auteur ou une autre langue.</p></div>}
    </>
  )
}

// ---------------------------------------------------------------- page
export default function Library(p: P) {
  const { S, upd, m, setM } = p
  const [tab, setTab] = useTab(p.sub, ['catalogue', 'en-ligne', 'mes-livres'])
  const [q, setQ] = useState(''), [lang, setLang] = useState<Lang | ''>(''), [srcs, setSrcs] = useState<Src[]>(SRCS), [on, setOn] = useState<Online>({ st: 'idle' })
  const ctl = useRef<AbortController | null>(null)
  useEffect(() => () => ctl.current?.abort(), [])
  const hits = useMemo(() => searchBooksLocal(q, '', lang), [q, lang])
  const cancel = () => ctl.current?.abort()
  const go = async () => {
    const text = q.trim()
    if (text.length < MIN_Q || !srcs.length) return
    ctl.current?.abort()
    const c = new AbortController(); ctl.current = c
    setOn({ st: 'wait' }); setTab(1)
    try {
      const res = await searchBooks(text, lang, srcs, c.signal)
      if (ctl.current === c) setOn({ st: 'done', q: text, res })
    } catch (e) {
      if (ctl.current !== c) return // remplacée par une recherche plus récente
      if (e instanceof ExtFail && e.message === 'cancelled') setOn({ st: 'idle' })
      else setOn({ st: 'err', q: text, msg: extErr(e instanceof ExtFail ? e : new ExtFail('upstream')) })
    }
  }
  const nb = on.st === 'done' ? ' (' + on.res.items.length + ')' : ''
  return (
    <>
      <h1>Bibliothèque et recherche de livres</h1>
      <Flash m={m} />
      <form className="card" role="search" aria-label="Recherche de livres" onSubmit={e => { e.preventDefault(); void go() }}>
        <label htmlFor="bq">Rechercher un livre</label>
        <div className="row">
          <input id="bq" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="titre, auteur, thème, mot-clé, langue…" autoComplete="off" enterKeyHint="search" maxLength={80} style={{ flex: '1 1 200px', width: 'auto' }} />
          <button type="submit" className="btn" disabled={q.trim().length < MIN_Q || !srcs.length || on.st === 'wait'}>Chercher en ligne</button>
        </div>
        <div className="chips wrap" role="group" aria-label="Langue du livre" style={{ paddingBottom: 0, marginTop: 8 }}>
          {LANGS.map(([k, t]) => <button type="button" key={k} className="chip" aria-pressed={lang === k} onClick={() => setLang(k)}>{t}</button>)}
        </div>
        <p className="mut" style={{ margin: '6px 0 0' }}><small>Le catalogue intégré se filtre instantanément, sur votre appareil (titre, auteur, thème, mot-clé, langue). « Chercher en ligne » n’envoie le texte saisi qu’à votre demande.</small></p>
      </form>
      <Tabs items={['Catalogue (' + hits.length + ')', 'En ligne' + nb, 'Mes livres (' + S.books.length + ')']} v={tab} set={setTab} label="Section de la bibliothèque" S={S} wrap>
        {tab === 0 && <Catalogue S={S} upd={upd} setM={setM} q={q} hits={hits} online={() => { void go() }} />}
        {tab === 1 && <OnlineTab S={S} upd={upd} setM={setM} q={q} on={on} go={() => { void go() }} cancel={cancel} srcs={srcs} setSrcs={setSrcs} />}
        {tab === 2 && <MyBooks {...p} />}
      </Tabs>
      <p className="mut"><small>Les résumés du catalogue sont originaux et ne reproduisent pas les livres ; les citations, courtes et référencées, ne concernent que des textes du domaine public. Les livres audio ne viennent que de sources légales (LibriVox, domaine public, éditeurs).</small></p>
    </>
  )
}
