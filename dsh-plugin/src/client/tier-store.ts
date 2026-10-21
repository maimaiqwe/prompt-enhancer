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

/**
 * Overrides outlive the module, not just the render.
 *
 * A DSH client bundle is dropped and re-executed on every page refresh, and a
 * refresh is the normal way to pick up a plugin update — so those happen often.
 * Keeping the picks in plain module state meant a toggle flipped to 不结合上下文
 * silently came back on at the next reload, which reads as "it ignored me".
 * The storage is a best-effort cache: a browser that refuses `localStorage`
 * (private mode, a sandboxed frame) simply behaves as before, per session.
 */
const STORAGE_KEY = 'dsh-prompt-enhance:overrides:v1'

/** Oldest sessions are dropped past this, so the blob cannot grow forever. */
const MAX_ENTRIES = 64

interface StoredOverrides {
  readonly tier?: Record<string, unknown>
  readonly context?: Record<string, unknown>
}

function storageOf(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    // Access itself can throw when storage is blocked by policy.
    return undefined
  }
}

function hydrate(): void {
  const store = storageOf()
  if (store === undefined) return
  let parsed: StoredOverrides
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return
    parsed = JSON.parse(raw) as StoredOverrides
  } catch {
    // A corrupt or foreign blob is not worth failing the composer over.
    return
  }
  for (const [sessionId, value] of Object.entries(parsed.tier ?? {})) {
    tierOverrides.set(sessionId, normalizeTier(value, DEFAULT_TIER))
  }
  for (const [sessionId, value] of Object.entries(parsed.context ?? {})) {
    if (typeof value === 'boolean') contextOverrides.set(sessionId, value)
  }
}

function persist(): void {
  const store = storageOf()
  if (store === undefined) return
  const blob: StoredOverrides = {
    tier: Object.fromEntries(tierOverrides),
    context: Object.fromEntries(contextOverrides),
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(blob))
  } catch {
    // Quota or a blocked store: the in-memory picks still hold for this page.
  }
}

/** Keep the newest `MAX_ENTRIES` keys of one override map. */
function prune(map: Map<string, unknown>): void {
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next()
    if (oldest.done === true) return
    map.delete(oldest.value)
  }
}

hydrate()

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
 *
 * The plugin-level 上下文感知 switch is a master switch: while it is off the
 * host ignores every per-call value, so the toggle reports off instead of
 * showing a state the next request will not honour.
 * @param sessionId - the composer's session key.
 * @returns true when the next call may ground itself in recent history.
 */
export function effectiveUseContext(sessionId: string): boolean {
  if (!getClientSettings().contextAware) return false
  const tier = effectiveTier(sessionId)
  // 基础档 is a local tidy-up: its rules forbid expansion, and history is the
  // main source of expansion. The host refuses context for it regardless, so
  // reporting an override here would show a toggle the next call ignores.
  if (!tierAllowsContext(tier)) return false
  const override = contextOverrides.get(sessionId)
  if (override !== undefined) return override
  return TIER_CONTEXT_PRESET[tier].useContext
}

/**
 * Whether this tier can use context at all.
 * @param tier - the tier to ask about.
 * @returns false for tiers whose rules leave no room for supplied history.
 */
export function tierAllowsContext(tier: Tier): boolean {
  return TIER_CONTEXT_PRESET[tier].useContext
}

/**
 * Select a tier for this session. Clears the session's explicit context
 * choice so the new tier's preset takes over (the toggle stays directly
 * overridable afterwards).
 * @param sessionId - the composer's session key.
 * @param tier - the tier to use from now on in this conversation.
 */
export function selectTier(sessionId: string, tier: Tier): void {
  // Re-inserting moves the key to the tail, so `prune` drops the least recently
  // touched sessions rather than an arbitrary one.
  tierOverrides.delete(sessionId)
  tierOverrides.set(sessionId, tier)
  contextOverrides.delete(sessionId)
  prune(tierOverrides)
  persist()
  notify()
}

/**
 * Pin the context toggle for this session.
 * @param sessionId - the composer's session key.
 * @param value - whether history may ground the next call.
 */
export function selectUseContext(sessionId: string, value: boolean): void {
  contextOverrides.delete(sessionId)
  contextOverrides.set(sessionId, value)
  prune(contextOverrides)
  persist()
  notify()
}

/**
 * Drop every per-session choice so all composers fall back to the persisted
 * default and its context presets.
 *
 * This is a reset primitive, not a reaction to the default changing: an
 * explicit per-session pick stays valid when the operator edits `defaultTier`
 * elsewhere, and silently discarding it would undo a choice the user can still
 * see on screen. It also wipes the stored blob, otherwise the reset would only
 * last until the next refresh.
 */
export function clearOverrides(): void {
  tierOverrides.clear()
  contextOverrides.clear()
  persist()
  notify()
}

/**
 * Register the settings writer so the picker can persist a default tier.
 * Wired by the client entry once the settings scope binds; without it the
 * picker still works per session, the choice just does not persist.
 * @param writer - writes one field into the plugin settings section.
 */
export function registerTierPersist(writer: TierWriter | undefined): void {
  persistWriter = writer
  notify()
}

/** Writes one tier into the plugin settings section (the host owns the store). */
export type TierWriter = (tier: Tier) => Promise<void> | undefined

let persistWriter: TierWriter | undefined

/**
 * Whether a settings writer is bound, i.e. whether "设为默认档" can do anything.
 * The picker hides the action when it cannot persist, so the button never
 * promises a write that would silently be dropped.
 */
export function canPersistTier(): boolean {
  return persistWriter !== undefined
}

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
