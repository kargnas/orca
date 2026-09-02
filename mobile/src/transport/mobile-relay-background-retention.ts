import type { RelayReconnectController } from './mobile-relay-reconnect-controller'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'

type Clearable = { clear(): void }
type DirectProbe = Clearable & { schedule(delayMs?: number): void }
type DirectGrace = Clearable & { arm(): void }

// Owns the foreground flag and what a background transition does to relay
// recovery. A healthy relay is kept for the whole background stay: the desktop
// keeps its own leg open, and the OS freezes JS timers while hidden, so the
// only way to lose the session is a transport failure — and that is recovered
// on foreground, never in the background.
export class MobileRelayBackgroundRetention {
  private foregroundState = true
  private relaySuspended = false

  constructor(
    private readonly logical: StableLogicalRpcClient,
    private readonly relayReconnect: RelayReconnectController,
    private readonly leaseRotation: Clearable,
    private readonly directProbe: DirectProbe,
    private readonly directGrace: DirectGrace
  ) {}

  isForeground(): boolean {
    return this.foregroundState
  }

  setForeground(foreground: boolean): void {
    const wasForeground = this.foregroundState
    this.foregroundState = foreground
    if (foreground) {
      this.relayReconnect.handleForeground(this.logical, wasForeground)
      this.directProbe.schedule(0)
      this.directGrace.arm()
    } else if (wasForeground) {
      this.background()
    }
  }

  stop(): void {
    this.directProbe.clear()
    this.relayReconnect.clear()
    this.leaseRotation.clear()
    this.directGrace.clear()
    this.logical.setRecoveryPath(null)
  }

  handleStateFailure(): void {
    if (this.logical.getActivePath() === 'relay') {
      this.suspendRelay()
    }
  }

  private background(): void {
    this.relaySuspended = false
    this.directProbe.clear()
    this.directGrace.clear()
    this.logical.setRecoveryPath(null)
    if (this.logical.getActivePath() === 'relay' && this.logical.getState() === 'connected') {
      return
    }
    this.relayReconnect.clear()
    this.leaseRotation.clear()
    if (this.logical.getActivePath() === 'relay') {
      this.suspendRelay()
    }
  }

  private suspendRelay(): void {
    // Why: suspending publishes 'disconnected', which re-enters handleStateFailure.
    if (this.relaySuspended || this.logical.getActivePath() !== 'relay') {
      return
    }
    this.relaySuspended = true
    this.leaseRotation.clear()
    this.relayReconnect.suspendActiveRelay(this.logical)
  }
}
