import { describe, expect, test } from 'bun:test'

async function readAppearanceSettingsSource(): Promise<string> {
  return Bun.file(new URL('../AppearanceSettings.tsx', import.meta.url)).text()
}

describe('主题卡片操作菜单', () => {
  test('Given 主题列表位于 OverlayScrollbars 中, When 打开操作菜单, Then 不安装整页模态指针锁', async () => {
    const source = await readAppearanceSettingsSource()

    expect(source).toContain('<DropdownMenu modal={false}>')
  })

  test('Given 菜单内容通过 Portal 渲染, When 设置窗口启用拖拽区域, Then 菜单保持可交互并位于弹层上方', async () => {
    const source = await readAppearanceSettingsSource()

    expect(source).toContain(
      '<DropdownMenuContent align="end" className="z-[100] titlebar-no-drag">',
    )
  })
})
