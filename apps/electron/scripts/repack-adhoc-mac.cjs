/**
 * electron-builder afterSign 钩子:macOS 未签名构建的 ad-hoc 重签修复
 *
 * 动机:开源项目无 Apple Developer ID 证书时,CI 产物是 ad-hoc 签名,
 * 但 electron-builder 的 mac.hardenedRuntime=true 仍会把 hardened runtime
 * 标志打到 ad-hoc 签名上。这个组合在 macOS 13+ 上会触发
 * `EXC_BAD_ACCESS / SIGKILL (Code Signature Invalid) / Invalid Page` 崩溃,
 * 应用启动即闪退(崩溃栈顶为 electron::fuses::IsRunAsNodeEnabled())。
 *
 * 策略:
 *  - 无证书环境(CSC_LINK / CSC_KEY_PASSWORD 未设置,等价于 CI 未配 MAC_CERT_P12)
 *    -> 必然是 ad-hoc 构建,强制重新 ad-hoc 签名并清除 hardened runtime 标志
 *  - 有证书环境 -> 走正式 Developer ID 签名 + 公证流程,本钩子跳过
 *
 * 为什么用「环境变量」而非「读取产物签名」判断:
 * electron-builder 在跳过正式签名时,afterSign 仍会被调用,但此时产物可能
 * 尚未被 linker 打上 ad-hoc 签名,读取 codesign 结果不可靠。而证书的有无是
 * 确定性信号,足以区分两条路径。
 *
 * 为什么不动 entitlements 文件本身:正式签名构建仍需 hardened runtime + entitlements,
 * 只是 ad-hoc 构建需要走一条不应用 hardened runtime 的路径。
 */

const path = require('node:path')
const { execFileSync } = require('node:child_process')

/** 运行外部命令,失败抛错(中文信息) */
function run(file, args, label) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const stderr = (err.stderr || '').toString().trim()
    throw new Error(`[repack-adhoc] ${label} 失败: ${stderr || err.message}`)
  }
}

/** 是否配置了正式签名证书(CI secrets 或本地 CSC_* 变量) */
function hasSigningCertificate() {
  return Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD)
}

exports.default = async function repackAdhocMac(context) {
  const { electronPlatformName, appOutDir, packager } = context

  // 只处理 macOS;Windows / Linux 无此问题
  if (electronPlatformName !== 'darwin') return

  const appName = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)

  // 有证书 -> 走正式签名 + 公证流程,跳过
  if (hasSigningCertificate()) {
    console.log(`[repack-adhoc] 检测到签名证书,走正式签名流程,跳过 ad-hoc 重签`)
    return
  }

  console.log(`[repack-adhoc] 无签名证书,重新 ad-hoc 签名并清除 hardened runtime 标志: ${appPath}`)

  // --force: 覆盖现有签名
  // --deep: 递归处理 Frameworks 下的嵌套 bundle(Electron Framework、各 Helper)
  // --sign -: ad-hoc 签名
  // --options 0: 清除所有 flags(含 runtime = hardened runtime),不应用 hardened runtime
  //   这是修复 Invalid Page 崩溃的关键
  run(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--options', '0', appPath],
    'ad-hoc 重签',
  )

  // 校验重签结果:签名 flags 应不再含 runtime 位
  const verify = run('codesign', ['-dvv', appPath], '校验重签结果')
  if (/runtime/.test(verify)) {
    throw new Error(`[repack-adhoc] 重签后仍检测到 hardened runtime 标志,可能需要人工排查: ${verify}`)
  }

  console.log(`[repack-adhoc] ✓ ad-hoc 重签完成,已清除 hardened runtime`)
}

