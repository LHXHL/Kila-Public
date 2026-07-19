import { describe, expect, test } from 'bun:test'
import {
  detectCodeBlockLanguage,
  getCollapsedCodeBlockVisibleLineCount,
  getCodeBlockDisplayName,
  normalizeCodeBlockLanguage,
  shouldAutoCollapseCodeBlock,
  shouldShowCodeBlockLineNumbers,
} from './CodeBlock.tsx'

describe('CodeBlock language handling', () => {
  test('normalizes explicit fence language aliases through Shiki metadata', () => {
    expect(normalizeCodeBlockLanguage('py')).toBe('python')
    expect(normalizeCodeBlockLanguage('tsx')).toBe('tsx')
    expect(getCodeBlockDisplayName('python')).toBe('Python')
  })

  test('detects unfenced Go snippets as Go instead of plaintext', () => {
    const code = `package main

import "fmt"

func fibonacci(n int) []int {
  if n <= 0 {
    return nil
  }
  fib := make([]int, n)
  fib[0] = 0
  if n > 1 {
    fib[1] = 1
  }
  for i := 2; i < n; i++ {
    fib[i] = fib[i-1] + fib[i-2]
  }
  return fib
}`

    expect(detectCodeBlockLanguage(code)).toBe('go')
    expect(getCodeBlockDisplayName(detectCodeBlockLanguage(code))).toBe('Go')
  })

  test('keeps ambiguous short snippets as plaintext', () => {
    const code = `def fibonacci(n):
    if n <= 0:
        return []
    return [0, 1]`

    expect(detectCodeBlockLanguage(code)).toBe('plaintext')
  })

  test('auto-collapses long code blocks and keeps a short preview', () => {
    expect(shouldAutoCollapseCodeBlock(30)).toBe(false)
    expect(shouldAutoCollapseCodeBlock(31)).toBe(true)
    expect(getCollapsedCodeBlockVisibleLineCount(8)).toBe(8)
    expect(getCollapsedCodeBlockVisibleLineCount(31)).toBe(10)
    expect(shouldShowCodeBlockLineNumbers(31)).toBe(true)
  })
})
