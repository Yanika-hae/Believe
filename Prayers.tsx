import { useEffect, useRef, useState } from 'react'
import { today, uid } from './lib'
import type { Prayer, State } from './lib'
import * as V from './schema'
import { Flash } from './ui'
import type { Msg, Upd } from './ui'

const MAX_ITEMS = 1000, MAX_TXT = 500
/** Intitulé court d'un sujet, repris dans le nom accessible de ses boutons (« Supprimer : … »). */
const short = (t: string) => { const s = t.replace(/\s+/g, ' ').trim(); return s.length > 60 ? s.slice(0, 57) + '…' : s }
const frDay = (d: string) => { const x = new Date(d + 'T12:00:00'); return isNaN(+x) ? d : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) }
/** Plus récents d'abord : par date, puis le dernier ajouté en premier à date égale. */
const newest = (l: Prayer[], key: 'c' | 'a') => [...l].reverse().sort((x, y) => (y[key] ?? '').localeCompare(x[key] ?? ''))

/** Place le curseur dans le champ du mur (raccourci « Ajouter une prière » lorsque l'adresse est déjà la bonne). */
export const focusPrayerField = () => { const el = document.getElementById('pnew'); if (el) { el.scrollIntoView?.({ block: 'center' }); el.focus() } }

/** `note(texte, enregistré)` : l'état est déjà modifié en mémoire quand le stockage refuse l'écriture ; le message le dit au lieu de faire croire à un enregistrement. */
interface ItemProps { x: Prayer; upd: Upd; note: (t: string, saved: boolean) => void; moved: (id: string) => void; gone: () => void }

function Item({ x, upd, note, moved, gone }: ItemProps) {
  const g = x.k === 'g', nm = short(x.t)
  const [edit, setEdit] = useState(false), [del, setDel] = useState(false), [er, setEr] = useState(''), [val, setVal] = useState(x.t), [dv, setDv] = useState(x.a ?? '')
  const back = useRef(false), mod = useRef<HTMLButtonElement>(null), box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setDv(x.a ?? '') }, [x.a])
  useEffect(() => {
    if (edit) box.current?.focus()
    else if (back.current) { back.current = false; mod.current?.focus() }
  }, [edit])
  const close = () => { back.current = true; setEdit(false); setEr('') }

  const toggle = (on: boolean) => {
    setEr('')
    const d = today() < x.c ? x.c : today() // horloge de l'appareil reculée : jamais d'exaucement avant la création
    note(on ? 'Marquée comme exaucée : ' + nm : 'Remise parmi les prières en cours : ' + nm, upd(s => { const y = s.prayers.find(z => z.id === x.id); if (y) y.a = on ? d : null }))
    moved(x.id)
  }
  const setDate = (v: string) => {
    const range = 'Date d’exaucement : entre le ' + frDay(x.c) + ' et aujourd’hui.'
    setDv(v)
    if (!v) return // saisie du jour encore incomplète
    if (V.day(v, '') !== null) return setEr(range) // année à plus de quatre chiffres ou date impossible
    if (v < x.c || v > today()) setEr(range)
    else {
      setEr('')
      note('Date d’exaucement modifiée : ' + nm, upd(s => { const y = s.prayers.find(z => z.id === x.id); if (y) y.a = v }))
    }
  }
  const saveText = () => {
    const t = val.trim()
    if (!t) return setEr(g ? 'Le motif ne peut pas être vide : supprimez-le pour l’enlever.' : 'Le sujet ne peut pas être vide : supprimez-le pour l’enlever.')
    if (t === x.t) return close()
    note('Texte modifié.', upd(s => { const y = s.prayers.find(z => z.id === x.id); if (y) y.t = t }))
    close()
  }
  const remove = () => { note((g ? 'Gratitude supprimée : ' : 'Sujet supprimé : ') + nm, upd(s => { s.prayers = s.prayers.filter(y => y.id !== x.id) })); gone() }

  if (edit) {
    return (
      <li className="pt">
        <form aria-label={'Modifier : ' + nm} onSubmit={e => { e.preventDefault(); saveText() }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setVal(x.t); close() } }}>
          <label htmlFor={'pe-' + x.id}>{g ? 'Modifier le motif' : 'Modifier le sujet'}</label>
          <textarea id={'pe-' + x.id} ref={box} rows={3} maxLength={MAX_TXT} value={val} onChange={e => setVal(e.target.value)} />
          {er && <p className="ko" role="alert">{er}</p>}
          <div className="row" style={{ marginTop: 8 }}><button type="submit" className="btn">Enregistrer</button><button type="button" className="btn alt" onClick={() => { setVal(x.t); close() }}>Annuler</button></div>
        </form>
      </li>
    )
  }
  return (
    <li className="pt">
      <p className="pq">{x.t}</p>
      <p className="mut" style={{ margin: '0 0 2px' }}><small>{g ? 'Gratitude' : 'Prière'} du <time dateTime={x.c}>{frDay(x.c)}</time>{x.a && <> · exaucée le <time dateTime={x.a}>{frDay(x.a)}</time></>}</small></p>
      <div className="row">
        {!g && <label className="rd"><input type="checkbox" data-pcb={x.id} checked={x.a !== null} aria-label={'Exaucée : ' + nm} onChange={e => toggle(e.target.checked)} />Exaucée</label>}
        {!g && x.a !== null && <span className="pdt"><label htmlFor={'pd-' + x.id}>Date d’exaucement</label><input id={'pd-' + x.id} type="date" aria-label={'Date d’exaucement : ' + nm} min={x.c} max={today()} value={dv} onChange={e => setDate(e.target.value)} /></span>}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button ref={mod} className="chip" aria-label={'Modifier : ' + nm} onClick={() => { setVal(x.t); setEr(''); setEdit(true) }}>Modifier</button>
        {del
          ? <span className="row" role="group" aria-label={'Supprimer : ' + nm}><span>{g ? 'Supprimer cette gratitude ?' : 'Supprimer ce sujet ?'}</span><button className="chip" onClick={remove}>Oui, supprimer</button><button className="chip" onClick={() => setDel(false)}>Annuler</button></span>
          : <button className="chip" aria-label={'Supprimer : ' + nm} onClick={() => setDel(true)}>Supprimer</button>}
      </div>
      {er && <p className="ko" role="alert">{er}</p>}
    </li>
  )
}

function Group({ title, list, ...p }: { title: string; list: Prayer[] } & Omit<ItemProps, 'x'>) {
  const [lim, setLim] = useState(10)
  if (!list.length) return null
  return (
    <>
      <h3>{title} ({list.length})</h3>
      <ul className="pl">{list.slice(0, lim).map(x => <Item key={x.id} x={x} {...p} />)}</ul>
      {list.length > lim && <p><button className="btn alt" onClick={() => setLim(lim + 10)}>Afficher la suite ({list.length - lim} restants)</button></p>}
    </>
  )
}

/** Mur de prières et de gratitudes : tout reste sur l'appareil ; seuls les sujets de prière peuvent être partagés, sur choix explicite (rubrique 5), jamais les gratitudes. */
export default function PrayerWall({ S, upd, focus }: { S: State; upd: Upd; focus: boolean }) {
  const [kind, setKind] = useState<'p' | 'g'>('p'), [txt, setTxt] = useState(''), [er, setEr] = useState(''), [fb, setFb] = useState<Msg>(null), [fid, setFid] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null), head = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (focus) { ta.current?.scrollIntoView?.({ block: 'center' }); ta.current?.focus() } }, [focus])
  useEffect(() => { // après un changement de groupe (exaucée, remise en cours), le focus suit l'élément ; après une suppression, il revient au titre
    if (!fid) return
    if (fid === '-') head.current?.focus(); else document.querySelector<HTMLElement>('[data-pcb="' + fid + '"]')?.focus()
    setFid('')
  }, [fid])

  const note = (t: string, saved: boolean) => setFb(saved ? { t } : { e: 1, t: t.replace(/\.$/, '') + ' : non enregistré, le stockage local est indisponible ou plein.' })
  const add = () => {
    const t = txt.trim()
    if (!t) return setEr(kind === 'g' ? 'Écrivez d’abord un motif de gratitude.' : 'Écrivez d’abord un sujet.')
    if (S.prayers.length >= MAX_ITEMS) return setEr('Limite de ' + MAX_ITEMS.toLocaleString('fr-FR') + ' éléments atteinte : supprimez-en avant d’en ajouter.')
    const item: Prayer = kind === 'g' ? { id: uid('p'), t, c: today(), a: null, k: 'g' } : { id: uid('p'), t, c: today(), a: null }
    const saved = upd(s => { s.prayers.push(item) })
    setEr(''); setTxt('') // l'élément est déjà dans la liste, même si le stockage a refusé : le champ est vidé pour ne pas créer de doublon
    note(kind === 'g' ? 'Gratitude ajoutée au mur.' : 'Sujet de prière ajouté au mur.', saved)
  }
  const pend = newest(S.prayers.filter(x => x.k !== 'g' && x.a === null), 'c'), done = newest(S.prayers.filter(x => x.k !== 'g' && x.a !== null), 'a'), gr = newest(S.prayers.filter(x => x.k === 'g'), 'c')
  const common = { upd, note, moved: setFid, gone: () => setFid('-') }
  return (
    <section className="wall" aria-label="Mur de prières et gratitudes">
      <h2 tabIndex={-1} ref={head}>Mur de prières et gratitudes</h2>
      <p className="mut">Notez ce que vous confiez à Dieu et ce dont vous êtes reconnaissant. Tout reste sur cet appareil. Vos sujets de prière ne sont partagés que si vous le choisissez dans la rubrique 5 ; vos gratitudes ne le sont jamais.</p>
      <form onSubmit={e => { e.preventDefault(); add() }} noValidate>
        <fieldset className="pk"><legend>Type</legend>
          <label className="rd"><input type="radio" name="pkind" checked={kind === 'p'} onChange={() => { setKind('p'); setEr('') }} />Prière</label>
          <label className="rd"><input type="radio" name="pkind" checked={kind === 'g'} onChange={() => { setKind('g'); setEr('') }} />Gratitude</label>
        </fieldset>
        <label htmlFor="pnew">{kind === 'g' ? 'Motif de gratitude' : 'Sujet de prière'}</label>
        <textarea id="pnew" ref={ta} rows={3} maxLength={MAX_TXT} value={txt} aria-describedby="pnew-n" onChange={e => { setTxt(e.target.value); setFb(null) }} />
        <p id="pnew-n" className="mut" style={{ margin: '4px 0' }}><small>{txt.length} / {MAX_TXT} caractères.</small></p>
        {er && <p className="ko" role="alert">{er}</p>}
        <button type="submit" className="btn">Ajouter au mur</button>
      </form>
      <Flash m={fb} />
      {!S.prayers.length && <p>Le mur est vide : écrivez ci-dessus votre premier sujet de prière ou votre premier motif de gratitude.</p>}
      <Group title="Prières en cours" list={pend} {...common} />
      <Group title="Prières exaucées" list={done} {...common} />
      <Group title="Gratitudes" list={gr} {...common} />
    </section>
  )
}
