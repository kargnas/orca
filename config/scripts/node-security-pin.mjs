import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Node 18 stays a floating smoke runtime; 22/24/26 must be the patched releases.
const patched = new Set(['22.23.4', '24.22.1', '26.12.1'])
const failures = []
let patchedHits = 0

const note = (message) => {
  failures.push(message)
}

const read = (path) => readFileSync(path, 'utf8')

const assertEngines = (path, expected) => {
  const engines = JSON.parse(read(path)).engines?.node
  if (engines !== expected) {
    note(
      `${path} engines.node is ${JSON.stringify(engines)}, expected ${JSON.stringify(expected)}`
    )
    return
  }
  patchedHits += 1
}

const classify = (specifier, where) => {
  const value = specifier.trim().replace(/^['"]|['"]$/g, '')
  if (value.includes('${{')) {
    return
  }
  if (patched.has(value)) {
    patchedHits += 1
    return
  }
  if (value === '18' || value.startsWith('18.')) {
    return
  }
  if (/^(22|24|26)(\.|$)/.test(value)) {
    note(`${where}: Node ${value} is not a patched release`)
  }
}

const scanWorkflow = (path, text) => {
  for (const match of text.matchAll(/node-version:\s*([^\n#]+)/g)) {
    const raw = match[1].trim()
    if (raw.includes('${{')) {
      continue
    }
    const specifier = raw.split(/\s+/)[0].replace(/[},]+$/g, '')
    classify(specifier, `${path} node-version`)
  }
  for (const match of text.matchAll(/node_versions:\s*(['"])(\[.*?\])\1/g)) {
    let versions
    try {
      versions = JSON.parse(match[2])
    } catch {
      note(`${path}: unreadable node_versions ${match[2]}`)
      continue
    }
    if (!Array.isArray(versions)) {
      note(`${path}: node_versions is not a list`)
      continue
    }
    for (const version of versions) {
      classify(String(version), `${path} node_versions`)
    }
  }
}

const walkYml = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkYml(path)
    } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
      scanWorkflow(path, read(path))
    }
  }
}

const scanDocker = (path) => {
  for (const match of read(path).matchAll(/^FROM node:(\S+)/gm)) {
    classify(match[1].split('@')[0].split('-')[0], `${path} FROM`)
  }
}

assertEngines('package.json', '24.22.1')
assertEngines('docs/site/package.json', '22.23.4')
assertEngines('cloud/package.json', '24.22.1 || 26.12.1')

const nodeVersionFile = read('cloud/.node-version').trim()
if (nodeVersionFile !== '24.22.1') {
  note(`cloud/.node-version is ${nodeVersionFile}`)
} else {
  patchedHits += 1
}

walkYml('.github')
for (const path of [
  'cloud/apps/relay/Dockerfile',
  'cloud/apps/relay-fence-broker/Dockerfile',
  'config/docker/headless-pairing/Dockerfile.build',
  'tests/e2e/fixtures/docker-ssh-relay/Dockerfile'
]) {
  scanDocker(path)
}

const setupScript = read('.github/actions/setup-wsl-test-runtime/setup.ps1')
const distUrls = [...setupScript.matchAll(/nodejs\.org\/dist\/v(\d+\.\d+\.\d+)\//g)].map(
  (match) => match[1]
)
if (!distUrls.includes('22.23.4')) {
  note('WSL setup is missing the Node 22.23.4 tarball')
}
for (const version of distUrls) {
  classify(version, 'setup.ps1 nodejs.org')
}

if (patchedHits < 20) {
  note(`only ${patchedHits} patched Node pins found`)
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure)
  }
  process.exit(1)
}

console.log(`Node 22/24/26 pins match the October 2026 releases (${patchedHits} pins)`)
