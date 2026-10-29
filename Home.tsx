import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { curVerse, dayIdx, dayPct, gauge, refSpoken, today, trLabel, vlist } from './lib'
import type { State, Verse } from './lib'
import { quad } from './cal'
import { askAI, errText } from './ai'
import { Dialog, Flash, canSay, say, stopSay } from './ui'
import type { P, Upd } from './ui'
import PrayerWall from './Prayers'
import Icon from './icons'

/** Texte lu à voix haute : le verset, puis sa référence prononcée (« Psaume 46, verset 6 »). */
const readVerse = (v: Verse) => v[1] + ' ' + refSpoken(v[0])
/** Taille du verset : les plus longs sont un peu moins grands pour que la carte reste lisible d'un coup d'œil. */
const qc = (t: string) => 'q' + (t.length > 170 ? ' xl' : t.length > 110 ? ' lg' : '')
const nextVerse = (s: State) => { const c = s.verse && s.verse.d === today() ? s.verse.i : dayIdx(); s.verse = { d: today(), i: (c + 1) % vlist(s).length } }

/** Encouragement de Believe AI, clairement distingué du texte biblique ; envoie uniquement le verset affiché, sur clic. */
function Encourage({ S, v }: { S: State; v: Verse }) {
  const [txt, setTxt] = useState(''), [busy, setBusy] = useState(false), [er, setEr] = useState(''), ac = useRef<AbortController | null>(null)
  if (!S.consents.ai) return <p className="mut">Pour recevoir un encouragement écrit par Believe AI, donnez votre accord à l’IA dans la rubrique 3.</p>
  const go = async () => {
    setBusy(true); setEr(''); ac.current = new AbortController()
    try {
      const r = await askAI('spirit', [{ role: 'user', content: 'Écris un court encouragement (trois phrases au plus) inspiré de ce verset : « ' + v[1] + ' » (' + v[0] + '). Ne cite aucun autre verset.' }], '', ac.current.signal)
      setTxt(r.text)
    } catch (e) { setEr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn alt" disabled={busy} onClick={go}><Icon n="spark" size={18} />Encouragement de Believe AI</button>
      {busy && <> <span className="mut" role="status">Believe AI écrit…</span> <button className="chip" onClick={() => ac.current?.abort()}>Annuler</button></>}
      {er && <p className="ko" role="alert">{errText(er)}</p>}
      {txt && <div className="ai"><span className="tag">Généré par IA, distinct du texte biblique</span><p>{txt}</p></div>}
    </div>
  )
}

/** Fenêtre du verset du jour, affichée une fois par jour à l’ouverture de l’application. */
export function VerseModal({ S, upd, open, onClose }: { S: State; upd: Upd; open: boolean; onClose: () => void }) {
  const v = curVerse(S), close = () => { stopSay(); onClose() }
  return (
    <Dialog open={open} onClose={close} label="Verset du jour" cls="vm">
      <div className="reel">
        <span className="tag">Verset du jour</span>
        <p className={qc(v[1])}>« {v[1]} »</p>
        <p className="mut">{v[0]}, {trLabel(v)}</p>
        <div className="row">
          <button className="btn" onClick={close}>Continuer</button>
          <button className="btn alt" onClick={() => upd(nextVerse)}><Icon n="refresh" size={18} />Nouveau verset</button>
          {canSay && <button className="btn alt" onClick={() => say(readVerse(v))}><Icon n="speaker" size={18} />Écouter</button>}
        </div>
        <Encourage S={S} v={v} />
      </div>
    </Dialog>
  )
}

/** Anneau d'un indicateur : `pct` (0 à 100) règle l'arc coloré ; sans valeur, l'anneau est plein. */
const ring = (pct?: number): CSSProperties | undefined => (pct === undefined ? undefined : ({ '--p': Math.max(0, Math.min(100, Math.round(pct))) } as CSSProperties))

export default function Home({ S, upd, m, sub }: P) {
  const p = S.profile, v = curVerse(S), g = gauge(p), kc = S.meals.filter(x => x.d === today()).reduce((a, x) => a + x.kcal, 0), steps = S.steps[today()]
  const pct = dayPct(S, today()), p1 = S.tasks.filter(x => !x.done && quad(x) === 1).length
  return (
    <>
      <h1>{p ? 'Bonjour ' + p.name : 'Bienvenue'}</h1>
      <p className="mut" style={{ marginTop: 0 }}>{p ? 'Prêt' + (p.g === 'F' ? 'e' : '') + ' pour aujourd’hui ?' : 'Renseignez votre profil pour recevoir des versets adaptés.'}</p>
      <Flash m={m} />
      <div className="story" role="group" aria-label="Indicateurs du jour">
        <a className="st" href="#/6"><span className="ring" style={ring(pct)}><b>{pct} %</b></span><span className="lb">Habitudes du jour</span></a>
        <div className="st"><span className="ring sens" style={ring(g ?? undefined)}>{p ? <><b>{p.w}</b><small>kg</small></> : <b>—</b>}</span><span className="lb">Poids{p && <> <span className="sens">→ {p.t} kg</span></>}{g !== null && <span className="sr sens">, jauge {g} %</span>}</span></div>
        <a className="st" href="#/7"><span className="ring" style={ring(steps === undefined ? 0 : steps / 100)}><b>{steps ?? '—'}</b></span><span className="lb">Pas du jour</span></a>
        <a className="st" href="#/8"><span className="ring"><b className="sens">{kc}</b><small className="sens">kcal</small></span><span className="lb">Kcal et eau<br />{S.water[today()] ?? 0} ml</span></a>
        <a className="st" href="#/9"><span className="ring"><b>{p1}</b></span><span className="lb">Priorité P1</span></a>
      </div>
      <section className="verse reel" aria-label="Verset du jour">
        <span className="tag">Verset du jour</span>
        <p className={qc(v[1])}>« {v[1]} »</p>
        <p className="mut">{v[0]}, {trLabel(v)}</p>
        <div className="row">
          <button className="btn" onClick={() => upd(nextVerse)}><Icon n="refresh" size={18} />Nouveau verset</button>
          {canSay && <button className="btn alt" onClick={() => say(readVerse(v))}><Icon n="speaker" size={18} />Écouter</button>}
          {!p && <a className="btn alt" href="#/1">Renseigner mon profil</a>}
        </div>
        <Encourage S={S} v={v} />
      </section>
      <PrayerWall S={S} upd={upd} focus={sub === 'prieres'} />
    </>
  )
}
