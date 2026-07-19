import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { UserMessageContent } from './message'

describe('UserMessageContent', () => {
  test('shrinks to the message length while keeping long JSON wrap-safe', () => {
    const html = renderToStaticMarkup(
      <UserMessageContent>
        {"{\"codex\":{\"theme\":{\"accent\":\"#339cff\",\"contrast\":45,\"fonts\":\"Inter\"}}}"}
      </UserMessageContent>
    )

    expect(html).toContain('class="relative inline-flex w-fit max-w-[min(100%,42rem)] min-w-0 flex-col rounded-[14px]')
    expect(html).toContain('min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]')
  })
})
