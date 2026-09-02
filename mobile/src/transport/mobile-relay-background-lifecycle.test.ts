import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dependencies,
  FakeLogicalClient,
  FakeRelaySession,
  FakeSession,
  host
} from './mobile-endpoint-supervisor-test-fakes'
import { MobileEndpointSupervisor } from './mobile-endpoint-supervisor'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))

const SIX_HOURS_MS = 6 * 3_600_000

describe('mobile Relay background lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z'))
  })

  afterEach(() => vi.useRealTimers())

  it('retains a healthy relay for the whole background stay', async () => {
    const logical = new FakeLogicalClient('connected', 'relay')
    const deps = dependencies()
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()

    supervisor.setForeground(false)
    await vi.advanceTimersByTimeAsync(SIX_HOURS_MS)
    expect(logical.suspendActiveSession).not.toHaveBeenCalled()
    expect(logical.getState()).toBe('connected')

    // Why: the OS freezes JS timers while hidden, so wall-clock time jumps on
    // resume without any timer having fired; that jump must not close the relay.
    vi.setSystemTime(Date.now() + SIX_HOURS_MS)
    supervisor.setForeground(true)
    await vi.advanceTimersByTimeAsync(1)

    expect(logical.suspendActiveSession).not.toHaveBeenCalled()
    expect(deps.openRelay).not.toHaveBeenCalled()
    expect(logical.getActivePath()).toBe('relay')
    expect(logical.getState()).toBe('connected')
    supervisor.stop()
  })

  it('recovers after a retained relay fails while backgrounded', async () => {
    const logical = new FakeLogicalClient('connected', 'relay')
    const deps = dependencies()
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()

    supervisor.setForeground(false)
    await vi.advanceTimersByTimeAsync(5_000)
    logical.publishState('disconnected')

    expect(logical.suspendActiveSession).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(deps.openRelay).not.toHaveBeenCalled()

    supervisor.setForeground(true)
    await vi.waitFor(() => expect(deps.openRelay).toHaveBeenCalledOnce())
    expect(logical.getState()).toBe('connected')
    supervisor.stop()
  })

  it('does not retain or suspend a healthy direct session in the background', async () => {
    const logical = new FakeLogicalClient('connected', 'tailscale')
    const deps = dependencies()
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()

    supervisor.setForeground(false)
    await vi.advanceTimersByTimeAsync(SIX_HOURS_MS)

    expect(logical.suspendActiveSession).not.toHaveBeenCalled()
    expect(logical.getState()).toBe('connected')
    expect(deps.openRelay).not.toHaveBeenCalled()
    supervisor.stop()
  })

  it('resumes a lease rotation that came due while backgrounded', async () => {
    const logical = new FakeLogicalClient('disconnected', 'lan')
    const openRelay = vi.fn(() => new FakeRelaySession('connected', null, Date.now() + 90_000))
    const deps = dependencies({
      openDirect: vi.fn(() => new FakeSession('disconnected')),
      openRelay
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()

    await vi.advanceTimersByTimeAsync(40_000)
    supervisor.setForeground(false)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(openRelay).toHaveBeenCalledOnce()
    expect(logical.getState()).toBe('connected')

    supervisor.setForeground(true)
    await vi.waitFor(() => expect(openRelay).toHaveBeenCalledTimes(2))
    expect(logical.getState()).toBe('connected')
    supervisor.stop()
  })

  it('arms lease rotation when confirmation persistence finishes while backgrounded', async () => {
    let finishWrite: (() => void) | null = null
    const writeStarted = new Promise<void>((resolve) => {
      finishWrite = resolve
    })
    const logical = new FakeLogicalClient('disconnected', 'lan')
    const openRelay = vi.fn(() => new FakeRelaySession('connected', null, Date.now() + 90_000))
    const deps = dependencies({
      openDirect: vi.fn(() => new FakeSession('disconnected')),
      openRelay,
      writeBundle: vi.fn(() => writeStarted)
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    const starting = supervisor.start()
    await vi.waitFor(() => expect(deps.writeBundle).toHaveBeenCalledOnce())

    supervisor.setForeground(false)
    finishWrite?.()
    await starting
    supervisor.setForeground(true)
    await vi.advanceTimersByTimeAsync(60_000)

    await vi.waitFor(() => expect(openRelay).toHaveBeenCalledTimes(2))
    expect(logical.getState()).toBe('connected')
    supervisor.stop()
  })
})
