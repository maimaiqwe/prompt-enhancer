/**
 * Deterministic local rewriting — a standalone utility, no longer wired to any
 * tier.
 *
 * History: the 基础 (base) tier used to run this pipeline so it could tidy a
 * draft with no model call (offline, free, unable to invent requirements). That
 * promise only held for whitespace and two verbal tics — it could not fix a
 * broken sentence, a missing subject, or tangled connectives, which is exactly
 * what "理顺语序" means. The base tier now calls the model under a tight
 * light-tidy-up rule set instead, and nothing in the plugin calls this module.
 * It is kept (and exported) as a pure helper for callers that want a lossless
 * whitespace/punctuation pass with Skill tokens and code preserved.
 *
 * The pipeline:
 *
 *   1. protect `$skill-name` invocations behind `__PO_SKILL_0001__` placeholders;
 *   2. protect fenced blocks and inline code behind `__PO_BASE_CODE_0001__`;
 *   3. normalise whitespace, keep structural lines (headings, list items,
 *      tables, rules, block quotes) byte-stable apart from trailing spaces;
 *   4. fix two verbal tics and add terminal punctuation;
 *   5. restore code, then restore Skill tokens.
 *
 * Everything here is pure and synchronous: no model, no network, no clock.
 * @module dsh-prompt-enhance/local-rewrite
 */

import { onlySkillTokens, SKILL_TOKEN } from './shared/skill-tokens'

/** Placeholder written in place of a protected Skill token. */
const SKILL_PLACEHOLDER = /__PO_SKILL_(\d{4})_[A-Za-z0-9_]+__/g
/** Placeholder written in place of protected code. */
const CODE_PLACEHOLDER = /__PO_BASE_CODE_(\d{4})__/g

/**
 * Lines whose leading whitespace is meaningful. They keep their own layout and
 * only lose trailing spaces; everything else is trimmed and squeezed.
 */
const STRUCTURAL_LINE = /^[ \t]*(?:#{1,6}[ \t]+|[-+*][ \t]+|\d+[.)][ \t]+|>|\||[-*_]{3,}[ \t]*$|_{3,}[ \t]*$)/

/** Visual tics the base pass normalises, applied to the whole text. */
const TIC_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['咋', '怎么'],
  ['啥', '什么'],
]

/** Replacement for a leading 帮我 so the rewritten draft reads as a request. */
const LEADING_ASK = /^( *)帮我/

/**
 * Replace `$skill-name` invocations with placeholders.
 * @param text - draft text, unmodified.
 * @returns the masked text plus the original tokens, in order.
 */
export function protectSkillTokens(text: string): { text: string; tokens: string[] } {
  const tokens: string[] = []
  const masked = text.replace(SKILL_TOKEN, (whole: string, name: string) => {
    tokens.push(whole)
    const safe = name.replace(/[^A-Za-z0-9]/g, '_')
    return `__PO_SKILL_${String(tokens.length).padStart(4, '0')}_${safe}__`
  })
  return { text: masked, tokens }
}

/**
 * Put the original `$skill-name` invocations back.
 * @param text - masked text.
 * @param tokens - tokens captured by {@link protectSkillTokens}.
 * @returns text with every placeholder restored.
 */
export function restoreSkillTokens(text: string, tokens: readonly string[]): string {
  return text.replace(SKILL_PLACEHOLDER, (whole: string, index: string) => {
    const slot = Number.parseInt(index, 10) - 1
    return slot >= 0 && slot < tokens.length ? (tokens[slot] as string) : whole
  })
}

/**
 * Whether the draft is nothing but Skill tokens and whitespace.
 * @param text - draft text.
 * @returns true when no natural language remains.
 * @deprecated Import {@link onlySkillTokens} from `./shared/skill-tokens` instead.
 */
export { onlySkillTokens }

/**
 * Mask fenced code blocks so the tidier never touches their interior.
 * @param text - text already masked by {@link protectSkillTokens}.
 * @param tokens - accumulator, appended in document order.
 * @returns text with fenced blocks replaced by placeholders.
 */
function protectFences(text: string, tokens: string[]): string {
  const lines = text.split(/(?<=\n)/)
  const out: string[] = []
  let plain: string[] = []
  let index = 0
  const flush = (): void => {
    if (plain.length > 0) {
      out.push(protectInline(plain.join(''), tokens))
      plain = []
    }
  }
  while (index < lines.length) {
    const line = lines[index] as string
    const stripped = line.replace(/^[ \t]+/, '')
    const marker = stripped.charAt(0)
    let run = 0
    while (run < stripped.length && stripped.charAt(run) === marker && (marker === '`' || marker === '~')) {
      run += 1
    }
    if (run < 3) {
      plain.push(line)
      index += 1
      continue
    }
    flush()
    const fence = marker.repeat(run)
    const start = index
    index += 1
    while (index < lines.length) {
      const closeText = (lines[index] as string).trim()
      if (closeText.length >= run && closeText === fence.repeat(closeText.length / run)) {
        index += 1
        break
      }
      index += 1
    }
    let block = lines.slice(start, index).join('')
    let suffix = ''
    if (block.endsWith('\r\n')) {
      block = block.slice(0, -2)
      suffix = '\r\n'
    } else if (block.endsWith('\n')) {
      block = block.slice(0, -1)
      suffix = '\n'
    }
    tokens.push(block)
    out.push(`__PO_BASE_CODE_${String(tokens.length).padStart(4, '0')}__${suffix}`)
  }
  flush()
  return out.join('')
}

/**
 * Mask inline code spans. A span whose closing run is missing, or that would
 * cross a newline, is left alone — that is markdown-legal literal text, not code.
 * @param text - text to scan.
 * @param tokens - accumulator, appended in document order.
 * @returns text with inline code replaced by placeholders.
 */
function protectInline(text: string, tokens: string[]): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    if (text.charAt(index) !== '`') {
      out += text.charAt(index)
      index += 1
      continue
    }
    let runEnd = index
    while (runEnd < text.length && text.charAt(runEnd) === '`') runEnd += 1
    const ticks = text.slice(index, runEnd)
    const closing = text.indexOf(ticks, runEnd)
    const newline = text.indexOf('\n', runEnd)
    if (closing < 0 || (newline >= 0 && closing > newline)) {
      out += ticks
      index = runEnd
      continue
    }
    tokens.push(text.slice(index, closing + ticks.length))
    out += `__PO_BASE_CODE_${String(tokens.length).padStart(4, '0')}__`
    index = closing + ticks.length
  }
  return out
}

/**
 * Give the last natural-language line an ending, so a tidied draft reads as a
 * finished sentence rather than a fragment. Structural lines and trailing code
 * placeholders are left untouched.
 * @param text - text whose whitespace is already normalised.
 * @returns the same text, possibly with one added punctuation mark.
 */
function finalizePunctuation(text: string): string {
  const lines = text.split('\n')
  const marks = '。！？!?；;：:'
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string
    const stripped = line.trim()
    if (stripped === '') {
      if (index === lines.length - 1) return lines.join('\n')
      continue
    }
    if (STRUCTURAL_LINE.test(line) || stripped.startsWith('__PO_BASE_CODE_')) return lines.join('\n')
    if (!marks.includes(stripped.charAt(stripped.length - 1))) lines[index] = `${line}。`
    return lines.join('\n')
  }
  return lines.join('\n')
}

/**
 * Tidy text whose Skill tokens and code are already masked.
 * @param text - masked draft.
 * @returns the tidied masked draft.
 */
function tidyMasked(text: string): string {
  const lines = text.trim().split('\n')
  const cleaned = lines.map((line: string): string => {
    if (line.trim() === '') return ''
    if (/^[ \t]*\|/.test(line)) return line.replace(/[ \t]+$/, '')
    if (STRUCTURAL_LINE.test(line)) return line.replace(/[ \t]+$/, '')
    return line.trim().replace(/[ \t]+/g, ' ')
  })
  let out = cleaned.join('\n').trim()
  out = out.replace(LEADING_ASK, '$1请帮我')
  for (const [from, to] of TIC_REPLACEMENTS) out = out.split(from).join(to)
  return finalizePunctuation(out)
}

/**
 * Run the whole deterministic base pass.
 *
 * Idempotent: running it twice returns the same text, so pressing ✨ again on
 * an already-tidied draft is harmless.
 * @param text - raw draft text.
 * @returns the tidied draft, with Skill tokens and code restored verbatim.
 */
export function rewriteLocally(text: string): string {
  const skills = protectSkillTokens(text)
  const codeTokens: string[] = []
  const masked = protectFences(skills.text, codeTokens)
  const tidied = tidyMasked(masked)
  const withCode = tidied.replace(CODE_PLACEHOLDER, (whole: string, index: string) => {
    const slot = Number.parseInt(index, 10) - 1
    return slot >= 0 && slot < codeTokens.length ? (codeTokens[slot] as string) : whole
  })
  return restoreSkillTokens(withCode, skills.tokens)
}
