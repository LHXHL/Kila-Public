/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import { highlightCode, highlightToTokens } from './shiki-service.ts'

const GO_CODE = `package main

import "fmt"

func main() {
  fmt.Println("hello")
}`

describe('Shiki 语言按需加载', () => {
  test('已知但未加载的语言不会被同步路径缓存为纯文本', async () => {
    await highlightCode({ code: 'const ready = true', language: 'typescript' })

    expect(highlightToTokens({ code: GO_CODE, language: 'go' })).toBeNull()

    const loaded = await highlightCode({ code: GO_CODE, language: 'go' })
    const tokens = highlightToTokens({ code: GO_CODE, language: 'go' })

    expect(loaded.language).toBe('go')
    expect(tokens?.language).toBe('go')
    expect(tokens?.lines.flat().some((token) => Boolean(token.color))).toBe(true)
  })

  test('可以按需加载常见的多种语言', async () => {
    const cases = [
      { language: 'python', code: 'def greet(name):\n    return f"Hello, {name}"' },
      { language: 'rust', code: 'fn main() {\n    println!("hello");\n}' },
      { language: 'java', code: 'class Main {\n  public static void main(String[] args) {}\n}' },
      { language: 'css', code: '.card { color: rebeccapurple; }' },
      { language: 'sql', code: 'SELECT id, name FROM users WHERE active = true;' },
      { language: 'yaml', code: 'name: kila\nenabled: true' },
    ]

    const results = await Promise.all(
      cases.map(({ code, language }) => highlightCode({ code, language }))
    )

    for (const [index, result] of results.entries()) {
      const sample = cases[index]!
      const tokens = highlightToTokens(sample)

      expect(result.language).toBe(sample.language)
      expect(tokens?.language).toBe(sample.language)
      expect(tokens?.lines.flat().some((token) => Boolean(token.color))).toBe(true)
    }
  })

  test('未知语言仍然直接回退到纯文本', async () => {
    await highlightCode({ code: 'const ready = true', language: 'typescript' })

    const tokens = highlightToTokens({ code: 'plain content', language: 'not-a-real-language' })

    expect(tokens?.language).toBe('text')
  })
})
