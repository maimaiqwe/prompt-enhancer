/**
 * Strip literal constructs (linked skill references, URLs, local paths) and
 * bare skill tokens into placeholder anchors before the draft reaches the
 * model, then restore them verbatim. A placeholder the model dropped is
 * appended back instead of failing the rewrite — the model never sees the
 * content, so it cannot lose it.
 * @module dsh-prompt-enhance-cn/shared/literal-guard
 */

const URL_RE = /https?:\/\/[^\s<>'"`]+/g
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const WIN_PATH_RE = /[A-Za-z]:[\\/](?:[^\s<>'"`]+[\\/])*[^\s<>'"`]+/g
const UNIX_PATH_RE = /(?<![\w/])\/(?:[^\s<>'"`/]+\/)*[^\s<>'"`/]+/g
const FILENAME_RE = /(?<![\w./\\-])[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown|py|ts|tsx|js|mjs|cjs|json|yml|yaml|toml|ini|cfg|conf|txt|log|ps1|cmd|bat|sh|exe|dll|cs|java|xml|csv|sql|html|htm|css|scss|png|jpe?g|gif|svg|ico|zip|tar|gz|tgz|7z|pdf|docx?|xlsx?|pptx?)\b/gi
const SKILL_LINK_RE = /\[\$[A-Za-z][A-Za-z0-9_-]*\]\([^()\s]{1,400}\)/g
const SKILL_TOKEN_RE = /(?<![\w$])\$[A-Za-z][A-Za-z0-9_-]*/g
const SKILL_ANCHOR_RE = /__PO_SKILL_(\d{4})_[A-Za-z0-9_]+__/g
const LIT_ANCHOR_RE = /__PO_LIT_(\d{4})__/g

export interface DraftGuard {
  litItems: string[]
  skillTokens: string[]
}

const pad4 = (n: number): string => String(n).padStart(4, '0')

const skillAnchor = (index: number, token: string): string =>
  `__PO_SKILL_${pad4(index + 1)}_${token.slice(1).replace(/[^A-Za-z0-9]/g, '_')}__`

/**
 * Replace everything the model must not rewrite with short anchors.
 * @param text - the raw draft.
 * @returns the guarded text plus the guard state {@link restoreResult} needs.
 */
export function protectDraft(text: string): { guarded: string; guard: DraftGuard } {
  const guard: DraftGuard = { litItems: [], skillTokens: [] }
  const keepLit = (match: string): string => {
    guard.litItems.push(match)
    return `__PO_LIT_${pad4(guard.litItems.length)}__`
  }
  let guarded = text.replace(SKILL_LINK_RE, keepLit)
  guarded = guarded.replace(URL_RE, keepLit)
  guarded = guarded.replace(EMAIL_RE, keepLit)
  guarded = guarded.replace(WIN_PATH_RE, keepLit)
  guarded = guarded.replace(UNIX_PATH_RE, keepLit)
  guarded = guarded.replace(FILENAME_RE, keepLit)
  guarded = guarded.replace(SKILL_TOKEN_RE, (match) => {
    guard.skillTokens.push(match)
    return skillAnchor(guard.skillTokens.length - 1, match)
  })
  return { guarded, guard }
}

/**
 * Turn anchors back into their originals. Missing anchors are appended at
 * the end (placeholder form first, mapped below) rather than reported.
 * @param text - the model output after normalization.
 * @param guard - the state from {@link protectDraft}.
 * @returns the text with every literal restored exactly once.
 */
export function restoreResult(text: string, guard: DraftGuard): string {
  const missing: string[] = []
  guard.skillTokens.forEach((token, i) => {
    const anchor = skillAnchor(i, token)
    if (!text.includes(anchor)) missing.push(anchor)
  })
  guard.litItems.forEach((item, i) => {
    const anchor = `__PO_LIT_${pad4(i + 1)}__`
    if (!text.includes(anchor)) missing.push(anchor)
  })
  let out = missing.length > 0 ? `${text.replace(/\s+$/, '')}\n${missing.join('\n')}` : text
  out = out.replace(SKILL_ANCHOR_RE, (anchor) => guard.skillTokens[Number(anchor.slice(11, 15)) - 1] ?? '')
  out = out.replace(LIT_ANCHOR_RE, (anchor) => guard.litItems[Number(anchor.slice(9, 13)) - 1] ?? '')
  return out.replace(/\s+$/, '')
}
