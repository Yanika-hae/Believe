import { useEffect, useState } from 'react'
import { uid } from './lib'
import { Gate } from './ui'
import type { P } from './ui'
import { putAudio, toBuf } from './idb'
import { discardRec, rec, recSupported, startRec, stopRec, useRec } from './rec'
import { mmss, size } from './util'

const OWNER = 'academie', MAX = 5 * 60_000
/**
 * Auto-écoute : on s'enregistre, on s'écoute, puis on jette l'enregistrement (par défaut) ou on le garde dans le dictaphone (rubrique 11).
 * Le micro n'est demandé qu'au clic, il est relâché à l'arrêt, et tout enregistrement non gardé est supprimé quand on quitte l'exercice.
 */
export default function Listen({ S, upd, setM, title }: Pick<P, 'S' | 'upd' | 'setM'> & { title: string }) {
  const r = useRec(), [busy, setBusy] = useState(false)
  useEffect(() => () => { if (rec.owner === OWNER) discardRec() }, [])
  const mine = r.owner === OWNER || r.st === 'idle'
  const keep = async () => {
    if (!r.blob) return
    setBusy(true)
    try {
      const data = await toBuf(r.blob), t = Date.now(), n = data.byteLength
      await putAudio({ id: uid('a'), title: title.slice(0, 120), cat: 'Apprentissages', t, ms: r.ms, type: r.type, data })
      discardRec()
      try { void navigator.storage?.persist?.() } catch { /* indisponible */ }
      setM({ t: 'Audio gardé dans le dictaphone (' + size(n) + ') : rubrique 11, onglet Dictaphone.' })
    } catch {
      setM({ e: 1, t: 'Audio non gardé : espace insuffisant ou stockage indisponible (navigation privée ?). Votre enregistrement reste ici tant que vous ne fermez pas cet exercice.' })
    } finally { setBusy(false) }
  }
  return (
    <section className="listen" aria-label="Auto-écoute">
      <h3>M’écouter</h3>
      <Gate k="mic" S={S} upd={upd} title="Microphone" why={<p>Believe enregistre le son uniquement quand vous appuyez sur « M’enregistrer ». L’enregistrement reste sur cet appareil, rien n’est envoyé, et il est supprimé dès que vous quittez cet exercice ou ce sujet, sauf si vous le gardez.</p>}>
        {!recSupported() && r.st === 'idle'
          ? <p className="ko">Ce navigateur ne permet pas d’enregistrer du son. Essayez Chrome (Android) ou Safari à jour (iPhone).</p>
          : !mine
            ? <p>Le micro est déjà utilisé par une autre rubrique (dictaphone). Terminez-y l’enregistrement d’abord.</p>
            : <>
              {r.err && <p className="ko" role="alert">{r.err}</p>}
              {r.st === 'idle' && <>
                <p className="mut" style={{ marginTop: 0 }}>Parlez, arrêtez, puis réécoutez-vous. Durée maximale : {MAX / 60000} minutes.</p>
                <button className="btn alt" onClick={() => { void startRec(OWNER, MAX) }}>M’enregistrer</button></>}
              {r.st === 'ask' && <p role="status">Autorisez le micro dans la fenêtre du navigateur… <button className="btn alt" onClick={discardRec}>Annuler</button></p>}
              {r.st === 'rec' && <>
                <p className="recnow"><span className="dot" aria-hidden="true" /> <b role="timer" aria-label="Durée enregistrée">{mmss(r.ms)}</b></p>
                <div className="row"><button className="btn" onClick={stopRec}>Arrêter et m’écouter</button><button className="btn alt" onClick={discardRec}>Abandonner</button></div></>}
              {r.st === 'done' && <>
                <audio controls src={r.url} style={{ width: '100%' }} aria-label="Écouter mon enregistrement" />
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn alt" disabled={busy} onClick={discardRec}>Jeter l’enregistrement</button>
                  <button className="btn alt" disabled={busy} onClick={keep}>Garder dans le dictaphone</button>
                  <button className="btn alt" disabled={busy} onClick={() => { discardRec(); void startRec(OWNER, MAX) }}>Réessayer</button></div>
                <p className="mut" style={{ margin: '6px 0 0' }}><small>Enregistrement de {mmss(r.ms)}, non conservé tant que vous ne le gardez pas.</small></p></>}
            </>}
      </Gate>
    </section>
  )
}
