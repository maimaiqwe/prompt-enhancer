/**
 * Client state of the iteration panel: the last enhanced text per composer
 * session (the fallback base) plus the panel's own panes, persisted per
 * session and invalidated the moment the composer draft changes — closing and
 * reopening the panel keeps what was typed only when the box still holds the
 * draft it was typed against.
 * @module dsh-prompt-enhance/client/iter-state
 */

const LAST_PREFIX = 'dsh-prompt-enhance:iter-last:v1:'
const PANEL_PREFIX = 'dsh-prompt-enhance:iter-panel:v2:'

/** Session storage behind try/catch: a blocked store degrades to "nothing saved". */
function read(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.sessionStorage?.setItem(key, value)
  } catch {
    // Policy-blocked or full storage: persistence is a convenience, never a gate.
  }
}

/**
 * Record the latest successful enhancement of one composer session.
 * @param key - the composer session key.
 * @param text - the enhanced text (applied or previewed).
 */
export function recordLastEnhanced(key: string, text: string): void {
  write(LAST_PREFIX + key, text)
}

/**
 * The last recorded enhancement of one composer session.
 * @param key - the composer session key.
 * @returns the text, or undefined when none was recorded.
 */
export function lastEnhancedOf(key: string): string | undefined {
  const value = read(LAST_PREFIX + key)
  return value !== null && value !== '' ? value : undefined
}

/** What the panel persists between open/close cycles. */
export interface IterPanelState {
  /** The editable base pane (may diverge from the draft once hand-edited). */
  base: string
  /** The requirement pane. */
  input: string
  /** The output pane. */
  output: string
  /** The composer draft the panes were typed against. */
  draft: string
}

/**
 * Save the panel contents together with the draft they were typed against.
 * @param key - the composer session key.
 * @param state - base, requirement, output, and the current composer draft.
 */
export function saveIterPanel(key: string, state: IterPanelState): void {
  write(PANEL_PREFIX + key, JSON.stringify(state))
}

/**
 * Restore the panel contents, but only against an unchanged draft.
 * @param key - the composer session key.
 * @param currentDraft - the composer draft at open time.
 * @returns the saved panes, or undefined when nothing was saved or the draft
 *   has changed since the save. `base` is optional: saves from the previous
 *   storage layout carry no base pane.
 */
export function loadIterPanel(key: string, currentDraft: string): { base?: string; input: string; output: string } | undefined {
  const raw = read(PANEL_PREFIX + key)
  if (raw === null) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<IterPanelState> | null
    if (parsed === null || typeof parsed !== 'object') return undefined
    if (parsed.draft !== currentDraft) return undefined
    if (typeof parsed.input !== 'string' || typeof parsed.output !== 'string') return undefined
    return {
      base: typeof parsed.base === 'string' ? parsed.base : undefined,
      input: parsed.input,
      output: parsed.output,
    }
  } catch {
    return undefined
  }
}

/**
 * Drop the persisted panel contents of one composer session.
 * @param key - the composer session key.
 */
export function clearIterPanel(key: string): void {
  try {
    globalThis.sessionStorage?.removeItem(PANEL_PREFIX + key)
  } catch {
    // Nothing to clean behind a blocked store.
  }
}
