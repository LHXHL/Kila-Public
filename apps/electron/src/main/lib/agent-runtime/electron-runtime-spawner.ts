import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { RuntimeProcessLike, RuntimeProcessSpawner } from './runtime-supervisor'
import { createLogger } from '../logger'

const requireElectron = createRequire(__filename)
const log = createLogger('Pi Runtime Utility')

interface RuntimeProcessWithStdio extends RuntimeProcessLike {
  stderr?: {
    on: (event: 'data', listener: (chunk: Uint8Array | string) => void) => void
  }
}

/** Electron 主进程唯一的 Utility Process 创建入口。 */
export function createElectronRuntimeSpawner(): RuntimeProcessSpawner {
  return (entryPath, serviceName): RuntimeProcessLike => {
    const { utilityProcess } = requireElectron('electron') as typeof import('electron')
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    const child = utilityProcess.fork(
      entryPath,
      [],
      {
        serviceName,
        env: {
          ...process.env,
          KILA_EXTERNAL_MODULES_DIR: resourcesPath
            ? join(resourcesPath, 'ext-modules', 'node_modules')
            : join(dirname(entryPath), 'ext-modules', 'node_modules'),
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    ) as unknown as RuntimeProcessWithStdio
    child.stderr?.on('data', (chunk) => {
      const message = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      if (message.trim()) log.error(`[${serviceName}] stderr: ${message.trim()}`)
    })
    return child
  }
}
