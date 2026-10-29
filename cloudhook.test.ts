// Passerelle de l'application vers le compte en ligne (src/cloudhook.ts), côté rappels application fermée :
// le code des rappels n'est chargé que s'ils sont activés sur cet appareil (sinon rien n'est téléchargé ni exécuté), l'arrêt ne charge rien,
// une désactivation qui échoue n'est jamais présentée comme réussie, et « reste-t-il quelque chose du compte » regarde aussi les rappels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PUSH = 'believe:push'
type Off = 'none' | 'removed' | 'failed'
/** Remplace src/push.ts par un faux module qui compte ses chargements et ses appels, puis recharge la passerelle à neuf. */
async function gate(disable: () => Promise<Off> = async () => 'removed') {
  vi.resetModules()
  const loads = { n: 0 }, fns = { touch: vi.fn(), start: vi.fn(), stop: vi.fn(), disable: vi.fn(disable) }
  vi.doMock('./push', () => { loads.n++; return fns })
  return { hook: await import('./cloudhook'), loads, fns }
}
const activate = () => localStorage.setItem(PUSH, JSON.stringify({ on: true, title: false, test: 0 }))
/** Laisse le temps à un chargement paresseux qui n'aurait pas dû avoir lieu. */
const quiet = () => new Promise<void>(r => setTimeout(r, 80))
beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.doUnmock('./push'); vi.resetModules(); localStorage.clear() })

describe('Passerelle des rappels application fermée', () => {
  it('rappels non activés : programmer, démarrer, arrêter ou désactiver ne chargent pas le code des rappels et ne l’appellent pas', async () => {
    const { hook, loads, fns } = await gate()
    expect(hook.pushOn()).toBe(false)
    hook.touchPush(); hook.startPush(); hook.stopPush()
    expect(await hook.disablePush(), 'rien n’était activé').toBe('none')
    await quiet()
    expect(loads.n, 'le code des rappels n’est pas chargé').toBe(0)
    expect(fns.touch).not.toHaveBeenCalled(); expect(fns.start).not.toHaveBeenCalled(); expect(fns.stop).not.toHaveBeenCalled(); expect(fns.disable).not.toHaveBeenCalled()
  })

  it('rappels activés : le code est chargé une seule fois, puis programmer, démarrer et arrêter l’appellent chacun une fois', async () => {
    activate()
    const { hook, loads, fns } = await gate()
    expect(hook.pushOn()).toBe(true)
    hook.touchPush(); await vi.waitFor(() => expect(fns.touch).toHaveBeenCalledTimes(1))
    hook.startPush(); await vi.waitFor(() => expect(fns.start).toHaveBeenCalledTimes(1))
    expect(loads.n, 'chargé une seule fois').toBe(1); expect(fns.stop).not.toHaveBeenCalled(); expect(fns.disable).not.toHaveBeenCalled()
    hook.stopPush(); await vi.waitFor(() => expect(fns.stop).toHaveBeenCalledTimes(1))
    expect(fns.touch).toHaveBeenCalledTimes(1); expect(fns.start).toHaveBeenCalledTimes(1); expect(loads.n).toBe(1)
  })

  it('« activé » se lit strictement : seul `on: true` compte (réglage absent, illisible ou autre valeur : non)', async () => {
    const { hook } = await gate()
    for (const [raw, want] of [[null, false], ['pas du JSON', false], ['{"on":false}', false], ['{"on":"true"}', false], ['{"on":1}', false], ['{}', false], ['null', false], ['{"on":true}', true]] as const) {
      localStorage.clear(); if (raw !== null) localStorage.setItem(PUSH, raw)
      expect(hook.pushOn(), String(raw)).toBe(want)
    }
  })

  it('désactivation : le résultat du code des rappels est transmis tel quel (confirmé, non confirmé, rien)', async () => {
    for (const r of ['removed', 'failed', 'none'] as const) {
      activate(); const { hook, fns } = await gate(async () => r)
      expect(await hook.disablePush(), r).toBe(r); expect(fns.disable).toHaveBeenCalledTimes(1)
    }
  })

  it('désactivation qui échoue (erreur du code des rappels) : « non confirmé », jamais « supprimé »', async () => {
    activate(); const { hook, fns } = await gate(async () => { throw new Error('boum') })
    expect(await hook.disablePush()).toBe('failed'); expect(fns.disable).toHaveBeenCalledTimes(1)
  })

  it('désactivation quand le code des rappels ne peut pas être chargé (réseau coupé) : « non confirmé », jamais « supprimé »', async () => {
    activate(); vi.resetModules(); vi.doMock('./push', () => { throw new Error('chargement impossible') })
    const hook = await import('./cloudhook')
    expect(await hook.disablePush()).toBe('failed')
  })

  it('« reste-t-il quelque chose du compte en ligne » : chaque repère compte, y compris celui des rappels application fermée', async () => {
    const { hook } = await gate()
    expect(hook.cloudUsed()).toBe(false)
    for (const k of ['believe:sync', 'believe:auth', 'believe:synckey', 'believe:syncbak', 'believe:auth-pending', 'believe:circles', PUSH]) {
      localStorage.clear(); localStorage.setItem(k, '{}')
      expect(hook.cloudUsed(), k).toBe(true)
    }
    localStorage.clear(); localStorage.setItem('believe:autre', '{}'); expect(hook.cloudUsed(), 'un autre repère ne compte pas').toBe(false)
  })
})
