import { Flash, Tabs, useTab } from './ui'
import type { P } from './ui'
import ExoTab from './ExoTab'
import QuizTab from './QuizTab'
import ImproTab from './ImproTab'

export default function Academy(p: P) {
  const [tab, setTab] = useTab(p.sub, ['exo', 'quiz', 'impro'])
  return (
    <>
      <h1>Académie d’éloquence et quiz</h1>
      <Flash m={p.m} />
      <Tabs items={['Exercices', 'Quiz', 'Improvisation']} v={tab} set={setTab} label="Section" S={p.S} wrap>
        {tab === 0 && <ExoTab {...p} />}
        {tab === 1 && <QuizTab {...p} />}
        {tab === 2 && <ImproTab {...p} />}
      </Tabs>
    </>
  )
}
