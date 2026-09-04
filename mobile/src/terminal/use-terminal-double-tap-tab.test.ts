import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalDoubleTapTab } from './use-terminal-double-tap-tab'

describe('useTerminalDoubleTapTab', () => {
  let renderer: ReactTestRenderer | null = null
  let cancelPendingTap: (() => void) | null = null
  let shouldSendTab: ((handle: string) => boolean) | null = null
  let now = 100

  function Harness({
    enabled = true,
    activeHandle,
    lifecycleKey = 'host-a:worktree-a:connected'
  }: {
    enabled?: boolean
    activeHandle: string | null
    lifecycleKey?: string
  }): null {
    const handlers = useTerminalDoubleTapTab(enabled, activeHandle, lifecycleKey)
    cancelPendingTap = handlers.cancelPendingTap
    shouldSendTab = handlers.shouldSendTabForTap
    return null
  }

  function mount(props: Parameters<typeof Harness>[0] = { activeHandle: 'terminal-a' }): void {
    act(() => {
      renderer = create(createElement(Harness, props))
    })
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    now = 100
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    cancelPendingTap = null
    shouldSendTab = null
    vi.restoreAllMocks()
  })

  it('sequences two taps while arrow gestures are enabled', () => {
    mount()

    expect(shouldSendTab?.('terminal-a')).toBe(false)
    now += 100
    expect(shouldSendTab?.('terminal-a')).toBe(true)
  })

  it('never sends Tab while arrow gestures are disabled', () => {
    mount({ enabled: false, activeHandle: 'terminal-a' })

    expect(shouldSendTab?.('terminal-a')).toBe(false)
    now += 100
    expect(shouldSendTab?.('terminal-a')).toBe(false)
  })

  it('clears a pending tap when arrow gestures are turned off and back on', () => {
    mount()
    expect(shouldSendTab?.('terminal-a')).toBe(false)

    act(() =>
      renderer?.update(createElement(Harness, { enabled: false, activeHandle: 'terminal-a' }))
    )
    act(() =>
      renderer?.update(createElement(Harness, { enabled: true, activeHandle: 'terminal-a' }))
    )
    now += 100

    expect(shouldSendTab?.('terminal-a')).toBe(false)
  })

  it('clears a pending tap across an active terminal change', () => {
    mount()
    expect(shouldSendTab?.('terminal-a')).toBe(false)

    act(() => renderer?.update(createElement(Harness, { activeHandle: 'terminal-b' })))
    act(() => renderer?.update(createElement(Harness, { activeHandle: 'terminal-a' })))
    now += 100

    expect(shouldSendTab?.('terminal-a')).toBe(false)
  })

  it('clears a pending tap across route or connection lifecycle changes', () => {
    mount()
    expect(shouldSendTab?.('terminal-a')).toBe(false)

    act(() =>
      renderer?.update(
        createElement(Harness, {
          activeHandle: 'terminal-a',
          lifecycleKey: 'host-a:worktree-a:reconnecting'
        })
      )
    )
    now += 100

    expect(shouldSendTab?.('terminal-a')).toBe(false)
  })

  it('clears a pending tap when an excluded terminal gesture occurs', () => {
    mount()
    expect(shouldSendTab?.('terminal-a')).toBe(false)

    act(() => cancelPendingTap?.())
    now += 100

    expect(shouldSendTab?.('terminal-a')).toBe(false)
  })
})
