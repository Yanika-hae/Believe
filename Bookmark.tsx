import { useEffect, useState } from 'react'
import { habitOf } from './lib'
import type { Role } from './data'
import type { P } from './ui'
import { GOAL, MAX_DAY, act, coursePagesToday, current, doneText, pagesToday, probe, setCourseName } from './reading'
import type { Act, Target } from './reading'

/**
 * Saisie d'un marque-page, commune à la rubrique 6 (Habitudes) et à la rubrique 12 (Mes livres) : « j'ai lu N pages » fait avancer le marque-page,
 * « je suis à la page P » le place, et l'écart peut être compté ou non dans les pages du jour. Le message de confirmation n'apparaît qu'une fois l'enregistrement confirmé.
 */
export function PageForm({ S, upd, to, idp, page, role, label }: { S: P['S']; upd: P['upd']; to: Target; idp: string; page: number | null; role: Role; label: string }) {
  const [n, setN] = useState('20'), [at, setAt] = useState(page === null ? '' : String(page)), [count, setCount] = useState(true), [msg, setMsg] = useState<{ e?: 1; t: string } | null>(null)
  useEffect(() => { setAt(page === null ? '' : String(page)) }, [page]) // le marque-page a bougé (autre onglet, autre rubrique) : le champ suit
  const run = (a: Act) => {
    const r = probe(S, to, a)
    if (!r.ok) return setMsg({ e: 1, t: r.why })
    if (upd(s => { act(s, to, a) }, undefined, true)) setMsg({ t: doneText(r, habitOf(S, role)?.n) })
    else setMsg(null) // l'échec d'enregistrement est signalé par l'application
  }
  const target = Number(at.trim())
  const delta = page !== null && at.trim() !== '' && Number.isInteger(target) ? target - page : null
  return (
    <div role="group" aria-label={'Marque-page : ' + label}>
      <form noValidate onSubmit={e => { e.preventDefault(); run({ t: 'read', n: Number(n.trim()) }) }}>
        <label htmlFor={idp + '-n'}>Pages lues</label>
        <div className="row">
          <input id={idp + '-n'} type="number" inputMode="numeric" min={1} max={MAX_DAY} step={1} value={n} onChange={e => setN(e.target.value)} style={{ width: 110 }} />
          <button type="submit" className="btn" aria-label={'Ajouter les pages lues : ' + label}>Ajouter les pages lues</button>
        </div>
      </form>
      {page !== null && (
        <form noValidate onSubmit={e => { e.preventDefault(); run({ t: 'at', page: Number(at.trim()), count }) }} style={{ marginTop: 10 }}>
          <label htmlFor={idp + '-p'}>Page atteinte (marque-page)</label>
          <div className="row">
            <input id={idp + '-p'} type="number" inputMode="numeric" min={0} step={1} value={at} onChange={e => setAt(e.target.value)} style={{ width: 110 }} />
            <button type="submit" className="btn alt" aria-label={'Placer le marque-page : ' + label}>Placer le marque-page</button>
          </div>
          <label className="rd" htmlFor={idp + '-c'} style={{ marginTop: 6 }}><input id={idp + '-c'} type="checkbox" checked={count} onChange={e => setCount(e.target.checked)} />Compter l’écart dans mes pages d’aujourd’hui</label>
          <p className="mut" style={{ margin: '2px 0 0' }}><small>{delta === null ? 'Page actuelle : ' + page + '.' : 'Page actuelle ' + page + ', nouvelle page ' + target + (count ? ' : ' + (delta >= 0 ? '+ ' : '− ') + Math.abs(delta) + ' page' + (Math.abs(delta) > 1 ? 's' : '') + ' comptée' + (Math.abs(delta) > 1 ? 's' : '') + '.' : ' : marque-page déplacé, aucune page comptée.')}</small></p>
        </form>
      )}
      {msg && <p className={msg.e ? 'ko' : 'ok'} role={msg.e ? 'alert' : 'status'}>{msg.t}</p>}
    </div>
  )
}

const Bar = ({ v, label }: { v: number; label: string }) => <progress value={Math.min(v, GOAL)} max={GOAL} aria-label={label} />

/** Marque-pages de la rubrique 6 : un pour « 20 pages de mon livre » (relié à Mes livres), un pour « 20 pages de cours ». Affichés tant que l'habitude existe. */
export function BookmarkCards({ S, upd }: Pick<P, 'S' | 'upd'>) {
  const hb = habitOf(S, 'livre'), hc = habitOf(S, 'cours')
  const [pick, setPick] = useState(() => current(S)?.id ?? ''), [name, setName] = useState(S.course.n) // le livre choisi reste affiché même terminé (le message de fin ne disparaît pas)
  const free = pick === '-', cur = free ? undefined : S.books.find(b => b.id === pick) ?? current(S)
  const open = S.books.filter(b => b.st !== 'fini' || b.id === cur?.id)
  const pb = pagesToday(S), pc = coursePagesToday(S)
  useEffect(() => { setName(S.course.n) }, [S.course.n])
  return (
    <>
      {hb && (
        <section className="card" aria-labelledby="bm-livre">
          <h2 id="bm-livre">Marque-page : {hb.n}</h2>
          <p style={{ margin: '0 0 4px' }}>Aujourd’hui : <b>{pb} / {GOAL} pages</b>{pb >= GOAL ? ' ✓ objectif atteint' : ''}</p>
          <Bar v={pb} label="Pages de livre lues aujourd’hui" />
          {open.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <label htmlFor="bm-book">Livre en cours de lecture</label>
              <select id="bm-book" value={free ? '-' : cur?.id ?? ''} onChange={e => setPick(e.target.value)}>
                {open.map(b => <option key={b.id} value={b.id}>{b.t}{b.total ? ' (page ' + b.page + ' sur ' + b.total + ')' : ' (page ' + b.page + ')'}</option>)}
                <option value="-">Un autre livre (pages comptées sans marque-page)</option>
              </select>
            </div>
          )}
          {!open.length && <p className="mut">Aucun livre dans Mes livres : les pages lues sont comptées sans marque-page. <a href="#/12/en-ligne">Trouver un livre</a> ou <a href="#/12/mes-livres">en ajouter un à la main</a>.</p>}
          <div style={{ marginTop: 10 }}>
            <PageForm key={free ? '-' : cur?.id ?? 'free'} S={S} upd={upd} idp="bm-b" to={cur ? { k: 'book', id: cur.id } : { k: 'free' }} page={cur ? cur.page : null} role="livre" label={cur ? cur.t : 'livre'} />
          </div>
          <p className="mut" style={{ marginBottom: 0 }}><small>Même liste que la Bibliothèque : <a href="#/12/mes-livres">ouvrir Mes livres</a>. L’habitude est cochée automatiquement à {GOAL} pages et se décoche à la main.</small></p>
        </section>
      )}
      {hc && (
        <section className="card" aria-labelledby="bm-cours">
          <h2 id="bm-cours">Marque-page : {hc.n}</h2>
          <p style={{ margin: '0 0 4px' }}>Aujourd’hui : <b>{pc} / {GOAL} pages</b>{pc >= GOAL ? ' ✓ objectif atteint' : ''}</p>
          <Bar v={pc} label="Pages de cours lues aujourd’hui" />
          <div style={{ marginTop: 10 }}>
            <label htmlFor="bm-cn">Cours ou support (facultatif)</label>
            <input id="bm-cn" maxLength={120} value={name} placeholder="Par exemple : Droit des contrats, chapitre 3" onChange={e => setName(e.target.value)}
              onBlur={() => { if (name.trim() !== S.course.n) upd(s => { setCourseName(s, name) }, undefined, true) }} />
          </div>
          <div style={{ marginTop: 10 }}>
            <PageForm S={S} upd={upd} idp="bm-c" to={{ k: 'course' }} page={S.course.page} role="cours" label={S.course.n || 'cours'} />
          </div>
        </section>
      )}
    </>
  )
}
