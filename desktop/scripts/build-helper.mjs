#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helperDirectory = path.resolve(desktop, '..', 'helper')
const outputRoot = path.join(desktop, 'resources', 'helper')

const targets = [
  { goos: 'darwin', goarch: 'arm64', directory: 'darwin-arm64', binary: 'shieldbar-helper' },
  { goos: 'windows', goarch: 'amd64', directory: 'win32-x64', binary: 'shieldbar-helper.exe' },
  { goos: 'linux', goarch: 'amd64', directory: 'linux-x64', binary: 'shieldbar-helper' }
]

for (const target of targets) {
  const directory = path.join(outputRoot, target.directory)
  mkdirSync(directory, { recursive: true })
  const output = path.join(directory, target.binary)

  const result = spawnSync(
    'go',
    ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'],
    {
      cwd: helperDirectory,
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOOS: target.goos,
        GOARCH: target.goarch
      },
      stdio: 'inherit'
    }
  )

  if (result.status !== 0) {
    process.stderr.write(
      `Failed to build ${target.goos}/${target.goarch} helper (exit ${result.status}).\n`
    )
    process.exit(result.status ?? 1)
  }

  process.stdout.write(`Built ${target.goos}/${target.goarch} helper: ${output}\n`)
}
