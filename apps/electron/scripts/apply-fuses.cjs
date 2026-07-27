/**
 * electron-builder afterPack 钩子：写入 Electron Fuses
 *
 * 动机：未配置 Fuses 时，拿到本地立足点的攻击者可以用 `ELECTRON_RUN_AS_NODE=1`
 * 把 Kila 主二进制当通用 Node 运行任意脚本，从而继承 App 已获授的
 * TCC / 自动化 / 辅助功能 / 网络权限。对一个具备 cua-driver 电脑操作能力的应用，
 * 这条提权路径尤其敏感。
 *
 * 为什么用 afterPack 而不是 electron-builder 的 `electronFuses` 配置：
 * 后者要求 electron-builder >= 26，本仓固定在 25.1.8；升级主版本的打包风险
 * 远大于收益，因此改用官方 @electron/fuses 在打包后直接改写二进制。
 *
 * 已核对本仓不依赖被关闭的能力：全仓无自用 ELECTRON_RUN_AS_NODE
 * （shell-env.ts 里那处是把它从导入的 shell 环境中「排除」，与本开关无关）、
 * 无 NODE_OPTIONS 依赖、无 --inspect 调试链路。
 */

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const path = require('node:path')

/** 按平台定位打包产物中的 Electron 主二进制 */
function resolveElectronBinary(context) {
  const { electronPlatformName, appOutDir, packager } = context
  const appName = packager.appInfo.productFilename

  switch (electronPlatformName) {
    case 'darwin':
      return path.join(appOutDir, `${appName}.app`, 'Contents', 'MacOS', appName)
    case 'win32':
      return path.join(appOutDir, `${appName}.exe`)
    default:
      return path.join(appOutDir, appName)
  }
}

exports.default = async function applyFuses(context) {
  const electronBinary = resolveElectronBinary(context)

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    // 签名会在 fuses 写入之后进行，这里显式关闭自动 resign 避免重复签名
    resetAdHocDarwinSignature: false,

    // 关闭 ELECTRON_RUN_AS_NODE：阻断「把 App 二进制当通用 Node 跑」的提权继承
    [FuseV1Options.RunAsNode]: false,
    // 关闭 NODE_OPTIONS 与 --inspect：阻断经环境变量/调试端口注入代码
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // 只从 app.asar 加载应用代码，不回退到 app/ 目录
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // 加密 cookie 存储
    [FuseV1Options.EnableCookieEncryption]: true,
  })

  console.log(`[Fuses] 已写入 Electron Fuses: ${electronBinary}`)
}
