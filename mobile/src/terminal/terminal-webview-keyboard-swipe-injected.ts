import {
  TERMINAL_ACCESSORY_REPEAT_DELAY_MS,
  TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS
} from './terminal-accessory-repeat'

// Keyboard-visible swipe state and rendering, injected into the terminal touch dispatcher.
export const TERMINAL_KEYBOARD_SWIPE_JS = `
  var swipeRepeatTimer = null;
  var keyboardVisible = false;
  var swipeIndicator = document.getElementById('terminal-swipe-indicator');
  var swipeOrigin = document.getElementById('terminal-swipe-origin');
  var swipeVector = document.getElementById('terminal-swipe-vector');
  var swipeDirection = document.getElementById('terminal-swipe-direction');
  var SWIPE_REPEAT_DELAY_MS = ${TERMINAL_ACCESSORY_REPEAT_DELAY_MS};
  var SWIPE_REPEAT_INTERVAL_MS = ${TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS};

  function clearSwipeRepeat() {
    if (swipeRepeatTimer) {
      clearTimeout(swipeRepeatTimer);
      swipeRepeatTimer = null;
    }
  }

  function armSwipeRepeat(delay) {
    clearSwipeRepeat();
    swipeRepeatTimer = setTimeout(function repeatSwipeArrow() {
      swipeRepeatTimer = null;
      if (dispatch.mode !== 'swipe' || !dispatch.swipeSequence) return;
      notify({ type: 'terminal-input', bytes: dispatch.swipeSequence });
      armSwipeRepeat(SWIPE_REPEAT_INTERVAL_MS);
    }, delay);
  }

  function directionName(final) {
    return final === 'A' ? 'up' : final === 'B' ? 'down' : final === 'C' ? 'right' : 'left';
  }

  function directionGlyph(final) {
    return final === 'A' ? '↑' : final === 'B' ? '↓' : final === 'C' ? '→' : '←';
  }

  function showSwipeIndicator(t) {
    dispatch.swipeOriginX = t.clientX;
    dispatch.swipeOriginY = t.clientY;
    swipeIndicator.hidden = false;
    swipeIndicator.dataset.startX = String(t.clientX);
    swipeIndicator.dataset.startY = String(t.clientY);
    swipeIndicator.dataset.currentDirection = '';
    swipeOrigin.setAttribute('cx', String(t.clientX));
    swipeOrigin.setAttribute('cy', String(t.clientY));
    swipeVector.setAttribute('x1', String(t.clientX));
    swipeVector.setAttribute('y1', String(t.clientY));
    swipeVector.setAttribute('x2', String(t.clientX));
    swipeVector.setAttribute('y2', String(t.clientY));
    swipeDirection.textContent = '';
  }

  function updateSwipeIndicator(t, final) {
    swipeVector.setAttribute('x2', String(t.clientX));
    swipeVector.setAttribute('y2', String(t.clientY));
    swipeDirection.setAttribute('x', String(t.clientX));
    swipeDirection.setAttribute('y', String(t.clientY));
    swipeDirection.textContent = final ? directionGlyph(final) : '';
    swipeIndicator.dataset.currentDirection = final ? directionName(final) : '';
  }

  function hideSwipeIndicator() {
    swipeIndicator.hidden = true;
    swipeIndicator.dataset.currentDirection = '';
    swipeDirection.textContent = '';
  }

  function stopSurfaceTouchScroll() {
    resetSmoothScrollOffset();
    if (ts.momentumId) {
      cancelAnimationFrame(ts.momentumId);
      ts.momentumId = null;
    }
    ts.velY = 0;
    ts.accumDelta = 0;
  }

  function updateKeyboardSwipe(t) {
    if (selMode === 'select') return;
    var dx = t.clientX - dispatch.swipeOriginX;
    var dy = t.clientY - dispatch.swipeOriginY;
    var final = Math.abs(dx) + Math.abs(dy) > TAP_SLOP
      ? (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'D' : 'C') : (dy < 0 ? 'A' : 'B'))
      : '';
    updateSwipeIndicator(t, final);
    if (!final || final === dispatch.swipeDirection) return;
    dispatch.mode = 'swipe';
    dispatch.swipeDirection = final;
    dispatch.swipeSequence = buildArrowKeySequence(final);
    tapCandidate = null;
    clearLongPress();
    cancelTerminalPlainTap();
    notify({ type: 'terminal-input', bytes: dispatch.swipeSequence });
    armSwipeRepeat(SWIPE_REPEAT_DELAY_MS);
  }

  function resetKeyboardSwipe() {
    clearSwipeRepeat();
    hideSwipeIndicator();
    dispatch.swipeSequence = '';
    dispatch.swipeDirection = '';
    if (dispatch.mode === 'keyboard-touch' || dispatch.mode === 'swipe' || dispatch.mode === 'blocked-end') {
      dispatch.mode = 'idle';
      dispatch.touchId = null;
    }
  }
`
