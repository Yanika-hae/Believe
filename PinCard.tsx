import { useState } from 'react'
import { AUTO, PIN_MAX, PIN_MIN, hasPin, hasVault, readPin, removePin, setAuto, setPin, validPin, verifyPin } from './pin'
import { changePin, checkRecovery, disableVault, enableVault, newRecoveryKey } from './vaultops'
import type { Why } from './vaultops'
import { Dialog } from './ui'
import type { Msg } from './ui'

const LBL: Record<number, string> = { 0: 'Dès que l’application quitte l’écran', 1: 'Après 1 minute', 5: 'Après 5 minutes', 15: 'Après 15 minutes' }
const fmt = (ms: number) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s' }
const WHY: Record<Why, string> = {
  pin: 'Le PIN doit comporter de ' + PIN_MIN + ' à ' + PIN_MAX + ' chiffres.',
  already: 'Le chiffrement est déjà actif.',
  locked: 'Application verrouillée : saisissez d’abord votre PIN.',
  store: 'Non enregistré : le stockage du navigateur est plein ou indisponible. Rien n’a été modifié.',
  data: 'Vos données actuelles n’ont pas pu être relues : rien n’a été modifié.',
  crypto: 'Le chiffrement du navigateur est indisponible (il faut une page sécurisée HTTPS).',
  audio: 'Certains enregistrements audio n’ont pas pu être convertis : rien d’autre n’a été modifié et tout reste lisible.'
}
/** Force du PIN, dite sans promesse excessive : le PIN n'est protégé que par la lenteur de la dérivation. */
export const strength = (n: number) => n < 6
  ? 'PIN court : il écarte un regard curieux, mais quelqu’un qui copierait vos données chiffrées pourrait tester les ' + (10 ** n).toLocaleString('fr-FR') + ' combinaisons. Choisissez 8 chiffres ou plus pour une vraie protection.'
  : n < 8 ? 'PIN moyen (' + (10 ** n).toLocaleString('fr-FR') + ' combinaisons) : correct contre un voisin, limité contre un attaquant équipé. 8 chiffres ou plus protègent beaucoup mieux.'
    : 'PIN long (' + (10 ** n).toLocaleString('fr-FR') + ' combinaisons) : bonne protection pour un code numérique.'

type Mode = '' | 'change' | 'off' | 'encOn' | 'encOff' | 'rkNew' | 'rkCheck'

/** Fenêtre de la clé de récupération : montrée une seule fois, à noter avant de continuer. */
function RecoveryKey({ rk, onDone, setM }: { rk: string; onDone: () => void; setM: (m: Msg) => void }) {
  const [ok, setOk] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(rk); setM({ t: 'Clé de récupération copiée dans le presse-papiers.' }) } catch { setM({ e: 1, t: 'Copie impossible : recopiez la clé à la main.' }) }
  }
  const save = () => {
    try {
      const u = URL.createObjectURL(new Blob(['Believe — clé de récupération\n\n' + rk + '\n\nGardez ce fichier hors de cet appareil (gestionnaire de mots de passe, papier). Il rouvre vos données chiffrées si vous oubliez le PIN.\n'], { type: 'text/plain' }))
      const a = document.createElement('a'); a.href = u; a.download = 'believe-cle-de-recuperation.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000)
    } catch { setM({ e: 1, t: 'Téléchargement impossible : copiez ou recopiez la clé.' }) }
  }
  return (
    <Dialog open onClose={() => { if (ok) onDone() }} label="Votre clé de récupération">
      <h2 style={{ marginTop: 0 }}>Votre clé de récupération</h2>
      <p>Notez-la maintenant, ou copiez-la dans un endroit sûr (gestionnaire de mots de passe, papier rangé). <b>Elle ne sera plus jamais affichée.</b> Elle rouvre vos données si vous oubliez le PIN, et sert à les retrouver sur un autre appareil. Sans le PIN ni cette clé, personne ne peut récupérer vos données, pas même le développeur de l’application.</p>
      <p><code data-testid="rk" style={{ display: 'block', fontSize: '1.15rem', letterSpacing: '.06em', padding: 12, border: '1px solid var(--line)', borderRadius: 10, wordBreak: 'break-all', userSelect: 'all' }}>{rk}</code></p>
      <div className="row"><button className="btn alt" onClick={copy}>Copier</button><button className="btn alt" onClick={save}>Télécharger en fichier texte</button></div>
      <p><label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} style={{ width: 'auto', marginTop: 4 }} /><span>J’ai conservé cette clé en lieu sûr, hors de cet appareil.</span></label></p>
      <button className="btn" disabled={!ok} onClick={onDone}>Terminer</button>
    </Dialog>
  )
}

/** Réglage du PIN et du chiffrement des données. Les messages de succès n'apparaissent qu'après écriture vérifiée (relecture). */
export default function PinCard({ setM, onChange }: { setM: (m: Msg) => void; onChange: () => void }) {
  const [on, setOn] = useState(hasPin), [enc, setEnc] = useState(hasVault), [cur, setCur] = useState(''), [a, setA] = useState(''), [b, setB] = useState(''), [auto, setAutoV] = useState(() => readPin()?.a ?? 1)
  const [mode, setMode] = useState<Mode>(''), [busy, setBusy] = useState(false), [wantEnc, setWantEnc] = useState(true), [rk, setRk] = useState<string | null>(null), [chk, setChk] = useState('')
  const refresh = () => { setOn(hasPin()); setEnc(hasVault()); onChange() }
  const reset = () => { setCur(''); setA(''); setB(''); setChk(''); setMode('') }
  const digits = (set: (v: string) => void) => (e: { target: { value: string } }) => set(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))
  const field = (id: string, label: string, v: string, set: (v: string) => void) => (
    <div><label htmlFor={id}>{label}</label><input id={id} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={PIN_MAX} value={v} onChange={digits(set)} /></div>
  )
  /** Contrôle l'ancien PIN (compte comme un essai) ; renvoie true s'il est correct. */
  const checkCur = async () => {
    const r = await verifyPin(cur)
    if (r.ok) return true
    setM({ e: 1, t: r.broken ? 'Le PIN est correct mais les données chiffrées ne s’ouvrent pas avec lui : utilisez la clé de récupération.' : r.wait > 0 ? 'Trop d’essais : réessayez dans ' + fmt(r.wait) + '.' : 'PIN actuel incorrect. Il reste ' + r.left + ' essai' + (r.left > 1 ? 's' : '') + ' avant un blocage temporaire.' })
    return false
  }
  const newPinOk = () => {
    if (!validPin(a)) { setM({ e: 1, t: WHY.pin }); return false }
    if (a !== b) { setM({ e: 1, t: 'Les deux saisies ne sont pas identiques.' }); return false }
    return true
  }
  const audioNote = (n: number) => (n > 0 ? ' ' + n + ' enregistrement' + (n > 1 ? 's' : '') + ' audio n’' + (n > 1 ? 'ont' : 'a') + ' pas pu être chiffré' + (n > 1 ? 's' : '') + ' (' + (n > 1 ? 'ils restent lisibles' : 'il reste lisible') + ', non chiffré' + (n > 1 ? 's' : '') + ').' : '')

  const activate = async () => {
    if (!newPinOk()) return
    setBusy(true)
    try {
      if (wantEnc) {
        const r = await enableVault(a, auto)
        if (!r.ok) return setM({ e: 1, t: WHY[r.why] })
        reset(); refresh(); setRk(r.rk); setM({ t: 'PIN activé et données chiffrées.' + audioNote(r.audioFailed) })
      } else {
        if (!(await setPin(a, auto))) return setM({ e: 1, t: 'PIN non enregistré : le chiffrement du navigateur (page sécurisée HTTPS requise) ou le stockage est indisponible.' })
        reset(); refresh(); setM({ t: 'PIN activé : l’application se verrouillera selon le délai choisi. Vos données ne sont pas chiffrées.' })
      }
    } finally { setBusy(false) }
  }
  const change = async () => {
    if (!newPinOk()) return
    setBusy(true)
    try {
      if (!(await checkCur())) return
      const r = await changePin(a, auto)
      if (!r.ok) return setM({ e: 1, t: WHY[r.why] })
      reset(); refresh(); setM({ t: enc ? 'PIN modifié. Vos données chiffrées se rouvrent avec le nouveau PIN.' : 'PIN modifié.' })
    } finally { setBusy(false) }
  }
  const turnOnEnc = async () => {
    setBusy(true)
    try {
      if (!(await checkCur())) return
      const r = await enableVault(cur, auto)
      if (!r.ok) return setM({ e: 1, t: WHY[r.why] })
      reset(); refresh(); setRk(r.rk); setM({ t: 'Chiffrement activé.' + audioNote(r.audioFailed) })
    } finally { setBusy(false) }
  }
  const turnOffEnc = async () => {
    setBusy(true)
    try {
      if (!(await checkCur())) return
      const r = await disableVault(true)
      if (!r.ok) return setM({ e: 1, t: WHY[r.why] })
      reset(); refresh(); setM({ t: 'Chiffrement arrêté : vos données sont de nouveau stockées en clair sur cet appareil. Le PIN reste actif.' })
    } finally { setBusy(false) }
  }
  const disable = async () => {
    setBusy(true)
    try {
      if (!(await checkCur())) return
      if (enc) { const r = await disableVault(false); if (!r.ok) return setM({ e: 1, t: WHY[r.why] }) }
      else if (!removePin()) return setM({ e: 1, t: 'PIN non désactivé : le stockage n’a pas confirmé la suppression.' })
      reset(); refresh(); setM({ t: enc ? 'PIN et chiffrement désactivés : vos données sont en clair sur cet appareil.' : 'PIN désactivé.' })
    } finally { setBusy(false) }
  }
  const newKey = async () => {
    setBusy(true)
    try {
      if (!(await checkCur())) return
      const k = await newRecoveryKey()
      if (!k) return setM({ e: 1, t: 'Nouvelle clé non créée : rien n’a été modifié.' })
      reset(); setRk(k); setM({ t: 'Nouvelle clé de récupération créée : l’ancienne ne fonctionne plus.' })
    } finally { setBusy(false) }
  }
  const check = async () => {
    setBusy(true)
    try { const ok = await checkRecovery(chk); setM(ok ? { t: 'Cette clé de récupération est la bonne.' } : { e: 1, t: 'Cette clé ne correspond pas (ou a été remplacée par une plus récente).' }); if (ok) reset() } finally { setBusy(false) }
  }
  const delay = (e: { target: { value: string } }) => {
    const v = +e.target.value
    if (on) { if (!setAuto(v)) return setM({ e: 1, t: 'Délai non enregistré.' }); onChange(); setM({ t: 'Verrouillage automatique : ' + LBL[v].toLowerCase() + '.' }) }
    setAutoV(v)
  }
  const pinHelp = (v: string) => (v.length >= PIN_MIN ? <p className="mut" style={{ margin: '4px 0 0' }}>{strength(v.length)}</p> : null)
  return (
    <div className="card"><h2>Code PIN et chiffrement des données</h2>
      <p className="mut">Un PIN de {PIN_MIN} à {PIN_MAX} chiffres verrouille l’application à l’ouverture et après le délai choisi ; après 5 erreurs, l’accès est bloqué de plus en plus longtemps, même si vous rechargez la page. Avec le <b>chiffrement</b>, vos données (profil, habitudes, notes, prières, audio) sont aussi illisibles dans le stockage du navigateur sans le PIN. Le PIN ne vaut que par sa longueur : il est ralenti par une dérivation lente (PBKDF2), mais quelqu’un qui copierait les données chiffrées pourrait essayer tous les PIN hors de l’application. La <b>clé de récupération</b> rouvre vos données si vous oubliez le PIN.</p>
      <label htmlFor="pin-auto">Verrouillage automatique</label>
      <select id="pin-auto" value={auto} onChange={delay}>{AUTO.map(v => <option key={v} value={v}>{LBL[v]}</option>)}</select>
      {!on && <>
        <div className="grid2" style={{ marginTop: 10 }}>{field('pin-new', 'Nouveau PIN (' + PIN_MIN + ' à ' + PIN_MAX + ' chiffres)', a, setA)}{field('pin-conf', 'Confirmer le PIN', b, setB)}</div>
        {pinHelp(a)}
        <p><label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={wantEnc} onChange={e => setWantEnc(e.target.checked)} style={{ width: 'auto', marginTop: 4 }} /><span>Chiffrer mes données avec ce PIN (recommandé). Une clé de récupération me sera donnée.</span></label></p>
        <p style={{ marginBottom: 0 }}><button className="btn" disabled={busy} onClick={activate}>Activer le PIN</button></p></>}
      {on && <>
        <p className="ok" style={{ marginBottom: 6 }}>PIN actif. {enc ? 'Données chiffrées sur cet appareil.' : 'Données non chiffrées.'}</p>
        {mode === '' && <div className="row">
          <button className="btn alt" onClick={() => setMode('change')}>Changer le PIN</button>
          {!enc && <button className="btn alt" onClick={() => setMode('encOn')}>Chiffrer mes données</button>}
          {enc && <button className="btn alt" onClick={() => setMode('rkNew')}>Nouvelle clé de récupération</button>}
          {enc && <button className="btn alt" onClick={() => setMode('rkCheck')}>Vérifier ma clé de récupération</button>}
          {enc && <button className="btn alt" onClick={() => setMode('encOff')}>Arrêter le chiffrement</button>}
          <button className="btn alt" onClick={() => setMode('off')}>Désactiver le PIN</button>
        </div>}
        {mode === 'change' && <><div className="grid2">{field('pin-cur', 'PIN actuel', cur, setCur)}{field('pin-new', 'Nouveau PIN (' + PIN_MIN + ' à ' + PIN_MAX + ' chiffres)', a, setA)}{field('pin-conf', 'Confirmer le nouveau PIN', b, setB)}</div>
          {pinHelp(a)}
          <p className="row"><button className="btn" disabled={busy} onClick={change}>Enregistrer le nouveau PIN</button><button className="btn alt" onClick={reset}>Annuler</button></p></>}
        {mode === 'encOn' && <><p>Vos données actuelles (et vos enregistrements audio) seront chiffrées avec votre PIN. Une clé de récupération vous sera montrée une seule fois.</p><div className="grid2">{field('pin-cur', 'PIN actuel', cur, setCur)}</div>
          <p className="row"><button className="btn" disabled={busy} onClick={turnOnEnc}>Chiffrer mes données</button><button className="btn alt" onClick={reset}>Annuler</button></p></>}
        {mode === 'encOff' && <><p>Vos données seront de nouveau stockées en clair sur cet appareil ; le PIN continuera de verrouiller l’application. La clé de récupération ne servira plus.</p><div className="grid2">{field('pin-cur', 'PIN actuel', cur, setCur)}</div>
          <p className="row"><button className="btn" disabled={busy} onClick={turnOffEnc}>Arrêter le chiffrement</button><button className="btn alt" onClick={reset}>Annuler</button></p></>}
        {mode === 'rkNew' && <><p>Une nouvelle clé de récupération sera créée ; l’ancienne cessera de fonctionner.</p><div className="grid2">{field('pin-cur', 'PIN actuel', cur, setCur)}</div>
          <p className="row"><button className="btn" disabled={busy} onClick={newKey}>Créer une nouvelle clé</button><button className="btn alt" onClick={reset}>Annuler</button></p></>}
        {mode === 'rkCheck' && <><p>Recopiez la clé que vous avez conservée : elle est vérifiée sans rien modifier.</p><label htmlFor="rk-chk">Clé de récupération</label><input id="rk-chk" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={chk} onChange={e => setChk(e.target.value.slice(0, 64))} placeholder="XXXX-XXXX-XXXX-…" />
          <p className="row"><button className="btn" disabled={busy} onClick={check}>Vérifier la clé</button><button className="btn alt" onClick={reset}>Annuler</button></p></>}
        {mode === 'off' && <><p>{enc ? 'Le PIN et le chiffrement seront désactivés : vos données seront stockées en clair sur cet appareil.' : 'Le PIN sera désactivé.'}</p><div className="grid2">{field('pin-cur', 'PIN actuel', cur, setCur)}</div>
          <p className="row"><button className="btn" disabled={busy} onClick={disable}>Confirmer la désactivation</button><button className="btn alt" onClick={reset}>Annuler</button></p></>}
      </>}
      {rk && <RecoveryKey rk={rk} setM={setM} onDone={() => setRk(null)} />}
    </div>
  )
}
