import { useEffect, useRef, useState } from 'react'
import { habitOf, markHabit, today } from './lib'
import type { P } from './ui'
import { askJSON, errText } from './ai'
import { GEN_MAX, PER_QUIZ, QCATS, addGen, allQ, answerQ, curQs, genRequest, inProgress, parseGen, progress, remaining, seenQs, startQuiz, stats, view } from './quiz'
import type { Q, QCat, Start, StartOpts } from './quiz'

const LET = ['A', 'B', 'C', 'D']
const dayFr = (d: string) => { const x = new Date(d + 'T00:00:00'); return isNaN(+x) ? d : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) }
const pct = (ok: number, n: number) => (n ? Math.round(100 * ok / n) : 0)
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n > 1 ? many : one)
/** Réponse telle qu'elle est affichée : lettre de sa position à l'écran, puis texte. */
const shown = (q: Q, orig: number) => LET[view(q).order.indexOf(orig)] + '. ' + q.o[orig]
const firstOpen = (S: P['S']) => { const cur = S.quiz.cur, qs = curQs(S), i = cur ? qs.findIndex(q => cur.ans[q.id] === undefined) : -1; return i < 0 ? qs.length : i }

type Begin = (o?: StartOpts) => void

function Options({ q, chosen, onPick }: { q: Q; chosen: number | undefined; onPick: (orig: number) => void }) {
  const done = chosen !== undefined
  return (
    <div className="opts" role="group" aria-label="Réponses possibles">
      {view(q).order.map((orig, k) => {
        const good = orig === q.a, mine = chosen === orig
        return (
          <button key={orig} type="button" className={'opt' + (done && good ? ' good' : done && mine ? ' bad' : '')} aria-disabled={done || undefined} onClick={() => { if (!done) onPick(orig) }}>
            <b>{LET[k]}.</b> {q.o[orig]}
            {done && good && <span className="tag">✓ Bonne réponse{mine ? ' · la vôtre' : ''}</span>}
            {done && mine && !good && <span className="tag">✗ Votre réponse</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Quiz en cours : une question à la fois, explication après chaque réponse, puis score et revue des réponses. */
function Run({ S, upd, idx, setIdx, begin, onHome }: Pick<P, 'S' | 'upd'> & { idx: number; setIdx: (i: number) => void; begin: Begin; onHome: () => void }) {
  const cur = S.quiz.cur!, qs = curQs(S), p = progress(S), n = qs.length
  const [ask, setAsk] = useState(false)
  const head = useRef<HTMLHeadingElement>(null), next = useRef<HTMLButtonElement>(null), first = useRef(true)
  const q = idx < n ? qs[idx] : undefined, chosen = q ? cur.ans[q.id] : undefined
  useEffect(() => { if (first.current) { first.current = false; return } head.current?.focus() }, [idx])
  useEffect(() => { if (chosen !== undefined) next.current?.focus() }, [chosen, q?.id])
  const close = () => { upd(s => { s.quiz.cur = null }); onHome() }
  if (!n) return <div className="card"><h2>Quiz</h2><p>Ce quiz ne contient plus aucune question disponible.</p><button className="btn" onClick={close}>Fermer</button></div>

  if (!q) { // score et revue
    const pc = pct(p.ok, p.n), more = cur.rev ? seenQs(S).length > 0 : remaining(S).total > 0
    return (
      <>
        <div className="card">
          <h2>{cur.rev ? 'Révision terminée' : 'Quiz terminé'}</h2>
          <p className="score" style={{ margin: '4px 0' }}><b>{p.ok} / {p.n}</b> · {pc} % de bonnes réponses</p>
          <p style={{ marginTop: 0 }}>{pc >= 80 ? 'Très bien joué.' : pc >= 50 ? 'Bien joué : continuez ainsi.' : 'Relisez les explications ci-dessous : c’est ainsi que l’on retient.'}{cur.rev ? ' Cette révision n’est pas comptée dans vos statistiques.' : ''}</p>
          <div className="row">
            <button className="btn" disabled={!more} onClick={() => begin(cur.rev ? { rev: true } : {})}>{cur.rev ? 'Une autre révision' : 'Un autre quiz inédit'}</button>
            <button className="btn alt" onClick={onHome}>Retour</button>
          </div>
          {!more && <p className="mut" style={{ marginBottom: 0 }}><small>{cur.rev ? 'Aucune question à réviser.' : 'Plus aucune question inédite : retournez à l’accueil du quiz pour réviser ou demander de nouvelles questions à l’IA.'}</small></p>}
        </div>
        <div className="card">
          <h2>Vos réponses</h2>
          <ol className="rev">
            {qs.map(x => {
              const a = cur.ans[x.id], ok = a === x.a
              return (
                <li key={x.id}>
                  <b>{x.q}</b>{x.ia && <> <span className="tag">Généré par IA</span></>}
                  <div>{ok ? <span className="ok">✓ Juste : {a !== undefined && shown(x, a)}</span> : <><span className="ko">✗ Votre réponse : {a !== undefined ? shown(x, a) : 'aucune'}</span><br /><span className="ok">Bonne réponse : {shown(x, x.a)}</span></>}</div>
                  <div className="mut"><small>{x.e}</small></div>
                </li>
              )
            })}
          </ol>
        </div>
      </>
    )
  }

  const ok = chosen === q.a, last = idx === n - 1, left = n - p.answered
  const pick = (orig: number) => {
    const fin = left === 1 && !cur.rev, h = fin ? habitOf(S, 'apprendre') : undefined
    const mark = !!h && !(S.checks[today()] ?? []).includes(h.id), done = left === 1
    upd(s => { if (answerQ(s, q.id, orig) && mark) markHabit(s, 'apprendre') },
      done ? (cur.rev ? 'Révision terminée.' : 'Quiz terminé et ajouté à l’historique.') + (mark ? ' Habitude « ' + h!.n + ' » cochée pour aujourd’hui.' : '') : undefined, !done)
  }
  return (
    <>
      <div className="card" role="region" aria-label={'Question ' + (idx + 1) + ' sur ' + n}>
        <div className="row"><span className="tag">{q.c}</span>{cur.rev && <span className="tag">Révision</span>}{q.ia && <span className="tag">Généré par IA</span>}</div>
        <progress value={p.answered} max={n} aria-label="Questions répondues" />
        <h2 ref={head} tabIndex={-1} style={{ marginTop: 12 }}>Question {idx + 1} sur {n}</h2>
        <p className="qq">{q.q}</p>
        <Options q={q} chosen={chosen} onPick={pick} />
        <div role="status" className="fb">
          {chosen !== undefined && <>
            <p><b className={ok ? 'ok' : 'ko'}>{ok ? 'Bonne réponse.' : 'Ce n’est pas la bonne réponse.'}</b>{!ok && <> La bonne réponse est : {shown(q, q.a)}.</>}</p>
            <p>{q.e}</p>
            {q.ia && <p className="mut"><small>Question générée par IA : vérifiez les réponses importantes.</small></p>}
          </>}
        </div>
        {chosen !== undefined && <button ref={next} className="btn" onClick={() => setIdx(idx + 1)}>{last ? 'Voir mon score' : 'Question suivante'}</button>}
      </div>
      <div className="row">
        <button className="chip" onClick={onHome}>Quitter, reprendre plus tard</button>
        {!ask && p.answered < n && <button className="chip" onClick={() => setAsk(true)}>Abandonner ce quiz</button>}
        {ask && <>
          <span className="mut"><small>{cur.rev ? 'Le quiz sera fermé sans être compté.' : 'Les questions non répondues ne seront pas reproposées et le quiz ne sera pas compté.'}</small></span>
          <button className="chip" onClick={() => { upd(s => { s.quiz.cur = null }, 'Quiz abandonné.'); onHome() }}>Confirmer l’abandon</button>
          <button className="chip" onClick={() => setAsk(false)}>Garder le quiz</button></>}
      </div>
    </>
  )
}

/** Questions supplémentaires par IA : texte exact montré, accord et clic avant tout envoi ; chaque question est contrôlée avant d'être gardée. */
function Gen({ S, upd }: Pick<P, 'S' | 'upd'>) {
  const [cat, setCat] = useState<QCat>('Vocabulaire'), [wait, setWait] = useState(false), [note, setNote] = useState<{ e?: 1; t: string } | null>(null)
  const ctl = useRef<AbortController | null>(null)
  useEffect(() => () => ctl.current?.abort(), [])
  const sent = genRequest(cat), full = S.quiz.gen.length >= GEN_MAX
  const send = async () => {
    const c = new AbortController(); ctl.current = c; setWait(true); setNote(null)
    try {
      const r = await askJSON('quiz', sent, undefined, c.signal)
      const res = { n: 0, invalid: 0, dup: 0 }
      if (!upd(s => { const g = parseGen(r.data, cat, s); res.invalid = g.invalid; res.dup = g.dup; res.n = addGen(s, g.add) })) return
      const extra = (res.invalid ? ' ' + plural(res.invalid, 'question refusée', 'questions refusées') + ' (forme invalide).' : '') + (res.dup ? ' ' + plural(res.dup, 'doublon écarté', 'doublons écartés') + '.' : '')
      setNote(res.n ? { t: plural(res.n, 'nouvelle question ajoutée', 'nouvelles questions ajoutées') + ' (thème « ' + cat + ' »), signalées « Généré par IA ». Vérifiez les réponses importantes.' + extra } : { e: 1, t: 'Aucune question utilisable dans la réponse de l’IA.' + extra + ' Réessayez.' })
    } catch (e) {
      const m = (e as Error).message
      if (m !== 'cancelled') setNote({ e: 1, t: errText(m) })
    } finally { setWait(false) }
  }
  return (
    <div className="card">
      <h2>Questions supplémentaires (IA)</h2>
      <p style={{ marginTop: 0 }}>Quand vous avez vu toutes les questions intégrées, Believe AI peut en écrire de nouvelles. Elles sont contrôlées (quatre réponses distinctes, pas de doublon) avant d’être gardées sur cet appareil, et signalées comme générées par IA, car une IA peut se tromper.</p>
      <label htmlFor="gencat">Thème des questions</label>
      <select id="gencat" value={cat} disabled={wait} onChange={e => setCat(e.target.value as QCat)}>{QCATS.map(c => <option key={c}>{c}</option>)}</select>
      <b style={{ display: 'block', marginTop: 10 }}>Ce qui sera envoyé à l’IA (Google Gemini, via le serveur Believe)</b>
      <pre className="send" tabIndex={0} aria-label="Texte exact qui sera envoyé">{sent}</pre>
      <p className="mut"><small>Ce texte ne contient aucune donnée personnelle : seul le thème choisi y figure. Rien n’est envoyé tant que vous n’appuyez pas sur le bouton.</small></p>
      {note && <p className={note.e ? 'ko' : 'ok'} role="status">{note.t}</p>}
      {full && <p className="ko">Limite de {GEN_MAX} questions générées atteinte sur cet appareil.</p>}
      {wait
        ? <div className="row"><span role="status">Believe AI écrit…</span><button className="btn alt" onClick={() => ctl.current?.abort()}>Arrêter d’attendre la réponse</button></div>
        : S.consents.ai
          ? <button className="btn" disabled={full} onClick={send}>Générer 6 questions</button>
          : <button className="btn" onClick={() => upd(s => { s.consents.ai = true }, 'Accord enregistré : Believe AI.')}>Donner mon accord pour l’IA</button>}
    </div>
  )
}

function Home({ S, begin, open }: Pick<P, 'S'> & { begin: Begin; open: () => void }) {
  const rm = remaining(S), st = stats(S), cur = S.quiz.cur, pr = progress(S), prog = inProgress(S), seen = seenQs(S).length, total = allQ(S).length
  const doneToday = S.quiz.hist.find(h => h.d === today() && !h.rev), hist = S.quiz.hist.slice(-10).reverse()
  return (
    <>
      <div className="card">
        <h2>Quiz du jour</h2>
        {prog
          ? <>
            <p style={{ marginTop: 0 }}>Un {cur?.rev ? 'quiz de révision' : 'quiz'} est en cours : {plural(pr.answered, 'réponse')} sur {pr.n}.</p>
            <button className="btn" onClick={open}>Reprendre le quiz</button></>
          : <>
            <p style={{ marginTop: 0 }}>{PER_QUIZ} questions inédites, une par thème : vocabulaire, définitions, rhétorique, culture générale, biblique. Chaque réponse est expliquée, puis vous voyez votre score.</p>
            {doneToday && <p className="ok">Quiz du jour terminé : {doneToday.ok} / {doneToday.n}. Vous pouvez en faire un autre, les questions restent inédites.</p>}
            {rm.total === 0
              ? <div className="ai" role="status"><b>Vous avez vu toutes les questions disponibles.</b><p>Faites une révision des questions déjà vues (carte « Révision »), ou demandez de nouvelles questions à Believe AI (carte « Questions supplémentaires »).</p></div>
              : <button className="btn" onClick={() => begin()}>{doneToday ? 'Faire un autre quiz inédit' : 'Commencer le quiz du jour'}</button>}
            {rm.total > 0 && rm.total < PER_QUIZ && <p className="mut">Il ne reste que {plural(rm.total, 'question inédite', 'questions inédites')} : le quiz sera plus court.</p>}
            {cur && pr.done && <p><button className="btn alt" onClick={open}>Revoir les réponses du dernier quiz</button></p>}</>}
        <p className="mut" style={{ marginBottom: 0 }}><small>Questions inédites restantes : {rm.total} sur {total}. Une question attribuée ne revient jamais dans un quiz, même si vous quittez le quiz en cours de route.</small></p>
      </div>

      <div className="card">
        <h2>Un seul thème</h2>
        <div className="chips wrap" role="group" aria-label="Quiz par thème">
          {QCATS.map(c => <button key={c} className="chip" disabled={prog || !rm.byCat[c]} onClick={() => begin({ cat: c })}>{c} ({rm.byCat[c]})</button>)}
        </div>
        <p className="mut" style={{ marginBottom: 0 }}><small>Entre parenthèses : questions inédites restantes dans le thème.</small></p>
      </div>

      <div className="card">
        <h2>Révision</h2>
        <p style={{ marginTop: 0 }}>Refaites des questions déjà vues ({seen} à ce jour), tirées au hasard. Une révision ne compte pas dans les statistiques et n’utilise aucune question inédite.</p>
        <button className="btn alt" disabled={prog || !seen} onClick={() => begin({ rev: true })}>{seen ? 'Réviser ' + plural(Math.min(PER_QUIZ, seen), 'question') : 'Rien à réviser pour le moment'}</button>
      </div>

      <div className="card">
        <h2>Mes résultats</h2>
        {st.runs
          ? <p style={{ marginTop: 0 }}>{plural(st.runs, 'quiz terminé', 'quiz terminés')} · {st.ok} bonnes réponses sur {st.answered} ({st.pct} %) · meilleur score : {st.best} %.{st.revisions ? ' Révisions : ' + st.revisions + ' (non comptées).' : ''}</p>
          : <p style={{ marginTop: 0 }}>Aucun quiz terminé pour le moment.{st.revisions ? ' Révisions : ' + st.revisions + ' (non comptées).' : ''}</p>}
        {hist.length > 0 && <ul className="hist" aria-label="Derniers quiz">
          {hist.map((h, i) => <li key={i}><b>{dayFr(h.d)}</b> : {h.ok} / {h.n}{h.rev && <> <span className="tag">Révision</span></>} <span className="mut"><small>{h.cats.join(', ')}</small></span></li>)}
        </ul>}
      </div>
    </>
  )
}

export default function QuizTab({ S, upd, setM }: P) {
  const [mode, setMode] = useState<'home' | 'run'>(() => (inProgress(S) ? 'run' : 'home')), [idx, setIdx] = useState(() => firstOpen(S))
  const begin: Begin = (o = {}) => {
    const res: { r?: Start } = {}
    if (!upd(s => { res.r = startQuiz(s, today(), o) })) return
    if (res.r?.ok) { setIdx(0); setMode('run') } else setM({ e: 1, t: res.r?.why === 'encours' ? 'Terminez ou abandonnez le quiz en cours avant d’en commencer un autre.' : 'Aucune question disponible pour ce choix : essayez une révision ou demandez de nouvelles questions à l’IA.' })
  }
  const home = () => setMode('home'), open = () => { setIdx(firstOpen(S)); setMode('run') }
  return (
    <>
      {mode === 'run' && S.quiz.cur
        ? <Run S={S} upd={upd} idx={idx} setIdx={setIdx} begin={begin} onHome={home} />
        : <Home S={S} begin={begin} open={open} />}
      {mode === 'home' && <Gen S={S} upd={upd} />}
    </>
  )
}
