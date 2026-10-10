import {
  TERMINAL_ACCESSORY_REPEAT_DELAY_MS,
  TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS
} from '../terminal-accessory-repeat'
import type { TerminalDocumentScope } from './document-scope'
import { elementInRoot } from './document-host-seams'
import { notify } from './host-notify'
import { buildArrowKeySequence, getMouseTrackingMode } from './mouse-input-encoding'
import { resetSmoothScrollOffset } from './normal-buffer-smooth-scroll'
import { cancelTerminalPlainTap } from './surface-tap'
import { armLongPress, clearLongPress, TAP_SLOP, touchSlopExceeded } from './tap-dispatch'

/** The arrow-gesture swipe's latched direction and sequence, carried on the touch dispatch. */
export type TerminalArrowSwipe = {
  swipeSequence: string
  swipeDirection: string
  swipeOriginX: number
  swipeOriginY: number
}

function swipeElements(scope: TerminalDocumentScope) {
  const indicator = elementInRoot(scope.root, 'terminal-swipe-indicator')
  const origin = elementInRoot(scope.root, 'terminal-swipe-origin')
  const vector = elementInRoot(scope.root, 'terminal-swipe-vector')
  const direction = elementInRoot(scope.root, 'terminal-swipe-direction')
  return indicator && origin && vector && direction
    ? { indicator, origin, vector, direction }
    : null
}

export function clearSwipeRepeat(scope: TerminalDocumentScope) {
  if (scope.swipeRepeatTimer) {
    clearTimeout(scope.swipeRepeatTimer)
    scope.swipeRepeatTimer = null
  }
}

function armSwipeRepeat(scope: TerminalDocumentScope, delay: number) {
  clearSwipeRepeat(scope)
  scope.swipeRepeatTimer = setTimeout(function () {
    scope.swipeRepeatTimer = null
    const dispatch = scope.touchDispatch
    if (dispatch.mode !== 'swipe' || !dispatch.swipeSequence) {
      return
    }
    notify(scope, { type: 'terminal-input', bytes: dispatch.swipeSequence })
    armSwipeRepeat(scope, TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS)
  }, delay)
}

function directionName(final: string) {
  return final === 'A' ? 'up' : final === 'B' ? 'down' : final === 'C' ? 'right' : 'left'
}

function directionGlyph(final: string) {
  return final === 'A' ? '↑' : final === 'B' ? '↓' : final === 'C' ? '→' : '←'
}

export function showSwipeIndicator(scope: TerminalDocumentScope, t: Touch) {
  scope.touchDispatch.swipeOriginX = t.clientX
  scope.touchDispatch.swipeOriginY = t.clientY
  const els = swipeElements(scope)
  if (!els) {
    return
  }
  const x = String(t.clientX)
  const y = String(t.clientY)
  els.indicator.hidden = false
  els.indicator.dataset.startX = x
  els.indicator.dataset.startY = y
  els.indicator.dataset.currentDirection = ''
  els.origin.setAttribute('cx', x)
  els.origin.setAttribute('cy', y)
  els.vector.setAttribute('x1', x)
  els.vector.setAttribute('y1', y)
  els.vector.setAttribute('x2', x)
  els.vector.setAttribute('y2', y)
  els.direction.textContent = ''
}

function updateSwipeIndicator(scope: TerminalDocumentScope, t: Touch, final: string) {
  const els = swipeElements(scope)
  if (!els) {
    return
  }
  els.vector.setAttribute('x2', String(t.clientX))
  els.vector.setAttribute('y2', String(t.clientY))
  els.direction.setAttribute('x', String(t.clientX))
  els.direction.setAttribute('y', String(t.clientY))
  els.direction.textContent = final ? directionGlyph(final) : ''
  els.indicator.dataset.currentDirection = final ? directionName(final) : ''
}

export function hideSwipeIndicator(scope: TerminalDocumentScope) {
  const els = swipeElements(scope)
  if (!els) {
    return
  }
  els.indicator.hidden = true
  els.indicator.dataset.currentDirection = ''
  els.direction.textContent = ''
}

export function haltSurfaceTouchScroll(scope: TerminalDocumentScope) {
  resetSmoothScrollOffset(scope)
  if (scope.touchGesture.momentumId) {
    cancelAnimationFrame(scope.touchGesture.momentumId)
    scope.touchGesture.momentumId = null
  }
  scope.touchGesture.velY = 0
  scope.touchGesture.accumDelta = 0
}

export function updateArrowSwipe(scope: TerminalDocumentScope, t: Touch) {
  if (scope.selMode === 'select') {
    return
  }
  const dispatch = scope.touchDispatch
  const dx = t.clientX - dispatch.swipeOriginX
  const dy = t.clientY - dispatch.swipeOriginY
  const final =
    Math.abs(dx) + Math.abs(dy) > TAP_SLOP
      ? Math.abs(dx) > Math.abs(dy)
        ? dx < 0
          ? 'D'
          : 'C'
        : dy < 0
          ? 'A'
          : 'B'
      : ''
  updateSwipeIndicator(scope, t, final)
  if (!final || final === dispatch.swipeDirection) {
    return
  }
  dispatch.mode = 'swipe'
  dispatch.swipeDirection = final
  dispatch.swipeSequence = buildArrowKeySequence(scope, final)
  scope.tapCandidate = null
  clearLongPress(scope)
  cancelTerminalPlainTap(scope)
  notify(scope, { type: 'terminal-input', bytes: dispatch.swipeSequence })
  armSwipeRepeat(scope, TERMINAL_ACCESSORY_REPEAT_DELAY_MS)
}

/** Ends the swipe's repeat and indicator but leaves the dispatch mode to the caller. */
export function clearArrowSwipe(scope: TerminalDocumentScope) {
  clearSwipeRepeat(scope)
  hideSwipeIndicator(scope)
  scope.touchDispatch.swipeSequence = ''
  scope.touchDispatch.swipeDirection = ''
}

/** Claims a lone finger for arrow swipes when the TUI isn't tracking the mouse. */
export function beginArrowSwipe(scope: TerminalDocumentScope, t: Touch, fingers: number) {
  if (fingers !== 1 || !scope.arrowGesturesEnabled || getMouseTrackingMode(scope) !== 'none') {
    return false
  }
  scope.touchDispatch.mode = 'gesture-touch'
  showSwipeIndicator(scope, t)
  haltSurfaceTouchScroll(scope)
  armLongPress(scope, t)
  return true
}

/** Tracks the swipe's owning finger; returns false once that finger is gone. */
export function moveArrowSwipe(scope: TerminalDocumentScope, t: Touch | null) {
  // Why: the swipe stays owned by its first finger; a second finger must not cancel it.
  if (!t) {
    resetArrowSwipe(scope)
    return false
  }
  if (scope.longPressTimer && touchSlopExceeded(scope, t)) {
    clearLongPress(scope)
  }
  updateArrowSwipe(scope, t)
  return true
}

/** Drops the swipe's latch, sequence and indicator; also clears the swipe-only dispatch modes. */
export function resetArrowSwipe(scope: TerminalDocumentScope) {
  clearArrowSwipe(scope)
  const dispatch = scope.touchDispatch
  if (
    dispatch.mode === 'gesture-touch' ||
    dispatch.mode === 'swipe' ||
    dispatch.mode === 'blocked-end'
  ) {
    dispatch.mode = 'idle'
    dispatch.touchId = null
  }
}
