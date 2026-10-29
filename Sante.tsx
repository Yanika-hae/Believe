import { useId, useRef, useState } from 'react'
import type { State } from './lib'
import { gauge, today } from './lib'
import { FREE_NOTE, askJSON, compress, errText } from './ai'
import DishArt from './DishArt'
import { okRecipes, okScan, pushMeal } from './health'
import type { Recipe } from './health'
import { Flash, Gate, Tabs, num, useTab } from './ui'
import Suivi from './SuiviPage'
import type { P, Upd } from './ui'

type SP = P
const msgOf = errText

/** Accord à l'IA (et aux photos) pour le scanner et les recettes. */
const AiGate = ({ upd, photo }: { S: State; upd: Upd; photo: boolean }) => (
  <div className="card"><h2>Consentement</h2>
    <p>Les données saisies{photo ? ' et la photo (compressée sur votre appareil)' : ''} sont envoyées au serveur de Believe, puis à Google (API Gemini) pour l’analyse. {FREE_NOTE} Rien n’est envoyé sans votre action. Les résultats sont des estimations générées par IA, modifiables avant tout ajout au journal. Retrait possible dans Paramètres › Confidentialité.</p>
    <button className="btn" onClick={() => upd(s => { s.consents.ai = true; if (photo) s.consents.photo = true }, 'Consentement enregistré.')}>J’accepte</button></div>
)

function Weight({ S, upd, setM }: SP) {
  const [v, setV] = useState(''), p = S.profile, ws = [...S.weights].sort((a, b) => a.d.localeCompare(b.d)), g = gauge(p)
  const add = () => {
    const kg = num(v)
    if (!(kg >= 30 && kg <= 250)) return setM({ e: 1, t: 'Poids : de 30 à 250 kg.' })
    setV(''); upd(s => { const i = s.weights.findIndex(x => x.d === today()); if (i < 0) s.weights.push({ d: today(), kg }); else s.weights[i].kg = kg; if (s.profile) s.profile.w = kg }, 'Poids enregistré.')
  }
  const lo = Math.min(...ws.map(x => x.kg), p ? p.t : Infinity), hi = Math.max(...ws.map(x => x.kg), p ? p.t : -Infinity), f = (k: number) => 90 - ((k - lo) / Math.max(hi - lo, 1)) * 80
  const xs = ws.map((_, i) => ws.length > 1 ? 10 + (i * 280) / (ws.length - 1) : 150), ys = ws.map(x => f(x.kg))
  const pts = xs.map((x, i) => x + ',' + ys[i]).join(' '), gid = useId().replace(/[^A-Za-z0-9]/g, '')
  return (
    <>
      <div className="row"><input inputMode="decimal" aria-label="Poids en kg" placeholder="Poids du jour (kg)" className="sens" style={{ flex: '1 1 160px', width: 'auto' }} value={v} onChange={e => setV(e.target.value)} /><button className="btn" onClick={add}>Enregistrer</button></div>
      {g !== null && p && <p className="sens">Objectif : {p.ws} → {p.t} kg, jauge {g} %</p>}
      {ws.length > 0 && (
        <svg className="sens" viewBox="0 0 300 100" role="img" aria-label="Courbe de poids" style={{ width: '100%', marginTop: 8, overflow: 'visible' }}>
          <defs>
            <linearGradient id={gid + 'l'} x1="0" x2="1" y1="0" y2="0"><stop offset="0" style={{ stopColor: 'var(--ra)' }} /><stop offset="1" style={{ stopColor: 'var(--rb)' }} /></linearGradient>
            <linearGradient id={gid + 'a'} x1="0" x2="0" y1="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--ra)', stopOpacity: 0.3 }} /><stop offset="1" style={{ stopColor: 'var(--ra)', stopOpacity: 0 }} /></linearGradient>
          </defs>
          {p && <line x1="0" x2="300" y1={f(p.t)} y2={f(p.t)} stroke="var(--mut)" strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round" />}
          {ws.length > 1 && <polygon points={pts + ' ' + xs[xs.length - 1] + ',100 ' + xs[0] + ',100'} fill={'url(#' + gid + 'a)'} />}
          <polyline points={pts} fill="none" stroke={'url(#' + gid + 'l)'} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="5" fill="var(--rb)" stroke="var(--card)" strokeWidth="2.5" />
        </svg>
      )}
      {ws.slice(-5).reverse().map(x => <p key={x.d} className="sens mut" style={{ margin: '2px 0' }}>{x.d} : {x.kg} kg</p>)}
      {!ws.length && <p className="mut">Aucune pesée enregistrée.</p>}
    </>
  )
}

function Daily({ S, upd, setM }: SP) {
  const k = today(), w = S.water[k] ?? 0, [h, setH] = useState(String(S.sleep[k] ?? ''))
  const sl = () => { const x = num(h); if (!(x >= 0 && x <= 16)) return setM({ e: 1, t: 'Sommeil : de 0 à 16 h.' }); upd(s => { s.sleep[k] = x }, 'Sommeil enregistré.') }
  return (
    <>
      <h2>Hydratation</h2><p><b>{w} ml</b> <span className="mut">aujourd’hui, repère général 1,5 à 2 L à adapter</span></p>
      <div className="row"><button className="btn alt" onClick={() => upd(s => { s.water[k] = Math.max(0, (s.water[k] ?? 0) - 250) })}>− 250 ml</button><button className="btn" onClick={() => upd(s => { s.water[k] = (s.water[k] ?? 0) + 250 })}>+ 250 ml</button></div>
      <h2>Sommeil de la nuit</h2>
      <div className="row"><input inputMode="decimal" aria-label="Heures de sommeil" placeholder="Heures (ex. 7,5)" style={{ flex: '1 1 140px', width: 'auto' }} value={h} onChange={e => setH(e.target.value)} /><button className="btn" onClick={sl}>Enregistrer</button></div>
      <p className="mut">{S.sleep[k] !== undefined ? 'Enregistré aujourd’hui : ' + S.sleep[k] + ' h.' : 'Rien d’enregistré aujourd’hui.'}</p>
    </>
  )
}

function Meals({ S, upd, setM }: SP) {
  const k = today(), ms = S.meals.filter(x => x.d === k), t = ms.reduce((a, x) => ({ kcal: a.kcal + x.kcal, p: a.p + x.p, g: a.g + x.g, l: a.l + x.l }), { kcal: 0, p: 0, g: 0, l: 0 })
  const [f, setF] = useState({ n: '', kcal: '', p: '', g: '', l: '' })
  const add = () => {
    const m = { n: f.n.trim().slice(0, 60), kcal: num(f.kcal), p: num(f.p || '0'), g: num(f.g || '0'), l: num(f.l || '0') }
    if (!m.n || ![m.kcal, m.p, m.g, m.l].every(x => Number.isFinite(x) && x >= 0) || m.kcal > 5000) return setM({ e: 1, t: 'Nom requis et valeurs positives (5000 kcal maximum).' })
    setF({ n: '', kcal: '', p: '', g: '', l: '' }); upd(s => pushMeal(s, m, 'manuel'), 'Repas ajouté.')
  }
  const inp = (key: 'n' | 'kcal' | 'p' | 'g' | 'l', ph: string) => <input aria-label={ph} placeholder={ph} inputMode={key === 'n' ? 'text' : 'decimal'} value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })} style={{ flex: key === 'n' ? '2 1 140px' : '1 1 70px', width: 'auto' }} />
  return (
    <>
      <p className="sens"><b>{t.kcal} kcal</b>, protéines {t.p} g, glucides {t.g} g, lipides {t.l} g <span className="mut">(somme des repas du jour)</span></p>
      <div className="row">{inp('n', 'Repas')}{inp('kcal', 'kcal')}{inp('p', 'Prot. g')}{inp('g', 'Gluc. g')}{inp('l', 'Lip. g')}<button className="btn" onClick={add}>Ajouter</button></div>
      {ms.map(x => <div className="li sens" key={x.id}><span>{x.n} <small className="mut">({x.src})</small><br /><small className="mut">{x.kcal} kcal, P {x.p}, G {x.g}, L {x.l}</small></span><button className="cb" aria-label={'Retirer ' + x.n} style={{ color: 'var(--mut)' }} onClick={() => upd(s => { s.meals = s.meals.filter(y => y.id !== x.id) })}>✕</button></div>)}
      {!ms.length && <p className="mut">Aucun repas aujourd’hui.</p>}
    </>
  )
}

function Scan({ S, upd, setM }: SP) {
  const [busy, setBusy] = useState(false), [er, setEr] = useState(''), [sc, setSc] = useState<Record<string, string> | null>(null), ac = useRef<AbortController | null>(null)
  if (!S.consents.ai || !S.consents.photo) return <AiGate S={S} upd={upd} photo />
  const pick = async (f?: File) => {
    if (!f) return
    setBusy(true); setEr(''); setSc(null); ac.current = new AbortController()
    try {
      const d = okScan((await askJSON('scan', 'Analyse ce plat.', await compress(f), ac.current.signal)).data)
      if (!d) throw new Error('invalid')
      setSc({ n: d.nom, kcal: String(d.kcal), p: String(d.proteines), g: String(d.glucides), l: String(d.lipides), conseil: d.conseil, inc: d.incertitude })
    } catch (e) { setEr((e as Error).message) } finally { setBusy(false) }
  }
  const addIt = () => {
    if (!sc) return
    const m = { n: sc.n.trim().slice(0, 60), kcal: num(sc.kcal), p: num(sc.p), g: num(sc.g), l: num(sc.l) }
    if (!m.n || ![m.kcal, m.p, m.g, m.l].every(x => Number.isFinite(x) && x >= 0) || m.kcal > 5000) return setM({ e: 1, t: 'Corrigez les valeurs : nom requis, nombres positifs (5000 kcal maximum).' })
    upd(s => pushMeal(s, m, 'IA'), 'Repas ajouté après votre validation.'); setSc(null)
  }
  return (
    <>
      <p className="mut">Photographiez votre plat : l’IA estime calories et macros (estimation souvent approximative). Vous pouvez tout corriger avant l’ajout au journal.</p>
      <input type="file" accept="image/*" aria-label="Photo du plat" disabled={busy} onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      {busy && <p className="mut" role="status">Analyse en cours… <button className="chip" onClick={() => ac.current?.abort()}>Annuler</button></p>}
      {er && <p className="ko" role="alert">{msgOf(er)}</p>}
      {sc && <div className="card"><h2>Résultat à valider</h2>
        <div className="grid2">{(['n', 'kcal', 'p', 'g', 'l'] as const).map((key, i) => <div key={key}><label htmlFor={'sc' + key}>{['Plat', 'kcal', 'Protéines (g)', 'Glucides (g)', 'Lipides (g)'][i]}</label><input id={'sc' + key} value={sc[key]} onChange={e => setSc({ ...sc, [key]: e.target.value })} /></div>)}</div>
        <p><b>Conseil :</b> {sc.conseil}</p><p className="mut">Incertitudes : {sc.inc}</p><p className="mut">Généré par IA : estimation à vérifier.</p>
        <button className="btn" onClick={addIt}>Ajouter au journal</button> <button className="btn alt" onClick={() => setSc(null)}>Ignorer</button></div>}
    </>
  )
}

function Recipes({ S, upd, setM }: SP) {
  const [t, setT] = useState(''), [img, setImg] = useState<string | undefined>(), [busy, setBusy] = useState(false), [er, setEr] = useState(''), [rs, setRs] = useState<Recipe[]>([]), ac = useRef<AbortController | null>(null)
  const [pics, setPics] = useState<Record<number, boolean>>({})
  if (!S.consents.ai) return <AiGate S={S} upd={upd} photo={false} />
  const photo = async (f?: File) => {
    if (!f) return
    if (!S.consents.photo) return setM({ e: 1, t: 'Consentement photo requis : activez-le dans l’onglet Scanner.' })
    try { setImg(await compress(f)); setEr('') } catch (e) { setEr((e as Error).message) }
  }
  const go = async () => {
    if (!t.trim() && !img) return setM({ e: 1, t: 'Indiquez des ingrédients ou ajoutez une photo du frigo.' })
    setBusy(true); setEr(''); setRs([]); ac.current = new AbortController()
    setPics({}) // les dessins de la liste précédente ne seraient plus attachés à rien
    try {
      const r = okRecipes((await askJSON('recipes', 'Ingrédients : ' + (t.trim().slice(0, 600) || 'voir la photo'), img, ac.current.signal)).data)
      if (!r) throw new Error('invalid')
      setRs(r)
    } catch (e) { setEr((e as Error).message) } finally { setBusy(false) }
  }
  /** Dessin du plat, à la demande : fait sur l'appareil à partir du titre et des ingrédients, sans réseau ni IA ; il n'est jamais enregistré. */
  const flip = (i: number) => setPics(p => ({ ...p, [i]: !p[i] }))
  return (
    <>
      <p className="mut">Indiquez vos ingrédients (ou photographiez votre frigo) : 3 recettes saines et pauvres en sucre. Chaque recette peut recevoir, sur demande, une image du plat (dessin gratuit fait sur votre appareil).</p>
      <textarea rows={3} maxLength={600} aria-label="Ingrédients" placeholder="Ex. : courgettes, œufs, feta" value={t} onChange={e => setT(e.target.value)} />
      <label htmlFor="fr" style={{ marginTop: 8 }}>Photo du frigo (facultatif){img ? ' : ajoutée' : ''}</label>
      <input id="fr" type="file" accept="image/*" onChange={e => { photo(e.target.files?.[0]); e.target.value = '' }} />
      <p className="row"><button className="btn" disabled={busy} onClick={go}>Proposer 3 recettes</button>{img && <button className="btn alt" onClick={() => setImg(undefined)}>Retirer la photo</button>}{busy && <button className="btn alt" onClick={() => ac.current?.abort()}>Annuler</button>}</p>
      {busy && <p className="mut" role="status">Recherche de recettes…</p>}
      {er && <p className="ko" role="alert">{msgOf(er)}</p>}
      {rs.length > 0 && <p id="dish-note" className="mut"><small>Image du plat, facultative et gratuite : dessin schématique fait sur votre appareil d’après le titre et les ingrédients (ce n’est pas une photo, aucune IA n’intervient, rien n’est envoyé).</small></p>}
      {rs.map((r, n) => { const on = !!pics[n]; return (
        <div className="card" key={r.titre}>
          {on && <figure className="dish"><DishArt title={r.titre} ingredients={r.ingredients} /><figcaption className="mut"><small>Dessin fait par l’application d’après les ingrédients (ni photo, ni image d’IA). La recette réelle peut différer.</small></figcaption></figure>}
          <h2>{r.titre}</h2><p className="mut">{r.minutes} min, {r.kcal} kcal par portion (P {r.proteines} g, G {r.glucides} g, L {r.lipides} g). Généré par IA : estimation.</p>
          <p><b>Ingrédients :</b> {r.ingredients.join(', ')}</p><ol>{r.etapes.map((x, i) => <li key={i}>{x}</li>)}</ol>
          <div className="row">
            <button className="btn" onClick={() => upd(s => pushMeal(s, { n: r.titre, kcal: r.kcal, p: r.proteines, g: r.glucides, l: r.lipides }, 'IA'), 'Recette ajoutée à l’alimentation après votre validation.')}>Ajouter à l’alimentation</button>
            <button className="btn alt" aria-describedby="dish-note" onClick={() => flip(n)}>{on ? 'Masquer l’image du plat' : 'Afficher l’image du plat'}</button>
          </div>
          <span className="sr" role="status">{on ? 'Image du plat affichée.' : ''}</span>
        </div>) })}
    </>
  )
}

export default function SantePage(p: SP) {
  const [tab, setTab] = useTab(p.sub, ['poids', 'eau', 'suivi', 'repas', 'scanner', 'recettes'])
  return (
    <>
      <h1>Santé, scanner et recettes</h1>
      <Flash m={p.m} />
      <Gate k="health" S={p.S} upd={p.upd} title="Santé et poids" why={<p>Pour suivre votre poids, votre eau, votre sommeil et vos repas, Believe les enregistre sur cet appareil uniquement. Rien n’est envoyé à un serveur, sauf si vous demandez vous-même une analyse par l’IA (scanner, recettes), avec son propre accord. Ce sont des données de santé : le mode discret et le PIN aident à les protéger.</p>}>
        <Tabs items={['Poids', 'Eau et sommeil', 'Cycle / récupération', 'Repas', 'Scanner', 'Recettes']} v={tab} set={setTab} label="Section" S={p.S}>
          <div hidden={tab !== 0}><Weight {...p} /></div><div hidden={tab !== 1}><Daily {...p} /></div><div hidden={tab !== 2}><Suivi S={p.S} upd={p.upd} /></div><div hidden={tab !== 3}><Meals {...p} /></div><div hidden={tab !== 4}><Scan {...p} /></div><div hidden={tab !== 5}><Recipes {...p} /></div>
        </Tabs>
        <p className="mut">Estimations indicatives, jamais un avis médical ni diététique. En cas de doute ou de trouble alimentaire, parlez-en à un professionnel de santé.</p>
      </Gate>
    </>
  )
}
