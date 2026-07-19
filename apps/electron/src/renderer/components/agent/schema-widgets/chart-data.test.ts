import { describe, expect, test } from 'bun:test'
import { getBarChartExtent, getFiniteChartExtent, limitChartRows, toFiniteChartNumber } from './chart-data'

describe('图表数值归一化', () => {
  test('Given 非数值或无限值 When 进入图表 Then 降级为 0 而不是 NaN', () => {
    expect([toFiniteChartNumber('oops'), toFiniteChartNumber(Infinity), toFiniteChartNumber(null)]).toEqual([0, 0, 0])
  })

  test('Given 空数据 When 计算坐标范围 Then 返回可绘制的安全范围', () => {
    expect(getFiniteChartExtent([])).toEqual({ min: 0, max: 1 })
  })

  test('Given 所有数据相等 When 计算坐标范围 Then 保留基线并避免零范围', () => {
    expect(getFiniteChartExtent([5, 5])).toEqual({ min: 5, max: 6 })
  })

  test('Given 正负柱状数据 When 计算分组范围 Then 零基线同时覆盖正负方向', () => {
    expect(getBarChartExtent([[8, -3], [2, -5]], false)).toEqual({ min: -5, max: 8 })
  })

  test('Given 正负堆叠数据 When 计算范围 Then 分别累计正值和负值', () => {
    expect(getBarChartExtent([[8, 2, -3, -4], [1, -2]], true)).toEqual({ min: -7, max: 10 })
  })

  test('Given 超大数据集 When 准备渲染 Then 限制 DOM 规模并报告省略数量', () => {
    expect(limitChartRows([1, 2, 3, 4], 2)).toEqual({ rows: [1, 2], truncatedCount: 2 })
  })
})
