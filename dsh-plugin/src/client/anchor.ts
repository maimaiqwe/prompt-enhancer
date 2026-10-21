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
