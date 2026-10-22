/**
 * Pure input text checks shared by the host route and the browser half, so
 * the button can refuse locally with the exact verdict the host would send.
 * Messages are locale-owned: this module returns structured verdicts, the
 * host formats them in Chinese, the client passes them through its `t` seat.
 * @module dsh-prompt-enhance/shared/validate
 */

/** Verdict of one input check. */
export type InputCheck =
  | { ok: true }
  | { ok: false; code: 'empty' }
  | { ok: false; code: 'too-long'; count: number; max: number }

/**
 * Zero-width and bidi control code points stripped before emptiness checks.
 * The previous regex `/[\u200B-\u200D…]/g` scanned the WHOLE text on every
 * call; for a 12 k-character draft that is a 12 k-element regex engine run,
 * plus the `[...text].length` array spread in `countText` (another 12 k
 * allocations). Both are now folded into a single code-point walk that
 * counts AND filters at the same time — one pass, zero intermediate
 * strings, zero arrays. Equivalent semantics: invisible code points do not
 * count toward the emptiness check, every code point (invisible or not)
 * counts toward the cap (the cap is the user-facing "characters" count).
 */
function isInvisibleCodePoint(cp: number): boolean {
  return (cp >= 0x200B && cp <= 0x200D)
    || cp === 0xFEFF
    || (cp >= 0x202A && cp <= 0x202E)
    || (cp >= 0x2066 && cp <= 0x2069)
}

/**
 * One pass over the text: count code points (the user-facing "characters"
 * count, shared by validation / error copy / host logs) and detect whether
 * any non-invisible, non-whitespace content exists. An emoji or a composed
 * character is one character, so every layer counts it the same way; mixing
 * this with the UTF-16 code-unit count of `String.length` makes a user-visible
 * number disagree with the logged one.
 * @param text - the text to measure.
 * @returns the code-point count and whether any visible content was seen.
 */
function scanText(text: string): { count: number; visibleNonBlank: boolean } {
  let count = 0
  let visibleNonBlank = false
  for (const ch of text) {
    count++
    const code = ch.codePointAt(0) ?? 0
    if (!isInvisibleCodePoint(code) && !/\s/.test(ch)) visibleNonBlank = true
  }
  return { count, visibleNonBlank }
}

/**
 * Count one text in Unicode code points — the single length gauge shared by
 * validation, error messages, and host logs. An emoji or a composed character
 * is one character to the user, so every layer counts it the same way; mixing
 * this with the UTF-16 code-unit count of `String.length` makes a user-visible
 * number disagree with the logged one.
 * @param text - the text to measure.
 * @returns the code-point count.
 */
export function countText(text: string): number {
  let n = 0
  // `for (const _ of text)` iterates code points, not UTF-16 units — exactly
  // the gauge the user perceives as "characters" (emoji = 1, not 2).
  for (const _ of text) n++
  return n
}

/**
 * Judge one draft text: non-empty after stripping invisible characters and
 * trimming whitespace, and within the configured character cap. The whole
 * check is one code-point walk (see {@link scanText}); length is measured in
 * Unicode code points — matching user perception — so an emoji is one
 * character, not two UTF-16 units. Over-length input is rejected, never
 * truncated — truncation would change the user's meaning.
 * @param text - the raw draft text.
 * @param maxChars - the configured character cap (in code points).
 * @returns the structured verdict.
 */
export function checkInputText(text: string, maxChars: number): InputCheck {
  const { count, visibleNonBlank } = scanText(text)
  if (!visibleNonBlank) {
    return { ok: false, code: 'empty' }
  }
  if (count > maxChars) {
    return { ok: false, code: 'too-long', count, max: maxChars }
  }
  return { ok: true }
}

/**
 * Render one verdict as the displayable Chinese message (host-side copy).
 * @param check - the structured verdict.
 * @returns the message; empty string for a passing check.
 */
export function formatInputCheckZh(check: InputCheck): string {
  if (check.ok) return ''
  if (check.code === 'empty') return '输入框为空，请先输入要增强的提示词。'
  return `内容共 ${check.count} 个字符，超过 ${check.max} 个字符上限（按 Unicode 字符数统计，不是 token 数）。为避免改变原意不会自动截断，请精简后再试。`
}