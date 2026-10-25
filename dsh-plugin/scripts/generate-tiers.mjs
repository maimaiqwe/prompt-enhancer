/**
 * Generate `src/generated/tier-rules.ts` from `../core/rules.md`.
 *
 * `core/rules.md` is the single shared source of prompt rules: the Windows
 * hotkey layer reads it at runtime, this plugin cannot (bundled client code has
 * no filesystem), so its sections are inlined at build time instead. Editing
 * the rules means editing `core/rules.md` and re-running this script — never
 * editing the generated file.
 *
 * Usage: `node scripts/generate-tiers.mjs` (write) or `--check` (verify the
 * committed file matches the rules file; exit 1 when stale).
 * @module scripts/generate-tiers
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(root, '..', 'core', 'rules.md')
const targetPath = join(root, 'src', 'generated', 'tier-rules.ts')

/** Sections composed into per-tier system prompts, in rules-file order. */
const SECTIONS = ['COMMON', 'BASE', 'STANDARD', 'PROFESSIONAL', 'SYSTEM', 'ITERATE']

/**
 * Split the rules file into its `## [NAME]` sections.
 * @param markdown - the rules file contents.
 * @returns section name → section body (heading excluded, trimmed).
 */
function parseSections(markdown) {
  const lines = markdown.split(/\r?\n/)
  const sections = new Map()
  let current
  let buffer = []
  const flush = () => {
    if (current !== undefined) sections.set(current, buffer.join('\n').trim())
    buffer = []
  }
  for (const line of lines) {
    const heading = /^##\s+\[([A-Z]+)\]\s*$/.exec(line)
    if (heading !== null) {
      flush()
      current = heading[1]
      continue
    }
    if (current !== undefined) buffer.push(line)
  }
  flush()
  return sections
}

/**
 * Escape a section body for a template literal.
 * @param text - raw section body.
 * @returns the body with backslashes, backticks and `${` neutralized.
 */
function escapeTemplate(text) {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

/**
 * Render the generated module.
 * @param sections - parsed rules-file sections.
 * @returns the TypeScript source.
 */
function render(sections) {
  const blocks = SECTIONS.map((name) => {
    const body = sections.get(name)
    if (body === undefined || body === '') {
      throw new Error(`core/rules.md is missing the [${name}] section`)
    }
    return `  /** \`[${name}]\` — ${body.split('\n')[0]?.replace(/^#+\s*/, '') ?? ''} */\n  ${name}: \`${escapeTemplate(body)}\`,`
  })
  return [
    '/**',
    ' * Prompt rules inlined from `core/rules.md`.',
    ' *',
    ' * GENERATED FILE — do not edit. Run `npm run gen:tiers` after changing',
    ' * `core/rules.md` (the shared rules file the Windows hotkey layer also reads).',
    ' * @module dsh-prompt-enhance/generated/tier-rules',
    ' */',
    '',
    '/** The rules sections, heading excluded and body trimmed. */',
    'export const RULE_SECTIONS = {',
    ...blocks,
    '} as const',
    '',
    '/** Sections present in the rules file; guards accidental renames. */',
    `export type RuleSection = keyof typeof RULE_SECTIONS`,
    '',
  ].join('\n')
}

const markdown = await readFile(sourcePath, 'utf8')
const rendered = render(parseSections(markdown))
const check = process.argv.includes('--check')

if (check) {
  let existing = ''
  try {
    existing = await readFile(targetPath, 'utf8')
  } catch {
    existing = ''
  }
  if (existing !== rendered) {
    console.error('src/generated/tier-rules.ts is stale — run: npm run gen:tiers')
    process.exit(1)
  }
  console.log('src/generated/tier-rules.ts is up to date')
} else {
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, rendered, 'utf8')
  console.log(`wrote src/generated/tier-rules.ts (${rendered.length} bytes)`)
}
