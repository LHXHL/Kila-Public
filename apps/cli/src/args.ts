export interface ParsedArgs {
  positionals: string[]
  flags: Map<string, string | boolean | string[]>
}

const BOOLEAN_FLAGS = new Set([
  'ai-can-exit',
  'json-value',
  'loop',
  'notify-missed',
  'json',
  'no-stream',
  'stdin',
  'verbose',
  'yes',
])

function setFlag(
  flags: ParsedArgs['flags'],
  key: string,
  value: string | boolean,
): void {
  const existing = flags.get(key)
  if (typeof value === 'boolean' || typeof existing === 'boolean' || typeof existing === 'undefined') {
    flags.set(key, value)
    return
  }
  if (Array.isArray(existing)) {
    flags.set(key, [...existing, value])
    return
  }
  flags.set(key, [existing, value])
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string | boolean>()

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current) continue

    if (!current.startsWith('--')) {
      positionals.push(current)
      continue
    }

    const eqIndex = current.indexOf('=')
    if (eqIndex > -1) {
      const key = current.slice(2, eqIndex)
      const value = current.slice(eqIndex + 1)
      setFlag(flags, key, value)
      continue
    }

    const key = current.slice(2)
    if (BOOLEAN_FLAGS.has(key)) {
      setFlag(flags, key, true)
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      setFlag(flags, key, next)
      index += 1
      continue
    }

    setFlag(flags, key, true)
  }

  return { positionals, flags }
}

export function getBooleanFlag(
  args: ParsedArgs,
  name: string,
): boolean {
  return args.flags.get(name) === true
}

export function getStringFlag(
  args: ParsedArgs,
  name: string,
): string | undefined {
  const value = args.flags.get(name)
  if (Array.isArray(value)) return value.at(-1)
  return typeof value === 'string' ? value : undefined
}

export function getStringFlags(
  args: ParsedArgs,
  name: string,
): string[] {
  const value = args.flags.get(name)
  if (Array.isArray(value)) return value
  return typeof value === 'string' ? [value] : []
}
