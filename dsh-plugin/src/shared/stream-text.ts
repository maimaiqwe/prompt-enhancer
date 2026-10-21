/**
 * Incremental text normalization for the streaming display path.
 *
 * The final enhanced body is always produced by `normalizeOutput` over the
 * complete model output — this module never decides what the user applies.
 * It only decides what the panel may show WHILE the text is still arriving,
 * so an incremental view does not flash a code fence the final body will not
 * have. Two things are withheld until more text (or the end) resolves them:
 * a leading fence opener, and a trailing run of backticks that might turn out
 * to be a fence closer.
 * @module dsh-prompt-enhance/shared/stream-text
 */

/** One streaming display normalizer. */
export interface StreamTextNormalizer {
  /**
   * Feed the next raw chunk.
   * @param chunk - the newly arrived text.
   * @returns the text now safe to show (may be empty).
   */
  push(chunk: string): string
  /**
   * End the stream.
   * @returns any withheld text that survived the closing-fence check.
   */
  finish(): string
}

/**
 * A leading fence: optional spaces, three backticks, an optional language,
 * then the newline that ends the fence line. The newline is part of the match
 * on purpose — until it arrives the tail could still be ordinary content, and
 * releasing it early would show a stray blank line.
 */
const LEADING_FENCE = /^[ \t]*```[A-Za-z0-9_+-]*[ \t]*\r?\n/
/** Text that could still turn out to be a fence opener (short, no content yet). */
const POSSIBLE_FENCE_PREFIX = /^[ \t]*`{0,3}[A-Za-z0-9_+-]*$/
/** Longest possible fence mark; nothing longer needs to be withheld. */
const MAX_HELD_BACKTICKS = 3
/** Bound on how much of a fenceless prefix is held while a fence is still possible. */
const MAX_FENCE_PREFIX_LOOKAHEAD = 40

/** How many trailing backticks must be withheld as a possible fence closer. */
function heldBacktickCount(text: string): number {
  let count = 0
  for (let index = text.length - 1; index >= 0 && count < MAX_HELD_BACKTICKS; index--) {
    if (text[index] !== '`') break
    count++
  }
  return count
}

/**
 * Create one normalizer for a single stream.
 * @returns the normalizer; not reusable across streams.
 */
export function createStreamNormalizer(): StreamTextNormalizer {
  let buffer = ''
  let opened = false

  const stripLeadingFence = (): void => {
    if (opened) return
    const match = buffer.match(LEADING_FENCE)
    if (match !== null) {
      buffer = buffer.slice(match[0].length)
      opened = true
      return
    }
    // Still too early to tell: hold everything until real content arrives.
    if (POSSIBLE_FENCE_PREFIX.test(buffer) && buffer.length <= MAX_FENCE_PREFIX_LOOKAHEAD) return
    opened = true
  }

  const stripTrailingFence = (): string => {
    const rest = buffer.replace(/```[ \t]*$/, '')
    buffer = ''
    return rest
  }

  return {
    push(chunk: string): string {
      buffer += chunk
      stripLeadingFence()
      if (!opened) return ''
      const held = heldBacktickCount(buffer)
      if (held === buffer.length && held > 0) return ''
      let trimEnd = buffer.length - held
      // Withheld 3+ backticks: the line break before them belongs to the
      // (now-hidden) closing fence, not the body — hold it back too so the
      // display never flashes a stray blank line ahead of an unwritten closer.
      if (held >= MAX_HELD_BACKTICKS && trimEnd > 0 && buffer[trimEnd - 1] === '\n') {
        trimEnd--
      }
      const emit = buffer.slice(0, trimEnd)
      buffer = buffer.slice(trimEnd)
      return emit
    },
    finish(): string {
      // A stream that never produced prose may still be a fence prefix; run
      // the opener check once more before releasing whatever was withheld.
      const openerMatch = buffer.match(LEADING_FENCE)
      if (!opened && openerMatch !== null) buffer = buffer.slice(openerMatch[0].length)
      // Find a trailing fence close and strip it plus the line break before
      // it (that line break sat in `buffer` because `push` withheld it).
      const fenceMatch = buffer.match(/```[ \t]*$/)
      let rest = buffer
      if (fenceMatch !== null) {
        rest = buffer.slice(0, fenceMatch.index)
        if (rest.endsWith('\n')) rest = rest.slice(0, -1)
      }
      buffer = ''
      return rest
    },
  }
}
