// Rubrique 5 › Amis : cercles d'amis par invitation, avec le compte en ligne FACULTATIF.
// Entrer dans un cercle ne partage rien. Le partage de MA carte se choisit cercle par cercle, après un aperçu exact de ce que verront les autres ; il s'arrête en un clic, et la carte est alors effacée du service.
// Chaque message de réussite n'apparaît qu'après la réponse du service (jamais « fait » avant confirmation).
import { useEffect, useRef, useState } from 'react'
import * as C from './circles'
import * as K from './cloud'
import { Dialog, Gate } from './ui'
import type { Msg, P } from './ui'
import { SHARE_ITEMS, buildShare, dateFr, hasContent, rowsOf, whyBad } from './share'
import type { SharePayload } from './share'

const fmt = (d: string | null | undefined) => { if (!d) return '—'; const t = new Date(d); return isNaN(t.getTime()) ? '—' : t.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) }
const fmtDay = (d: string | null | undefined) => { if (!d) return '—'; const t = new Date(d); return isNaN(t.getTime()) ? '—' : t.toLocaleDateString('fr-FR', { dateStyle: 'medium' }) }

/** Phrase affichée pour chaque raison d'échec. */
export const WHY: Record<string, string> = {
  auth: 'Connexion expirée ou refusée : reconnectez-vous avec Google (onglet Compte).',
  net: 'Hors ligne : impossible de joindre le service. Rien n’a été modifié.',
  server: 'Le service ne répond pas correctement. Réessayez plus tard ; rien n’est considéré comme fait.',
  config: 'Le compte en ligne n’est pas disponible pour le moment.',
  schema: 'Les cercles d’amis sont momentanément indisponibles : réessayez plus tard.',
  rate: 'Trop de demandes : patientez un instant puis réessayez.',
  locked: 'Application verrouillée : saisissez votre PIN.',
  data: 'Vos données locales n’ont pas pu être relues : rien n’est envoyé.',
  consent: 'L’accord « Compte en ligne » n’est pas donné.',
  noshare: 'L’accord « Partage avec des amis » n’est pas donné : donnez-le d’abord.',
  empty: 'Aucun élément n’est coché pour vos amis : cochez-en dans l’onglet Partage avant de partager.',
  card: 'La carte a été refusée (format inattendu) : rien n’a été partagé.',
  name: 'Nom du cercle invalide : 1 à 40 caractères, sans caractère de commande ni caractère invisible.',
  display: 'Nom invalide : 1 à 30 caractères, sans caractère de commande ni caractère invisible.',
  code: 'Ce code n’a pas la bonne forme : 24 caractères (chiffres 0 à 9 et lettres A à F), en 4 groupes de 6, par exemple 1A2B3C-4D5E6F-….',
  limit: 'Limite atteinte : 5 cercles par personne et 10 invitations en attente par cercle.',
  circle: 'Ce cercle n’existe plus, ou vous n’en faites plus partie.',
  member: 'Cette personne n’est plus membre de ce cercle, ou vous en faites déjà partie.',
  owner: 'Le créateur d’un cercle ne peut pas le quitter : supprimez-le si vous n’en voulez plus.',
  share: 'Le partage n’est pas activé dans ce cercle.',
  invite: 'Invitation inconnue, expirée ou déjà utilisée. Demandez-en une nouvelle à la personne qui vous invite.',
  full: 'Ce cercle est complet (12 personnes au plus).',
  arg: 'Demande invalide.'
}
const why = (e: unknown, over: Record<string, string> = {}): string => { const c = e instanceof K.CloudError ? e.code : 'server'; return over[c] ?? WHY[c] ?? WHY.server }

const copyText = async (t: string) => { try { await navigator.clipboard.writeText(t); return true } catch { return false } }

/** Confirmation d'une action qui détruit ou expose quelque chose : le texte dit exactement quoi. */
function Confirm({ title, children, yes, onYes, onNo, busy }: { title: string; children: React.ReactNode; yes: string; onYes: () => void; onNo: () => void; busy?: boolean }) {
  return (
    <Dialog open onClose={onNo} label={title}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>{children}
      <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={busy} onClick={onYes}>{yes}</button><button className="btn alt" onClick={onNo}>Annuler</button></div>
    </Dialog>
  )
}

/** Une carte « Vue Ami » : mêmes lignes que l'aperçu de l'onglet Partage (elles viennent toutes de `rowsOf`, après vérification en liste blanche). */
function CardView({ who, p, at, you }: { who: string; p: SharePayload; at: string | null; you?: boolean }) {
  const rows = rowsOf(p)
  return (
    <div className="friend" role="group" aria-label={'Carte de ' + who + (you ? ' (vous)' : '')}>
      <div className="fh"><span className="fw">BELIEVE</span><b>{who}{you ? ' (vous)' : ''}</b>
        <small>{p.who ? 'Prénom : ' + C.cleanName(p.who) + ' · ' : ''}carte du {dateFr(p.d)}{at ? ' · déposée le ' + fmt(at) : ''}</small></div>
      <div className="fb">{rows.length
        ? rows.map(r => <section key={r.k} aria-label={r.h}><h3>{r.h}</h3><ul>{r.l.map((l, i) => <li key={i} className={r.sens ? 'sens' : undefined}>{l}</li>)}</ul></section>)
        : <p className="mut" style={{ margin: '10px 0' }}>Aucun élément n’est partagé pour le moment.</p>}</div>
    </div>
  )
}

// ---------------------------------------------------------------- partage de ma carte dans un cercle
function ShareBox({ c, p, me, reload, busy, setBusy }: { c: C.Circle; p: P; me: C.Member | undefined; reload: () => Promise<void>; busy: boolean; setBusy: (b: boolean) => void }) {
  const [ask, setAsk] = useState(false)
  const card = buildShare(p.S), hidden = SHARE_ITEMS.filter(i => p.S.share.vis[i.k] !== true)
  const ready = !!card && hasContent(card) && whyBad(card) === null
  const others = Math.max(0, c.members - 1)
  const start = async () => {
    setBusy(true)
    try {
      await C.startSharing(c.id)
      setAsk(false); await reload()
      const who = others > 1 ? 'les ' + others + ' autres membres peuvent' : others === 1 ? 'l’autre membre peut' : 'les membres qui viendront pourront'
      p.setM({ t: 'Partage activé dans « ' + c.name + ' » : votre carte a été déposée, ' + who + ' la voir. Vous pouvez l’arrêter à tout moment.' })
    } catch (e) { setAsk(false); await reload(); p.setM({ e: 1, t: why(e) + ' Le partage n’a pas été activé.' }) }
    setBusy(false)
  }
  const stop = async () => {
    setBusy(true)
    try { await C.stopSharing(c.id); await reload(); p.setM({ t: 'Partage arrêté dans « ' + c.name + ' » : votre carte a été effacée du service. Une personne qui l’aurait déjà vue ou copiée la garde peut-être.' }) } catch (e) { p.setM({ e: 1, t: why(e) + ' Le partage n’est pas arrêté : réessayez.' }) }
    setBusy(false)
  }
  const retry = async () => {
    setBusy(true)
    const r = await C.publish(true)
    await reload(); setBusy(false)
    p.setM(r.ok ? { t: 'Carte envoyée.' } : { e: 1, t: WHY[r.why] ?? WHY.server })
  }
  return (
    <div>
      <h3>Ma carte dans ce cercle</h3>
      {c.sharing
        ? <>
          <p role="status"><span className="ok"><b>Partagée.</b></span> Les autres membres voient la carte ci-dessous (mise à jour automatiquement quand vous utilisez Believe connecté).{me && !me.card ? ' Elle n’est pas encore déposée : « Renvoyer la carte ».' : ''}</p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={stop}>Arrêter de partager dans ce cercle</button>
            {me && !me.card && <button className="btn alt" disabled={busy} onClick={retry}>Renvoyer la carte</button>}
          </div>
          {!p.S.consents.share && <p className="ko">L’accord « Partage avec des amis » est retiré : aucune mise à jour n’est envoyée. Arrêtez le partage pour effacer la carte.</p>}
        </>
        : <>
          <p className="mut">Vous ne partagez <b>rien</b> dans ce cercle. Si vous le décidez, vos amis verront la carte « Vue Ami » de l’onglet Partage : seulement les éléments que vous y avez cochés.</p>
          {!p.S.consents.share
            ? <>
              <p>Pour partager, l’accord « Partage avec des amis » est nécessaire : Believe créera votre carte avec les seuls éléments que vous cochez, puis la déposera sur le compte en ligne pour les membres du cercle choisi.</p>
              <button className="btn" onClick={() => p.upd(s => { s.consents.share = true }, 'Accord enregistré : Partage avec des amis.')}>Donner l’accord « Partage avec des amis »</button></>
            : !ready
              ? <p>Aucun élément n’est coché pour vos amis. <a href="#/5/partage">Choisir ce que mes amis voient</a> (onglet Partage), puis revenez ici.</p>
              : <button className="btn" disabled={busy} onClick={() => setAsk(true)}>Partager ma carte dans ce cercle…</button>}
        </>}
      {ask && card && ready && <Confirm title={'Partager ma carte dans « ' + c.name + ' » ?'} yes="Partager cette carte" onYes={start} onNo={() => setAsk(false)} busy={busy}>
        <p>{others > 1 ? 'Les ' + others + ' autres membres de ce cercle verront' : others === 1 ? 'L’autre membre de ce cercle verra' : 'Les membres de ce cercle verront'} <b>exactement ceci, et rien d’autre</b> :</p>
        <CardView who={c.display} p={card} at={null} you />
        <p className="mut">Masqué pour vos amis ({hidden.length}) : {hidden.length ? hidden.map(i => i.t).join(' ; ') : 'aucun'}. <a href="#/5/partage">Modifier</a></p>
        <p className="mut">La carte est déposée sur le compte en ligne, puis mise à jour tant que le partage est actif. Vous pouvez l’arrêter à tout moment : elle est alors effacée du service. Personne n’est averti quand vous la modifiez.</p>
      </Confirm>}
    </div>
  )
}

// ---------------------------------------------------------------- invitations (créateur du cercle)
function Invites({ c, p, busy, setBusy }: { c: C.Circle; p: P; busy: boolean; setBusy: (b: boolean) => void }) {
  const [list, setList] = useState<C.Invite[] | null>(null), [fresh, setFresh] = useState<{ id: string; code: string; until: string } | null>(null), [err, setErr] = useState('')
  const live = useRef(true); useEffect(() => () => { live.current = false }, [])
  const load = async () => { try { const l = await C.invites(c.id); if (live.current) { setList(l); setErr('') } } catch (e) { if (live.current) setErr(why(e)) } }
  useEffect(() => { void load() }, [c.id])
  const make = async () => {
    setBusy(true)
    try { const r = await C.invite(c.id); setFresh(r); await load(); p.setM({ t: 'Invitation créée : le code est valable 7 jours et ne sert qu’une fois. Envoyez-le seulement à la personne invitée.' }) } catch (e) { p.setM({ e: 1, t: why(e) }) }
    setBusy(false)
  }
  const revoke = async (id: string) => {
    setBusy(true)
    try { await C.revoke(c.id, id); if (fresh?.id === id) setFresh(null); await load(); p.setM({ t: 'Invitation révoquée : son code ne fonctionne plus.' }) } catch (e) { p.setM({ e: 1, t: why(e, { invite: 'Cette invitation n’existe plus (utilisée, expirée ou déjà révoquée).' }) }); await load() }
    setBusy(false)
  }
  const link = fresh ? C.inviteLink(fresh.code) : ''
  const text = fresh ? 'Rejoins mon cercle « ' + c.name + ' » sur Believe : ' + link + ' (invitation valable 7 jours, pour une seule personne).' : ''
  const share = async () => {
    if (!fresh) return
    try { if (typeof navigator.share === 'function') { await navigator.share({ title: 'Invitation Believe', text }); p.setM({ t: 'Le menu de partage s’est fermé : l’invitation a été remise à l’application que vous avez choisie.' }) } else p.setM({ e: 1, t: 'Ce navigateur n’a pas de menu de partage : copiez le lien.' }) } catch (e) { p.setM((e as Error).name === 'AbortError' ? { t: 'Partage annulé.' } : { e: 1, t: 'Partage impossible : copiez le lien.' }) }
  }
  const copy = async () => p.setM((await copyText(link)) ? { t: 'Lien d’invitation copié dans le presse-papiers.' } : { e: 1, t: 'Copie refusée par le navigateur : recopiez le code à la main.' })
  return (
    <div>
      <h3>Inviter quelqu’un</h3>
      <p className="mut">Seul le créateur du cercle invite. Un code ne sert qu’à une personne, pendant 7 jours ; il n’est montré qu’une fois (le service n’en garde que l’empreinte). Vous pouvez le révoquer avant qu’il serve.</p>
      <button className="btn" disabled={busy} onClick={make}>Créer une invitation</button>
      {fresh && <div role="group" aria-label="Nouvelle invitation" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, margin: '10px 0' }}>
        <p style={{ marginTop: 0 }}>Code (valable jusqu’au {fmt(fresh.until)}) :</p>
        <p><code data-testid="invite-code" style={{ display: 'block', fontSize: '1.1rem', letterSpacing: '.05em', padding: 10, border: '1px solid var(--line)', borderRadius: 10, wordBreak: 'break-all', userSelect: 'all' }}>{fresh.code}</code></p>
        <p className="mut" style={{ wordBreak: 'break-all' }}>Lien : {link}</p>
        <div className="row"><button className="btn alt" onClick={share}>Envoyer l’invitation…</button><button className="btn alt" onClick={copy}>Copier le lien</button></div>
      </div>}
      {err && <p className="ko" role="alert">{err}</p>}
      {list && list.length > 0 && <>
        <p className="mut" style={{ marginBottom: 4 }}>Invitations en attente ({list.length}) :</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{list.map(i => (
          <li key={i.id} style={{ margin: '4px 0' }}>créée le {fmtDay(i.at)}, valable jusqu’au {fmtDay(i.until)} <button className="chip" disabled={busy} aria-label={'Révoquer l’invitation du ' + fmtDay(i.at)} onClick={() => revoke(i.id)}>Révoquer</button></li>
        ))}</ul></>}
      {list && list.length === 0 && !fresh && <p className="mut">Aucune invitation en attente.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- un cercle ouvert
function Detail({ c, p, reload, close }: { c: C.Circle; p: P; reload: () => Promise<void>; close: () => void }) {
  const [mem, setMem] = useState<C.Member[] | null>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const [view, setView] = useState<'' | 'leave' | 'delete'>(''), [kick, setKick] = useState<C.Member | null>(null), [name, setName] = useState(c.name), [disp, setDisp] = useState(c.display)
  const live = useRef(true); useEffect(() => () => { live.current = false }, [])
  const loadMem = async () => {
    try { const l = await C.members(c.id); if (live.current) { setMem(l); setErr('') } } catch (e) { if (live.current) { setErr(why(e)); if (e instanceof K.CloudError && e.code === 'circle') void reload() } }
  }
  const all = async () => { await Promise.all([loadMem(), reload()]) }
  useEffect(() => { void loadMem() }, [c.id])
  const me = mem?.find(m => m.you)
  /** Exécute une action, puis relit l'état du service avant d'annoncer le résultat. `gone` : le cercle n'existe plus pour moi après l'action (quitté, supprimé). */
  const act = async (f: () => Promise<void>, ok: string, over: Record<string, string> = {}, gone = false) => {
    setBusy(true)
    try {
      await f(); setView(''); setKick(null)
      if (gone) { await reload(); close() } else await all()
      p.setM({ t: ok })
    } catch (e) { setView(''); setKick(null); p.setM({ e: 1, t: why(e, over) }); await all() }
    setBusy(false)
  }
  return (
    <div style={{ marginTop: 10 }}>
      <ShareBox c={c} p={p} me={me} reload={all} busy={busy} setBusy={setBusy} />
      <h3>Membres ({c.members})</h3>
      {err && <p className="ko" role="alert">{err}</p>}
      {!mem && !err && <p className="mut" role="status">Chargement des membres…</p>}
      {mem && <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{mem.map(m => (
        <li key={m.id} style={{ margin: '8px 0' }}>
          <div className="li" style={{ alignItems: 'center' }}>
            <span><b>{m.display}</b>{m.you ? ' (vous)' : ''}{m.owner ? ' · créateur' : ''} <span className="mut">· {m.sharing ? (m.card ? 'partage sa carte' : m.badCard ? 'carte refusée' : 'partage activé, carte pas encore envoyée') : 'ne partage rien'}</span></span>
            {c.owner && !m.you && <button className="chip" disabled={busy} aria-label={'Retirer ' + m.display + ' du cercle'} onClick={() => setKick(m)}>Retirer</button>}
          </div>
          {m.card && <details><summary>Voir la carte de {m.display}{m.you ? ' (telle que le service l’affiche)' : ''}</summary><CardView who={m.display} p={m.card} at={m.cardAt} you={m.you} /></details>}
          {m.badCard && <p className="ko"><small>Le service a renvoyé une carte que Believe refuse d’afficher (format inattendu) : elle n’est pas montrée.</small></p>}
        </li>
      ))}</ul>}
      <div className="row" style={{ margin: '8px 0' }}><button className="btn alt" disabled={busy} onClick={() => void all()}>Actualiser</button></div>

      {c.owner && <Invites c={c} p={p} busy={busy} setBusy={setBusy} />}

      <details style={{ marginTop: 10 }}><summary>Réglages du cercle</summary>
        <div style={{ marginTop: 8 }}>
          <label htmlFor={'cd-' + c.id}>Mon nom dans ce cercle (visible de tous les membres)</label>
          <input id={'cd-' + c.id} autoComplete="off" maxLength={C.DISPLAY_MAX} value={disp} onChange={e => setDisp(e.target.value)} />
          <div className="row" style={{ margin: '6px 0 12px' }}><button className="btn alt" disabled={busy || !disp.trim() || disp.trim() === c.display} onClick={() => act(() => C.setDisplay(c.id, disp), 'Votre nom dans « ' + c.name + ' » a été changé.')}>Changer mon nom</button></div>
          {c.owner && <>
            <label htmlFor={'cn-' + c.id}>Nom du cercle</label>
            <input id={'cn-' + c.id} autoComplete="off" maxLength={C.NAME_MAX} value={name} onChange={e => setName(e.target.value)} />
            <div className="row" style={{ margin: '6px 0 12px' }}><button className="btn alt" disabled={busy || !name.trim() || name.trim() === c.name} onClick={() => act(() => C.rename(c.id, name), 'Le cercle s’appelle maintenant « ' + name.trim() + ' ».')}>Renommer le cercle</button></div></>}
          <div className="row">
            {c.owner
              ? <button className="btn alt" disabled={busy} onClick={() => setView('delete')}>Supprimer le cercle…</button>
              : <button className="btn alt" disabled={busy} onClick={() => setView('leave')}>Quitter le cercle…</button>}
          </div>
        </div></details>

      {view === 'leave' && <Confirm title={'Quitter « ' + c.name + ' » ?'} yes="Quitter le cercle" busy={busy} onNo={() => setView('')} onYes={() => act(() => C.leave(c.id), 'Vous avez quitté « ' + c.name + ' » : votre carte y est effacée.', {}, true)}>
        <p>Vous ne verrez plus ce cercle et votre carte y est effacée du service. Pour revenir, il faudra une nouvelle invitation.</p></Confirm>}
      {view === 'delete' && <Confirm title={'Supprimer « ' + c.name + ' » ?'} yes="Supprimer pour tous" busy={busy} onNo={() => setView('')} onYes={() => act(() => C.remove(c.id), 'Cercle « ' + c.name + ' » supprimé pour tous ses membres, cartes comprises.', {}, true)}>
        <p>Le cercle disparaît <b>pour tous ses membres</b> : leurs cartes y sont effacées du service et les invitations en attente ne servent plus. Cela ne peut pas être annulé.</p></Confirm>}
      {kick && <Confirm title={'Retirer ' + kick.display + ' ?'} yes="Retirer du cercle" busy={busy} onNo={() => setKick(null)} onYes={() => act(() => C.kick(c.id, kick.id), '« ' + kick.display + ' » a été retiré du cercle : sa carte y est effacée.', { member: 'Cette personne n’est plus membre de ce cercle.' })}>
        <p>Cette personne ne verra plus le cercle et sa carte y est effacée. Elle pourra revenir avec une nouvelle invitation.</p></Confirm>}
    </div>
  )
}

// ---------------------------------------------------------------- créer, rejoindre
const profileName = (p: P) => (p.S.profile?.name ?? '').slice(0, C.DISPLAY_MAX)
function Create({ p, done, busy, setBusy }: { p: P; done: (id: string) => Promise<void>; busy: boolean; setBusy: (b: boolean) => void }) {
  const [name, setName] = useState(''), [disp, setDisp] = useState(() => profileName(p))
  const go = async () => {
    setBusy(true)
    try { const r = await C.create(name, disp); const nm = C.okName(name, C.NAME_MAX) ?? name; setName(''); await done(r.id); p.setM({ t: 'Cercle « ' + nm + ' » créé. Aucun partage n’est activé : vous choisissez ce que vous partagez, et vous pouvez maintenant inviter des personnes.' }) } catch (e) { p.setM({ e: 1, t: why(e) }) }
    setBusy(false)
  }
  return (
    <div className="card"><h2>Créer un cercle</h2>
      <p className="mut">Un cercle réunit 12 personnes au plus, toutes invitées par vous. Vous pouvez en créer ou rejoindre 5 au plus. Créer un cercle ne partage rien.</p>
      <label htmlFor="cc-name">Nom du cercle</label>
      <input id="cc-name" autoComplete="off" maxLength={C.NAME_MAX} placeholder="Famille, église, club de course…" value={name} onChange={e => setName(e.target.value)} />
      <label htmlFor="cc-disp">Mon nom dans ce cercle</label>
      <input id="cc-disp" autoComplete="off" maxLength={C.DISPLAY_MAX} value={disp} onChange={e => setDisp(e.target.value)} />
      <p className="mut"><small>Ce nom (et le nom du cercle) sont visibles de tous les membres. Choisissez ce que vous voulez : ce n’est pas obligatoirement votre vrai nom.</small></p>
      <div className="row"><button className="btn" disabled={busy || !name.trim() || !disp.trim()} onClick={go}>Créer le cercle</button></div>
    </div>
  )
}

function Join({ p, done, busy, setBusy }: { p: P; done: (id: string) => Promise<void>; busy: boolean; setBusy: (b: boolean) => void }) {
  const [code, setCode] = useState(() => C.pendingInvite() ?? ''), [info, setInfo] = useState<C.Peek | null>(null), [disp, setDisp] = useState(() => profileName(p))
  const fromLink = useRef(code !== '')
  const check = async () => {
    setBusy(true); setInfo(null)
    try { setInfo(await C.peek(code)) } catch (e) { p.setM({ e: 1, t: why(e) }) }
    setBusy(false)
  }
  const join = async () => {
    if (!info) return
    setBusy(true)
    try { const r = await C.accept(code, disp); setInfo(null); setCode(''); await done(r.circle); p.setM({ t: 'Vous avez rejoint « ' + info.name + ' ». Aucun partage n’est activé : vous choisissez ce que vous partagez, cercle par cercle.' }) } catch (e) { p.setM({ e: 1, t: why(e, { member: 'Vous faites déjà partie de ce cercle.' }) }) }
    setBusy(false)
  }
  const refuse = () => { C.dropInvite(); setInfo(null); setCode(''); fromLink.current = false; p.setM({ t: 'Invitation écartée : rien n’a été rejoint.' }) }
  return (
    <div className="card"><h2>Rejoindre un cercle</h2>
      {fromLink.current && code && !info && <p role="status"><b>Une invitation vous attend.</b> Vérifiez-la avant de décider : rien n’est rejoint tant que vous n’avez pas confirmé.</p>}
      <p className="mut">Collez le code reçu de la personne qui vous invite (ou ouvrez le lien qu’elle vous a envoyé). Un code ne sert qu’une fois et expire au bout de 7 jours.</p>
      <label htmlFor="cj-code">Code d’invitation</label>
      <input id="cj-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX" value={code} onChange={e => { setCode(e.target.value); setInfo(null) }} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn alt" disabled={busy || code.trim().length < 8} onClick={check}>Vérifier l’invitation</button>
        {code && <button className="btn alt" onClick={refuse}>Effacer le code</button>}
      </div>
      {info && <div role="group" aria-label="Invitation vérifiée" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, margin: '10px 0' }}>
        <p style={{ marginTop: 0 }}>Invitation au cercle <b>« {info.name} »</b>, créé par <b>{info.by}</b> ({info.members} membre{info.members > 1 ? 's' : ''} pour l’instant).</p>
        {info.already ? <p className="ko">Vous faites déjà partie de ce cercle.</p>
          : info.full ? <p className="ko">Ce cercle est complet (12 personnes) : demandez au créateur de faire de la place.</p>
            : <>
              <label htmlFor="cj-disp">Mon nom dans ce cercle</label>
              <input id="cj-disp" autoComplete="off" maxLength={C.DISPLAY_MAX} value={disp} onChange={e => setDisp(e.target.value)} />
              <p className="mut"><small>Ce nom sera visible de tous les membres. Rejoindre ne partage rien : vous choisirez ensuite si vous partagez votre carte.</small></p>
              <div className="row"><button className="btn" disabled={busy || !disp.trim()} onClick={join}>Rejoindre ce cercle</button><button className="btn alt" disabled={busy} onClick={refuse}>Refuser</button></div></>}
      </div>}
    </div>
  )
}

// ---------------------------------------------------------------- page
function Body(p: P) {
  const [cs, setCs] = useState<C.Circle[] | null>(null), [err, setErr] = useState(''), [open, setOpen] = useState<string | null>(null), [busy, setBusy] = useState(false), [pend, setPend] = useState(C.retractPending())
  const live = useRef(true); useEffect(() => () => { live.current = false }, [])
  const reload = async () => {
    try {
      const l = await C.refresh()
      if (live.current) { setCs(l); setErr('') }
      void C.publish().then(() => { if (live.current) setPend(C.retractPending()) })
    } catch (e) { if (live.current) setErr(why(e)) }
  }
  useEffect(() => { void reload() }, [])
  const done = async (id: string) => { await reload(); if (live.current) setOpen(id) }
  const retract = async () => {
    setBusy(true)
    try { const n = await C.retractAll(); setPend(false); await reload(); p.setM({ t: n ? 'Vos cartes ont été effacées de ' + n + ' cercle' + (n > 1 ? 's' : '') + '.' : 'Aucune carte à effacer : le retrait est terminé.' }) } catch (e) { p.setM({ e: 1, t: why(e) + ' Le retrait n’est pas terminé.' }) }
    setBusy(false)
  }
  return (
    <>
      <div className="card"><h2>Cercles d’amis</h2>
        <p className="mut">Un cercle est un petit groupe (12 personnes au plus) où chacun est invité par le créateur. <b>Entrer dans un cercle ne partage rien.</b> Vous décidez, cercle par cercle, si votre carte de progression y est visible ; elle contient seulement les éléments que vous avez cochés dans l’onglet Partage, les données sensibles restant masquées tant que vous ne les confirmez pas.</p>
        <p className="mut">Ne sont jamais partagés : texte et titres de vos notes, enregistrements audio, photos, échanges avec l’IA, PIN, gratitudes, noms de vos habitudes. Vos amis voient ce que vous choisissez de montrer ; ils pourraient en faire une capture d’écran.</p>
        {pend && <div role="alert" style={{ border: '2px solid var(--warn, #b45309)', borderRadius: 10, padding: 10, margin: '8px 0' }}>
          <p style={{ marginTop: 0 }}><b>Retrait de vos cartes en attente.</b> Vous avez retiré un accord, mais le service n’a pas encore confirmé l’effacement de vos cartes dans vos cercles : elles restent visibles tant que ce n’est pas fait.</p>
          <button className="btn" disabled={busy} onClick={retract}>Effacer mes cartes maintenant</button></div>}
        {err && <p className="ko" role="alert">{err}</p>}
        {!cs && !err && <p className="mut" role="status">Chargement de vos cercles…</p>}
        {cs && cs.length === 0 && !err && <p>Vous n’êtes dans aucun cercle. Créez-en un, ou rejoignez celui d’un ami avec son code d’invitation.</p>}
        <div className="row"><button className="btn alt" disabled={busy} onClick={() => void reload()}>Actualiser mes cercles</button></div>
      </div>
      {cs && cs.map(c => (
        <section className="card" key={c.id} aria-label={'Cercle ' + c.name}>
          <h2>{c.name}</h2>
          <p className="mut">{c.owner ? 'Vous avez créé ce cercle' : 'Vous avez été invité'} · {c.members} membre{c.members > 1 ? 's' : ''} · votre nom ici : <b>{c.display}</b></p>
          <p>{c.sharing ? <span className="ok">Votre carte est partagée dans ce cercle.</span> : <span className="mut">Vous ne partagez rien dans ce cercle.</span>}</p>
          <button className="btn alt" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Fermer le cercle' : 'Ouvrir le cercle'}</button>
          {open === c.id && <Detail c={c} p={p} reload={reload} close={() => setOpen(null)} />}
        </section>
      ))}
      {cs && <Join p={p} done={done} busy={busy} setBusy={setBusy} />}
      {cs && <Create p={p} done={done} busy={busy} setBusy={setBusy} />}
    </>
  )
}

/** Garde le code d'une invitation reçue par lien (#/5/amis/CODE) le temps de la session de l'onglet, puis le retire de la barre d'adresse. */
let seenLink = '' // un lien n'est traité qu'une fois : l'adresse de l'application garde l'ancien « sub » tant que la page n'est pas rechargée (changer d'onglet ne doit pas faire revenir une invitation refusée)
function useLink(sub: string, setM: (m: Msg) => void) {
  useEffect(() => {
    const raw = sub.split('/')[1]
    if (raw === undefined || raw === seenLink) return
    seenLink = raw
    try { history.replaceState(null, '', location.pathname + location.search + '#/5/amis') } catch { /* barre d'adresse inchangée */ }
    let t = raw
    try { t = decodeURIComponent(raw) } catch { /* gardé tel quel */ }
    const code = C.normCode(t)
    if (code) C.stashInvite(code); else setM({ e: 1, t: 'Le lien d’invitation est incomplet ou abîmé : demandez-en un nouveau.' })
  }, [sub])
}

const WHYCARD = (
  <>
    <p>Les cercles d’amis passent par le <b>compte en ligne</b> (facultatif) : connexion avec Google, puis un service d’hébergement (Supabase). Believe fonctionne entièrement sans.</p>
    <ul className="mut">
      <li>Vous voyez et choisissez tout : entrer dans un cercle ne partage rien, le partage est un réglage par cercle, avec un aperçu exact.</li>
      <li>Le service garde votre adresse e-mail Google, les noms de cercle, vos noms d’affichage et les cartes que vous choisissez de partager.</li>
      <li>Vous pouvez quitter un cercle, arrêter de partager ou supprimer votre compte à tout moment : les cartes sont alors effacées.</li>
    </ul>
  </>
)

/** Vérifie le service puis montre la bonne page. Rendu seulement derrière l'accord « Compte en ligne » : sans accord, aucune requête n'est faite. */
function Service(p: P) {
  const [cfg, setCfg] = useState<K.CfgRes | null>(null)
  useEffect(() => { let live = true; void K.getConfig().then(r => { if (live) setCfg(r) }); return () => { live = false } }, [])
  const signed = K.getSession() !== null
  return (
    <>
      {cfg === null && <div className="card"><p className="mut" role="status">Vérification du service…</p></div>}
      {cfg && !cfg.ok && <div className="card"><h2>Cercles d’amis</h2>
        {cfg.why === 'offline'
          ? <p className="ko" role="status">Hors ligne : impossible de joindre le serveur de Believe.</p>
          : <p role="status"><b>Les cercles d’amis ne sont pas disponibles pour le moment.</b> Ils demandent le compte en ligne (onglet <a href="#/2/compte">Compte</a>).</p>}
      </div>}
      {cfg?.ok && !signed && <div className="card"><h2>Cercles d’amis</h2>
        {C.pendingInvite() && <p role="status"><b>Une invitation vous attend.</b> Connectez-vous pour la voir ; elle reste dans cet onglet.</p>}
        <p>Connectez-vous avec Google pour créer ou rejoindre un cercle.</p>
        <a className="btn" href="#/2/compte">Aller à l’onglet Compte pour me connecter</a></div>}
      {cfg?.ok && signed && <Body {...p} />}
    </>
  )
}

export default function CirclesPage(p: P) {
  useLink(p.sub, p.setM)
  return (
    <Gate k="cloud" S={p.S} upd={p.upd} title="Cercles d’amis (compte en ligne facultatif)" why={WHYCARD} label="J’accepte le compte en ligne">
      <Service {...p} />
    </Gate>
  )
}
