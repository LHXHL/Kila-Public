import { describe, expect, test } from 'bun:test'
import { getBooleanFlag, getStringFlag, getStringFlags, parseArgs } from './args'

describe('cli args', () => {
  test('preserves repeated string flags for multi-value options', () => {
    const args = parseArgs([
      '--bridge-target',
      'telegram:telegram:42',
      '--bridge-target=wechat:wechat:account:user:wxid_1',
    ])

    expect(getStringFlags(args, 'bridge-target')).toEqual([
      'telegram:telegram:42',
      'wechat:wechat:account:user:wxid_1',
    ])
    expect(getStringFlag(args, 'bridge-target')).toBe('wechat:wechat:account:user:wxid_1')
  })

  test('recognizes task boolean flags even before following options', () => {
    const args = parseArgs(['--loop', '--channel', 'default', '--ai-can-exit'])

    expect(getBooleanFlag(args, 'loop')).toBe(true)
    expect(getStringFlag(args, 'channel')).toBe('default')
    expect(getBooleanFlag(args, 'ai-can-exit')).toBe(true)
  })
})
