/**
 * Check that the plugin copy inside a DSH profile is the one this repo built.
 *
 * The profile stores a plain directory rather than a symlink, so a rebuild is
 * invisible until `install-profile.mjs` runs again — and a `pnpm install` in the
 * profile (any market install triggers one) would replace the whole directory
 * with the published upstream package. Both failure modes look like "my change
 * did nothing", so compare hashes and say which one happened.
 *
 * Usage:
 *   node scripts/verify-profile.mjs                 # default profile path below
 *   node scripts/verify-profile.mjs <profile-dir>   # explicit profile directory
 *
 * Exits 1 when the profile is stale or holds a different origin.
 *
 * @module scripts/verify-profile
 */
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const DEFAULT_PROFILE =
  process.env.DSH_PROFILE_DIR ??
  'E:/aaaWorkspace/WorkSpace/dsh/.dsh/profiles/desktop'

const profile = resolve(process.argv[2] ?? DEFAULT_PROFILE)
const target = join(profile, 'node_modules', 'dsh-prompt-enhance')

/** Everything the host actually loads plus the markers we fingerprint. */
const ENTRIES = ['lib/index.js', 'lib/client.js', 'package.json', 'cordis.patch.yml']

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 16)
}

let problems = 0

const link = await lstat(target).then(
  (info) => (info.isSymbolicLink() ? realpath(target) : undefined),
  () => undefined,
)
if (link !== undefined) {
  console.log(`linked: ${target} -> ${link}`)
  console.log('a linked install is live by construction; hashes are the same files.')
  process.exit(0)
}

for (const entry of ENTRIES) {
  const mine = await digest(join(root, entry)).catch(() => null)
  const theirs = await digest(join(target, entry)).catch(() => null)
  if (mine === null) {
    console.error(`missing build: ${entry} — run \`npm run build\` first.`)
    problems += 1
    continue
  }
  if (theirs === null) {
    console.error(`missing in profile: ${entry}`)
    problems += 1
    continue
  }
  const same = mine === theirs
  console.log(`${same ? 'same' : 'DIFF'}  ${entry}  repo=${mine} profile=${theirs}`)
  if (!same) problems += 1
}

if (problems > 0) {
  console.error(`\nprofile copy differs (${problems} file(s)). Fix with: node scripts/install-profile.mjs`)
  console.error('If the diff appeared after a plugin install, pnpm fetched the published')
  console.error('package over this one — run the install script again afterwards.')
  console.error('Do not "fix" this with a `link:` dependency: the linked path would')
  console.error('resolve @deepseek-ai/dsh-llm from this repo\'s devDependencies, and a')
  console.error('second copy of those services breaks cordis service identity.')
  process.exit(1)
}

const installed = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
console.log(`\nprofile copy matches the build (${installed.name}@${installed.version}).`)
console.log('The host still has to restart before server-side changes take effect.')
