// @vitest-environment jsdom
/**
 * Unit tests for the panel's anchor resolver.
 *
 * The composer card is not addressable by class (it belongs to the host), so
 * the resolver walks up from the ✨ button. These cases pin the two signals
 * that identify the card — a rounded border and containment of the editable
 * field — plus the fallbacks that keep the panel centred instead of guessing.
 * @module tests/anchor
 */

import { afterEach, describe, expect, it } from 'vitest'
import { resolveAttachBox, resolveComposerBox } from '../src/client/anchor'

/** Give an element a measured rect and a corner radius. */
function measure(element: HTMLElement, width: number, left = 0, top = 0): HTMLElement {
  element.style.borderTopLeftRadius = '12px'
  element.getBoundingClientRect = () => ({
    width,
    height: 48,
    left,
    top,
    right: left + width,
    bottom: top + 48,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as unknown as DOMRect
  return element
}

/** A rounded, unmeasured wrapper that only participates via its radius. */
function rounded(element: HTMLElement): HTMLElement {
  element.style.borderTopLeftRadius = '12px'
  return element
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('resolveAttachBox', () => {
  it('returns the card around the button and the editable field', () => {
    const page = measure(document.createElement('div'), 1600)
    const card = measure(document.createElement('div'), 760, 120, 600)
    const toolbar = measure(document.createElement('div'), 240, 600, 660)
    const button = measure(document.createElement('button'), 26, 820, 664)
    const textarea = document.createElement('textarea')
    document.body.append(page)
    page.append(card)
    card.append(textarea, toolbar)
    toolbar.append(button)

    expect(resolveAttachBox(button)).toEqual({ left: 120, width: 760, top: 600 })
  })

  it('falls back to the outermost rounded ancestor when there is no editable', () => {
    const page = measure(document.createElement('div'), 1600)
    const card = measure(document.createElement('div'), 700, 40, 300)
    const inner = measure(document.createElement('div'), 400, 60, 320)
    const button = measure(document.createElement('button'), 26, 400, 340)
    document.body.append(page)
    page.append(card)
    card.append(inner)
    inner.append(button)

    expect(resolveAttachBox(button)).toEqual({ left: 40, width: 700, top: 300 })
  })

  it('stops at the page shell instead of anchoring to it', () => {
    const shell = measure(document.createElement('div'), 1400)
    const button = measure(document.createElement('button'), 26, 800, 500)
    document.body.append(shell)
    shell.append(button)

    expect(resolveAttachBox(button)).toBeUndefined()
  })

  it('ignores ancestors without a corner radius', () => {
    const card = rounded(document.createElement('div'))
    const button = measure(document.createElement('button'), 26)
    document.body.append(card)
    card.append(button)

    expect(resolveAttachBox(button)).toBeUndefined()
  })

  it('returns undefined for a missing or detached anchor', () => {
    expect(resolveAttachBox(null)).toBeUndefined()
    const stray = measure(document.createElement('button'), 26)
    expect(resolveAttachBox(stray)).toBeUndefined()
  })
})

describe('resolveComposerBox', () => {
  /** Build a dock row beside a card, both inside one composer seat. */
  function seat(cardWidth: number, cardLeft: number): { row: HTMLElement; card: HTMLElement } {
    const shell = document.createElement('div')
    const region = document.createElement('div')
    const row = document.createElement('div')
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    measure(card, cardWidth, cardLeft, 700)
    region.append(row, card)
    shell.append(region)
    document.body.append(shell)
    return { row, card }
  }

  it('measures the card next to the dock row', () => {
    const { row } = seat(860, 120)
    expect(resolveComposerBox(row)).toEqual({ left: 120, width: 860, top: 700 })
  })

  it('prefers the nearest card in a multi-composer layout', () => {
    // Two seats mounted at once: the row must follow its own card, not the
    // first one in the document.
    const other = document.createElement('div')
    other.setAttribute('data-composer-card', '')
    measure(other, 500, 0, 100)
    document.body.append(other)
    const { row } = seat(860, 120)

    expect(resolveComposerBox(row)?.width).toBe(860)
  })

  it('ignores a card too narrow to be the composer', () => {
    const { row } = seat(120, 0)
    expect(resolveComposerBox(row)).toBeUndefined()
  })

  it('returns undefined when no card is mounted', () => {
    const shell = document.createElement('div')
    const row = document.createElement('div')
    shell.append(row)
    document.body.append(shell)
    expect(resolveComposerBox(row)).toBeUndefined()
    expect(resolveComposerBox(null)).toBeUndefined()
  })
})
