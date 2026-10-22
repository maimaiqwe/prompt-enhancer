/**
 * Tier selection state of the composer.
 *
 * Three layers, matching how the picker reads:
 * - the **persisted default** — one tier for every new conversation, stored in
 *   `localStorage` so it survives a reload whether or not the host settings
 *   document does, and written through to `settings.defaultTier` so the
 *   shortcut and `/enhance` agree;
 * - a **per-session pick** — clicking a tier without ticking 默认 only changes
 *   this conversation, and it is held in `sessionStorage`: a refresh keeps it
 *   (refreshes are routine) while closing DSH drops it, which is what "临时"
 *   means here;
 * - the **context toggle**, whose default comes from the current tier's preset
 *   and which can be pinned per session the same way.
 *
 * Why `sessionStorage` and not module state: a DSH client bundle is dropped and
 * re-executed on every refresh, so module state is not "session" state at all.
 * Why not `localStorage`: a temporary pick that outlives the app is no longer
 * temporary.
 * @module dsh-prompt-enhance/client/tier-store
 */

import { DEFAULT_TIER, normalizeTier, TIER_CONTEXT_PRESET, TIERS, type Tier } from '../tiers'
import { getClientSettings } from './settings'

/** Persisted default tier (survives closing DSH). */
const DEFAULT_KEY = 'dsh-prompt-enhance:default-tier:v1'

/** Persisted default context toggle (survives closing DSH). */
const DEFAULT_CONTEXT_KEY = 'dsh-prompt-enhance:default-context:v1'

/** Per-session picks (survive a refresh, drop when DSH closes). */
const SESSION_KEY = 'dsh-prompt-enhance:session-picks:v1'

/** The pre-storage blob, keyed by mount ids that changed on every reload. */
const LEGACY_KEY = 'dsh-prompt-enhance:overrides:v1'

/** Oldest sessions are dropped past this, so the blob cannot grow forever. */
const MAX_ENTRIES = 64

/** One session's picks; both fields absent means "follow the default". */
interface SessionPick {
  tier?: Tier
  context?: boolean
}

const picks = new Map<string, SessionPick>()

let defaultTier: Tier | undefined

/** Persisted default context toggle; absent means "follow the tier presets". */
let defaultContext: boolean | undefined

function storageOf(kind: 'local' | 'session'): Storage | undefined {
  try {
    const store = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage
    return store ?? undefined
  } catch {
    // Access itself can throw when storage is blocked by policy.
    return undefined
  }
}

function readJson<T>(store: Storage | undefined, key: string): T | undefined {
  if (store === undefined) return undefined
  try {
    const raw = store.getItem(key)
    if (raw === null || raw === '') return undefined
    return JSON.parse(raw) as T
  } catch {
    // A corrupt or foreign blob is not worth failing the composer over.
    return undefined
  }
}

function writeJson(store: Storage | undefined, key: string, value: unknown): void {
  if (store === undefined) return
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or a blocked store: the in-memory picks still hold for this page.
  }
}

/** Read both stores once at module load. */
function hydrate(): void {
  const local = storageOf('local')
  const stored = readJson<unknown>(local, DEFAULT_KEY)
  defaultTier = typeof stored === 'string' ? normalizeTier(stored, DEFAULT_TIER) : undefined
  const storedContext = readJson<unknown>(local, DEFAULT_CONTEXT_KEY)
  defaultContext = typeof storedContext === 'boolean' ? storedContext : undefined
  // The old blob was keyed by mount ids that change on every reload, so its
  // entries could never be matched again. Drop it rather than carry garbage.
  try {
    local?.removeItem(LEGACY_KEY)
  } catch {
    // Ignore: a store that refuses removal is a store we are not using anyway.
  }
  const entries = readJson<Record<string, unknown>>(storageOf('session'), SESSION_KEY)
  for (const [sessionId, value] of Object.entries(entries ?? {})) {
    if (value === null || typeof value !== 'object') continue
    const record = value as { tier?: unknown; context?: unknown }
    const pick: SessionPick = {}
    if (typeof record.tier === 'string') pick.tier = normalizeTier(record.tier, DEFAULT_TIER)
    if (typeof record.context === 'boolean') pick.context = record.context
    if (pick.tier !== undefined || pick.context !== undefined) picks.set(sessionId, pick)
  }
}

/** Write the per-session map back, dropping the least recently touched keys. */
function persistPicks(): void {
  while (picks.size > MAX_ENTRIES) {
    const oldest = picks.keys().next()
    if (oldest.done === true) break
    picks.delete(oldest.value)
  }
  writeJson(storageOf('session'), SESSION_KEY, Object.fromEntries(picks))
}

/**
 * Touch one session's pick. Re-inserting moves the key to the tail so the
 * eviction above drops the least recently used session, not an arbitrary one.
 */
function touch(sessionId: string, next: SessionPick): void {
  picks.delete(sessionId)
  if (next.tier !== undefined || next.context !== undefined) picks.set(sessionId, next)
  persistPicks()
  notify()
}

hydrate()

const listeners = new Set<() => void>()
let version = 0

/**
 * The tier a new conversation starts from.
 *
 * The stored value wins over the host setting: the host's settings document is
 * only known to be read at boot, and a default the client cannot confirm was
 * written is worse than one it owns.
 * @returns the persisted default tier.
 */
export function defaultTierOf(): Tier {
  if (defaultTier !== undefined) return defaultTier
  return normalizeTier(getClientSettings().defaultTier, DEFAULT_TIER)
}

/**
 * Whether `tier` is the one every new conversation starts from.
 * @param tier - the tier to test.
 * @returns true when it is the persisted default.
 */
export function isDefaultTier(tier: Tier): boolean {
  return defaultTierOf() === tier
}

/**
 * Whether this tier may be the default at all.
 *
 * 系统 is a whole system prompt: making it the default turns every later
 * enhancement — shortcut and `/enhance` included — into a persona rewrite. The
 * Windows hotkey layer refuses it for the same reason, and one rule that both
 * entrances follow beats two that disagree.
 * @param tier - the tier to test.
 * @returns true for 基础 / 标准 / 专业.
 */
export function tierCanBeDefault(tier: Tier): boolean {
  return tier !== 'system'
}

/**
 * The persisted default context toggle.
 *
 * A pinned default wins over the tier presets: the user has said "start every
 * conversation with history on/off" and per-tier seeding must not quietly
 * undo that. When nothing is pinned the presets decide, which keeps the
 * 基础-never-sees-history rule and the richer windows of 专业/系统 intact.
 * @returns the pinned default, or undefined to follow the tier presets.
 */
export function defaultContextOf(): boolean | undefined {
  return defaultContext
}

/**
 * Pin the context toggle as the default for every new conversation, or unpin
 * it so the tier presets decide again.
 * @param value - the default on/off state, or undefined to unpin.
 */
export function setDefaultContext(value: boolean | undefined): void {
  defaultContext = value
  if (value === undefined) {
    try {
      storageOf('local')?.removeItem(DEFAULT_CONTEXT_KEY)
    } catch {
      // A store that refuses removal is not one we can clean; the in-memory
      // unpin still holds for this page.
    }
  } else {
    writeJson(storageOf('local'), DEFAULT_CONTEXT_KEY, value)
  }
  notify()
}

/** The tier currently displayed and used for the next call in this session. */
export function effectiveTier(sessionId: string): Tier {
  return picks.get(sessionId)?.tier ?? defaultTierOf()
}

/**
 * This session's explicit context choice, when it made one.
 * @param sessionId - the composer's session key.
 * @returns the per-session on/off, or undefined when following the default.
 */
export function sessionContextPick(sessionId: string): boolean | undefined {
  return picks.get(sessionId)?.context
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
  // 基础档 only does a light tidy-up: its rules forbid expansion, and history
  // is the main source of expansion. The host refuses context for it
  // regardless, so reporting an override here would show a toggle the next call
  // ignores.
  if (!tierAllowsContext(tier)) return false
  const pick = picks.get(sessionId)?.context
  if (pick !== undefined) return pick
  // A pinned default (the context row's radio) outranks the tier presets.
  const pinned = defaultContextOf()
  if (pinned !== undefined) return pinned
  return TIER_CONTEXT_PRESET[tier].useContext
}

/**
 * The context state a fresh conversation would start with for this tier: the
 * pinned default when one exists, otherwise the tier's own preset.
 *
 * The UI needs this separately from {@link effectiveUseContext}: that one folds
 * in the session's temporary override, so using it to describe "the default"
 * would report the override back as the default and mislead the user.
 * @param tier - the tier to describe.
 * @returns the on/off a new conversation would get.
 */
export function effectiveDefaultContext(tier: Tier): boolean {
  const pinned = defaultContextOf()
  if (pinned !== undefined) return pinned
  return TIER_CONTEXT_PRESET[tier].useContext
}

/**
 * Whether this session carries a pick of its own, i.e. whether the capsule is
 * showing something other than the default.
 * @param sessionId - the composer's session key.
 * @returns true when a temporary pick is in force.
 */
export function hasSessionPick(sessionId: string): boolean {
  return picks.get(sessionId) !== undefined
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
 * Pick a tier for this session only. Clears the session's explicit context
 * choice so the new tier's preset — or the pinned context default when one
 * exists — takes over (the toggle stays directly overridable afterwards).
 * @param sessionId - the composer's session key.
 * @param tier - the tier to use from now on in this conversation.
 */
export function selectTier(sessionId: string, tier: Tier): void {
  touch(sessionId, { ...picks.get(sessionId), tier, context: undefined })
}

/**
 * Pin the context toggle for this session.
 * @param sessionId - the composer's session key.
 * @param value - whether history may ground the next call.
 */
export function selectUseContext(sessionId: string, value: boolean): void {
  touch(sessionId, { ...picks.get(sessionId), context: value })
}

/**
 * Make `tier` the default for every new conversation: store it here, and ask
 * the host to record it too so the shortcut and `/enhance` follow.
 *
 * The local write is authoritative and happens first: it is synchronous, it is
 * the one we can read back, and it is the one that makes the radio stay ticked
 * after a reload even when the settings service is absent or read-only.
 * @param tier - the tier to persist.
 * @returns false when the tier may not be a default (系统).
 */
export function setDefaultTier(tier: Tier): boolean {
  if (!tierCanBeDefault(tier)) return false
  defaultTier = tier
  writeJson(storageOf('local'), DEFAULT_KEY, tier)
  void persistWriter?.(tier)
  notify()
  return true
}

/**
 * Drop every per-session pick so all composers fall back to the default and its
 * context presets. This is a reset primitive, not a reaction to the default
 * changing: an explicit per-session pick stays valid when the default is edited
 * elsewhere, and silently discarding it would undo a choice the user can still
 * see on screen. It wipes the stored blob too, otherwise the reset would only
 * last until the next refresh.
 */
export function clearOverrides(): void {
  picks.clear()
  persistPicks()
  notify()
}

/**
 * Register the settings writer so a new default reaches the host config.
 * Wired by the client entry once the settings scope binds; without it the
 * default still persists locally, the shortcut just keeps the host value.
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
 * Whether a settings writer is bound. The picker no longer hides the default
 * radio when it is absent — the local store alone keeps the choice — but the
 * footer reports that the host copy was not updated.
 */
export function canPersistTier(): boolean {
  return persistWriter !== undefined
}

/** Every tier, in display order (re-exported so the picker has one source). */
export const TIER_ORDER: readonly Tier[] = TIERS

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
