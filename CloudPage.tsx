// Paramètres › Compte : compte en ligne FACULTATIF (connexion Google) et synchronisation des données entre appareils.
// Rien ici n'est nécessaire au reste de l'application ; chaque usage du compte a son propre réglage et son propre message d'état (jamais « fait » avant confirmation).
import { useEffect, useState, useSyncExternalStore } from 'react'
import * as C from './cloud'
import * as Y from './sync'
import * as A from './account'
import { load } from './lib'
import { hasPin, verifyPin } from './pin'
import { Dialog, Gate } from './ui'
import type { Msg, P } from './ui'
import { size } from './util'

const fmtDate = (d: string | number | null | undefined) => {
  if (d === null || d === undefined || d === '') return '—'
  const t = new Date(d)
  return isNaN(t.getTime()) ? '—' : t.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}
/** Phrase affichée pour chaque raison d'arrêt ou d'échec de la synchronisation. */
export const WHY: Record<Y.Why, string> = {
  off: '',
  consent: 'L’accord « Compte en ligne » est retiré : rien n’est envoyé ni reçu.',
  config: 'Le compte en ligne n’est pas disponible pour le moment.',
  signin: 'Connexion expirée ou refusée : reconnectez-vous avec Google.',
  account: 'Cet appareil est connecté à un autre compte Google que celui de la synchronisation. Reconnectez le bon compte, ou activez la synchronisation pour le compte actuel (la clé et les repères de l’autre compte seront oubliés ici).',
  key: 'Aucune clé de synchronisation sur cet appareil : saisissez-la.',
  badkey: 'La clé ne correspond plus aux données en ligne (clé changée depuis un autre appareil, ou données en ligne altérées). Saisissez la clé actuelle.',
  locked: 'Application verrouillée : saisissez votre PIN.',
  data: 'Vos données locales n’ont pas pu être relues : rien n’est envoyé.',
  offline: 'Hors ligne : la synchronisation reprendra au retour du réseau.',
  server: 'Le service ne répond pas correctement. Un nouvel essai aura lieu plus tard.',
  schema: 'Le compte en ligne est momentanément indisponible : réessayez plus tard.',
  big: 'Vos données dépassent la taille maximale synchronisable (environ 2,5 Mo une fois chiffrées). Allégez-les (notes, historique) ou exportez-les, puis réessayez.',
  toonew: 'Les données en ligne viennent d’une version plus récente de Believe : mettez l’application à jour.',
  badformat: 'Les données en ligne ne sont pas dans un format que cette version comprend. Rien n’a été modifié ici.',
  conflict: 'Deux versions différentes existent : choisissez celle à garder.',
  store: 'Enregistrement local impossible (stockage plein ou indisponible). Rien n’a été remplacé.',
  busy: 'Trop de modifications simultanées. Réessayez dans un instant.',
  changed: 'La version en ligne vient de changer : relisez la comparaison, puis choisissez de nouveau.'
}
const KEYWHY: Record<string, string> = {
  format: 'Cette clé n’a pas la bonne forme : 8 groupes de 4 lettres (A à Z) et chiffres (2 à 7), par exemple ABCD-EF23-… Les tirets, espaces et majuscules importent peu.',
  badkey: 'Cette clé n’ouvre pas les données en ligne (clé incorrecte, ou données en ligne altérées). Rien n’a été enregistré.',
  empty: 'Aucune donnée n’est en ligne pour ce compte : il n’y a rien à ouvrir avec une clé. Activez la synchronisation sur l’appareil qui contient vos données.'
}
const keyWhy = (w: string) => KEYWHY[w] ?? WHY[w as Y.Why] ?? 'Échec inattendu.'

/** Enregistre du texte dans un fichier téléchargé. Renvoie false si le navigateur refuse. */
function download(name: string, text: string, type = 'text/plain'): boolean {
  try {
    const u = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a')
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000)
    return true
  } catch { return false }
}
const copyText = async (t: string) => { try { await navigator.clipboard.writeText(t); return true } catch { return false } }

// ---------------------------------------------------------------- fenêtres
/** Clé de synchronisation : montrée à la création (à confirmer avant de continuer) ou à la demande. */
function KeyDialog({ k, first, onDone, setM }: { k: string; first: boolean; onDone: () => void; setM: (m: Msg) => void }) {
  const [ok, setOk] = useState(false)
  const copy = async () => setM((await copyText(k)) ? { t: 'Clé de synchronisation copiée dans le presse-papiers.' } : { e: 1, t: 'Copie impossible : recopiez la clé à la main.' })
  const save = () => { if (!download('believe-cle-de-synchronisation.txt', 'Believe — clé de synchronisation\n\n' + k + '\n\nGardez ce fichier hors de cet appareil (gestionnaire de mots de passe, papier). Elle est nécessaire pour ouvrir vos données sur un autre appareil. Sans elle, personne ne peut les lire, pas même le développeur de l’application.\n')) setM({ e: 1, t: 'Téléchargement impossible : copiez ou recopiez la clé.' }) }
  return (
    <Dialog open onClose={() => { if (!first || ok) onDone() }} label="Votre clé de synchronisation">
      <h2 style={{ marginTop: 0 }}>Votre clé de synchronisation</h2>
      <p>{first ? <>Notez-la maintenant : <b>elle est nécessaire pour ouvrir vos données sur un autre appareil</b>. </> : null}Vos données sont chiffrées sur cet appareil avec cette clé avant d’être envoyées : le service ne la reçoit jamais et ne peut pas les lire. Sans elle, personne ne peut les récupérer, pas même le développeur de l’application. Vous pourrez la réafficher ici.</p>
      <p><code data-testid="synckey" style={{ display: 'block', fontSize: '1.15rem', letterSpacing: '.06em', padding: 12, border: '1px solid var(--line)', borderRadius: 10, wordBreak: 'break-all', userSelect: 'all' }}>{k}</code></p>
      <div className="row"><button className="btn alt" onClick={copy}>Copier</button><button className="btn alt" onClick={save}>Télécharger en fichier texte</button></div>
      {first && <p><label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} style={{ width: 'auto', marginTop: 4 }} /><span>J’ai conservé cette clé en lieu sûr, hors de cet appareil.</span></label></p>}
      <button className="btn" disabled={first && !ok} onClick={onDone}>{first ? 'Terminer' : 'Fermer'}</button>
    </Dialog>
  )
}
/** Redemande le PIN avant de réafficher la clé (le PIN verrouille l'interface ; les essais comptent comme à l'écran de verrouillage). */
function PinAsk({ onOk, onCancel, setM }: { onOk: () => void; onCancel: () => void; setM: (m: Msg) => void }) {
  const [pin, setPin] = useState(''), [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    const r = await verifyPin(pin)
    setBusy(false)
    if (r.ok) return onOk()
    setPin('')
    setM({ e: 1, t: r.broken ? 'Le PIN est correct mais les données chiffrées ne s’ouvrent pas avec lui : utilisez la clé de récupération.' : r.wait > 0 ? 'Trop d’essais : réessayez dans ' + Math.ceil(r.wait / 1000) + ' s.' : 'PIN incorrect. Il reste ' + r.left + ' essai' + (r.left > 1 ? 's' : '') + ' avant un blocage temporaire.' })
  }
  return (
    <Dialog open onClose={onCancel} label="Saisissez votre PIN">
      <h2 style={{ marginTop: 0 }}>Saisissez votre PIN</h2>
      <p className="mut">Par précaution, le PIN est redemandé avant d’afficher la clé de synchronisation.</p>
      <label htmlFor="sk-pin">PIN</label><input id="sk-pin" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={12} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} />
      <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={busy || pin.length < 4} onClick={go}>Afficher la clé</button><button className="btn alt" onClick={onCancel}>Annuler</button></div>
    </Dialog>
  )
}
/** Confirmation d'une action qui détruit quelque chose : le texte dit exactement quoi. */
function Confirm({ title, children, yes, onYes, onNo, busy }: { title: string; children: React.ReactNode; yes: string; onYes: () => void; onNo: () => void; busy?: boolean }) {
  return (
    <Dialog open onClose={onNo} label={title}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>{children}
      <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={busy} onClick={onYes}>{yes}</button><button className="btn alt" onClick={onNo}>Annuler</button></div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- connexion
type Cfg = C.CfgRes | null
function useConfig(): [Cfg, (force?: boolean) => void] {
  const [cfg, setCfg] = useState<Cfg>(null)
  const load = (force = false) => { setCfg(null); void C.getConfig(force).then(setCfg) }
  useEffect(() => { load() }, [])
  return [cfg, load]
}
function Connexion({ setM, bump }: { setM: (m: Msg) => void; bump: () => void }) {
  const [cfg, reload] = useConfig(), [busy, setBusy] = useState(false), [schema, setSchema] = useState<string | null>(null)
  const s = C.getSession()
  useEffect(() => {
    if (!cfg?.ok) return
    let live = true
    C.ping().then(r => { if (live) setSchema(r.v === 1 ? null : WHY.schema) }, e => { if (live) setSchema(e instanceof C.CloudError && e.code === 'schema' ? WHY.schema : null) })
    return () => { live = false }
  }, [cfg])
  const signIn = async () => {
    setBusy(true)
    const r = await C.startGoogle()
    if (!r.ok) { setBusy(false); setM({ e: 1, t: r.why === 'store' ? 'Connexion impossible : le stockage du navigateur est plein ou indisponible.' : r.why === 'crypto' ? 'Connexion impossible : le chiffrement n’est pas disponible dans ce navigateur (ouvrez Believe depuis son adresse sécurisée, en https).' : r.why === 'offline' ? 'Hors ligne : impossible de joindre le serveur de Believe.' : WHY.config }) }
  }
  const out = async () => { setBusy(true); await A.leaveCloud(); setBusy(false); bump(); setM({ t: 'Déconnecté sur cet appareil. Vos données locales et les données en ligne sont intactes.' }) }
  return (
    <div className="card"><h2>Connexion</h2>
      {cfg === null && <p className="mut" role="status">Vérification du service…</p>}
      {cfg && !cfg.ok && (cfg.why === 'offline'
        ? <><p className="ko" role="status">Hors ligne : impossible de joindre le serveur de Believe.</p><button className="btn alt" onClick={() => reload(true)}>Réessayer</button></>
        : <>
          <p role="status">{WHY.config} Tout le reste de Believe fonctionne sans lui.</p>
          <button className="btn alt" onClick={() => reload(true)}>Réessayer</button></>)}
      {cfg?.ok && schema && <p className="ko" role="alert">{schema}</p>}
      {cfg?.ok && !s && <>
        <p className="mut">Connectez-vous avec Google pour synchroniser vos données entre appareils. Vous serez envoyé vers la page de connexion de Google, puis ramené ici. Believe reçoit votre adresse e-mail et un identifiant, jamais votre mot de passe. Aucune donnée n’est envoyée avant que vous activiez la synchronisation.</p>
        <button className="btn" disabled={busy} onClick={signIn}>Se connecter avec Google</button></>}
      {cfg?.ok && s && <>
        <p role="status">Connecté{s.email ? <> : <b>{s.email}</b></> : null}.</p>
        <button className="btn alt" disabled={busy} onClick={out}>Se déconnecter de cet appareil</button>
        <p className="mut">Se déconnecter n’efface ni vos données locales ni les données en ligne ; la clé de synchronisation reste sur cet appareil. Les cartes que vous partagez dans des cercles d’amis y restent visibles, sans mise à jour, tant que vous n’arrêtez pas le partage (onglet Amis, après reconnexion) ou ne retirez pas l’accord « Compte en ligne ».</p></>}
    </div>
  )
}

// ---------------------------------------------------------------- synchronisation
const useStatus = () => useSyncExternalStore(Y.subscribe, Y.getStatus)
function Count({ n, one, many }: { n: number; one: string; many: string }) { return <>{n} {n > 1 ? many : one}</> }
function Side({ title, s, extra }: { title: string; s: Y.Summary | null; extra?: string }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, minWidth: 0 }}>
      <b>{title}</b>
      {s ? <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        <li>{s.name ? 'Profil : ' + s.name : 'Pas de profil'}</li>
        <li><Count n={s.habits} one="habitude" many="habitudes" />, <Count n={s.days} one="jour validé" many="jours validés" /></li>
        <li><Count n={s.notes} one="note" many="notes" />, <Count n={s.weights} one="pesée" many="pesées" /></li>
        <li><Count n={s.prayers} one="prière" many="prières" />, <Count n={s.books} one="livre" many="livres" /></li>
        {extra && <li className="mut">{extra}</li>}
      </ul> : <p className="mut" style={{ margin: '6px 0 0' }}>Rien.</p>}
    </div>
  )
}
const KINDTXT: Record<Y.Conflict['kind'], string> = {
  both: 'Cet appareil et la version en ligne ont chacun changé depuis la dernière synchronisation. Believe ne les fusionne pas : choisissez celle à garder.',
  first: 'Cet appareil contient déjà des données différentes de celles du compte en ligne. Choisissez celles à garder.',
  reset: 'La version en ligne a disparu (supprimée depuis un autre appareil). Voulez-vous la recréer avec les données de cet appareil ?',
  older: 'La version en ligne est plus ancienne que celle que cet appareil avait déjà reçue (le service est revenu à une sauvegarde ?). Choisissez celle à garder.'
}
function ConflictCard({ c, setM, bump }: { c: Y.Conflict; setM: (m: Msg) => void; bump: () => void }) {
  const [busy, setBusy] = useState(false)
  const pick = async (choice: 'local' | 'remote') => {
    setBusy(true)
    const r = await Y.resolve(choice)
    setBusy(false); bump()
    if (r === null) setM({ t: choice === 'remote' ? 'Les données en ligne ont remplacé celles de cet appareil. Une copie de sécurité de vos anciennes données est gardée ci-dessous.' : 'Les données de cet appareil ont remplacé la version en ligne.' + (c.remote ? ' Une copie de sécurité de l’ancienne version en ligne est gardée ci-dessous.' : '') })
    else setM({ e: 1, t: WHY[r] })
  }
  const dl = () => {
    const cur = load()
    if (cur.err || cur.locked) return setM({ e: 1, t: 'Vos données locales ne peuvent pas être relues : téléchargement impossible.' })
    if (!download('believe-donnees-de-cet-appareil.json', JSON.stringify(cur.s, null, 1), 'application/json')) setM({ e: 1, t: 'Téléchargement impossible.' })
  }
  return (
    <div role="group" aria-label="Conflit de synchronisation" style={{ border: '2px solid var(--warn, #b45309)', borderRadius: 12, padding: 12, margin: '8px 0' }}>
      <h3 style={{ marginTop: 0 }}>Deux versions différentes</h3>
      <p>{KINDTXT[c.kind]}{c.kind === 'first' && c.local.light ? ' (Cet appareil ne contient encore que votre profil.)' : ''}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
        <Side title="Cet appareil" s={c.local} />
        <Side title="En ligne" s={c.remote} extra={c.remote ? 'Envoyée le ' + fmtDate(c.remoteAt) + (c.remoteDev ? ' depuis « ' + c.remoteDev + ' »' : '') : undefined} />
      </div>
      <p className="mut">Ce qui est remplacé est d’abord gardé en copie de sécurité sur cet appareil (une seule copie : la suivante remplace celle-ci). Vous pouvez aussi télécharger les données de cet appareil avant de choisir.</p>
      <div className="row">
        {c.remote && <button className="btn" disabled={busy} onClick={() => pick('remote')}>Utiliser la version en ligne</button>}
        <button className="btn alt" disabled={busy} onClick={() => pick('local')}>{c.kind === 'reset' ? 'Recréer avec les données de cet appareil' : 'Garder cet appareil et remplacer la version en ligne'}</button>
        <button className="btn alt" onClick={dl}>Télécharger les données de cet appareil</button>
      </div>
      <p className="mut">« Décider plus tard » : fermez simplement cet écran ; rien n’est envoyé ni remplacé tant que vous n’avez pas choisi, et Believe ne vous le redemandera que dans cet onglet et par un bandeau.</p>
    </div>
  )
}
type View = '' | 'pinask' | 'newkey' | 'stop' | 'delete' | 'over'
function Sync({ p, bump }: { p: P; bump: () => void }) {
  const st = useStatus(), s = C.getSession()
  const [view, setView] = useState<View>(''), [need, setNeed] = useState(false), [key, setKey] = useState<{ k: string; first: boolean } | null>(null), [text, setText] = useState(''), [busy, setBusy] = useState(false), [forget, setForget] = useState(true)
  useEffect(() => { Y.refreshStatus() }, [])
  const meta = Y.readMeta(), hasKey = Y.getKeyText() !== null
  const done = (t: string) => { setBusy(false); bump(); p.setM({ t }) }
  const fail = (t: string) => { setBusy(false); bump(); p.setM({ e: 1, t }) }
  const enable = async () => {
    setBusy(true)
    const r = await Y.enableSync()
    if (!r.ok) return fail(WHY[r.why])
    if (r.mode === 'needkey') { setBusy(false); setNeed(true); return }
    if (r.mode === 'created') { setBusy(false); setKey({ k: r.key!, first: true }); p.setM({ t: 'Synchronisation activée. Notez votre clé de synchronisation : elle ne sera pas redemandée sur cet appareil, mais il vous la faudra sur les autres.' }); bump(); return }
    const g = Y.getStatus()
    if (g.conflict) { setBusy(false); bump(); p.setM({ t: 'Synchronisation reprise : deux versions diffèrent, choisissez celle à garder.' }); return }
    if (g.err) return fail(WHY[g.err])
    done('Synchronisation reprise.')
  }
  const enter = async () => {
    setBusy(true)
    const r = await Y.enterKey(text)
    if (!r.ok) return fail(keyWhy(r.why))
    setText(''); setNeed(false); const g = Y.getStatus()
    if (g.conflict) { setBusy(false); bump(); p.setM({ t: 'Clé acceptée. Cet appareil et le compte ont des données différentes : choisissez celles à garder.' }); return }
    if (g.err) return fail(WHY[g.err])
    done('Clé acceptée : vos données sont synchronisées.')
  }
  const now = async () => {
    setBusy(true)
    const g = await Y.syncNow('manual')
    if (g.conflict) { setBusy(false); bump(); p.setM({ t: 'Deux versions diffèrent : choisissez celle à garder.' }); return }
    if (g.err) return fail(WHY[g.err])
    done('Synchronisé : cet appareil et la version en ligne sont d’accord.')
  }
  const rotate = async () => {
    setBusy(true); setView('')
    const r = await Y.newKey()
    if (!r.ok) return fail(WHY[r.why] + ' La clé n’a pas été changée.')
    setBusy(false); bump(); setKey({ k: r.key, first: true }); p.setM({ t: 'Clé changée. Les autres appareils devront saisir la nouvelle clé.' })
  }
  const stop = () => { Y.stopSync(forget); setView(''); bump(); p.setM({ t: 'Synchronisation arrêtée sur cet appareil' + (forget ? ' (clé oubliée ici)' : ' (clé conservée)') + '. Les données en ligne et celles de cet appareil sont intactes.' }) }
  const del = async () => {
    setBusy(true)
    const r = await Y.deleteOnline()
    setView('')
    if (r) return fail(WHY[r])
    done('Version en ligne supprimée et synchronisation arrêtée sur cet appareil. Vos données locales sont intactes.')
  }
  const over = async () => {
    setBusy(true); setView('')
    const r = await Y.startOver()
    if (!r.ok) return fail(WHY[r.why])
    setBusy(false); bump()
    if (r.mode === 'created') { setKey({ k: r.key!, first: true }); p.setM({ t: 'Repartis de zéro : l’ancienne version en ligne est supprimée, une nouvelle clé est créée.' }) } else p.setM({ t: 'Synchronisation reprise.' })
  }
  const showKey = () => { const k = Y.getKeyText(); if (!k) return p.setM({ e: 1, t: 'Clé indisponible (application verrouillée ?).' }); setKey({ k, first: false }) }

  return (
    <div className="card"><h2>Synchronisation entre appareils</h2>
      <p className="mut">Vos données (profil, habitudes, notes, santé, prières…) sont chiffrées sur cet appareil avec une clé que vous seul gardez, puis déposées sous forme d’<b>un seul instantané</b> en ligne. Les autres appareils connectés au même compte Google et possédant la clé le récupèrent. Ne sont <b>jamais</b> synchronisés : accords, réglages d’affichage, mode discret, préférences de partage, PIN, code d’accès à Believe AI, et <b>les enregistrements audio</b> (ils restent sur l’appareil). C’est un instantané complet, pas une fusion : si deux appareils sont modifiés sans s’être synchronisés, vous choisissez lequel garder.</p>
      {!s && <p className="mut">Connectez-vous avec Google (carte « Connexion ») pour utiliser la synchronisation.</p>}
      {s && !st.on && !need && <>
        <button className="btn" disabled={busy} onClick={enable}>{hasKey ? 'Reprendre la synchronisation' : 'Activer la synchronisation'}</button>
        <p className="mut">{hasKey ? 'La clé de cette synchronisation est encore sur cet appareil.' : 'Premier appareil : une clé de synchronisation sera créée et montrée une fois. Autre appareil : si des données existent déjà en ligne, la clé vous sera demandée.'}</p></>}
      {s && !st.on && need && <NeedKey text={text} setText={setText} busy={busy} enter={enter} cancel={() => { setNeed(false); setText('') }} lost={() => setView('over')} />}
      {s && st.on && <>
        <p role="status" aria-live="polite">
          {st.busy ? 'Synchronisation en cours…'
            : st.conflict ? <b>Choix à faire : deux versions différentes.</b>
              : st.err ? <span className="ko">{WHY[st.err]}</span>
                : st.dirty ? 'Modifications pas encore envoyées.' : <span className="ok">À jour.</span>}
          {' '}<span className="mut">Dernière vérification réussie : {fmtDate(meta?.at ?? st.at)}.</span>
        </p>
        {st.conflict && <ConflictCard c={st.conflict} setM={p.setM} bump={bump} />}
        {(st.err === 'badkey' || st.err === 'key') && !st.conflict && <NeedKey text={text} setText={setText} busy={busy} enter={enter} lost={() => setView('over')} />}
        <div className="row">
          <button className="btn" disabled={busy || st.busy} onClick={now}>Synchroniser maintenant</button>
          <button className="btn alt" disabled={!hasKey} onClick={() => (hasPin() ? setView('pinask') : showKey())}>Afficher ma clé</button>
        </div>
        <details style={{ marginTop: 10 }}><summary>Plus d’options</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn alt" onClick={() => setView('newkey')}>Changer la clé</button>
            <button className="btn alt" onClick={() => setView('stop')}>Arrêter ici</button>
            <button className="btn alt" onClick={() => setView('delete')}>Supprimer les données en ligne</button>
          </div>
        </details>
        <p className="mut">Appareil : {meta?.dev ?? '—'}. Version en ligne connue : {meta?.rev || 'aucune'}.</p></>}

      {key && <KeyDialog k={key.k} first={key.first} setM={p.setM} onDone={() => { setKey(null); bump() }} />}
      {view === 'pinask' && <PinAsk setM={p.setM} onCancel={() => setView('')} onOk={() => { setView(''); showKey() }} />}
      {view === 'newkey' && <Confirm title="Changer la clé de synchronisation" yes="Changer la clé" onYes={rotate} onNo={() => setView('')} busy={busy}>
        <p>Une nouvelle clé est créée et les données de cet appareil sont renvoyées chiffrées avec elle. <b>Les autres appareils ne pourront plus synchroniser tant que vous n’y aurez pas saisi la nouvelle clé.</b> À faire si l’ancienne clé a pu être vue par quelqu’un d’autre. L’ancienne clé cesse d’ouvrir les données en ligne.</p></Confirm>}
      {view === 'stop' && <Confirm title="Arrêter la synchronisation sur cet appareil" yes="Arrêter" onYes={stop} onNo={() => setView('')}>
        <p>Cet appareil n’enverra et ne recevra plus rien. Vos données locales et celles en ligne restent intactes ; vous pourrez reprendre plus tard.</p>
        <label className="rd"><input type="checkbox" checked={forget} onChange={e => setForget(e.target.checked)} /> Oublier aussi la clé sur cet appareil (vous devrez la ressaisir pour reprendre).</label></Confirm>}
      {view === 'delete' && <Confirm title="Supprimer les données en ligne" yes="Supprimer définitivement" onYes={del} onNo={() => setView('')} busy={busy}>
        <p>La version en ligne (l’instantané chiffré) est supprimée pour tous vos appareils, et la synchronisation s’arrête sur celui-ci. Vos données locales ne sont pas touchées. Votre compte (cercles d’amis, rappels) n’est pas supprimé : voir « Ce que le service garde » plus bas.</p></Confirm>}
      {view === 'over' && <Confirm title="Repartir de zéro (clé perdue)" yes="Effacer la version en ligne et repartir" onYes={over} onNo={() => setView('')} busy={busy}>
        <p>Sans la clé, la version en ligne est illisible pour tout le monde. Vous pouvez l’<b>effacer</b> et publier à la place les données de CET appareil, avec une clé neuve. Les autres appareils devront alors saisir la nouvelle clé (ils garderont leurs données locales et vous proposeront de choisir).</p>
        <p className="ko">La version en ligne actuelle sera perdue définitivement.</p></Confirm>}
    </div>
  )
}
function NeedKey({ text, setText, busy, enter, cancel, lost }: { text: string; setText: (v: string) => void; busy: boolean; enter: () => void; cancel?: () => void; lost: () => void }) {
  return (
    <div style={{ margin: '8px 0' }}>
      <p>Des données existent déjà en ligne pour ce compte. Saisissez la clé de synchronisation notée sur l’appareil qui les a envoyées.</p>
      <label htmlFor="sync-key">Clé de synchronisation</label>
      <input id="sync-key" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={text} onChange={e => setText(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" disabled={busy || text.trim().length < 8} onClick={enter}>Valider la clé</button>
        {cancel && <button className="btn alt" onClick={cancel}>Annuler</button>}
        <button className="btn alt" onClick={lost}>Je n’ai plus la clé</button>
      </div>
      <p className="mut">La clé n’est enregistrée que si elle ouvre vraiment les données en ligne.</p>
    </div>
  )
}

// ---------------------------------------------------------------- copie de sécurité
function Backup({ setM, bump }: { setM: (m: Msg) => void; bump: () => void }) {
  const b = Y.getBackup()
  if (!b) return null
  const dl = () => { if (!download('believe-copie-de-securite.json', JSON.stringify(b.s, null, 1), 'application/json')) setM({ e: 1, t: 'Téléchargement impossible.' }) }
  return (
    <div className="card"><h2>Copie de sécurité avant remplacement</h2>
      <p>Faite le <b>{fmtDate(b.t)}</b> : {b.from === 'local' ? 'les données de cet appareil, juste avant qu’elles soient remplacées par la version en ligne' : 'la version en ligne, juste avant qu’elle soit remplacée par les données de cet appareil'}. Une seule copie est gardée : la suivante remplacera celle-ci.</p>
      <p className="mut">Pour la restaurer : téléchargez-la, puis Paramètres › Données › Importer (collez le contenu du fichier). Elle est chiffrée avec vos données si le chiffrement par le PIN est actif ; le fichier téléchargé, lui, est écrit en clair.</p>
      <div className="row"><button className="btn alt" onClick={dl}>Télécharger la copie</button><button className="btn alt" onClick={() => { Y.dropBackup(); bump(); setM({ t: 'Copie de sécurité supprimée.' }) }}>Supprimer la copie</button></div>
    </div>
  )
}

// ---------------------------------------------------------------- ce que le service garde, suppression du compte
function Online({ setM, bump }: { setM: (m: Msg) => void; bump: () => void }) {
  const [info, setInfo] = useState<A.Info | null>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [ask, setAsk] = useState(false)
  const s = C.getSession()
  if (!s) return null
  const load = async () => {
    setBusy(true); setErr('')
    const r = await A.accountInfo()
    setBusy(false)
    if (r.ok) setInfo(r.info); else setErr(r.code === 'net' ? 'Hors ligne.' : r.code === 'auth' ? 'Connexion expirée : reconnectez-vous.' : r.code === 'schema' ? WHY.schema : 'Le service ne répond pas correctement.')
  }
  const kill = async () => {
    setBusy(true)
    const r = await A.deleteAccount()
    setBusy(false); setAsk(false); setInfo(null); bump()
    if (!r.ok) return setM({ e: 1, t: r.code === 'net' ? 'Hors ligne : le compte n’a pas été supprimé.' : r.code === 'auth' ? 'Connexion expirée : reconnectez-vous puis réessayez. Le compte n’a pas été supprimé.' : 'Le compte n’a pas pu être supprimé. Réessayez.' })
    setM(r.verified ? { t: 'Compte en ligne supprimé (vérifié : le service ne garde plus rien). Cet appareil est déconnecté ; vos données locales sont intactes.' } : { t: 'Suppression demandée et acceptée, mais Believe n’a pas pu la vérifier (réseau). Cet appareil est déconnecté ; reconnectez-vous plus tard pour voir ce que le service garde.' })
  }
  return (
    <div className="card"><h2>Ce que le service garde</h2>
      <p className="mut">Le service qui héberge le compte (Supabase) garde votre adresse e-mail Google et un identifiant, plus ce que vous avez activé : l’instantané chiffré, les cercles d’amis (avec les cartes que vous y partagez) et les rappels. Rien d’autre : ni vos notes en clair, ni vos audios, ni vos échanges avec l’IA.</p>
      <button className="btn alt" disabled={busy} onClick={load}>{info ? 'Actualiser' : 'Voir ce que le service garde de moi'}</button>
      {err && <p className="ko" role="alert">{err}</p>}
      {info && <ul>
        <li>{info.snap ? <>Instantané chiffré : {size(info.snap.size)}, envoyé le {fmtDate(info.snap.at)}{info.snap.dev ? ' depuis « ' + info.snap.dev + ' »' : ''} (version {info.snap.rev}).</> : 'Aucun instantané de synchronisation.'}</li>
        <li>Cercles d’amis : {info.circles} (dont {info.owned} créé{info.owned > 1 ? 's' : ''} par vous) ; cartes partagées : {info.cards}.</li>
        <li>Abonnements aux rappels : {info.subs} ; rappels programmés : {info.reminders}.</li></ul>}
      <button className="btn alt" disabled={busy} onClick={() => setAsk(true)}>Supprimer mon compte en ligne</button>
      <p className="mut">Votre adresse e-mail est aussi gardée par le service d’authentification tant que le compte existe ; la suppression l’efface avec le reste.</p>
      {ask && <Confirm title="Supprimer mon compte en ligne" yes="Supprimer définitivement" onYes={kill} onNo={() => setAsk(false)} busy={busy}>
        <p>Cela supprime définitivement, côté service : l’instantané de synchronisation, les cercles que vous avez créés (pour tous leurs membres), vos appartenances et cartes dans les cercles des autres, vos abonnements et rappels, et votre compte lui-même. Cet appareil est déconnecté et la synchronisation s’y arrête.</p>
        <p><b>Vos données sur cet appareil et sur vos autres appareils ne sont pas touchées.</b> Les autres appareils verront le compte disparaître à leur prochaine synchronisation.</p></Confirm>}
    </div>
  )
}

// ---------------------------------------------------------------- page
const WHYCARD = (
  <>
    <p>Believe fonctionne entièrement sans compte. Le compte en ligne, facultatif, ajoute : la <b>synchronisation de vos données entre appareils</b>, les <b>cercles d’amis par invitation</b> et les <b>rappels quand l’application est fermée</b>. Chacun a ensuite son propre réglage.</p>
    <ul className="mut">
      <li>Vous vous connectez avec Google : le service d’authentification reçoit votre adresse e-mail et un identifiant (jamais votre mot de passe).</li>
      <li>Vos données synchronisées sont chiffrées sur votre appareil avec une clé que vous seul gardez ; le service ne peut pas les lire.</li>
      <li>Le compte est hébergé chez Supabase (voir la politique de confidentialité). Vous pouvez tout supprimer depuis cet onglet.</li>
    </ul>
  </>
)
export default function CloudPage(p: P) {
  // `bump` redessine la page entière : session, repères de synchronisation et copie de sécurité sont relus du stockage à chaque dessin (ils ne sont pas réactifs).
  const [, setV] = useState(0)
  const bump = () => setV(x => x + 1)
  return (
    <Gate k="cloud" S={p.S} upd={p.upd} title="Compte en ligne (facultatif)" why={WHYCARD} label="J’accepte le compte en ligne">
      <Connexion setM={p.setM} bump={bump} />
      <Sync p={p} bump={bump} />
      <Backup setM={p.setM} bump={bump} />
      <Online setM={p.setM} bump={bump} />
    </Gate>
  )
}
