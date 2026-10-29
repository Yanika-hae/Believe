import { useEffect, useRef, useState } from 'react'
import { hasVault, pinLen, readPin, validPin, verifyPin, waitMs } from './pin'
import { recoverWith } from './vaultops'

const fmt = (ms: number) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 12)

/** Écran de verrouillage : remplace toute l'application tant que le PIN n'est pas saisi (aucune donnée personnelle affichée). */
export default function Lock({ onUnlock, onForgot }: { onUnlock: () => void; onForgot: () => Promise<boolean> }) {
  const [n] = useState(pinLen), [vault] = useState(hasVault)
  const [d, setD] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false), [wait, setWait] = useState(() => waitMs()), [forgot, setForgot] = useState(false)
  const [rk, setRk] = useState(''), [p1, setP1] = useState(''), [p2, setP2] = useState(''), [rmsg, setRmsg] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (wait <= 0) return
    const i = setInterval(() => { const w = waitMs(); setWait(w); if (w <= 0) setMsg('') }, 500)
    return () => clearInterval(i)
  }, [wait > 0])
  const submit = async (pin: string) => {
    setBusy(true)
    const r = await verifyPin(pin)
    if (!alive.current) return
    setBusy(false); setD('')
    if (r.ok) return onUnlock()
    setWait(r.wait)
    setMsg(r.broken ? 'Le PIN est correct, mais les données chiffrées ne s’ouvrent pas avec lui. Utilisez votre clé de récupération (« PIN oublié ? »).' : r.wait > 0 ? '' : 'PIN incorrect. Il reste ' + r.left + ' essai' + (r.left > 1 ? 's' : '') + ' avant un blocage temporaire.')
  }
  const push = (c: string) => {
    if (busy || wait > 0 || forgot) return
    const x = (d + c).slice(0, n); setD(x); setMsg('')
    if (x.length === n) void submit(x)
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (forgot || (e.target as HTMLElement | null)?.closest?.('input,textarea')) return
      if (/^\d$/.test(e.key)) push(e.key)
      else if (e.key === 'Backspace') setD(x => x.slice(0, -1))
    }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  })
  const wipe = async () => { const ok = await onForgot(); if (!ok && alive.current) setMsg('Suppression non confirmée : le stockage n’a pas pu être vérifié.') }
  const recover = async () => {
    if (!validPin(p1)) return setRmsg('Le nouveau PIN doit comporter de 4 à 12 chiffres.')
    if (p1 !== p2) return setRmsg('Les deux saisies du nouveau PIN ne sont pas identiques.')
    setBusy(true); setRmsg('')
    const r = await recoverWith(rk, p1, readPin()?.a ?? 1)
    if (!alive.current) return
    setBusy(false)
    if (r === 'ok') return onUnlock()
    setRmsg(r === 'bad' ? 'Clé de récupération incorrecte ou mal recopiée (32 lettres et chiffres, par groupes de 4).' : r === 'pin' ? 'Le nouveau PIN doit comporter de 4 à 12 chiffres.' : 'Récupération impossible : le chiffrement du navigateur ou le stockage est indisponible.')
  }
  const dis = busy || wait > 0
  return (
    <div className="lock" role="dialog" aria-modal="true" aria-labelledby="lk-t">
      <span className="wm">BELIEVE</span>
      <h1 id="lk-t" style={{ fontSize: '1.5rem' }}>Saisissez votre PIN</h1>
      <div className="dots" style={n > 8 ? { gap: 8 } : undefined} role="img" aria-label={d.length + ' chiffre' + (d.length > 1 ? 's' : '') + ' saisi' + (d.length > 1 ? 's' : '') + ' sur ' + n}>{Array.from({ length: n }, (_, i) => <i key={i} className={i < d.length ? 'on' : ''} />)}</div>
      <p role="status" className={msg || wait > 0 ? 'ko' : 'mut'} style={{ minHeight: '1.6em', margin: '4px 0 10px', maxWidth: 340 }}>{wait > 0 ? 'Verrouillé : réessayez dans ' + fmt(wait) + '.' : msg}</p>
      <div className="pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(c => <button key={c} disabled={dis} onClick={() => push(c)}>{c}</button>)}
        <span /><button disabled={dis} onClick={() => push('0')}>0</button>
        <button aria-label="Effacer le dernier chiffre" disabled={dis} onClick={() => setD(x => x.slice(0, -1))}>⌫</button>
      </div>
      {!forgot
        ? <p><button className="chip" onClick={() => setForgot(true)}>PIN oublié ?</button></p>
        : <>
          {vault && <div className="card" style={{ maxWidth: 380, textAlign: 'left' }}>
            <h2 style={{ fontSize: '1.05rem' }}>J’ai ma clé de récupération</h2>
            <p className="mut" style={{ marginTop: 0 }}>Vos données sont chiffrées. La clé de récupération (32 lettres et chiffres) les rouvre, puis vous choisissez un nouveau PIN. Rien n’est effacé.</p>
            <label htmlFor="lk-rk">Clé de récupération</label>
            <input id="lk-rk" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={rk} onChange={e => setRk(e.target.value.slice(0, 64))} placeholder="XXXX-XXXX-XXXX-…" />
            <div className="grid2">
              <div><label htmlFor="lk-p1">Nouveau PIN (4 à 12 chiffres)</label><input id="lk-p1" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={12} value={p1} onChange={e => setP1(digits(e.target.value))} /></div>
              <div><label htmlFor="lk-p2">Confirmer le nouveau PIN</label><input id="lk-p2" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={12} value={p2} onChange={e => setP2(digits(e.target.value))} /></div>
            </div>
            {rmsg && <p className="ko" role="status">{rmsg}</p>}
            <p style={{ marginBottom: 0 }}><button className="btn" disabled={busy} onClick={recover}>Récupérer mes données</button></p>
          </div>}
          <div className="card" style={{ maxWidth: 380, textAlign: 'left' }}>
            <p style={{ marginTop: 0 }}>{vault ? 'Sans le PIN ni la clé de récupération' : 'Sans le PIN'}, la seule solution est d’effacer toutes les données Believe de cet appareil (profil, habitudes, notes, enregistrements audio). Elles ne pourront pas être récupérées.</p>
            <div className="row"><button className="btn" onClick={wipe}>Effacer et réinitialiser</button><button className="btn alt" onClick={() => { setForgot(false); setRmsg('') }}>Annuler</button></div></div>
        </>}
    </div>
  )
}
