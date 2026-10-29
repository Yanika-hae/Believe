import { useRef, useState } from 'react'
import type { Habit, State } from './lib'
import type { Role } from './data'
import { habitOf, markHabit, today } from './lib'
import { searchYT } from './ai'
import { FILTERS, embed, ytId, ytQuery } from './media'
import type { Kind } from './media'

type Mg = { e?: 1; t: string } | null
interface SP { S: State; upd: (f: (s: State) => void, ok?: string) => void; m: Mg; setM: (m: Mg) => void }
interface Hit { id: string; t: string; ch: string }
const EM: Record<string, string> = {
  not_configured: 'La recherche de vidéos n’est pas disponible pour le moment. Vous pouvez coller une adresse YouTube ci-dessous.',
  offline: 'Serveur injoignable ou hors ligne.', timeout: 'Le serveur a mis trop de temps à répondre.', quota: 'Quota dépassé ou accès refusé par YouTube.', cancelled: 'Recherche annulée.',
  code: 'Code d’accès requis ou incorrect (saisissez-le dans la rubrique 3).'
}

export default function MediaPage({ S, upd, m, setM }: SP) {
  const [kind, setKind] = useState<Kind>('danse'), [flt, setFlt] = useState(FILTERS.danse[0]), [q, setQ] = useState(''), [hits, setHits] = useState<Hit[]>([]), [busy, setBusy] = useState(false), [er, setEr] = useState('')
  const [cur, setCur] = useState<{ id: string; t: string } | null>(null), [url, setUrl] = useState(''), ac = useRef<AbortController | null>(null)
  const query = ytQuery(kind, flt, q), list = S.playlist.filter(p => p.k === kind), idx = cur ? list.findIndex(p => p.id === cur.id) : -1
  const pick = (k: Kind) => { setKind(k); setFlt(FILTERS[k][0]); setHits([]); setEr(''); setCur(null) }
  const search = async () => {
    setBusy(true); setEr(''); ac.current = new AbortController()
    try { setHits(await searchYT(query, ac.current.signal)) } catch (e) { setEr((e as Error).message) } finally { setBusy(false) }
  }
  const add = (id: string, t: string) => {
    if (S.playlist.some(p => p.id === id && p.k === kind)) return setM({ e: 1, t: 'Déjà dans la playlist.' })
    if (S.playlist.length >= 100) return setM({ e: 1, t: 'Playlist pleine (100 vidéos).' })
    upd(s => { s.playlist.push({ id, t: t.slice(0, 120), k: kind }) }, 'Ajouté à la playlist.')
  }
  const addUrl = () => { const id = ytId(url); if (!id) return setM({ e: 1, t: 'Adresse YouTube non reconnue.' }); setUrl(''); add(id, 'Vidéo YouTube ' + id) }
  const validate = (roles: Role[]) => {
    const found = roles.map(r => habitOf(S, r)).filter((h): h is Habit => !!h)
    if (!found.length) return setM({ e: 1, t: 'Habitude introuvable (supprimée ?) : rien n’a été validé.' })
    upd(s => { for (const r of roles) markHabit(s, r) }, 'Validé pour aujourd’hui : ' + found.map(h => h.n).join(', ') + '.')
  }
  return (
    <>
      <h1>Danse et louange</h1>
      {m && <p className={m.e ? 'ko' : 'ok'} role="status">{m.t}</p>}
      <div className="chips" role="group" aria-label="Section">{(['danse', 'louange'] as const).map(k => <button key={k} className="chip" aria-pressed={kind === k} onClick={() => pick(k)}>{k === 'danse' ? 'Danse' : 'Louange'}</button>)}</div>
      <div className="chips" role="group" aria-label="Filtre">{FILTERS[kind].map(f => <button key={f} className="chip" aria-pressed={flt === f} onClick={() => setFlt(f)}>{f}</button>)}</div>
      <div className="row">
        <input aria-label="Recherche" placeholder="Mots-clés (facultatif)" maxLength={60} style={{ flex: '1 1 180px', width: 'auto' }} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }} />
        <button className="btn" disabled={busy} onClick={search}>Rechercher</button>
        {busy && <button className="btn alt" onClick={() => ac.current?.abort()}>Annuler</button>}
        <a className="chip" href={'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)} target="_blank" rel="noopener noreferrer">Ouvrir sur YouTube</a>
      </div>
      {er && <p className="ko" role="alert">{EM[er] ?? 'Service indisponible, réessayez.'}</p>}
      {hits.map(h => <div className="li" key={h.id}><span>{h.t}<br /><small className="mut">{h.ch}</small></span><span className="row"><button className="chip" onClick={() => setCur({ id: h.id, t: h.t })}>Regarder</button><button className="chip" onClick={() => add(h.id, h.t)}>Ajouter</button></span></div>)}
      {cur && (
        <div style={{ margin: '12px 0' }}>
          <iframe title={cur.t} src={embed(cur.id, true)} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen style={{ width: '100%', aspectRatio: '16 / 9', border: 0, borderRadius: 12 }} />
          <div className="row"><b>{cur.t}</b>{idx >= 0 && idx < list.length - 1 && <button className="chip" onClick={() => setCur({ id: list[idx + 1].id, t: list[idx + 1].t })}>Suivant</button>}<button className="chip" onClick={() => setCur(null)}>Fermer le lecteur</button></div>
        </div>
      )}
      <h2>Ma playlist ({kind})</h2>
      {list.map(p => <div className="li" key={p.id}><span>{p.t}</span><span className="row"><button className="chip" onClick={() => setCur({ id: p.id, t: p.t })}>Lire</button><button className="cb" style={{ color: 'var(--mut)' }} aria-label={'Retirer ' + p.t} onClick={() => upd(s => { s.playlist = s.playlist.filter(x => !(x.id === p.id && x.k === p.k)) })}>✕</button></span></div>)}
      {!list.length && <p className="mut">Playlist vide.</p>}
      <div className="row" style={{ marginTop: 8 }}><input aria-label="Adresse YouTube" placeholder="Coller une adresse YouTube" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: '1 1 200px', width: 'auto' }} /><button className="btn alt" onClick={addUrl}>Ajouter l’adresse</button></div>
      <h2>Validation</h2>
      {kind === 'danse' ? <button className="btn" onClick={() => validate(['sport', 'creatif'])}>J’ai dansé : valider</button> : <button className="btn" onClick={() => validate(['priere'])}>J’ai prié : valider</button>}
      <p className="mut">Danse : valide les habitudes Sport et Activité créative. Louange : valide Prier le matin. La validation est déclarative : Believe ne mesure pas ce que vous regardez.</p>
      <p className="mut">Les vidéos passent par le lecteur intégré de YouTube (youtube-nocookie.com), sans téléchargement : les droits des ayants droit sont respectés. YouTube reçoit votre adresse IP à la lecture. Rien ne démarre au chargement de la page, et le lecteur s’arrête quand vous quittez la rubrique.</p>
    </>
  )
}
