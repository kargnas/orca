import { useCallback, useEffect, useRef, useState } from 'react'
import { Switch, Text, View } from 'react-native'
import {
  loadTerminalKeyboardResizeEnabled,
  loadTerminalTapKeyboardEnabled,
  saveTerminalKeyboardResizeEnabled,
  saveTerminalTapKeyboardEnabled
} from '../storage/preferences'
import { colors } from '../theme/mobile-theme'
import { terminalSettingsScreenStyles as styles } from './terminal-settings-screen-styles'

export function TerminalTapKeyboardSetting(): React.JSX.Element {
  const [enabled, setEnabled] = useState(true)
  const userToggledRef = useRef(false)

  useEffect(() => {
    let stale = false
    void loadTerminalTapKeyboardEnabled().then((storedEnabled) => {
      if (!stale && !userToggledRef.current) {
        setEnabled(storedEnabled)
      }
    })
    return () => {
      stale = true
    }
  }, [])

  const toggle = useCallback((next: boolean) => {
    userToggledRef.current = true
    setEnabled(next)
    void saveTerminalTapKeyboardEnabled(next)
  }, [])

  return (
    <>
      <View style={styles.separator} />
      <View style={styles.row}>
        <View style={styles.rowContent}>
          <Text style={styles.rowLabel}>Tap terminal to show keyboard</Text>
          <Text style={styles.rowSublabel}>{enabled ? 'On' : 'Off'}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={toggle}
          trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
          thumbColor={colors.textPrimary}
        />
      </View>
      <View style={styles.separator} />
    </>
  )
}

export function TerminalKeyboardResizeSetting(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const userToggledRef = useRef(false)

  useEffect(() => {
    let stale = false
    void loadTerminalKeyboardResizeEnabled().then((storedEnabled) => {
      if (!stale && !userToggledRef.current) {
        setEnabled(storedEnabled)
      }
    })
    return () => {
      stale = true
    }
  }, [])

  const toggle = useCallback((next: boolean) => {
    userToggledRef.current = true
    setEnabled(next)
    void saveTerminalKeyboardResizeEnabled(next)
  }, [])

  return (
    <>
      <Text style={[styles.groupHeading, styles.inputGroupGap]}>KEYBOARD LAYOUT</Text>
      <Text style={styles.groupDescription}>
        Reduce terminal rows to the visible area while the on-screen keyboard is open.
      </Text>
      <View style={[styles.section, styles.sectionTopGap]}>
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Resize terminal for keyboard</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={toggle}
            trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
            thumbColor={colors.textPrimary}
          />
        </View>
      </View>
    </>
  )
}
