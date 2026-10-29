import { useEffect, useRef, useState } from 'react'
import { dayPct, today } from './lib'
import type { State } from './lib'
import { FREE_NOTE, MODES, askAI, errText, setCode } from './ai'
import type { Mode, Msg as AMsg } from './ai'
import { canSay, say } from './ui'
import { MAX_Q, addSpoken, speechCtor, useDictation } from './dictation'
import type { P } from './ui'

const ctxOf = (s: State) => {
  const p = s.profile
  return p ? `Âge ${p.age} ans, taille ${p.h} cm, poids ${p.w} kg (cible ${p.t} kg), niveau ${p.lv === 'S' ? 'sédentaire' : p.lv === 'I' ? 'intermédiaire' : 'actif'}, habitudes validées aujourd’hui : ${dayPct(s, today())} %.` : 'Profil non renseigné.'
}

export default function AIPage({ S, upd }: P) {
  const [mode, setMode] = useState<Mode>('nutrition'), [ms, setMs] = useState<AMsg[]>([]), [inp, setInp] = useState(''), [cx, setCx] = useState(false)
  const [busy, setBusy] = useState(false), [er, setEr] = useState<string | null>(null), [mdl, setMdl] = useState(''), [cd, setCd] = useState('')
  const ac = useRef<AbortController | null>(null)
  const [askSpeech, setAskSpeech] = useState(false), [full, setFull] = useState(false), [note, setNote] = useState(''), cur = useRef(inp)
  cur.current = inp
  const dictBtn = useRef<HTMLButtonElement>(null), spHead = useRef<HTMLHeadingElement>(null), back = useRef(false)
  useEffect(() => { // le focus suit la carte d'accord : sur son titre quand elle s'ouvre, sur le bouton de dictée quand elle se ferme (sinon il retomberait en haut de la page)
    if (askSpeech) spHead.current?.focus()
    else if (back.current) { back.current = false; dictBtn.current?.focus() }
  }, [askSpeech])
  // Dictée vocale : le texte reconnu est ajouté au champ, que la personne relit ; rien n'est envoyé à l'IA sans le bouton « Envoyer ».
  const dict = useDictation(text => { const n = addSpoken(cur.current, text); if (n === null) setFull(true); else { cur.current = n; setInp(n); setFull(false); setNote('Texte dicté ajouté à votre question.') } })
  const send = async (text: string, base: AMsg[] = ms) => {
    const t = text.trim().slice(0, 4000)
    if (!t || busy) return
    dict.kill(); dict.setErr(null); setNote(''); setFull(false) // la question part : les messages de la dictée ne la concernent plus
    const next: AMsg[] = [...base, { role: 'user', content: t }]
    setMs(next); setInp(''); setEr(null); setBusy(true); ac.current = new AbortController()
    try { const r = await askAI(mode, next, cx ? ctxOf(S) : '', ac.current.signal); setMs([...next, { role: 'assistant', content: r.text }]); setMdl(r.model) }
    catch (e) { setEr((e as Error).message) } finally { setBusy(false) }
  }
  const last = ms[ms.length - 1]
  if (!S.consents.ai) return (
    <>
      <h1>Believe AI</h1>
      <div className="card"><h2>Consentement</h2>
        <p>Vos messages (et, si vous cochez la case, un contexte minimal : âge, taille, poids, niveau, habitudes du jour) sont envoyés au serveur de Believe, qui les transmet à Google (API Gemini) pour générer une réponse. Rien n’est envoyé sans action de votre part. Believe ne conserve pas ces échanges ; la conservation côté fournisseur relève de sa politique. {FREE_NOTE} Vous pouvez retirer ce consentement à tout moment dans Paramètres › Confidentialité.</p>
        <p className="mut">Les réponses sont générées par IA et peuvent contenir des erreurs. Believe AI n’est ni médecin, ni diététicien, ni psychologue, ni autorité spirituelle.</p>
        <button className="btn" onClick={() => upd(s => { s.consents.ai = true }, 'Consentement IA enregistré.')}>J’accepte l’envoi à l’IA</button></div>
    </>
  )
  return (
    <>
      <h1>Believe AI</h1>
      <div className="chips" role="group" aria-label="Mode">{MODES.map(x => <button key={x.k} className="chip" aria-pressed={mode === x.k} onClick={() => setMode(x.k)}>{x.t}</button>)}</div>
      <div className="chips">{MODES.find(x => x.k === mode)!.q.map(q => <button key={q} className="chip" onClick={() => setInp(q)}>{q}</button>)}</div>
      {ms.map((x, i) => (
        <div key={i} className={'bub ' + x.role}><p>{x.content}</p>
          {x.role === 'assistant' && <small className="mut">Généré par IA ({mdl || 'Gemini'}). Ne remplace pas un professionnel. {canSay && <button className="chip" onClick={() => say(x.content)}>Écouter</button>}</small>}</div>
      ))}
      {busy && <p className="mut" role="status">Believe AI réfléchit…</p>}
      {er && <p className="ko" role="alert">{errText(er)} {last?.role === 'user' && er !== 'not_configured' && <button className="chip" onClick={() => send(last.content, ms.slice(0, -1))}>Réessayer</button>}</p>}
      {er === 'code' && <div className="row"><input type="password" aria-label="Code d’accès" placeholder="Code d’accès" value={cd} onChange={e => setCd(e.target.value)} style={{ flex: '1 1 160px', width: 'auto' }} /><button className="btn" onClick={() => { setCode(cd.trim()); setEr(null) }}>Enregistrer le code</button></div>}
      <textarea rows={3} maxLength={MAX_Q} aria-label="Votre question" placeholder="Votre question" value={inp} onChange={e => setInp(e.target.value)} />
      <div className="row" style={{ margin: '6px 0' }}>
        {speechCtor()
          ? <button ref={dictBtn} className="btn alt" onClick={() => { if (dict.st !== 'idle') dict.stop(); else if (S.consents.speech) { setNote(''); setFull(false); dict.start() } else setAskSpeech(true) }}>{dict.st === 'idle' ? 'Dicter' : 'Arrêter la dictée'}</button>
          : <small className="mut">La dictée vocale n’est pas disponible dans ce navigateur : écrivez votre question au clavier.</small>}
        <small className="mut" aria-live="off">{dict.interim}</small>
      </div>
      <p className="mut" role="status">{dict.st === 'starting' ? 'Préparation du micro…' : dict.st === 'listening' ? 'Dictée en cours : parlez, puis faites une pause.' : note}</p>
      {dict.err && <p className="ko" role="alert">{dict.err}</p>}
      {full && <p className="ko" role="alert">La question est trop longue ({MAX_Q} caractères au plus) : la dernière phrase dictée n’a pas été ajoutée.</p>}
      {askSpeech && !S.consents.speech && (
        <div className="card" role="group" aria-labelledby="sp-h"><h2 id="sp-h" ref={spHead} tabIndex={-1}>Dictée vocale</h2>
          <p>La dictée utilise la reconnaissance vocale de votre navigateur, seulement le temps d’une phrase que vous lancez avec « Dicter ». <b>Selon le navigateur (Chrome, Safari), le son est envoyé à Google ou à Apple pour être transcrit.</b> Believe ne reçoit que le texte, ne garde aucun enregistrement, et rien n’est envoyé à l’IA tant que vous n’appuyez pas sur « Envoyer ».</p>
          <p className="mut">Accord retirable à tout moment dans Paramètres › Confidentialité. Le refus ne bloque pas le reste de l’application.</p>
          <div className="row"><button className="btn" onClick={() => { if (upd(s => { s.consents.speech = true }, 'Accord enregistré : dictée vocale.')) { back.current = true; setAskSpeech(false); setNote(''); dict.start() } }}>J’accepte et je dicte</button><button className="btn alt" onClick={() => { back.current = true; setAskSpeech(false) }}>Plus tard</button></div></div>
      )}
      <label className="rd" style={{ margin: '8px 0' }}><input type="checkbox" checked={cx} onChange={e => setCx(e.target.checked)} /> Inclure mon contexte (âge, taille, poids, niveau, habitudes du jour)</label>
      <div className="row">
        <button className="btn" disabled={busy || !inp.trim()} onClick={() => send(inp)}>Envoyer</button>
        {busy && <button className="btn alt" onClick={() => ac.current?.abort()}>Annuler</button>}
        <button className="btn alt" onClick={() => { dict.kill(); setMs([]); setEr(null) }}>Nouvelle conversation</button>
      </div>
    </>
  )
}
