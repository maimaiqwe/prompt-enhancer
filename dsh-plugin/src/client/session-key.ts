/**
 * Stable per-composer session key for client UI state.
 *
 * Three hosts, three places the real id can hide:
 * - dsh 0.1.1-rc: `props.sessionId` on the standard kit;
 * - dsh 0.1.2-rc+: that field is gone, but every composer slot receives the
 *   conversation snapshot as an owner prop, and `snapshot.sessionId` is the
 *   authoritative host id;
 * - a defensive third case: neither is present, so we mint a per-zone fallback
 *   anchored on `inputActions` (the same object is handed to every slot of one
 *   input zone, so the ✨ button and the undo bar agree on one key).
 *
 * The middle case matters more than it looks: the fallback id is minted fresh
 * on every page load, so anything keyed by it — a per-session tier pick, a
 * context toggle — is silently forgotten by the next refresh. Reading the
 * snapshot id is what makes "临时档位 stays until DSH closes" actually true.
 *
 * The server route receives the REAL id only when the host provides it;
 * otherwise it degrades to the harness default model (`sessionRouteOf`
 * undefined branch), which is the documented fallback.
 * @module dsh-prompt-enhance/client/session-key
 */

import { useRef } from 'react'

/** Monotonic source for fallback ids (module-scoped, never reset). */
let fallbackSeq = 0

/** Fallback id per input zone, keyed by the host's stable per-Session actions. */
const zoneKeys = new WeakMap<object, string>()

/** The shape we read the real id from; every field is optional on purpose. */
export interface SessionIdSources {
  /** dsh 0.1.1-rc standard kit field. */
  sessionId?: unknown
  /** Composer owner prop: `ConversationSnapshot`. */
  session?: { sessionId?: unknown } | undefined
}

/**
 * Pick the real host session id out of the several places it may live.
 * @param sources - the props an input slot received.
 * @returns the id, or `undefined` when this host does not expose one.
 */
export function hostSessionIdOf(sources: SessionIdSources): string | undefined {
  const fromSnapshot = sources.session?.sessionId
  if (typeof fromSnapshot === 'string' && fromSnapshot !== '') return fromSnapshot
  const direct = sources.sessionId
  if (typeof direct === 'string' && direct !== '') return direct
  return undefined
}

/**
 * Mint (or reuse) the fallback id of one input zone.
 * @param share - the host's `inputActions`; absent only in defensive cases.
 * @returns a stable id shared by every slot of that zone.
 */
function fallbackKeyOf(share: object | undefined): string {
  if (share === undefined) return `pe:mount:${++fallbackSeq}`
  const known = zoneKeys.get(share)
  if (known !== undefined) return known
  const minted = `pe:zone:${++fallbackSeq}`
  zoneKeys.set(share, minted)
  return minted
}

/**
 * Resolve the id used to key client UI state for one mounted composer.
 * @param sources - the props an input slot received (snapshot + legacy field).
 * @param share - the host's `inputActions`, the per-zone anchor for the fallback.
 * @returns the host id when present, otherwise a stable per-zone fallback id.
 */
export function useSessionKey(sources: SessionIdSources, share?: object): string {
  const real = hostSessionIdOf(sources)
  const fallback = useRef<string | undefined>(undefined)
  if (real !== undefined) return real
  if (fallback.current === undefined) fallback.current = fallbackKeyOf(share)
  return fallback.current
}

/**
 * The id to send to the host route. Real when the host provides it; otherwise
 * `undefined` so the server falls back to the harness default model route.
 * @param sources - the props an input slot received.
 * @returns the id to wire, or `undefined` when unknown.
 */
export function serverSessionId(sources: SessionIdSources): string | undefined {
  return hostSessionIdOf(sources)
}
