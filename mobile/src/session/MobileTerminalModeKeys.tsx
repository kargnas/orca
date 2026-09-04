import { Pressable } from 'react-native'
import { ChevronsRight, Monitor, Move, Smartphone } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { styles } from './mobile-session-styles'
import { isTerminalPhoneDisplayMode } from './mobile-session-route-helpers'
import type { MobileDisplayMode } from './mobile-session-route-types'

type MobileTerminalModeKeysProps = {
  readonly activeHandle: string | null
  readonly terminalModes: Map<string, MobileDisplayMode>
  readonly canSend: boolean
  readonly canCompose: boolean
  readonly liveInputEnabled: boolean
  readonly arrowGesturesEnabled: boolean
  readonly onToggleDisplayMode: (handle: string) => Promise<void>
  readonly onToggleLiveInput: () => void
  readonly onToggleArrowGestures: () => void
}

// The three mode switches that lead the accessory row: what the terminal renders
// as, where typed characters go, and what a touch on the terminal surface means.
export function MobileTerminalModeKeys({
  activeHandle,
  terminalModes,
  canSend,
  canCompose,
  liveInputEnabled,
  arrowGesturesEnabled,
  onToggleDisplayMode,
  onToggleLiveInput,
  onToggleArrowGestures
}: MobileTerminalModeKeysProps) {
  const phoneDisplayMode = isTerminalPhoneDisplayMode(activeHandle, terminalModes)
  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.accessoryKey,
          pressed && styles.accessoryKeyPressed,
          !canSend && styles.accessoryKeyDisabled
        ]}
        disabled={!canSend}
        onPress={() => {
          if (activeHandle) {
            void onToggleDisplayMode(activeHandle)
          }
        }}
        accessibilityLabel={phoneDisplayMode ? 'Switch to desktop mode' : 'Switch to phone mode'}
      >
        {phoneDisplayMode ? (
          <Monitor size={14} color={canSend ? colors.textSecondary : colors.textMuted} />
        ) : (
          <Smartphone size={14} color={canSend ? colors.textSecondary : colors.textMuted} />
        )}
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.accessoryKey,
          liveInputEnabled && styles.accessoryKeyActive,
          pressed && styles.accessoryKeyPressed,
          !canCompose && styles.accessoryKeyDisabled
        ]}
        // Why: offline, live mode is dead but the buffered box still composes — keep the escape hatch tappable (#6713).
        disabled={!canCompose}
        onPress={onToggleLiveInput}
        accessibilityLabel={
          liveInputEnabled ? 'Switch to buffered command input' : 'Switch to live terminal input'
        }
      >
        <ChevronsRight
          size={14}
          color={
            liveInputEnabled ? colors.bgBase : canCompose ? colors.textSecondary : colors.textMuted
          }
        />
      </Pressable>
      {/* Why: a local view mode, so it stays tappable while the session is offline. */}
      <Pressable
        style={({ pressed }) => [
          styles.accessoryKey,
          arrowGesturesEnabled && styles.accessoryKeyActive,
          pressed && styles.accessoryKeyPressed
        ]}
        onPress={onToggleArrowGestures}
        accessibilityLabel={
          arrowGesturesEnabled ? 'Switch to scroll gestures' : 'Switch to arrow key gestures'
        }
      >
        <Move size={14} color={arrowGesturesEnabled ? colors.bgBase : colors.textSecondary} />
      </Pressable>
    </>
  )
}
