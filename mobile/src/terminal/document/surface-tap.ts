import type { TerminalDocumentScope } from './document-scope'
import { notify } from './host-notify'
import {
  buildMouseClickInput,
  getMouseTrackingMode,
  isClickMouseTrackingMode
} from './mouse-input-encoding'
import { oscLinkAtViewportPoint, resolveTerminalFileUrlTap } from './osc-link-tap'
import { filePathAtViewportPoint } from './path-tap'
import { fileUrlAtViewportPoint, urlAtViewportPoint } from './url-tap'

export function cancelTerminalPlainTap(scope: TerminalDocumentScope) {
  notify(scope, { type: 'terminal-plain-tap-cancelled' })
}

export function notifyTerminalSurfaceTap(
  scope: TerminalDocumentScope,
  originX: number,
  originY: number,
  focusKeyboard: boolean
) {
  const tappedOscLink = oscLinkAtViewportPoint(scope, originX, originY)
  const unsupportedOscLink = tappedOscLink !== null && tappedOscLink.kind === 'unsupported'
  if (tappedOscLink && tappedOscLink.kind === 'file') {
    cancelTerminalPlainTap(scope)
    notify(scope, {
      type: 'terminal-file-tap',
      pathText: tappedOscLink.fileTap.pathText,
      line: tappedOscLink.fileTap.line,
      column: tappedOscLink.fileTap.column
    })
    return
  }
  const tappedFileUrl = tappedOscLink ? null : fileUrlAtViewportPoint(scope, originX, originY)
  const tappedFileUrlPath = tappedFileUrl ? resolveTerminalFileUrlTap(tappedFileUrl) : null
  if (tappedFileUrlPath) {
    cancelTerminalPlainTap(scope)
    notify(scope, {
      type: 'terminal-file-tap',
      pathText: tappedFileUrlPath.pathText,
      line: tappedFileUrlPath.line,
      column: tappedFileUrlPath.column
    })
    return
  }
  const tappedUrl =
    tappedOscLink && tappedOscLink.kind === 'url'
      ? tappedOscLink.url
      : tappedOscLink
        ? null
        : urlAtViewportPoint(scope, originX, originY)
  if (tappedUrl) {
    cancelTerminalPlainTap(scope)
    notify(scope, { type: 'open-url', url: tappedUrl })
    return
  }
  const tappedPath = tappedOscLink ? null : filePathAtViewportPoint(scope, originX, originY)
  if (tappedPath) {
    cancelTerminalPlainTap(scope)
    notify(scope, {
      type: 'terminal-file-tap',
      pathText: tappedPath.pathText,
      line: tappedPath.line,
      column: tappedPath.column
    })
    return
  }
  const clickInput = buildMouseClickInput(scope, originX, originY)
  if (clickInput) {
    notify(scope, { type: 'terminal-input', bytes: clickInput })
  }
  // A click with an unproven encoding reached no program, so it acts as a plain tap.
  const mouseTrackingTap =
    isClickMouseTrackingMode(getMouseTrackingMode(scope)) && scope.mouseEncodingKnown
  if (focusKeyboard && !mouseTrackingTap && !unsupportedOscLink) {
    notify(scope, { type: 'terminal-plain-tap' })
  } else if (focusKeyboard) {
    cancelTerminalPlainTap(scope)
  }
  // Touch still needs native input focus after the TUI consumes its mouse click.
  if (focusKeyboard || !mouseTrackingTap) {
    notify(scope, { type: 'terminal-tap' })
  }
}
