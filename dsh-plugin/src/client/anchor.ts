/**
 * Resolving the box the enhancement panel attaches to.
 *
 * The panel used to be a centred sheet over a scrim. Next to a composer that
 * is what a popup looks like when it is not related to what you were typing
 * in — so the panel now hangs directly above the input card, matching its
 * width and its left edge.
 *
 * The plugin cannot import the host's layout tokens: the composer slot is a
 * React seat, not a CSS context, and the card's class names are the host's
 * private business. So the box is measured from the DOM, starting at the ✨
 * button (which is inside the card) and walking up.
 *
 * "The card" is identified by two signals that a toolbar row does not have:
 * a rounded border and, above all, containing the editable field. The
 * outermost ancestor that still satisfies both is the composer card; anything
 * wider than MAX_WIDTH is page chrome, not the card.
 * @module dsh-prompt-enhance/client/anchor
 */

/** A measured composer box, in viewport coordinates. */
export interface AttachBox {
  /** Distance from the viewport's left edge to the box's left edge. */
  readonly left: number
  /** Box width in CSS pixels. */
  readonly width: number
  /** Distance from the viewport's top edge to the box's top edge. */
  readonly top: number
}

/** Narrower than this is a button bar, not the composer. */
const MIN_WIDTH = 280

/** Wider than this is the page shell, not the composer card. */
const MAX_WIDTH = 1200

/** Depth cap: a pathological host tree must not turn this into a loop. */
const MAX_DEPTH = 12

/** The editable field a composer card must contain. */
const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable=""]'

/**
 * Read the corner radius from the computed style.
 * @param element - the candidate container.
 * @returns the radius in pixels, or undefined when it is not a number.
 */
function radiusOf(element: HTMLElement): number | undefined {
  const view = element.ownerDocument.defaultView
  if (view === null) return undefined
  const raw = view.getComputedStyle(element).borderTopLeftRadius
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * The shell's stable marker for the input card. Documented by the skin layer as
 * "the official shell's stable card anchor" (unlike its hashed class names,
 * which are the host's private business).
 */
const CARD_SELECTOR = '[data-composer-card]'

/**
 * Find the composer card that owns a dock element.
 *
 * The dock slot is a SIBLING of the card, not its ancestor or descendant: the
 * host renders the seat as `composerStack > [dock slot rows..., card]`, so
 * walking up with `querySelector` alone never sees the card — it only searches
 * descendants, and the card lives in a subtree the row's ancestors do not
 * contain. At each level this therefore also checks the level's element itself
 * and its sibling subtrees before moving up; the first card found belongs to
 * the nearest seat shared by the row and the card, which keeps the right card
 * in a multi-session layout where several composers are mounted at once.
 * @param from - the dock row (or any node in the same composer seat).
 * @returns the card's box, or undefined when no card is mounted nearby.
 */
export function resolveComposerBox(from: HTMLElement | null): AttachBox | undefined {
  if (from === null || !from.isConnected) return undefined
  let node: HTMLElement | null = from.parentElement
  for (let depth = 0; node !== null && depth < MAX_DEPTH; depth++) {
    // The card may be a descendant of this level, a sibling of it, or the
    // level itself — all three happen across host versions.
    const candidates: (ParentNode | null)[] = [node, node.parentElement]
    for (const scope of candidates) {
      if (scope === null) continue
      const card = scope.querySelector<HTMLElement>(CARD_SELECTOR)
      if (card !== null) {
        const rect = card.getBoundingClientRect()
        if (rect.width >= MIN_WIDTH) {
          return { left: rect.left, width: rect.width, top: rect.top }
        }
      }
    }
    node = node.parentElement
  }
  // Hosts that render no marker at all fall back to the same signals the panel
  // anchor uses: the editable field's nearest wide, rounded ancestor. The dock
  // row is NOT inside the card, so this has to start from the editable itself
  // rather than from `from`.
  const doc = from.ownerDocument
  const editable = doc.querySelector<HTMLElement>(EDITABLE)
  if (editable !== null) {
    let fallback: HTMLElement | null = editable
    let best: AttachBox | undefined
    for (let depth = 0; fallback !== null && depth < MAX_DEPTH; depth++) {
      const rect = fallback.getBoundingClientRect()
      if (rect.width > MAX_WIDTH) break
      if (rect.width >= MIN_WIDTH && (radiusOf(fallback) ?? 0) > 0) {
        best = { left: rect.left, width: rect.width, top: rect.top }
      }
      fallback = fallback.parentElement
    }
    // The outermost qualifying ancestor is the card (the loop keeps the last
    // one before the width cap stops it).
    return best
  }
  return undefined
}

/**
 * Find the composer card that should anchor the panel.
 *
 * Returns the outermost rounded ancestor (within the width window) that
 * contains both the anchor button and the editable field. When the host
 * renders no editable field the plain rounded ancestor is used, and when no
 * ancestor qualifies at all the caller keeps the centred placement.
 * @param anchor - the ✨ button (or any node inside the composer).
 * @returns the measured box, or undefined when nothing qualifies.
 */
export function resolveAttachBox(anchor: HTMLElement | null): AttachBox | undefined {
  if (anchor === null || !anchor.isConnected) return undefined
  const doc = anchor.ownerDocument
  const editable = doc.querySelector<HTMLElement>(EDITABLE)
  let node: HTMLElement | null = anchor
  let rounded: AttachBox | undefined
  let withEditable: AttachBox | undefined
  for (let depth = 0; node !== null && depth < MAX_DEPTH; depth++) {
    const rect = node.getBoundingClientRect()
    if (rect.width > MAX_WIDTH) break
    if (rect.width >= MIN_WIDTH && (radiusOf(node) ?? 0) > 0) {
      const box: AttachBox = { left: rect.left, width: rect.width, top: rect.top }
      rounded = box
      if (editable !== null && node.contains(editable)) withEditable = box
    }
    node = node.parentElement
  }
  return withEditable ?? rounded
}
