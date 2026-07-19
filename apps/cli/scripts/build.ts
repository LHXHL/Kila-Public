#!/usr/bin/env bun

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const projectDir = resolve(import.meta.dir, '..')
const entrypoint = resolve(projectDir, 'src/main.ts')
const outdir = resolve(projectDir, 'dist')
const outfile = resolve(outdir, 'main.js')

mkdirSync(outdir, { recursive: true })

const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir,
  target: 'node',
  format: 'esm',
  minify: true,
  sourcemap: 'external',
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

const built = readFileSync(outfile, 'utf-8')
const withShebang = built.startsWith('#!')
  ? built
  : `#!/usr/bin/env node\n${built}`

writeFileSync(outfile, withShebang, 'utf-8')
chmodSync(outfile, 0o755)

if (result.outputs.some((output) => output.path === outfile)) {
  const mapPath = `${outfile}.map`
  if (existsSync(mapPath) && readFileSync(mapPath, 'utf-8')) {
    chmodSync(mapPath, 0o644)
  }
}
