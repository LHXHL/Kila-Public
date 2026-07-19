/**
 * 安装包清单
 *
 * 提供环境缺失时的一键安装下载源。内置 fallback 清单，不依赖远程 API。
 */

import type { InstallerManifest, InstallerSource } from '@kila/shared'

const BUILTIN_MANIFEST: InstallerManifest = {
  installers: [
    {
      id: 'git-for-windows',
      platform: 'win32',
      arch: 'x64',
      version: '2.54.0',
      downloadUrl: 'https://cdn.proma.cool/installers/git-for-windows/2.54.0/Git-2.54.0-64-bit.exe',
      fallbackUrl: 'https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/Git-2.54.0-64-bit.exe',
      sha256: '2b96e7854f0520f0f6b709c21041d9801b1be44d5e1a0d9fa621b2fbc40f1983',
      sizeBytes: 65_175_776,
      filename: 'Git-2.54.0-64-bit.exe',
    },
    {
      id: 'git-for-windows',
      platform: 'win32',
      arch: 'arm64',
      version: '2.54.0',
      downloadUrl: 'https://cdn.proma.cool/installers/git-for-windows/2.54.0/Git-2.54.0-arm64.exe',
      fallbackUrl: 'https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/Git-2.54.0-arm64.exe',
      sha256: '97bf63e5c65152c14b488e191c107aa1ccbeae2435690693241be4b2b5edd0d2',
      sizeBytes: 63_430_440,
      filename: 'Git-2.54.0-arm64.exe',
    },
    {
      id: 'nodejs',
      platform: 'win32',
      arch: 'x64',
      version: '22.22.2',
      downloadUrl: 'https://cdn.proma.cool/installers/nodejs/22.22.2/node-v22.22.2-x64.msi',
      fallbackUrl: 'https://nodejs.org/dist/v22.22.2/node-v22.22.2-x64.msi',
      sha256: '57456aa33fcd6fb6a9418e09227de0b0ca604f7b2123566acc66b555cb2f42e5',
      sizeBytes: 31_703_040,
      filename: 'node-v22.22.2-x64.msi',
    },
    {
      id: 'nodejs',
      platform: 'win32',
      arch: 'arm64',
      version: '22.22.2',
      downloadUrl: 'https://cdn.proma.cool/installers/nodejs/22.22.2/node-v22.22.2-arm64.msi',
      fallbackUrl: 'https://nodejs.org/dist/v22.22.2/node-v22.22.2-arm64.msi',
      sha256: '1ec02aeb76d716ce15915bed10c0a4dcf9a6224e9a4f4d1645ddca4985a7bc06',
      sizeBytes: 27_906_048,
      filename: 'node-v22.22.2-arm64.msi',
    },
  ],
}

export function getInstallerManifest(): InstallerManifest {
  return BUILTIN_MANIFEST
}

export function findInstallerSource(
  manifest: InstallerManifest,
  id: string,
  arch: 'x64' | 'arm64',
): InstallerSource | undefined {
  return manifest.installers.find((s) => s.id === id && s.arch === arch)
}
