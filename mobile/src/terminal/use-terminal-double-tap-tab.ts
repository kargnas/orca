import { useCallback, useEffect, useRef } from 'react'
import { resolveTerminalDoubleTapTab, type TerminalTapRecord } from './terminal-double-tap-tab'

export type TerminalDoubleTapTabHandlers = {
  readonly cancelPendingTap: () => void
  readonly shouldSendTabForTap: (handle: string) => boolean
}

export function useTerminalDoubleTapTab(
  enabled: boolean,
  activeHandle: string | null,
  lifecycleKey: string
): TerminalDoubleTapTabHandlers {
  const lastTapRef = useRef<TerminalTapRecord | null>(null)

  useEffect(() => {
    lastTapRef.current = null
  }, [enabled, activeHandle, lifecycleKey])

  const cancelPendingTap = useCallback(() => {
    lastTapRef.current = null
  }, [])

  const shouldSendTabForTap = useCallback(
    (handle: string) => {
      const resolution = resolveTerminalDoubleTapTab({
        enabled,
        handle,
        lastTap: lastTapRef.current,
        now: Date.now()
      })
      lastTapRef.current = resolution.nextTap
      return resolution.sendTab
    },
    [enabled]
  )

  return { cancelPendingTap, shouldSendTabForTap }
}
