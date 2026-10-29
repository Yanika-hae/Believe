import { useCallback, useEffect, useState } from 'react'
import { NOTE_CATS, uid } from './lib'
import type { NoteCat } from './lib'
import { Gate } from './ui'
import type { P } from './ui'
import { delAudio, getAudio, listAudios, putAudio, renameAudio, toBuf } from './idb'
import type { AudioMeta } from './idb'
import { MAX_MS, discardRec, extOf, recSupported, startRec, stopRec, useRec } from './rec'
import { mmss, size } from './util'

const stamp = (t: number) => { const d = new Date(t); return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }
const fileName = (title: string, type: string) => (title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'audio-believe') + '.' + extOf(type)
/** Télécharge un Blob comme fichier (copie de sécurité hors du navigateur). */
const saveAs = (url: string, name: string) => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove() }

function Recorder({ setM, onSaved }: { setM: P['setM']; onSaved: () => void }) {
  const r = useRec(), [title, setTitle] = useState(''), [cat, setCat] = useState<NoteCat>('Rêves'), [busy, setBusy] = useState(false)
  const mine = r.owner === 'dictaphone' || r.st === 'idle'
  const save = async () => {
    if (!r.blob) return
    setBusy(true)
    try {
      const data = await toBuf(r.blob), t = Date.now()
      await putAudio({ id: uid('a'), title: title.trim() || 'Audio du ' + stamp(t), cat, t, ms: r.ms, type: r.type, data })
      const n = data.byteLength
      discardRec(); setTitle(''); onSaved()
      try { void navigator.storage?.persist?.() } catch { /* indisponible */ }
      setM({ t: 'Audio enregistré sur cet appareil (' + size(n) + ').' })
    } catch {
      setM({ e: 1, t: 'Audio non enregistré : espace insuffisant ou stockage indisponible (navigation privée ?). Votre enregistrement reste ici : téléchargez-en une copie.' })
    } finally { setBusy(false) }
  }
  if (!recSupported() && r.st === 'idle') return <div className="card"><h2>Enregistrer</h2><p className="ko">Ce navigateur ne permet pas d’enregistrer du son. Essayez Chrome (Android) ou Safari à jour (iPhone).</p></div>
  if (!mine) return <div className="card"><h2>Enregistrer</h2><p>Le micro est déjà utilisé par une autre rubrique. Terminez-y l’enregistrement d’abord.</p></div>
  return (
    <div className="card"><h2>Enregistrer</h2>
      {r.err && <p className="ko" role="alert">{r.err}</p>}
      {r.st === 'idle' && <>
        <p className="mut">Le micro ne s’active que lorsque vous appuyez sur le bouton. Durée maximale : {MAX_MS / 60000} minutes. L’audio reste sur cet appareil.</p>
        <button className="rbtn" onClick={() => { void startRec('dictaphone') }}><i aria-hidden="true" />Enregistrer</button></>}
      {r.st === 'ask' && <p role="status">Autorisez le micro dans la fenêtre du navigateur… <button className="btn alt" onClick={discardRec}>Annuler</button></p>}
      {r.st === 'rec' && <>
        <p className="recnow"><span className="dot" aria-hidden="true" /> <b role="timer" aria-label="Durée enregistrée">{mmss(r.ms)}</b> <span className="mut">sur {MAX_MS / 60000}:00</span></p>
        <div className="row"><button className="btn" onClick={stopRec}>Arrêter</button><button className="btn alt" onClick={discardRec}>Abandonner</button></div></>}
      {r.st === 'done' && <>
        <p className="ok">Enregistrement terminé : {mmss(r.ms)}, pas encore sauvegardé. Écoutez-le, puis sauvegardez-le ou jetez-le.</p>
        <audio controls src={r.url} style={{ width: '100%' }} aria-label="Écouter l’enregistrement" />
        <div className="grid2" style={{ marginTop: 8 }}>
          <div><label htmlFor="at">Titre (facultatif)</label><input id="at" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="Audio du jour" /></div>
          <div><label htmlFor="ac">Catégorie</label><select id="ac" value={cat} onChange={e => setCat(e.target.value as NoteCat)}>{NOTE_CATS.map(c => <option key={c}>{c}</option>)}</select></div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" disabled={busy} onClick={save}>Sauvegarder sur l’appareil</button>
          <a className="btn alt" href={r.url} download={fileName(title, r.type)}>Télécharger une copie</a>
          <button className="btn alt" disabled={busy} onClick={discardRec}>Jeter</button></div></>}
    </div>
  )
}

function AudioItem({ m, onChange, setM }: { m: AudioMeta; onChange: () => void; setM: P['setM'] }) {
  const [url, setUrl] = useState(''), [load, setLoad] = useState(false), [ren, setRen] = useState<string | null>(null), [del, setDel] = useState(false)
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  const blob = async () => { const r = await getAudio(m.id); if (!r) throw new Error('absent'); return new Blob([r.data], { type: r.type }) }
  const fail = () => setM({ e: 1, t: 'Cet audio est introuvable ou illisible dans le stockage du navigateur.' })
  const play = async () => { setLoad(true); try { setUrl(URL.createObjectURL(await blob())) } catch { fail() } finally { setLoad(false) } }
  const download = async () => {
    try { const u = URL.createObjectURL(await blob()); saveAs(u, fileName(m.title, m.type)); setTimeout(() => URL.revokeObjectURL(u), 10000) } catch { fail() }
  }
  const rename = async () => {
    const t = (ren ?? '').trim()
    if (!t) return setM({ e: 1, t: 'Le titre ne peut pas être vide.' })
    try { if (await renameAudio(m.id, t)) { setRen(null); onChange(); setM({ t: 'Titre modifié.' }) } else setM({ e: 1, t: 'Titre non modifié : audio introuvable.' }) } catch { setM({ e: 1, t: 'Titre non modifié : stockage indisponible.' }) }
  }
  const remove = async () => {
    try {
      if (await delAudio(m.id)) { if (url) { URL.revokeObjectURL(url); setUrl('') } onChange(); setM({ t: 'Audio supprimé de cet appareil (vérifié).' }) } else setM({ e: 1, t: 'Suppression non confirmée : l’audio est toujours présent.' })
    } catch { setM({ e: 1, t: 'Suppression non confirmée : stockage indisponible.' }) }
    setDel(false)
  }
  return (
    <article className="card note" aria-label={'Audio ' + m.title}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {ren === null ? <h3>{m.title}</h3> : <form className="row" style={{ flex: 1 }} onSubmit={e => { e.preventDefault(); void rename() }}><label className="sr" htmlFor={'rn' + m.id}>Nouveau titre</label><input id={'rn' + m.id} style={{ flex: 1 }} maxLength={120} value={ren} onChange={e => setRen(e.target.value)} autoFocus /><button className="chip" type="submit">Valider le titre</button><button className="chip" type="button" onClick={() => setRen(null)}>Annuler</button></form>}
        <span className="tag">{m.cat}</span></div>
      <p className="mut" style={{ margin: '0 0 8px' }}><small>{stamp(m.t)} · {mmss(m.ms)} · {size(m.size)}</small></p>
      {url && <audio controls autoPlay src={url} style={{ width: '100%' }} aria-label={'Écouter ' + m.title} />}
      <div className="row">
        {!url ? <button className="chip" disabled={load} aria-label={'Écouter ' + m.title} onClick={play}>{load ? 'Chargement…' : 'Écouter'}</button> : <button className="chip" aria-label={'Fermer le lecteur de ' + m.title} onClick={() => setUrl('')}>Fermer le lecteur</button>}
        <button className="chip" aria-label={'Renommer ' + m.title} onClick={() => setRen(m.title)}>Renommer</button>
        <button className="chip" aria-label={'Télécharger ' + m.title} onClick={download}>Télécharger</button>
        {del
          ? <><button className="chip" aria-label={'Confirmer la suppression de ' + m.title} onClick={remove}>Confirmer la suppression</button><button className="chip" onClick={() => setDel(false)}>Annuler</button></>
          : <button className="chip" aria-label={'Supprimer ' + m.title} onClick={() => setDel(true)}>Supprimer</button>}
      </div>
    </article>
  )
}

function StorageInfo({ list }: { list: AudioMeta[] }) {
  const [est, setEst] = useState<{ u: number; q: number } | null>(null), [per, setPer] = useState<boolean | null>(null)
  useEffect(() => {
    let on = true
    try { navigator.storage?.estimate?.().then(e => { if (on) setEst({ u: e.usage ?? 0, q: e.quota ?? 0 }) }, () => undefined) } catch { /* indisponible */ }
    try { navigator.storage?.persisted?.().then(v => { if (on) setPer(v) }, () => undefined) } catch { /* indisponible */ }
    return () => { on = false }
  }, [list.length])
  return (
    <div className="card"><h2>Stockage</h2>
      <p>{list.length} audio{list.length > 1 ? 's' : ''}, {size(list.reduce((a, b) => a + b.size, 0))} sur cet appareil.{est && est.q ? ' Navigateur : ' + size(est.u) + ' utilisés sur ' + size(est.q) + ' (estimation).' : ''}</p>
      <p className="mut"><small>Les audios vivent dans le navigateur, pas dans un cloud. Le navigateur peut les effacer si l’appareil manque de place, et Safari efface les données des sites inutilisés pendant 7 jours sauf si l’application est installée sur l’écran d’accueil. {per === true ? 'Protection contre l’effacement automatique : accordée.' : per === false ? 'Protection contre l’effacement automatique : non accordée.' : ''} Pour un audio important, utilisez « Télécharger » et gardez le fichier ailleurs.</small></p></div>
  )
}

export default function Dictaphone({ S, upd, setM }: P) {
  const [list, setList] = useState<AudioMeta[] | null>(null), [bad, setBad] = useState(''), [f, setF] = useState('')
  const reload = useCallback(async () => {
    try { setList(await listAudios()); setBad('') } catch { setList([]); setBad('Le stockage des enregistrements est indisponible (navigation privée ou stockage bloqué).') }
  }, [])
  useEffect(() => { void reload() }, [reload])
  const shown = (list ?? []).filter(a => !f || a.cat === f)
  return (
    <>
      <Gate k="mic" S={S} upd={upd} title="Microphone" why={<p>Believe enregistre le son uniquement quand vous appuyez sur « Enregistrer ». L’audio reste sur cet appareil ; rien n’est envoyé. Vos audios déjà enregistrés restent écoutables sans cet accord.</p>}>
        <Recorder setM={setM} onSaved={reload} />
      </Gate>
      <h2>Mes enregistrements</h2>
      {bad && <p className="ko" role="alert">{bad}</p>}
      {list === null && <p className="mut" role="status">Chargement…</p>}
      {list && list.length > 0 && <div className="chips" role="group" aria-label="Filtrer les audios par catégorie">
        <button className="chip" aria-pressed={f === ''} onClick={() => setF('')}>Tous ({list.length})</button>
        {NOTE_CATS.map(c => <button key={c} className="chip" aria-pressed={f === c} onClick={() => setF(c)}>{c} ({list.filter(a => a.cat === c).length})</button>)}</div>}
      {list && !list.length && !bad && <div className="card"><p style={{ margin: 0 }}>Aucun enregistrement pour le moment.</p></div>}
      {shown.map(a => <AudioItem key={a.id} m={a} onChange={reload} setM={setM} />)}
      {list && list.length > 0 && <StorageInfo list={list} />}
    </>
  )
}
