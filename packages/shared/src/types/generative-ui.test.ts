import { describe, expect, test } from 'bun:test'
import { SCHEMA_WIDGET_TYPES } from './generative-ui'

describe('shared generative ui types', () => {
  test('exports the fixed first-wave schema widget families', () => {
    expect(SCHEMA_WIDGET_TYPES).toEqual([
      'stat-grid',
      'line-chart',
      'bar-chart',
      'comparison-table',
      'timeline',
      'flow-diagram',
    ])
  })
})
