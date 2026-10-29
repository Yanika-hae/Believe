import { useEffect, useMemo, useRef, useState } from 'react'
import { NOTE_CATS, habitOf, markHabit, today, uid } from './lib'
import type { Role } from './data'
import type { Note, NoteCat } from './lib'
import { Flash, Tabs, useTab } from './ui'
import type { P, Upd } from './ui'
import { askAI, errText } from './ai'
import { excerpt, highlight, matches, terms } from './util'
import Dictaphone from './Dictaphone'
import Prompter from './Prompter'
import MetroTab from './MetroTab'

const MAX_NOTES = 3000, MAX_BODY = 20000
/** Nombre maximal de caractères d'une note envoyés à l'IA (limite du serveur : 4 000 par message). */
export const SEND_MAX = 3000
/** Habitude (par son rôle, qui survit au renommage) cochée automatiquement quand une note de la catégorie est créée. */
const HABIT: Partial<Record<NoteCat, Role>> = { Apprentissages: 'apprendre', Chants: 'creatif', Poèmes: 'creatif' }
/** Consigne envoyée avec le cauchemar : apaiser et prier, sans interpréter. Affichée en entier à l'utilisateur avant l'envoi. */
export const SOOTHE =
  'Voici un cauchemar que j’ai noté. Réponds avec douceur et simplicité, en trois courtes parties : 1) quelques mots pour m’apaiser ; 2) deux ou trois gestes simples pour retrouver le calme ou me rendormir ; 3) une brève prière de paix et de protection. ' +
  'N’interprète pas le rêve, ne fais ni diagnostic ni prédiction. Si ce texte évoque une détresse sérieuse, invite-moi à en parler à un proche ou à un professionnel (112 en cas d’urgence).\n\nMon cauchemar :\n'

const dateFr = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) }
const marked = (text: string, ts: string[]) => highlight(text, ts).map((s, i) => (s.m ? <mark key={i}>{s.t}</mark> : s.t))

function NoteForm({ S, upd, edit, cat0, onDone }: { S: P['S']; upd: Upd; edit?: Note; cat0: NoteCat; onDone: () => void }) {
  const [t, setT] = useState(edit?.t ?? ''), [b, setB] = useState(edit?.b ?? ''), [cat, setCat] = useState<NoteCat>(edit?.cat ?? cat0), [err, setErr] = useState('')
  const id = edit ? 'e' + edit.id : 'new'
  const save = () => {
    const title = t.trim(), body = b.trim()
    if (!title && !body) return setErr('Écrivez un titre ou un texte avant d’enregistrer.')
    if (!edit && S.notes.length >= MAX_NOTES) return setErr('Limite de ' + MAX_NOTES + ' notes atteinte : supprimez-en avant d’en ajouter.')
    setErr('')
    const now = new Date().toISOString()
    if (edit) {
      if (upd(s => { const n = s.notes.find(x => x.id === edit.id); if (n) { n.t = title; n.b = body; n.cat = cat; n.u = now } }, 'Note modifiée.')) onDone()
      return
    }
    const pre = HABIT[cat], h = pre ? habitOf(S, pre) : undefined
    const mark = !!h && !(S.checks[today()] ?? []).includes(h.id)
    if (upd(s => { s.notes.unshift({ id: uid('n'), cat, t: title, b: body, c: now, u: now }); if (mark && pre) markHabit(s, pre) }, 'Note enregistrée.' + (mark ? ' Habitude « ' + h!.n + ' » cochée pour aujourd’hui.' : ''))) { setT(''); setB(''); onDone() }
  }
  return (
    <form aria-label={edit ? 'Modifier la note' : 'Nouvelle note'} onSubmit={e => { e.preventDefault(); save() }}>
      <div className="grid2">
        <div><label htmlFor={id + '-t'}>Titre (facultatif)</label><input id={id + '-t'} maxLength={120} value={t} onChange={e => setT(e.target.value)} /></div>
        <div><label htmlFor={id + '-c'}>Catégorie</label><select id={id + '-c'} value={cat} onChange={e => setCat(e.target.value as NoteCat)}>{NOTE_CATS.map(c => <option key={c}>{c}</option>)}</select></div>
      </div>
      <label htmlFor={id + '-b'} style={{ marginTop: 8 }}>Votre note</label>
      <textarea id={id + '-b'} rows={edit ? 8 : 5} maxLength={MAX_BODY} value={b} onChange={e => setB(e.target.value)} />
      <p className="mut" style={{ margin: '4px 0' }}><small>{b.length.toLocaleString('fr-FR')} / {MAX_BODY.toLocaleString('fr-FR')} caractères. Enregistrée sur cet appareil, jamais partagée.</small></p>
      {err && <p className="ko" role="alert">{err}</p>}
      <div className="row"><button type="submit" className="btn">{edit ? 'Enregistrer les modifications' : 'Enregistrer la note'}</button>{edit && <button type="button" className="btn alt" onClick={onDone}>Annuler</button>}</div>
    </form>
  )
}

/** Apaisement et prière pour un cauchemar : le texte exact envoyé est montré avant l'envoi, qui n'a lieu qu'après accord et clic. */
function Soothe({ n, S, upd, setM, onClose }: { n: Note; S: P['S']; upd: Upd; setM: P['setM']; onClose: () => void }) {
  const [st, setSt] = useState<'ready' | 'wait' | 'done'>('ready'), [out, setOut] = useState(''), [err, setErr] = useState('')
  const ctl = useRef<AbortController | null>(null)
  useEffect(() => () => ctl.current?.abort(), [])
  const sent = SOOTHE + n.b.slice(0, SEND_MAX)
  const send = async () => {
    const c = new AbortController(); ctl.current = c; setSt('wait'); setErr('')
    try { const r = await askAI('spirit', [{ role: 'user', content: sent }], '', c.signal); setOut(r.text); setSt('done') } catch (e) {
      const m = (e as Error).message
      if (m !== 'cancelled') setErr(errText(m))
      setSt('ready')
    }
  }
  const keep = () => {
    const add = '\n\n— Apaisement et prière générés par IA —\n' + out
    if (n.b.length + add.length > MAX_BODY) return setM({ e: 1, t: 'La note serait trop longue : l’ajout est refusé.' })
    if (upd(s => { const x = s.notes.find(y => y.id === n.id); if (x) { x.b += add; x.u = new Date().toISOString() } }, 'Texte ajouté à la note, signalé comme généré par IA.')) onClose()
  }
  return (
    <div className="ai" style={{ marginTop: 10 }}>
      {st === 'done' ? <>
        <span className="tag">Généré par IA</span>
        <p>{out}</p>
        <p className="mut"><small>Texte produit par une IA : il ne remplace ni un avis médical, ni un accompagnement spirituel ou psychologique. S’il n’est pas ajouté à la note, il disparaît à la fermeture.</small></p>
        <div className="row"><button className="btn" onClick={keep}>Ajouter à ma note</button><button className="btn alt" onClick={onClose}>Fermer</button></div></>
        : <>
          <b>Ce qui sera envoyé à l’IA (Google Gemini, via le serveur Believe)</b>
          <pre className="send" tabIndex={0} aria-label="Texte exact qui sera envoyé">{sent}</pre>
          <p className="mut"><small>Seul ce texte part : ni votre profil, ni vos autres notes. {n.b.length > SEND_MAX ? 'Votre note dépasse ' + SEND_MAX.toLocaleString('fr-FR') + ' caractères : seuls les ' + SEND_MAX.toLocaleString('fr-FR') + ' premiers sont envoyés. ' : ''}Rien n’est envoyé tant que vous n’appuyez pas sur le bouton.</small></p>
          {err && <p className="ko" role="alert">{err}</p>}
          {st === 'wait' ? <div className="row"><span role="status">Believe AI écrit…</span><button className="btn alt" onClick={() => ctl.current?.abort()}>Arrêter d’attendre la réponse</button></div>
            : <div className="row">
              {S.consents.ai
                ? <button className="btn" onClick={send}>Envoyer cette note à l’IA</button>
                : <button className="btn" onClick={() => upd(s => { s.consents.ai = true }, 'Accord enregistré : Believe AI.')}>Donner mon accord pour l’IA</button>}
              <button className="btn alt" onClick={onClose}>Annuler</button></div>}
        </>}
    </div>
  )
}

function NoteCard({ n, ts, S, upd, setM }: { n: Note; ts: string[]; S: P['S']; upd: Upd; setM: P['setM'] }) {
  const [open, setOpen] = useState(false), [edit, setEdit] = useState(false), [del, setDel] = useState(false), [ai, setAi] = useState(false)
  const name = n.t || 'sans titre'
  if (edit) return <div className="card"><NoteForm S={S} upd={upd} edit={n} cat0={n.cat} onDone={() => setEdit(false)} /></div>
  const body = open ? n.b : excerpt(n.b, ts)
  return (
    <article className="card note" aria-label={'Note ' + name}>
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>{marked(n.t || 'Sans titre', ts)}</h3><span className="tag">{n.cat}</span></div>
      <p className="mut" style={{ margin: '0 0 6px' }}><small>{dateFr(n.u)}{n.u !== n.c ? ' (modifiée)' : ''}</small></p>
      {body && <p className="nb">{marked(body, ts)}</p>}
      <div className="row">
        {n.b.length > 280 && <button className="chip" aria-expanded={open} aria-label={(open ? 'Réduire' : 'Lire tout') + ' la note ' + name} onClick={() => setOpen(!open)}>{open ? 'Réduire' : 'Lire tout'}</button>}
        <button className="chip" aria-label={'Modifier la note ' + name} onClick={() => setEdit(true)}>Modifier</button>
        {n.cat === 'Cauchemars' && <button className="chip" aria-expanded={ai} aria-label={'Apaisement et prière (IA) pour la note ' + name} onClick={() => setAi(!ai)}>Apaisement et prière (IA)</button>}
        {del
          ? <><button className="chip" aria-label={'Confirmer la suppression de la note ' + name} onClick={() => { upd(s => { s.notes = s.notes.filter(x => x.id !== n.id) }, 'Note supprimée.') }}>Confirmer la suppression</button><button className="chip" onClick={() => setDel(false)}>Annuler</button></>
          : <button className="chip" aria-label={'Supprimer la note ' + name} onClick={() => setDel(true)}>Supprimer</button>}
      </div>
      {ai && <Soothe n={n} S={S} upd={upd} setM={setM} onClose={() => setAi(false)} />}
    </article>
  )
}

function NotesTab({ S, upd, setM }: P) {
  const [q, setQ] = useState(''), [ci, setCi] = useState(0), [lim, setLim] = useState(20)
  const ts = terms(q)
  const found = useMemo(() => S.notes.filter(n => matches(n.t + ' ' + n.b + ' ' + n.cat, ts)), [S.notes, q])
  const count = (c: NoteCat) => found.filter(n => n.cat === c).length
  const items = ['Toutes (' + found.length + ')', ...NOTE_CATS.map(c => c + ' (' + count(c) + ')')]
  const list = useMemo(() => found.filter(n => ci === 0 || n.cat === NOTE_CATS[ci - 1]).sort((a, b) => Date.parse(b.u) - Date.parse(a.u)), [found, ci])
  return (
    <>
      <div className="card"><h2>Nouvelle note</h2><NoteForm S={S} upd={upd} cat0={ci > 0 ? NOTE_CATS[ci - 1] : 'Rêves'} onDone={() => undefined} /></div>
      <div className="card" role="search"><label htmlFor="nq">Rechercher dans mes notes</label>
        <input id="nq" type="search" value={q} onChange={e => { setQ(e.target.value); setLim(20) }} placeholder="mot, titre, catégorie…" autoComplete="off" />
        <p className="mut" style={{ margin: '4px 0 0' }}><small>Recherche dans le titre, le texte et la catégorie, sans tenir compte des accents ni des majuscules. Plusieurs mots : tous doivent apparaître.</small></p></div>
      <Tabs items={items} v={ci} set={i => { setCi(i); setLim(20) }} label="Filtrer les notes par catégorie" S={S}>
        <p className="mut" role="status" style={{ margin: '4px 0' }}>{list.length} note{list.length > 1 ? 's' : ''}{ts.length ? ' pour « ' + q.trim() + ' »' : ''}.</p>
        {list.slice(0, lim).map(n => <NoteCard key={n.id} n={n} ts={ts} S={S} upd={upd} setM={setM} />)}
        {!list.length && <div className="card"><p style={{ margin: 0 }}>{ts.length ? 'Aucune note ne correspond à cette recherche.' : S.notes.length ? 'Aucune note dans cette catégorie.' : 'Aucune note pour le moment : écrivez la première ci-dessus.'}</p></div>}
        {list.length > lim && <p><button className="btn alt" onClick={() => setLim(lim + 20)}>Afficher plus ({list.length - lim} restantes)</button></p>}
      </Tabs>
    </>
  )
}

export default function NotesPage(p: P) {
  const [tab, setTab] = useTab(p.sub, ['notes', 'audio', 'prompteur', 'metronome'])
  return (
    <>
      <h1>Notes, dictaphone, prompteur</h1>
      <Flash m={p.m} />
      <Tabs items={['Notes', 'Dictaphone', 'Prompteur', 'Métronome']} v={tab} set={setTab} label="Section" S={p.S} wrap>
        {tab === 0 && <NotesTab {...p} />}
        {tab === 1 && <Dictaphone {...p} />}
        {tab === 2 && <Prompter {...p} />}
        {tab === 3 && <MetroTab {...p} />}
      </Tabs>
    </>
  )
}
