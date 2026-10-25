/**
 * One-command acceptance check for the hand-copied dsh-prompt-enhance-cn
 * deployment — the exact flow a manual 复验 used to do step by step:
 *
 *   1. the profile's lib/index.js and lib/client.js match the repo build;
 *   2. the escaped-CJK markers prove the deployed bundles carry the newest
 *      rule text and client UI (esbuild escapes CJK, so a raw-text grep would
 *      miss content that is actually there);
 *   3. the four rules.md copies (repo core + the skill/hotkey consumers) are
 *      byte-identical;
 *   4. the git worktree is clean, so what was verified is what was committed.
 *
 * Usage:
 *   node scripts/verify-deploy.mjs                  # default paths below
 *   node scripts/verify-deploy.mjs <profile-dir>    # explicit profile directory
 *
 * Exits 1 on any problem.
 *
 * @module scripts/verify-deploy
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const DEFAULT_PROFILE =
  process.env.DSH_PROFILE_DIR ??
  'E:/aaaWorkspace/WorkSpace/dsh/.dsh/profiles/desktop'

const profile = resolve(process.argv[2] ?? DEFAULT_PROFILE)
const pkg = join(profile, 'node_modules', 'dsh-prompt-enhance-cn')

/** CJK marker probes, written as regex fragments over the escaped forms. */
const MARKERS = [
  { file: 'lib/index.js', label: 'SYSTEM tier unconditional LangGPT rule', probe: /u65[Ee]0.u6761.u4EF6.u91C7.u7528/i },
  { file: 'lib/client.js', label: 'iteration base pane label', probe: /u8FED.u4EE3.u57FA.u51C6/i },
]

/** rules.md consumers that must stay byte-identical to the repo core copy. */
const RULES_COPIES = [
  'E:/aaaWorkspace/WorkSpace/MEMORY/skills/prompt-enhancer/core/rules.md',
  'E:/aaaWorkspace/WorkSpace/MEMORY/skills/prompt-enhancer/references/rules.md',
  'E:/aaaWorkspace/WorkSpace/MEMORY/skills/prompt-enhancer/hotkey/core/rules.md',
]

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

let problems = 0
const fail = (message) => { console.error(`DIFF  ${message}`); problems += 1 }
const pass = (message) => console.log(`same  ${message}`)

// 1. bundle hashes: repo build vs deployed copy
for (const entry of ['lib/index.js', 'lib/client.js']) {
  const mine = await sha256(join(root, entry)).catch(() => null)
  const theirs = await sha256(join(pkg, entry)).catch(() => null)
  if (mine === null) { fail(`${entry} — run \`npm run build\` first`); continue }
  if (theirs === null) { fail(`${entry} missing in profile`); continue }
  if (mine === theirs) pass(`${entry} ${mine.slice(0, 12)}`)
  else fail(`${entry} repo=${mine.slice(0, 12)} profile=${theirs.slice(0, 12)}`)
}

// 2. escaped-CJK markers in the deployed bundles
for (const { file, label, probe } of MARKERS) {
  const text = await readFile(join(pkg, file), 'utf8').catch(() => null)
  if (text === null) { fail(`${file} unreadable for marker probe`); continue }
  if (probe.test(text)) pass(`${file} carries ${label}`)
  else fail(`${file} lost ${label} — deployed copy is stale`)
}

// 3. rules.md copies identical to the repo core
const coreDigest = await sha256(join(root, '..', 'core', 'rules.md')).catch(() => null)
if (coreDigest === null) fail('core/rules.md unreadable')
else {
  pass(`core/rules.md ${coreDigest.slice(0, 12)}`)
  for (const copy of RULES_COPIES) {
    const digest = await sha256(copy).catch(() => null)
    if (digest === null) fail(`rules copy missing: ${copy}`)
    else if (digest === coreDigest) pass(`rules copy in sync: ${copy}`)
    else fail(`rules copy DRIFTED: ${copy} — re-copy core/rules.md over it`)
  }
}

// 4. clean worktree
const status = await exec('git', ['status', '--porcelain'], { cwd: root })
  .then((r) => r.stdout.trim(), () => 'git-unavailable')
if (status === '') pass('git worktree clean')
else if (status === 'git-unavailable') fail('git not runnable — verify manually')
else fail(`uncommitted changes:\n${status.split('\n').map((l) => `      ${l}`).join('\n')}`)

if (problems > 0) {
  console.error(`\n${problems} problem(s). Rebuild (\`npm run build\`), re-copy lib/ into the`)
  console.error('profile, re-sync rules.md copies, commit, then run this again.')
  process.exit(1)
}
console.log('\nacceptance check passed: deployed copy, rule markers, rules copies and worktree all verified.')
