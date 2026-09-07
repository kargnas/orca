// @vitest-environment happy-dom

import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import { setDriverForPty } from '@/lib/pane-manager/mobile-driver-state'
import { setFitOverride } from '@/lib/pane-manager/mobile-fit-overrides'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { applyTerminalAppearance } from './terminal-appearance'
import type { PtyTransport } from './pty-transport'

type TerminalWithModes = Terminal & {
  _core: { coreService: { decPrivateModes: { colorSchemeUpdates: boolean } } }
}

describe('live terminal appearance color-scheme replies', () => {
  let terminal: TerminalWithModes
  let host: HTMLDivElement
  let replies: string[]
  let subscriptions: Map<number, boolean>
  let lastModes: Map<number, 'dark' | 'light'>
  let resize: ReturnType<typeof vi.fn>
  let apply: (updates?: Partial<GlobalSettings>, systemPrefersDark?: boolean) => void

  const write = (data: string): Promise<void> =>
    new Promise((resolve) => terminal.write(data, resolve))

  beforeEach(() => {
    // happy-dom has no canvas text metrics; the terminal itself remains real.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 10 })
    } as unknown as CanvasRenderingContext2D)
    host = document.createElement('div')
    document.body.appendChild(host)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
    terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true }) as TerminalWithModes
    terminal.open(host)
    replies = []
    subscriptions = new Map()
    lastModes = new Map()
    resize = vi.fn()
    const transport = {
      getPtyId: () => 'theme-pty',
      isConnected: () => true,
      sendInputImmediate: (data: string) => {
        replies.push(data)
        return true
      },
      resize
    } as unknown as PtyTransport
    const pane = {
      id: 1,
      terminal,
      container: host,
      fitAddon: { proposeDimensions: () => ({ cols: 80, rows: 24 }) }
    } as unknown as ManagedPane
    const manager = {
      getPanes: () => [pane],
      setPaneLigaturesEnabled: vi.fn(),
      setPaneStyleOptions: vi.fn()
    } as unknown as PaneManager
    const settings = {
      ...getDefaultSettings('/tmp'),
      theme: 'system' as const,
      terminalThemeDark: 'Ghostty Default Style Dark',
      terminalUseSeparateLightTheme: true,
      terminalThemeLight: 'Everforest Light'
    }
    apply = (updates = {}, systemPrefersDark = true) => {
      applyTerminalAppearance(
        manager,
        { ...settings, ...updates },
        systemPrefersDark,
        new Map(),
        new Map([[1, transport]]),
        'false',
        subscriptions,
        lastModes
      )
    }
    apply()
    resize.mockClear()
    terminal.onData((data) => transport.sendInputImmediate(data))
  })

  afterEach(() => {
    setDriverForPty('theme-pty', { kind: 'idle' })
    setFitOverride('theme-pty', 'desktop-fit', 80, 24)
    terminal.dispose()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  async function subscribe(): Promise<void> {
    await write('\x1b[?2031h')
    subscriptions.set(1, true)
    lastModes.set(1, 'dark')
    expect(terminal._core.coreService.decPrivateModes.colorSchemeUpdates).toBe(true)
  }

  it('paints the new palette and emits exactly one reply per system flip', async () => {
    await subscribe()
    apply({}, false)
    expect(replies).toEqual(['\x1b[?997;2n'])
    expect(
      host.querySelector<HTMLElement>('.xterm-scrollable-element')?.style.backgroundColor
    ).toBe('#fdf6e3')
    expect(getComputedStyle(host.querySelector('.xterm-rows')!).color).toBe('#5c6a72')
    apply({}, true)
    expect(replies).toEqual(['\x1b[?997;2n', '\x1b[?997;1n'])
    expect(
      host.querySelector<HTMLElement>('.xterm-scrollable-element')?.style.backgroundColor
    ).toBe('#282c34')
    expect(terminal._core.coreService.decPrivateModes.colorSchemeUpdates).toBe(true)
  })

  it('reports app mode once when the terminal palette has the opposite mode', async () => {
    await subscribe()
    apply({ theme: 'light', terminalThemeLight: 'Tango Dark' })
    expect(replies).toEqual(['\x1b[?997;2n'])
    replies.length = 0
    await write('\x1b[?996n')
    expect(replies).toEqual(['\x1b[?997;1n'])
  })

  it('keeps notifications for hidden fact-only subscriptions', () => {
    host.style.display = 'none'
    subscriptions.set(1, true)
    lastModes.set(1, 'dark')
    apply({}, false)
    expect(replies).toEqual(['\x1b[?997;2n'])
    expect(terminal._core.coreService.decPrivateModes.colorSchemeUpdates).toBe(false)
  })

  it('does not notify an unsubscribed program', () => {
    apply({}, false)
    expect(replies).toEqual([])
    expect(terminal._core.coreService.decPrivateModes.colorSchemeUpdates).toBe(false)
  })

  it.each([false, true])(
    'leaves mobile-owned replies to mobile (fit override: %s)',
    async (fit) => {
      await subscribe()
      setDriverForPty('theme-pty', { kind: 'mobile', clientId: 'phone' })
      if (fit) {
        setFitOverride('theme-pty', 'mobile-fit', 80, 24)
      }
      apply({}, false)
      expect(replies).toEqual([])
      expect(lastModes.get(1)).toBe('dark')
    }
  )

  it('notifies a desktop owner at retained phone dimensions without resizing the PTY', async () => {
    await subscribe()
    setFitOverride('theme-pty', 'mobile-fit', 80, 24)
    apply({}, false)
    expect(replies).toEqual(['\x1b[?997;2n'])
    expect(resize).not.toHaveBeenCalled()
    setFitOverride('theme-pty', 'desktop-fit', 80, 24)
    apply({}, false)
    expect(replies).toEqual(['\x1b[?997;2n'])
  })

  it('keeps no-op and font changes silent without disabling later native replies', async () => {
    await subscribe()
    const theme = terminal.options.theme
    apply()
    apply({ terminalFontSize: 20 })
    expect(terminal.options.theme).toBe(theme)
    expect(replies).toEqual([])
    await write('\x1b]11;#ffffff\x1b\\')
    expect(replies).toEqual(['\x1b[?997;2n'])
  })

  it('restores the native subscription if theme assignment throws', async () => {
    await subscribe()
    vi.spyOn(terminal.options, 'theme', 'set').mockImplementationOnce(() => {
      expect(terminal._core.coreService.decPrivateModes.colorSchemeUpdates).toBe(false)
      throw new Error('theme setter failed')
    })
    expect(() => apply({}, false)).toThrow('theme setter failed')
    expect(terminal._core.coreService.decPrivateModes.colorSchemeUpdates).toBe(true)
  })
})
