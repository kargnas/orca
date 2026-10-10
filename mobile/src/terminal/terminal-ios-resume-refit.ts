import { useEffect, type RefObject } from 'react'
import { AppState, Platform, type AppStateStatus } from 'react-native'
import { shouldRecoverTerminalOnAppStateChange } from './terminal-foreground-recovery'

export function useIosResumeRefit(
  viewportMeasuredRef: RefObject<boolean>,
  scheduleForcedViewportRefit: () => void
) {
  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return
    }
    let previousAppState: AppStateStatus | null = AppState.currentState
    const sub = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const shouldRefit = shouldRecoverTerminalOnAppStateChange(
        previousAppState,
        nextAppState,
        Platform.OS
      )
      previousAppState = nextAppState
      if (!shouldRefit) {
        return
      }
      // Why: cached grid can match while the host PTY changed in background; reassert equal dims to converge after iOS resume.
      viewportMeasuredRef.current = false
      scheduleForcedViewportRefit()
    })
    return () => sub.remove()
  }, [viewportMeasuredRef, scheduleForcedViewportRefit])
}
