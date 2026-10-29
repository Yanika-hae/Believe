import { Suspense, lazy } from 'react'
import { Flash, Skeleton, Tabs, useTab } from './ui'
import type { DP } from './SettingsPage'
import Bilan from './BilanPage'
import SharePanel from './SharePanel'

/** Cercles d'amis (compte en ligne) : chargés à la demande. */
const CirclesPage = lazy(() => import('./CirclesPage'))

/** Onglets de la rubrique 5 : identifiant d'adresse (#/5/amis) et libellé. */
const TABS: [string, string][] = [['bilan', 'Bilan'], ['partage', 'Partage'], ['amis', 'Amis']]
export default function BilanPartage(p: DP) {
  const [tab, setTab] = useTab(p.sub, TABS.map(t => t[0]))
  const k = TABS[tab][0]
  return (
    <>
      <h1>Bilan, partage et amis</h1>
      <Flash m={p.m} />
      <Tabs items={TABS.map(t => t[1])} v={tab} set={setTab} label="Section" S={p.S} wrap>
        {k === 'bilan' && <Bilan {...p} />}
        {k === 'partage' && <SharePanel {...p} />}
        {k === 'amis' && <Suspense fallback={<Skeleton />}><CirclesPage {...p} /></Suspense>}
      </Tabs>
    </>
  )
}
