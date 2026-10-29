import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { ComponentType, CSSProperties, ReactNode } from 'react'
import { DEF, KEY, load, roll, save, today, wipeLocal } from './lib'
import type { State } from './lib'
import { copie } from './draft'
import Home, { VerseModal } from './Home'
import { focusPrayerField } from './Prayers'
import Logo from './Logo'
import Icon from './icons'
import type { IconName } from './icons'
import Onboarding from './Onboarding'
import { Dialog, Skeleton, haptic, useSwipe } from './ui'
import type { Msg, P, Upd } from './ui'
import { discardRec, useRec } from './rec'
import { clock, mmss } from './util'
import Lock from './Lock'
import { RemindBanner, useReminders } from './Reminders'
import { PIN_KEY, hasPin, hasVault, readPin } from './pin'
import { closeKeys, unlocked } from './keys'
import { resetP, usePomo } from './pomo'
import { wipeIDB } from './idb'
import { left } from './cal'
import { forgetInvite, forgetSession, hasInvite, leave, looksLikeBack, startCircles, startPush, startSync, stopCircles, stopPush, stopSyncAuto, syncOn, touchCircles, touchPush, touchSync } from './cloudhook'

interface Rub { i: number; t: string; ic: IconName }
type Pg = ComponentType<P & { purge: () => Promise<boolean>; inst: (() => void) | null; pinChanged: () => void }>
const L = (f: () => Promise<{ default: ComponentType<any> }>) => ({ load: f, C: lazy(f) as unknown as Pg })
/** Pages chargées à la demande (une par rubrique, hors accueil) : le premier affichage reste léger. */
const PG: Record<string, ReturnType<typeof L>> = {
  1: L(() => import('./Profil')), 2: L(() => import('./SettingsPage')), 3: L(() => import('./AIPage')), 5: L(() => import('./BilanPartage')), 6: L(() => import('./Habits')), 7: L(() => import('./Sport')),
  8: L(() => import('./Sante')), 9: L(() => import('./Pro')), 10: L(() => import('./MediaPage')), 11: L(() => import('./Notes')), 12: L(() => import('./Library')), 13: L(() => import('./Academy')), legal: L(() => import('./LegalPage'))
}

/** Bandeau de la synchronisation : chargé seulement si elle est activée sur cet appareil. */
const SyncBanner = lazy(() => import('./SyncBanner'))

/** Page affichée. `will-change` n'est posé que le temps de l'animation d'entrée : posé en permanence, il garderait un calque par page et ancrerait à la page les éléments en position fixe. */
function View({ cls, children }: { cls: string; children: ReactNode }) {
  const [wc, setWc] = useState(true)
  useEffect(() => { const t = setTimeout(() => setWc(false), 800); return () => clearTimeout(t) }, []) // repli : mouvement réduit (aucune animation, donc aucun événement de fin)
  return <div className={'view' + cls + (wc ? ' wc' : '')} onAnimationEnd={e => { if (e.target === e.currentTarget) setWc(false) }}>{children}</div>
}

/** Bandeau d'enregistrement audio : isolé pour que seule cette ligne se redessine pendant l'enregistrement. */
function RecBanner({ a }: { a: string }) {
  const r = useRec()
  if (a === '11' || r.owner === 'academie' || (r.st !== 'rec' && r.st !== 'done')) return null // l'auto-écoute de l'académie vit sur son écran et s'efface en le quittant
  return <a className="ban" href="#/11/audio" style={{ display: 'block', color: 'inherit' }}>{r.st === 'rec' ? '● Enregistrement en cours (' + mmss(r.ms) + ') : retour au dictaphone' : 'Un enregistrement n’est pas encore sauvegardé : ouvrir le dictaphone'}</a>
}
const R: Rub[] = [
  { i: 1, t: 'Identité et profil', ic: 'user' },
  { i: 2, t: 'Paramètres', ic: 'gear' },
  { i: 3, t: 'Believe AI', ic: 'spark' },
  { i: 4, t: 'Accueil spirituel', ic: 'pray' },
  { i: 5, t: 'Bilan, partage et amis', ic: 'share' },
  { i: 6, t: 'Habitudes', ic: 'check' },
  { i: 7, t: 'Sport et podomètre', ic: 'run' },
  { i: 8, t: 'Santé, scanner et recettes', ic: 'heart' },
  { i: 9, t: 'Professionnel et calendrier', ic: 'calendar' },
  { i: 10, t: 'Danse et louange', ic: 'music' },
  { i: 11, t: 'Notes, dictaphone, prompteur', ic: 'mic' },
  { i: 12, t: 'Bibliothèque et recherche de livres', ic: 'library' },
  { i: 13, t: 'Académie d’éloquence et quiz', ic: 'cap' }
]
/** Menu des rubriques : une tuile colorée par rubrique, avec son numéro (celui que citent les textes de l'application). */
const Menu = () => (
  <>
    <h1>Rubriques</h1>
    <div className="tiles">
      {R.map(r => (
        <a key={r.i} className={'tl t' + r.i} href={'#/' + r.i} style={{ '--i': r.i } as CSSProperties}>
          <span className="tt"><span className="qi"><Icon n={r.ic} size={24} /></span><span className="num">{r.i}</span></span>
          <strong>{r.t}</strong>
        </a>
      ))}
    </div>
  </>
)

/** Au démarrage : si les données sont chiffrées, rien n'est lu ni écrit avant la saisie du PIN (l'état est alors vide et caché par l'écran de verrouillage). */
const boot = (() => { const b = load(); if (!b.locked) { roll(b.s); save(b.s) } return b })()
const seg = (h: string): [string, string] => { const i = h.indexOf('/'); return i < 0 ? [h, ''] : [h.slice(0, i), h.slice(i + 1)] }
/** Anciennes adresses des réglages (#/2/compte, #/2/affichage…) : elles mènent aux Paramètres, et la barre d'adresse est corrigée sans ajouter d'entrée à l'historique. */
const MOVED: Record<string, string> = { compte: 'compte', confidentialite: 'confidentialite', reglages: 'affichage', donnees: 'donnees' }
const hashOf = () => {
  const h = location.hash.replace(/^#\/?/, '') || '4', [a, sub] = seg(h), to = a === '5' ? MOVED[seg(sub)[0]] : undefined
  if (to === undefined) return h
  try { history.replaceState(null, '', location.pathname + location.search + '#/2/' + to) } catch { /* barre d'adresse inchangée */ }
  return '2/' + to
}
/** Sections principales, dans l'ordre de la barre du bas : on passe de l'une à l'autre par balayage. */
const MAIN = ['4', '6', '3', 'menu']
const NB: [string, IconName, string][] = [['4', 'home', 'Accueil'], ['6', 'check', 'Habitudes'], ['3', 'spark', 'IA'], ['menu', 'grid', 'Rubriques']]

export default function App() {
  const [S, setS] = useState<State>(boot.s), [err, setErr] = useState<string | null>(boot.err), [m, setM] = useState<Msg>(null), [h, setH] = useState(hashOf()), [ip, setIp] = useState<Event & { prompt?: () => void } | null>(null)
  const [sheet, setSheet] = useState(false), [vm, setVm] = useState(() => boot.s.ui.onboard && boot.s.ui.verseDay !== today() && !hasPin()), [dir, setDir] = useState(0)
  const [locked, setLocked] = useState(hasPin), [pinV, setPinV] = useState(0)
  const ref = useRef(S), hRef = useRef(h), lockedRef = useRef(locked), pomo = usePomo()
  /** Données chiffrées : verrouiller efface les clés ET l'état affiché de la mémoire. */
  const lock = (v: boolean) => {
    if (v && hasVault()) { stopSyncAuto(); stopCircles(); stopPush(); forgetInvite(); closeKeys(); forgetSession(); const d = DEF(); ref.current = d; setS(d) }
    lockedRef.current = v; setLocked(v)
  }
  const upd: Upd = (f, ok, quiet) => {
    if (lockedRef.current && hasVault()) return false // verrouillé et chiffré : aucune écriture, l'état affiché est vide
    const c = copie(ref.current); f(c.s)
    const n: State = c.fin()
    const saved = save(n); ref.current = n; setS(n)
    if (saved) { touchSync(); touchCircles(); touchPush() }
    setErr(saved ? null : 'Enregistrement impossible : stockage local indisponible ou plein. Les dernières modifications ne sont pas sauvegardées.')
    if (!saved) setM({ e: 1, t: 'Action non enregistrée.' })
    else if (ok) setM({ t: ok })
    else if (!quiet) setM(null)
    return saved
  }
  /** Droit à l'oubli : efface le stockage local ET la base IndexedDB (audios), arrête le minuteur et l'enregistrement en cours, puis vérifie. */
  const purge = async () => {
    resetP(); discardRec()
    stopSyncAuto(); stopCircles(); stopPush(); forgetInvite(); await leave() // déconnexion du compte en ligne tant que la session est encore lisible (durée bornée, jamais bloquante)
    closeKeys()
    const a = wipeLocal(), b = await wipeIDB()
    const n = DEF(); n.ui.onboard = true // l'écran « Données » reste affiché pour annoncer le résultat vérifié ; l'accueil guidé reviendra au prochain lancement, le stockage étant vide
    ref.current = n; setS(n); setVm(false); setSheet(false); lock(false); setPinV(v => v + 1)
    return a && b
  }
  /** Ouvre la fenêtre du verset du jour si elle n'a pas encore été vue aujourd'hui : jamais pendant l'accueil guidé ni derrière l'écran du PIN. */
  const askVerse = () => { const s = ref.current; if (s.ui.onboard && s.ui.verseDay !== today() && !lockedRef.current) { setSheet(false); setVm(true) } }
  useEffect(() => {
    const hc = () => {
      const nx = hashOf(), a = MAIN.indexOf(seg(hRef.current)[0]), b = MAIN.indexOf(seg(nx)[0])
      setDir(a >= 0 && b >= 0 && a !== b ? Math.sign(b - a) : 0); hRef.current = nx; setH(nx); setM(null); scrollTo(0, 0)
    }
    const vc = () => { if (!document.hidden) { upd(s => roll(s)); askVerse() } } // retour au premier plan : nouvelle semaine, nouveau jour
    const bi = (e: Event) => { e.preventDefault(); setIp(e) }
    /** Relit les données enregistrées (modifiées par un autre onglet, ou remplacées par la synchronisation) et les affiche. */
    const reload = () => { if (lockedRef.current && hasVault()) return; const r = load(); if (r.locked) return; ref.current = r.s; setS(r.s) }
    const st = (e: StorageEvent) => { // autre onglet ou fenêtre installée
      if (e.key === null || e.key === PIN_KEY) {
        if (!hasPin()) { if (lockedRef.current) lock(false) } // PIN retiré ailleurs
        else if (hasVault() && !unlocked() && !lockedRef.current) lock(true) // chiffrement activé ailleurs : il faut le PIN ici aussi
      }
      if (e.key === null || e.key === KEY) reload()
    }
    addEventListener('hashchange', hc); document.addEventListener('visibilitychange', vc); addEventListener('beforeinstallprompt', bi); addEventListener('storage', st); addEventListener('believe:reload', reload)
    return () => { removeEventListener('hashchange', hc); document.removeEventListener('visibilitychange', vc); removeEventListener('beforeinstallprompt', bi); removeEventListener('storage', st); removeEventListener('believe:reload', reload) }
  }, [])
  /** Compte en ligne : démarrage des déclencheurs de synchronisation et traitement du retour de connexion Google, une fois l'application déverrouillée (la session est enregistrée avec les données chiffrées). */
  const back = useRef(looksLikeBack())
  useEffect(() => {
    if (locked) return
    startSync(); startCircles(); startPush()
    if (!back.current) return
    back.current = false
    void (async () => {
      const c = await import('./cloud')
      const goTo = (msg: Msg, nx = '2/compte') => { c.cleanBack('#/' + nx); hRef.current = nx; setH(nx); setM(msg); scrollTo(0, 0) } // l'adresse suit l'écran affiché (le retour de connexion l'avait mise sur « Compte »)
      if (!ref.current.consents.cloud) { c.discardBack(); return goTo({ e: 1, t: 'Retour de connexion Google ignoré : l’accord « Compte en ligne » n’est pas donné. Donnez-le ci-dessous pour vous connecter.' }) }
      const r = await c.completeFromUrl()
      if (r.kind === 'none') return
      if (r.kind === 'ok') { const inv = hasInvite(); startSync(); startCircles(); return goTo({ t: 'Connecté avec Google' + (r.session.email ? ' : ' + r.session.email : '') + '. ' + (inv ? 'Une invitation à un cercle d’amis vous attend ci-dessous : vérifiez-la avant de décider. ' : '') + 'Aucune donnée n’est envoyée tant que vous n’avez pas activé la synchronisation ou un partage.' }, inv ? '5/amis' : '2/compte') }
      const why: Record<string, string> = { refused: 'Google ou le service a refusé la connexion' + (r.msg ? ' (« ' + r.msg + ' »)' : '') + '.', nopending: 'Aucune connexion n’avait été demandée sur cet appareil (ou la demande vient d’une autre fenêtre) : recommencez depuis cet onglet.', expired: 'La demande de connexion a expiré (plus de 15 minutes) : recommencez.', denied: 'Le service a refusé le code de connexion : recommencez.', net: 'Hors ligne : la connexion n’a pas pu se terminer. Recommencez.', server: 'Le service ne répond pas correctement : réessayez plus tard.', config: 'Le compte en ligne n’est pas disponible pour le moment.', store: 'Connexion impossible : le stockage du navigateur est plein ou indisponible.' }
      goTo({ e: 1, t: 'Connexion non terminée. ' + (why[r.why] ?? 'Recommencez.') })
    })()
  }, [locked])
  useEffect(() => { document.body.classList.toggle('discret', S.discret) }, [S.discret])
  useEffect(() => {
    const de = document.documentElement
    if (S.settings.theme === 'auto') de.removeAttribute('data-theme'); else de.setAttribute('data-theme', S.settings.theme)
    if (S.settings.motion === 'reduced') de.setAttribute('data-motion', 'reduced'); else de.removeAttribute('data-motion')
    /** La barre du navigateur (Android) prend la couleur de fond du thème choisi, y compris quand le thème suit le système. */
    const tint = () => { const c = getComputedStyle(de).getPropertyValue('--bg').trim(); if (c) document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', c)) }
    tint()
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
    mq?.addEventListener?.('change', tint)
    return () => mq?.removeEventListener?.('change', tint)
  }, [S.settings.theme, S.settings.motion])
  useEffect(() => { if (pomo.finished && !(lockedRef.current && hasVault())) { pomo.finished = false; upd(s => { s.pomos[today()] = (s.pomos[today()] ?? 0) + 1 }, 'Pomodoro terminé : prenez une pause.') } })
  const rem = useReminders(S, upd, locked)
  /** Verrouillage automatique : retour dans l'application après le délai choisi, ou inactivité (au moins 1 minute). */
  useEffect(() => {
    const cfg = readPin()
    if (locked || !cfg) return
    const a = cfg.a // délai en minutes, relu à chaque changement de réglage (pinV)
    let hiddenAt = 0, idle: ReturnType<typeof setTimeout> | undefined
    const lockNow = () => { setSheet(false); setVm(false); lock(true) }
    const arm = () => { clearTimeout(idle); idle = setTimeout(lockNow, Math.max(a, 1) * 60_000) }
    const vis = () => {
      if (document.hidden) { hiddenAt = Date.now(); if (a === 0) lockNow() }
      else { if (hiddenAt && Date.now() - hiddenAt >= a * 60_000) lockNow(); hiddenAt = 0; arm() }
    }
    const evs = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    document.addEventListener('visibilitychange', vis); evs.forEach(e => addEventListener(e, arm, { passive: true })); arm()
    return () => { clearTimeout(idle); document.removeEventListener('visibilitychange', vis); evs.forEach(e => removeEventListener(e, arm)) }
  }, [locked, pinV])
  useEffect(() => { // préchargement discret des autres pages une fois l'accueil affiché (elles restent disponibles hors ligne)
    const go = () => Object.values(PG).forEach(p => { p.load().catch(() => undefined) })
    const w = window as unknown as { requestIdleCallback?: (f: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(go); else setTimeout(go, 1500)
  }, [])

  const [a, sub] = seg(h), n = /^\d+$/.test(a) ? +a : 0, r = n >= 1 && n <= 13 ? R[n - 1] : null
  const p: P & { purge: () => Promise<boolean>; inst: (() => void) | null; pinChanged: () => void } = { S, upd, m, setM, sub, purge, inst: ip?.prompt ? () => { ip.prompt?.(); setIp(null) } : null, pinChanged: () => setPinV(v => v + 1) }
  const sw = useSwipe(d => {
    const i = MAIN.indexOf(a), j = i + d
    if (i < 0 || j < 0 || j >= MAIN.length) return false
    haptic(S); location.hash = '#/' + MAIN[j]; return true
  })
  let body: ReactNode
  if (r) {
    if (n === 4) body = <Home {...p} />
    else { const C = PG[n].C; body = <Suspense fallback={<Skeleton />}><C {...p} /></Suspense> }
  } else if (a === 'menu') body = <Menu />
  else if (PG[a]) { const C = PG[a].C; body = <Suspense fallback={<Skeleton />}><C {...p} /></Suspense> }
  else body = (<><h1>404</h1><p>Cette page n’existe pas.</p><a className="btn" href="#/4">Retour à l’accueil</a></>)

  const closeVerse = () => { setVm(false); upd(s => { s.ui.verseDay = today() }) }
  const water = () => { setSheet(false); upd(s => { s.water[today()] = (s.water[today()] ?? 0) + 250 }, 'Eau : + 250 ml.') }
  const QA: [IconName, string, string][] = [['check', 'Cocher une habitude', '#/6'], ['note', 'Nouvelle note', '#/11/notes'], ['mic', 'Enregistrer un audio', '#/11/audio'], ['tasks', 'Nouvelle tâche', '#/9'], ['heart', 'Ajouter une prière', '#/4/prieres'], ['run', 'Démarrer une séance', '#/7'], ['spark', 'Demander à Believe AI', '#/3']]

  /** Déverrouillage : si les données sont chiffrées, elles sont lues maintenant (les clés viennent d'être ouvertes par le PIN). */
  const unlockApp = () => {
    if (hasVault()) {
      const r = load()
      if (r.locked) return
      roll(r.s); const saved = save(r.s)
      ref.current = r.s; setS(r.s); setErr(r.err ?? (saved ? null : 'Enregistrement impossible : stockage local indisponible ou plein. Les dernières modifications ne sont pas sauvegardées.'))
    }
    lock(false); askVerse()
  }
  if (locked) return <Lock onUnlock={unlockApp} onForgot={async () => { const ok = await purge(); return ok }} />
  if (!S.ui.onboard) return <Onboarding S={S} upd={upd} onFinish={() => { upd(s => { s.ui.onboard = true }); askVerse() }} />
  return (
    <>
      <header>
        <Logo />
        <span className="wm">BELIEVE</span><span className="sp" />
        <button className="hb" aria-label="Discret" aria-pressed={S.discret} onClick={() => upd(s => { s.discret = !s.discret })}><Icon n={S.discret ? 'eyeoff' : 'eye'} /></button>
        <a className="hb" href="#/2" aria-label="Paramètres" aria-current={a === '2' ? 'page' : undefined}><Icon n="gear" /></a>
        <a className="av" href="#/1" aria-label="Mon profil">{S.profile ? (Array.from(S.profile.name.trim())[0] ?? '').toUpperCase() : <Icon n="user" size={20} />}</a>
      </header>
      {err && <p className="ban" role="alert">{err}</p>}
      <RecBanner a={a} />
      {pomo.st === 'run' && a !== '9' && <a className="ban" href="#/9" style={{ display: 'block', color: 'inherit' }}>Pomodoro en cours : {clock(left(pomo.end))}</a>}
      <RemindBanner items={rem.items} discret={S.discret} onClose={rem.clear} />
      {syncOn() && !(a === '2' && seg(sub)[0] === 'compte') && <Suspense fallback={null}><SyncBanner /></Suspense>}
      <div className="app">
        <nav className="side" aria-label="Rubriques">
          <button className="btn" onClick={() => setSheet(true)}>+ Actions rapides</button>
          {R.map(x => <a key={x.i} href={'#/' + x.i} aria-current={a === String(x.i) ? 'page' : undefined}><Icon n={x.ic} size={24} />{x.i}. {x.t}</a>)}
        </nav>
        <main {...sw}><View key={a} cls={dir > 0 ? ' fwd' : dir < 0 ? ' back' : ''}>{body}</View></main>
      </div>
      {a !== '3' && <a className="fab" href="#/3" aria-label="IA : ouvrir Believe AI"><Icon n="spark" size={26} /></a>}
      <nav className="bot" aria-label="Navigation principale">
        {NB.slice(0, 2).map(([k, g, t]) => <a key={k} href={'#/' + k} aria-current={k === a ? 'page' : undefined}><Icon n={g} size={26} />{t}</a>)}
        <button className="plus" aria-label="Actions rapides" aria-haspopup="dialog" onClick={() => setSheet(true)}><Icon n="plus" size={26} strokeWidth={2.6} /></button>
        {NB.slice(2).map(([k, g, t]) => <a key={k} href={'#/' + k} aria-current={k === a ? 'page' : undefined}><Icon n={g} size={26} />{t}</a>)}
      </nav>
      <Dialog open={sheet} onClose={() => setSheet(false)} label="Actions rapides" sheet>
        <h2 style={{ marginTop: 0 }}>Actions rapides</h2>
        <div className="qa">
          {QA.map(([g, t, href]) => <a key={t} href={href} onClick={e => { setSheet(false); if (href === '#/4/prieres' && href === location.hash) { e.preventDefault(); setTimeout(focusPrayerField, 0) } }}><span className="qi"><Icon n={g} size={22} /></span>{t}</a>)}
          {S.consents.health ? <button onClick={water}><span className="qi"><Icon n="drop" size={22} /></span>Boire + 250 ml</button> : <a href="#/8/eau" onClick={() => setSheet(false)}><span className="qi"><Icon n="drop" size={22} /></span>Eau et sommeil</a>}
        </div>
        <button className="btn alt" style={{ marginTop: 12, width: '100%' }} onClick={() => setSheet(false)}>Fermer</button>
      </Dialog>
      <VerseModal S={S} upd={upd} open={vm} onClose={closeVerse} />
    </>
  )
}
