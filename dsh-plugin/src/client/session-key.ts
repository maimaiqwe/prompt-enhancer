/**
 * Stable per-composer session key for client UI state, with a dual-host
 * compatibility shim between dsh 0.1.1-rc.2 and 0.1.2-rc.1.
 *
 * The input slot owner share (`SessionStandardProps`) carried a `sessionId`
 * field on the 0.1.1-rc line, which this plugin used to key its panel, undo
 * stack, and shortcut target. The 0.1.2-rc line dropped that field from the
 * standard kit (the snapshot hooks `useConversation`/`useInput`/`inputActions`
 * remain) — so `props.sessionId` is simply absent at runtime there.
 *
 * The browser half must still key its module-level state per mounted composer,
 * so when the host id is missing we mint a stable fallback id. That id is
 * anchored on the host's `inputActions` — the SAME object is handed to every
 * slot of one input zone, so the button (conversation.input.right) and the
 * undo bar (conversation.input.dock), which are separate component trees,
 * agree on one key. (Keying per component instead would give the two halves
 * different ids and the undo bar would silently never appear.)
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
 * @param maybeSessionId - the host-provided `sessionId` prop; `undefined` on 0.1.2-rc.1.
 * @param share - the host's `inputActions`, the per-zone anchor for the fallback.
 * @returns the host id when present, otherwise a stable per-zone fallback id.
 */
export function useSessionKey(maybeSessionId: string | undefined, share?: object): string {
  // The fallback is minted lazily: the 0.1.1-rc line never needs one.
  const fallback = useRef<string | undefined>(undefined)
  if (maybeSessionId !== undefined && maybeSessionId !== '') return maybeSessionId
  if (fallback.current === undefined) fallback.current = fallbackKeyOf(share)
  return fallback.current
}

/**
 * The id to send to the host route. Real when the host provides it; otherwise
 * `undefined` so the server falls back to the harness default model route.
 * @param maybeSessionId - the host-provided `sessionId` prop.
 * @returns the id to wire, or `undefined` when unknown.
 */
export function serverSessionId(maybeSessionId: string | undefined): string | undefined {
  return maybeSessionId !== undefined && maybeSessionId !== '' ? maybeSessionId : undefined
}
