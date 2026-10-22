/**
 * Copy the built plugin into a DSH profile's node_modules so the running
 * harness picks it up (the profile stores a plain directory, not a symlink).
 *
 * Usage:
 *   node scripts/install-profile.mjs                 # default profile path below
 *   node scripts/install-profile.mjs <profile-dir>   # explicit profile directory
 *
 * @module scripts/install-profile
 */
import { cp, lstat, mkdir, realpath, rm, stat, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const DEFAULT_PROFILE =
  process.env.DSH_PROFILE_DIR ??
  'E:/aaaWorkspace/WorkSpace/dsh/.dsh/profiles/desktop'

const NEW_NAME = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name

const profile = resolve(process.argv[2] ?? DEFAULT_PROFILE)
const target = join(profile, 'node_modules', NEW_NAME)

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

if (!(await exists(join(root, 'lib', 'index.js')))) {
  console.error('lib/index.js missing — run `npm run build` first.')
  process.exit(1)
}
if (!(await exists(profile))) {
  console.error(`profile directory not found: ${profile}`)
  process.exit(1)
}

// A `link:` dependency makes the profile entry a symlink into this repo.
// Copying onto it would write through the link (or replace it with a real
// directory), so a linked install is already live and needs no copy.
const linked = await lstat(target).then(
  (info) => info.isSymbolicLink(),
  () => false,
)
if (linked) {
  console.log(`skip: ${target} is linked to ${await realpath(target)} — already live.`)
  process.exit(0)
}

await mkdir(target, { recursive: true })
for (const entry of ['lib', 'src', 'package.json', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.zh-CN.md', 'docs']) {
  const from = join(root, entry)
  if (!(await exists(from))) continue
  const to = join(target, entry)
  await rm(to, { recursive: true, force: true })
  await cp(from, to, { recursive: true })
}

console.log(`installed ${pkg.name}@${pkg.version}`)
console.log(`  → ${target}`)
console.log('restart the DSH host (client-only changes just need a page refresh).')
