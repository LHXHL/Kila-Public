import { describe, expect, test } from 'bun:test'

async function readRendererCsp(): Promise<string> {
  const html = await Bun.file(new URL('./index.html', import.meta.url)).text()
  const match = html.match(/http-equiv=["']Content-Security-Policy["'][\s\S]*?content="([^"]+)"/i)
  if (!match?.[1]) throw new Error('Renderer index.html 缺少 Content-Security-Policy')
  return match[1]
}

describe('Renderer Content Security Policy', () => {
  test('允许 Shiki 编译 WebAssembly，但不开放 JavaScript eval', async () => {
    const csp = await readRendererCsp()

    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(csp).not.toMatch(/(?:^|[\s;])'unsafe-eval'(?:[\s;]|$)/)
  })
})

async function readWidgetFrameHtml(): Promise<string> {
  return Bun.file(new URL('./public/widget-frame.html', import.meta.url)).text()
}

describe('Widget iframe Content Security Policy', () => {
  test('使用独立 iframe 页面允许受控的 inline receiver 和白名单 CDN', async () => {
    const html = await readWidgetFrameHtml()
    const match = html.match(/http-equiv=["']Content-Security-Policy["'][\s\S]*?content="([^"]+)"/i)
    if (!match?.[1]) throw new Error('widget-frame.html 缺少 Content-Security-Policy')

    const csp = match[1]
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).toContain('https://cdnjs.cloudflare.com')
    expect(csp).toContain('https://cdn.jsdelivr.net')
    expect(csp).toContain('https://unpkg.com')
    expect(csp).toContain('https://esm.sh')
    expect(csp).toContain("connect-src 'none'")
  })

  test('WidgetRenderer 不再使用 srcdoc，避免继承主页面 script-src 限制', async () => {
    const source = await Bun.file(new URL('./components/agent/WidgetRenderer.tsx', import.meta.url)).text()

    expect(source).toContain('src="./widget-frame.html"')
    expect(source).not.toContain('srcDoc=')
  })
})
