// @vitest-environment happy-dom
// Exercises the in-WebView touch dispatcher end-to-end: a surface tap on a
// printed http(s) URL must post an `open-url` message (which RN routes to the
// in-app/phone browser). Regression guard for taps that jitter a few pixels —
// those were being swallowed because the tap shared the long-press slop gate.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

const bootListenerCleanups: Array<() => void> = []

function iifeSource(): string {
  const start = XTERM_HTML.indexOf('(function() {')
  const end = XTERM_HTML.lastIndexOf('})();')
  return XTERM_HTML.slice(start, end + '})();'.length)
}

function bodyMarkup(): string {
  const start = XTERM_HTML.indexOf('<body>') + '<body>'.length
  const end = XTERM_HTML.indexOf('<script>', start)
  return XTERM_HTML.slice(start, end)
}

// Minimal xterm stub: one scrollback line containing a URL, fixed 8x15 cells.
function makeTerminal(
  lineRef: { current: string },
  mouseTrackingMode = 'none',
  scrollLines = vi.fn(),
  scrollbackRows = 0
) {
  return {
    cols: 80,
    rows: 24,
    options: { fontSize: 13 },
    modes: { mouseTrackingMode },
    element: { scrollWidth: 800, scrollHeight: 360 },
    _core: { _renderService: { dimensions: { css: { cell: { width: 8, height: 15 } } } } },
    buffer: {
      active: {
        viewportY: scrollbackRows,
        baseY: scrollbackRows,
        length: 1,
        cursorY: 0,
        type: 'normal' as const,
        getLine(row: number) {
          const text = row === scrollbackRows ? lineRef.current : undefined
          if (text === undefined) {
            return null
          }
          return {
            // Honor (trimRight, startCol, endCol) like real xterm so the
            // cell→string-index conversion (cellColToStringIndex) resolves correctly.
            translateToString: (_trim?: boolean, start?: number, end?: number) =>
              text.slice(start ?? 0, end ?? text.length),
            getCell: () => ({ extended: undefined })
          }
        }
      }
    },
    write(_d: string, cb?: () => void) {
      cb?.()
    },
    open() {},
    resize() {},
    clear() {},
    reset() {},
    refresh() {},
    selectAll() {},
    clearSelection() {},
    select() {},
    scrollLines,
    scrollToBottom() {},
    getSelection: () => '',
    onLineFeed: () => ({ dispose() {} }),
    onScroll: () => ({ dispose() {} }),
    onWriteParsed: () => ({ dispose() {} }),
    dispose() {}
  }
}

type Posted = Array<Record<string, unknown>>

type OscLinkRange = { row: number; startCol: number; endCol: number; uri: string }

function boot(
  line: string,
  oscLinks?: OscLinkRange[],
  mouseTrackingMode = 'none',
  scrollbackRows = 0
): { posted: Posted; scrollLines: ReturnType<typeof vi.fn>; setLine: (line: string) => void } {
  const posted: Posted = []
  const scrollLines = vi.fn()
  const lineRef = { current: line }
  const w = window as unknown as { Terminal: unknown; ReactNativeWebView: unknown }
  w.Terminal = function () {
    return makeTerminal(lineRef, mouseTrackingMode, scrollLines, scrollbackRows)
  }
  w.ReactNativeWebView = {
    postMessage(s: string) {
      posted.push(JSON.parse(s))
    }
  }
  document.body.innerHTML = bodyMarkup()
  const addWindowListener = window.addEventListener.bind(window)
  const addDocumentListener = document.addEventListener.bind(document)
  const registeredWindowListeners: Array<{
    type: string
    listener: EventListenerOrEventListenerObject
    options?: boolean | AddEventListenerOptions
  }> = []
  const registeredDocumentListeners: Array<{
    type: string
    listener: EventListenerOrEventListenerObject
    options?: boolean | AddEventListenerOptions
  }> = []
  const addWindowListenerSpy = vi
    .spyOn(window, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      registeredWindowListeners.push({ type, listener, options })
      addWindowListener(type, listener, options)
    })
  const addDocumentListenerSpy = vi
    .spyOn(document, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      registeredDocumentListeners.push({ type, listener, options })
      addDocumentListener(type, listener, options)
    })
  try {
    new Function(iifeSource())()
  } finally {
    addWindowListenerSpy.mockRestore()
    addDocumentListenerSpy.mockRestore()
  }
  bootListenerCleanups.push(() => {
    for (const { type, listener, options } of registeredWindowListeners) {
      window.removeEventListener(type, listener, options)
    }
    for (const { type, listener, options } of registeredDocumentListeners) {
      document.removeEventListener(type, listener, options)
    }
  })
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({ type: 'init', cols: 80, rows: 24, initialData: '', oscLinks })
    })
  )
  return {
    posted,
    scrollLines,
    setLine: (nextLine: string) => {
      lineRef.current = nextLine
    }
  }
}

function fireTouch(type: string, touches: Array<{ x: number; y: number }>): void {
  const surface = document.getElementById('terminal-surface') as HTMLElement
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'touches', {
    value: touches.map((p, i) => ({ identifier: i, clientX: p.x, clientY: p.y, target: surface }))
  })
  surface.dispatchEvent(ev)
}

function firePlainTap(x = 100, y = 100): void {
  fireTouch('touchstart', [{ x, y }])
  fireTouch('touchend', [])
}

function fireArrowGestures(enabled: boolean): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({ type: 'arrow-gestures', enabled })
    })
  )
}

// Wait one macrotask so init()'s rAF chain (term.open -> ready) settles.
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

describe('terminal WebView tap routing', () => {
  // Fit scale here is min(1, innerWidth / (cellW*cols)) = 200 / 640 = 0.3125.
  // A URL at column 12 sits at screen x = 12 * 8 * 0.3125 = 30px, y within row 0.
  const URL_LINE = 'visit https://example.com/foo now'
  const tapX = 12 * 8 * 0.3125
  const tapY = 2
  const screenXForCol = (col: number): number => col * 8 * 0.3125

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 200, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })
  })

  afterEach(() => {
    for (const cleanup of bootListenerCleanups.splice(0)) {
      cleanup()
    }
    vi.useRealTimers()
  })

  it('posts open-url when a clean tap lands on a URL', async () => {
    const { posted } = boot(URL_LINE)
    await settle()
    fireTouch('touchstart', [{ x: tapX, y: tapY }])
    fireTouch('touchend', [])
    expect(posted.find((m) => m.type === 'open-url')?.url).toBe('https://example.com/foo')
    expect(posted.find((m) => m.type === 'terminal-plain-tap')).toBeUndefined()
    expect(posted.filter((m) => m.type === 'terminal-plain-tap-cancelled')).toHaveLength(1)
  })

  it('still posts open-url when the tap jitters a few pixels', async () => {
    // Why: a finger rarely lands perfectly still. Movement under TAP_SLOP must
    // not reclassify the tap as a scroll and drop the link open.
    const { posted } = boot(URL_LINE)
    await settle()
    fireTouch('touchstart', [{ x: tapX, y: tapY }])
    fireTouch('touchmove', [{ x: tapX + 11, y: tapY + 4 }])
    fireTouch('touchend', [])
    expect(posted.find((m) => m.type === 'open-url')?.url).toBe('https://example.com/foo')
  })

  it('focuses native input after reporting a touch tap to a mouse-tracking TUI', async () => {
    const { posted } = boot('interactive prompt', undefined, 'drag')
    await settle()

    fireTouch('touchstart', [{ x: 20, y: tapY }])
    fireTouch('touchend', [])

    expect(
      posted
        .filter((message) => message.type === 'terminal-input' || message.type === 'terminal-tap')
        .map((message) => message.type)
    ).toEqual(['terminal-input', 'terminal-tap'])
    expect(posted.find((message) => message.type === 'terminal-plain-tap')).toBeUndefined()
    expect(
      posted.filter((message) => message.type === 'terminal-plain-tap-cancelled')
    ).toHaveLength(1)
  })

  it('keeps mouse-tracking TUI swipes in arrow-gesture mode', async () => {
    const { posted } = boot('interactive prompt', undefined, 'drag')
    await settle()
    fireArrowGestures(true)
    posted.length = 0

    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 100, y: 160 }])
    fireTouch('touchend', [])

    const inputs = posted
      .filter((message) => message.type === 'terminal-input')
      .map((message) => message.bytes)
    expect(inputs.length).toBeGreaterThan(0)
    expect(inputs).not.toContain('\x1b[A')
    expect(inputs).not.toContain('\x1b[B')
    expect(document.getElementById('terminal-swipe-indicator')?.hidden).toBe(true)
  })

  it('reports a non-mouse touch tap without terminal mouse bytes', async () => {
    const { posted } = boot('plain prompt')
    await settle()

    fireTouch('touchstart', [{ x: 20, y: tapY }])
    fireTouch('touchend', [])

    expect(posted.find((message) => message.type === 'terminal-input')).toBeUndefined()
    expect(posted.filter((message) => message.type === 'terminal-plain-tap')).toHaveLength(1)
    expect(
      posted.find((message) => message.type === 'terminal-plain-tap-cancelled')
    ).toBeUndefined()
    expect(posted.filter((message) => message.type === 'terminal-tap')).toHaveLength(1)
  })

  it('does not classify pinch, long-press, or selection-dismiss gestures as plain taps', async () => {
    const { posted } = boot('plain prompt')
    await settle()

    fireTouch('touchstart', [
      { x: 20, y: tapY },
      { x: 80, y: tapY }
    ])
    fireTouch('touchend', [])
    expect(posted.find((message) => message.type === 'terminal-plain-tap')).toBeUndefined()
    expect(
      posted.filter((message) => message.type === 'terminal-plain-tap-cancelled')
    ).toHaveLength(1)

    fireTouch('touchstart', [{ x: 20, y: tapY }])
    await new Promise((resolve) => setTimeout(resolve, 550))
    fireTouch('touchend', [])
    expect(posted.find((message) => message.type === 'terminal-plain-tap')).toBeUndefined()
    expect(
      posted.filter((message) => message.type === 'terminal-plain-tap-cancelled').length
    ).toBeGreaterThan(1)

    posted.length = 0
    fireTouch('touchstart', [{ x: 40, y: tapY }])
    fireTouch('touchend', [])
    expect(posted.find((message) => message.type === 'terminal-plain-tap')).toBeUndefined()
    expect(posted.find((message) => message.type === 'terminal-plain-tap-cancelled')).toBeDefined()
  })

  it('cancels a pending plain tap when a scroll occurs before the next tap', async () => {
    const { posted } = boot('plain prompt')
    await settle()

    fireTouch('touchstart', [{ x: 20, y: tapY }])
    fireTouch('touchend', [])
    fireTouch('touchstart', [{ x: 20, y: tapY }])
    fireTouch('touchmove', [{ x: 20, y: tapY + 120 }])
    fireTouch('touchend', [])
    fireTouch('touchstart', [{ x: 20, y: tapY }])
    fireTouch('touchend', [])

    expect(
      posted
        .filter(
          (message) =>
            message.type === 'terminal-plain-tap' || message.type === 'terminal-plain-tap-cancelled'
        )
        .map((message) => message.type)
    ).toEqual(['terminal-plain-tap', 'terminal-plain-tap-cancelled', 'terminal-plain-tap'])
  })

  it('opens the URL even right after a width-change reflow', async () => {
    // Why: scrollback reflow rewraps the local buffer; the tap path must keep
    // working afterward (the reflow message must not disturb tap routing).
    const { posted } = boot(URL_LINE)
    await settle()
    window.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify({ type: 'reflow', cols: 100, rows: 24 }) })
    )
    fireTouch('touchstart', [{ x: tapX, y: tapY }])
    fireTouch('touchend', [])
    expect(posted.find((m) => m.type === 'open-url')?.url).toBe('https://example.com/foo')
  })

  it('opens first-load OSC links from snapshot metadata on the exact cell range', async () => {
    const oscLinks = [{ row: 0, startCol: 6, endCol: 11, uri: 'https://example.com/issue/1234' }]
    const { posted } = boot('issue #1234 done', oscLinks)
    await settle()

    fireTouch('touchstart', [{ x: screenXForCol(7), y: tapY }])
    fireTouch('touchend', [])

    expect(posted.find((m) => m.type === 'open-url')?.url).toBe('https://example.com/issue/1234')
  })

  it('opens first-load file OSC links through terminal file taps', async () => {
    const oscLinks = [{ row: 0, startCol: 5, endCol: 15, uri: 'file:///tmp/result.json#L12C3' }]
    const { posted } = boot('open artifact here', oscLinks)
    await settle()

    fireTouch('touchstart', [{ x: screenXForCol(7), y: tapY }])
    fireTouch('touchend', [])

    expect(posted.find((m) => m.type === 'open-url')).toBeUndefined()
    expect(posted.find((m) => m.type === 'terminal-file-tap')).toMatchObject({
      type: 'terminal-file-tap',
      pathText: '/tmp/result.json',
      line: 12,
      column: 3
    })
    expect(posted.find((m) => m.type === 'terminal-plain-tap')).toBeUndefined()
    expect(posted.find((m) => m.type === 'terminal-plain-tap-cancelled')).toBeDefined()
  })

  it('does not activate fallback targets for unsupported OSC links', async () => {
    const label = 'https://fallback.example'
    const oscLinks = [{ row: 0, startCol: 0, endCol: label.length, uri: 'mailto:team@example.com' }]
    const { posted } = boot(label, oscLinks)
    await settle()

    fireTouch('touchstart', [{ x: screenXForCol(2), y: tapY }])
    fireTouch('touchend', [])
    fireTouch('touchstart', [{ x: screenXForCol(2), y: tapY }])
    fireTouch('touchend', [])

    expect(posted.find((m) => m.type === 'open-url')).toBeUndefined()
    expect(posted.find((m) => m.type === 'terminal-file-tap')).toBeUndefined()
    expect(posted.find((m) => m.type === 'terminal-plain-tap')).toBeUndefined()
    expect(posted.filter((m) => m.type === 'terminal-plain-tap-cancelled')).toHaveLength(2)
    expect(posted.filter((m) => m.type === 'terminal-tap')).toHaveLength(2)
  })

  it('opens plain file URLs through terminal file taps', async () => {
    const line = 'open file:///tmp/result.json#L12C3 now'
    const { posted } = boot(line)
    await settle()

    fireTouch('touchstart', [{ x: screenXForCol(line.indexOf('result')), y: tapY }])
    fireTouch('touchend', [])

    expect(posted.find((m) => m.type === 'terminal-file-tap')).toMatchObject({
      type: 'terminal-file-tap',
      pathText: '/tmp/result.json',
      line: 12,
      column: 3
    })
  })

  it('does not open snapshot OSC links from adjacent terminal cells', async () => {
    const oscLinks = [{ row: 0, startCol: 6, endCol: 11, uri: 'https://example.com/issue/1234' }]
    const { posted } = boot('issue #1234 done', oscLinks)
    await settle()

    fireTouch('touchstart', [{ x: screenXForCol(12), y: tapY }])
    fireTouch('touchend', [])

    expect(posted.find((m) => m.type === 'open-url')).toBeUndefined()
  })

  it('does not parse off-cell snapshot file OSC links while routing a tap', async () => {
    const oscLinks = Array.from({ length: 50 }, (_, index) => ({
      row: index + 1,
      startCol: 0,
      endCol: 10,
      uri: `file:///tmp/result-${index}.json#L1`
    }))
    const { posted } = boot('plain text', oscLinks)
    await settle()

    const OriginalURL = window.URL
    let parseCount = 0
    const CountingURL = class extends OriginalURL {
      constructor(url: string | URL, base?: string | URL) {
        parseCount += 1
        super(url, base)
      }
    }
    Object.defineProperty(window, 'URL', { value: CountingURL, configurable: true })
    try {
      fireTouch('touchstart', [{ x: screenXForCol(5), y: tapY }])
      fireTouch('touchend', [])
    } finally {
      Object.defineProperty(window, 'URL', { value: OriginalURL, configurable: true })
    }

    expect(parseCount).toBe(0)
    expect(posted.find((m) => m.type === 'terminal-file-tap')).toBeUndefined()
  })

  it('does not open stale snapshot OSC links after the row text changes', async () => {
    const oscLinks = [{ row: 0, startCol: 6, endCol: 11, uri: 'https://example.com/issue/1234' }]
    const { posted, setLine } = boot('issue #1234 done', oscLinks)
    await settle()
    setLine('issue plain done')

    fireTouch('touchstart', [{ x: screenXForCol(7), y: tapY }])
    fireTouch('touchend', [])

    expect(posted.find((m) => m.type === 'open-url')).toBeUndefined()
  })

  it('does not post open-url for a scroll gesture past the tap slop', async () => {
    const { posted } = boot(URL_LINE)
    await settle()
    fireTouch('touchstart', [{ x: tapX, y: tapY }])
    fireTouch('touchmove', [{ x: tapX, y: tapY + 120 }])
    fireTouch('touchend', [])
    expect(posted.find((m) => m.type === 'open-url')).toBeUndefined()
    expect(posted.find((m) => m.type === 'terminal-plain-tap')).toBeUndefined()
    expect(posted.find((m) => m.type === 'terminal-plain-tap-cancelled')).toBeDefined()
  })

  it('sends all four arrows on arrow-gesture swipes and suppresses tap routing', async () => {
    const { posted, scrollLines } = boot(URL_LINE, undefined, 'none', 20)
    await settle()
    fireArrowGestures(true)

    for (const [x, y] of [
      [100, 60],
      [100, 140],
      [140, 100],
      [60, 100]
    ] as const) {
      fireTouch('touchstart', [{ x: 100, y: 100 }])
      fireTouch('touchmove', [{ x, y }])
      fireTouch('touchend', [])
    }
    expect(
      posted.filter((message) => message.type === 'terminal-input').map((message) => message.bytes)
    ).toEqual(['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D'])
    expect(scrollLines).not.toHaveBeenCalled()
    expect(posted.find((message) => message.type === 'open-url')).toBeUndefined()
    expect(posted.filter((message) => message.type === 'terminal-plain-tap')).toHaveLength(0)
  })

  it('repeats only after the swiped finger stays down for 400ms', async () => {
    const { posted } = boot('plain prompt')
    await settle()
    vi.useFakeTimers()
    fireArrowGestures(true)

    posted.length = 0
    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 140, y: 100 }])
    expect(posted.filter((message) => message.type === 'terminal-input')).toHaveLength(1)
    vi.advanceTimersByTime(399)
    expect(posted.filter((message) => message.type === 'terminal-input')).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(posted.filter((message) => message.type === 'terminal-input')).toHaveLength(2)
    vi.advanceTimersByTime(90)
    expect(posted.filter((message) => message.type === 'terminal-input')).toHaveLength(4)
  })

  it('keeps the hold time across movement and stops on release', async () => {
    const { posted } = boot('plain prompt')
    await settle()
    vi.useFakeTimers()
    fireArrowGestures(true)

    posted.length = 0
    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 140, y: 100 }])
    vi.advanceTimersByTime(300)
    fireTouch('touchmove', [{ x: 180, y: 100 }])
    vi.advanceTimersByTime(99)
    expect(posted.filter((message) => message.type === 'terminal-input')).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(posted.filter((message) => message.type === 'terminal-input')).toHaveLength(2)
    fireTouch('touchend', [])
    vi.advanceTimersByTime(1000)
    expect(posted.filter((message) => message.type === 'terminal-input')).toHaveLength(2)
  })

  it('keeps normal scrollback behavior for a single swipe', async () => {
    const { posted, scrollLines } = boot('plain prompt', undefined, 'none', 20)
    await settle()
    posted.length = 0

    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 100, y: 160 }])
    await settle()

    expect(scrollLines).toHaveBeenCalled()
    expect(posted.find((message) => message.type === 'terminal-input')).toBeUndefined()
  })

  it('keeps normal scrolling for a second touch inside the double-tap window in scroll mode', async () => {
    const { posted, scrollLines } = boot('plain prompt', undefined, 'none', 20)
    await settle()

    firePlainTap()
    scrollLines.mockClear()
    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 100, y: 160 }])
    await settle()
    fireTouch('touchend', [])

    expect(scrollLines).toHaveBeenCalled()
    expect(posted.find((message) => message.type === 'terminal-input')).toBeUndefined()
  })

  it('blocks scrolling throughout the second tap before sending Tab or an arrow', async () => {
    const { posted, scrollLines } = boot('plain prompt', undefined, 'none', 20)
    await settle()
    fireArrowGestures(true)

    firePlainTap()
    scrollLines.mockClear()
    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 104, y: 105 }])
    await settle()
    fireTouch('touchend', [])

    expect(scrollLines).not.toHaveBeenCalled()
    expect(posted.filter((message) => message.type === 'terminal-plain-tap')).toHaveLength(2)
    expect(posted.find((message) => message.type === 'terminal-input')).toBeUndefined()
  })

  it('opens links without arrow input in arrow-gesture mode', async () => {
    const { posted, scrollLines } = boot(URL_LINE, undefined, 'none', 20)
    await settle()
    fireArrowGestures(true)

    firePlainTap(tapX, tapY)

    expect(posted.find((message) => message.type === 'open-url')).toBeDefined()
    expect(posted.find((message) => message.type === 'terminal-input')).toBeUndefined()
    expect(scrollLines).not.toHaveBeenCalled()
  })

  it('stops held repeats on cancellation and pinch', async () => {
    const { posted } = boot('plain prompt')
    await settle()
    vi.useFakeTimers()
    fireArrowGestures(true)

    posted.length = 0
    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 140, y: 100 }])
    fireTouch('touchcancel', [])
    vi.advanceTimersByTime(1000)
    expect(posted.filter((message) => message.type === 'terminal-input')).toHaveLength(1)
    expect(document.getElementById('terminal-swipe-indicator')?.hidden).toBe(true)

    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 140, y: 100 }])
    fireTouch('touchstart', [
      { x: 140, y: 100 },
      { x: 170, y: 100 }
    ])
    vi.advanceTimersByTime(1000)
    expect(posted.filter((message) => message.type === 'terminal-input')).toHaveLength(2)
    expect(document.getElementById('terminal-swipe-indicator')?.hidden).toBe(true)
  })

  it('keeps an arrow-gesture long press in selection mode', async () => {
    const { posted } = boot('plain prompt')
    await settle()
    vi.useFakeTimers()
    fireArrowGestures(true)
    posted.length = 0

    fireTouch('touchstart', [{ x: 100, y: 100 }])
    vi.advanceTimersByTime(500)
    fireTouch('touchmove', [{ x: 140, y: 100 }])

    expect(posted).toContainEqual({ type: 'set-select-mode', enabled: true })
    expect(posted.find((message) => message.type === 'terminal-input')).toBeUndefined()
    expect(document.getElementById('terminal-swipe-indicator')?.hidden).toBe(true)
    fireTouch('touchend', [])
  })

  it('sends an arrow on the first arrow-gesture move and shows its origin and direction', async () => {
    const { posted, scrollLines } = boot('plain prompt', undefined, 'none', 20)
    await settle()
    vi.useFakeTimers()
    fireArrowGestures(true)

    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 140, y: 100 }])

    expect(posted.filter((message) => message.type === 'terminal-input')).toEqual([
      { type: 'terminal-input', bytes: '\x1b[C' }
    ])
    expect(posted.filter((message) => message.type === 'terminal-plain-tap')).toHaveLength(0)
    expect(scrollLines).not.toHaveBeenCalled()
    const indicator = document.getElementById('terminal-swipe-indicator')
    expect(indicator).not.toBeNull()
    expect(indicator?.hidden).toBe(false)
    expect(indicator?.dataset.startX).toBe('100')
    expect(indicator?.dataset.startY).toBe('100')
    expect(indicator?.dataset.currentDirection).toBe('right')
  })

  it('repeats the current arrow-gesture direction and switches immediately on a new axis', async () => {
    const { posted } = boot('plain prompt')
    await settle()
    vi.useFakeTimers()
    fireArrowGestures(true)

    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 140, y: 100 }])
    vi.advanceTimersByTime(400)
    fireTouch('touchmove', [{ x: 100, y: 60 }])

    expect(
      posted.filter((message) => message.type === 'terminal-input').map((message) => message.bytes)
    ).toEqual(['\x1b[C', '\x1b[C', '\x1b[A'])
    expect(document.getElementById('terminal-swipe-indicator')?.dataset.currentDirection).toBe('up')

    vi.advanceTimersByTime(400)
    expect(
      posted.filter((message) => message.type === 'terminal-input').map((message) => message.bytes)
    ).toEqual(['\x1b[C', '\x1b[C', '\x1b[A', '\x1b[A'])
    fireTouch('touchend', [])
  })

  it('keeps the arrow-gesture mode latched for a gesture and restores scroll after release', async () => {
    const { posted, scrollLines } = boot('plain prompt', undefined, 'none', 20)
    await settle()
    fireArrowGestures(true)
    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireArrowGestures(false)
    fireTouch('touchmove', [{ x: 140, y: 100 }])
    fireTouch('touchend', [])

    expect(posted.find((message) => message.type === 'terminal-input')).toMatchObject({
      type: 'terminal-input',
      bytes: '\x1b[C'
    })
    expect(scrollLines).not.toHaveBeenCalled()

    await Promise.resolve()
    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireArrowGestures(true)
    fireTouch('touchmove', [{ x: 100, y: 160 }])
    await settle()
    expect(scrollLines).toHaveBeenCalled()
  })

  it('scrolls in scroll mode and sends arrows in arrow-gesture mode without the keyboard', async () => {
    const { posted, scrollLines } = boot('plain prompt', undefined, 'none', 20)
    await settle()

    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchmove', [{ x: 100, y: 160 }])
    fireTouch('touchend', [])
    await settle()
    expect(scrollLines).toHaveBeenCalled()
    expect(posted.find((message) => message.type === 'terminal-input')).toBeUndefined()

    fireArrowGestures(true)
    scrollLines.mockClear()
    for (const [x, y] of [
      [100, 60],
      [100, 140],
      [140, 100],
      [60, 100]
    ] as const) {
      fireTouch('touchstart', [{ x: 100, y: 100 }])
      fireTouch('touchmove', [{ x, y }])
      fireTouch('touchend', [])
    }
    expect(
      posted.filter((message) => message.type === 'terminal-input').map((message) => message.bytes)
    ).toEqual(['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D'])
    expect(scrollLines).not.toHaveBeenCalled()
  })

  it('keeps a movement-free arrow-gesture double tap on the plain-tap Tab path', async () => {
    const { posted, scrollLines } = boot('plain prompt', undefined, 'none', 20)
    await settle()
    fireArrowGestures(true)

    firePlainTap()
    fireTouch('touchstart', [{ x: 100, y: 100 }])
    fireTouch('touchend', [])

    expect(posted.find((message) => message.type === 'terminal-input')).toBeUndefined()
    expect(posted.filter((message) => message.type === 'terminal-plain-tap')).toHaveLength(2)
    expect(scrollLines).not.toHaveBeenCalled()
  })
})
