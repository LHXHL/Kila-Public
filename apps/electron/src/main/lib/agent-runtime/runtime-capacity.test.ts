import { describe, expect, test } from 'bun:test'
import { RuntimeCapacityController, normalizeRuntimeCapacityOptions } from './runtime-capacity'

describe('Runtime capacity scheduler', () => {
  test('Given running 达到上限 When 新 Session 请求 Then FIFO 排队且释放后晋升', () => {
    const capacity = new RuntimeCapacityController({ maxRunning: 2, maxSpawnConcurrency: 1, maxHotIdle: 1, hotIdleMs: 30_000 })
    expect(capacity.requestRun('a', 1)).toBe('running')
    expect(capacity.requestRun('b', 2)).toBe('running')
    expect(capacity.requestRun('c', 3)).toBe('queued')
    expect(capacity.requestRun('d', 4)).toBe('queued')
    expect(capacity.release('a')).toBe('c')
    expect(capacity.snapshot()).toMatchObject({ running: ['b', 'c'], queued: ['d'] })
  })

  test('Given spawn 并发达到上限 When 后续 Session 等待 Then 仍按 FIFO 获得 spawn slot', () => {
    const capacity = new RuntimeCapacityController({ maxSpawnConcurrency: 2 })
    expect(capacity.beginSpawn('a')).toBe(true)
    expect(capacity.beginSpawn('b')).toBe(true)
    expect(capacity.beginSpawn('c')).toBe(false)
    expect(capacity.beginSpawn('d')).toBe(false)

    capacity.finishSpawn('b')
    expect(capacity.beginSpawn('d')).toBe(false)
    expect(capacity.beginSpawn('c')).toBe(true)
  })

  test('Given 多个 hot-idle When LRU 回收 Then 最久未使用的先被释放', () => {
    const capacity = new RuntimeCapacityController({ maxRunning: 4, maxHotIdle: 2 })
    capacity.requestRun('old', 1)
    capacity.requestRun('new', 2)
    capacity.markHotIdle('old', 1)
    capacity.markHotIdle('new', 2)
    expect(capacity.takeLruHotIdle(1)).toEqual(['old'])
    expect(capacity.snapshot().hotIdle).toEqual(['new'])
  })

  test('Given hot-idle 已达到上限 When 新 Runtime 进入 hot-idle Then 自动驱逐最老实例', () => {
    const capacity = new RuntimeCapacityController({ maxRunning: 3, maxHotIdle: 1 })
    capacity.requestRun('old', 1)
    capacity.requestRun('new', 2)

    expect(capacity.markHotIdle('old', 1)).toEqual([])
    expect(capacity.markHotIdle('new', 2)).toEqual(['old'])
    expect(capacity.snapshot().hotIdle).toEqual(['new'])
  })

  test('Given FIFO 队列等待且 running slot 空出 When 新 Session 请求 Then 先晋升队首不得插队', () => {
    const capacity = new RuntimeCapacityController({ maxRunning: 2, maxHotIdle: 2 })
    capacity.requestRun('a', 1)
    capacity.requestRun('b', 2)
    expect(capacity.requestRun('queued', 3)).toBe('queued')

    capacity.markHotIdle('a', 4)
    expect(capacity.snapshot()).toMatchObject({ running: ['b', 'queued'], queued: [] })
    expect(capacity.requestRun('new', 5)).toBe('queued')
    expect(capacity.snapshot().queued).toEqual(['new'])
  })

  test('Given FIFO 队首正在等待 When capacity 变化唤醒 Then 队首被复用而不会重复入队', () => {
    const capacity = new RuntimeCapacityController({ maxRunning: 1, maxHotIdle: 1 })
    capacity.requestRun('running', 1)
    expect(capacity.requestRun('queued', 2)).toBe('queued')
    capacity.release('running')
    expect(capacity.snapshot().running).toEqual(['queued'])
    expect(capacity.requestRun('queued', 3)).toBe('running')
    expect(capacity.snapshot().queued).toEqual([])
  })

  test('Given hot-idle Session 与 FIFO 队列并存 When hot-idle 恢复运行 Then 不得突破 running 上限', () => {
    const capacity = new RuntimeCapacityController({ maxRunning: 1, maxHotIdle: 1 })
    capacity.requestRun('hot-idle', 1)
    capacity.markHotIdle('hot-idle', 2)
    capacity.requestRun('running', 3)
    expect(capacity.requestRun('queued', 4)).toBe('queued')

    expect(capacity.requestRun('hot-idle', 5)).toBe('queued')
    expect(capacity.snapshot()).toMatchObject({ running: ['running'], queued: ['queued', 'hot-idle'] })
  })

  test('Given running slot 已满 When 新 run 排队 Then 优先回收最老 hot-idle 且保留请求 Session', () => {
    const capacity = new RuntimeCapacityController({ maxRunning: 1, maxHotIdle: 2 })
    capacity.requestRun('old-idle', 1)
    capacity.markHotIdle('old-idle', 2)
    capacity.requestRun('new-idle', 3)
    capacity.markHotIdle('new-idle', 4)
    capacity.requestRun('running', 5)

    expect(capacity.requestRun('queued', 6)).toBe('queued')
    expect(capacity.takeLruHotIdle(1, 'queued')).toEqual(['old-idle'])
    expect(capacity.snapshot().hotIdle).toEqual(['new-idle'])
  })

  test('Given 非法资源配置 When normalize Then 限制在合同范围内', () => {
    expect(normalizeRuntimeCapacityOptions({ maxRunning: 99, maxSpawnConcurrency: 0, maxHotIdle: -1, hotIdleMs: 1 })).toEqual({
      maxRunning: 8,
      maxSpawnConcurrency: 1,
      maxHotIdle: 0,
      hotIdleMs: 30_000,
    })
  })
})
