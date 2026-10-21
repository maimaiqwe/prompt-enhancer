/**
 * Skill-token recognition shared by the host and the composer.
 *
 * A Skill invocation is a `$name` reference (`$p`, `$prompt-enhancer`,
 * `$my_skill`). Both halves need to agree on what one looks like: the host
 * masks them before a rewrite so they survive verbatim, and the composer uses
 * the same shape to tell "a token with a request" from "a token and nothing
 * else". Keeping one definition here is what stops the two from drifting.
 * @module dsh-prompt-enhance/shared/skill-tokens
 */

/** A `$name` Skill invocation, single-match form: `$` not preceded by a word char or another `$`. */
const SKILL_TOKEN_ONE = /(?<![\w$])\$[A-Za-z][A-Za-z0-9_-]*/

/** A `$name` Skill invocation: `$` not preceded by a word char or another `$`. */
export const SKILL_TOKEN = /(?<![\w$])\$([A-Za-z][A-Za-z0-9_-]*)/g

/**
 * Whether the draft is nothing but Skill tokens and whitespace.
 *
 * Such a draft names a Skill but states no request, so there is nothing to
 * rewrite: the composer should ask for one instead of spending a call.
 *
 * An EMPTY draft is not this case — it has no token to protect and belongs to
 * the caller's own empty-input branch, which words the refusal differently.
 * @param text - draft text.
 * @returns true when at least one token is present and no natural language remains.
 */
export function onlySkillTokens(text: string): boolean {
  if (!SKILL_TOKEN_ONE.test(text)) return false
  return text.replace(SKILL_TOKEN, '').trim() === ''
}
