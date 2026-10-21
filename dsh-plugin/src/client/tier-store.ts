/**
 * Tier selection state of the composer.
 *
 * Two layers, matching how the picker is expected to behave:
 * - the **persisted default** (`settings.defaultTier`, written back to the
 *   host config so it survives a reload and applies to the shortcut and
 *   `/enhance` as well);
 * - a **per-session override**, so a one-off 专业 or 系统 rewrite does not
 *   silently change every later call in every conversation.
 *
 * The context toggle follows the same shape: the current tier's preset decides
 * its default, and flipping it pins an explicit value for that session until
 * the tier changes again (a new tier brings its own preset back).
 * @module dsh-prompt-enhance/client/tier-store
 */

import { DEFAULT_TIER, normalizeTier, TIER_CONTEXT_PRESET, type Tier } from '../tiers'
import { getClientSettings } from './settings'

/** Per-session selections; absent means "follow the persisted default". */
const tierOverrides = new Map<string, Tier>()

/** Per-session context choices; absent means "follow the tier preset". */
const contextOverrides = new Map<string, boolean>()

const listeners = new Set<() => void>()
let version = 0

/** The tier currently displayed and used for the next call in this session. */
export function effectiveTier(sessionId: string): Tier {
  const override = tierOverrides.get(sessionId)
  if (override !== undefined) return override
  return normalizeTier(getClientSettings().defaultTier, DEFAULT_TIER)
}

/**
 * The context toggle state for this session.
 * @param sessionId - the composer's session key.
 * @returns true when the next call may ground itself in recent history.
 */
export function effectiveUseContext(sessionId: string): boolean {
  const override = contextOverrides.get(sessionId)
  if (override !== undefined) return override
  return TIER_CONTEXT_PRESET[effectiveTier(sessionId)].useContext
}

/**
 * Select a tier for this session. Clears the session's explicit context
 * choice so the new tier's preset takes over (the toggle stays directly
 * overridable afterwards).
 * @param sessionId - the composer's session key.
 * @param tier - the tier to use from now on in this conversation.
 */
export function selectTier(sessionId: string, tier: Tier): void {
  tierOverrides.set(sessionId, tier)
  contextOverrides.delete(sessionId)
  notify()
}

/**
 * Pin the context toggle for this session.
 * @param sessionId - the composer's session key.
 * @param value - whether history may ground the next call.
 */
export function selectUseContext(sessionId: string, value: boolean): void {
  contextOverrides.set(sessionId, value)
  notify()
}

/**
 * Drop every per-session choice (called when the persisted default changes, so
 * the picker follows it immediately instead of keeping stale overrides).
 */
export function clearOverrides(): void {
  tierOverrides.clear()
  contextOverrides.clear()
  notify()
}

/**
 * Register the settings writer so the picker can persist a default tier.
 * Wired by the client entry once the settings scope binds; without it the
 * picker still works per session, the choice just does not persist.
 * @param writer - writes one field into the plugin settings section.
 */
export function registerTierPersist(writer: (tier: Tier) => Promise<void>): void {
  persistWriter = writer
}

let persistWriter: ((tier: Tier) => Promise<void>) | undefined

/**
 * Persist a tier as the plugin default.
 * @param tier - the tier to store in `defaultTier`.
 * @returns the writer's promise, or undefined when no writer is bound.
 */
export function persistDefaultTier(tier: Tier): Promise<void> | undefined {
  return persistWriter?.(tier)
}

/** Subscribe to selection changes. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Monotonic snapshot for `useSyncExternalStore`. */
export function getVersion(): number {
  return version
}

function notify(): void {
  version += 1
  for (const listener of listeners) listener()
}
