/**
 * 安装器相关类型定义
 * 用于 Windows 环境缺失时的一键下载安装引导
 */

import type { Architecture } from './runtime'

/**
 * 安装包来源信息
 */
export interface InstallerSource {
  /** 安装包唯一标识 */
  id: string
  /** 目标平台 */
  platform: 'win32' | 'darwin' | 'linux'
  /** 目标架构 */
  arch: Architecture
  /** 版本号 */
  version: string
  /** 主下载地址（OSS CDN） */
  downloadUrl: string
  /** 备用下载地址（官方上游） */
  fallbackUrl: string
  /** SHA256 校验值 */
  sha256: string
  /** 文件大小（字节） */
  sizeBytes: number
  /** 文件名 */
  filename: string
}

/**
 * 安装包清单
 */
export interface InstallerManifest {
  /** 可用安装包列表 */
  installers: InstallerSource[]
}

/**
 * 安装器下载请求
 */
export interface InstallerDownloadRequest {
  /** 安装包标识 */
  id: string
  /** 目标架构 */
  arch: Architecture
}

/**
 * 安装器下载结果
 */
export interface InstallerDownloadResult {
  /** 本地文件路径 */
  filePath: string
  /** SHA256 校验值 */
  sha256: string
}

/**
 * 安装器下载进度
 */
export interface InstallerProgressPayload {
  /** 下载唯一键（id:arch） */
  key: string
  /** 已下载字节数 */
  downloaded: number
  /** 总字节数 */
  total: number
  /** 下载速度（字节/秒） */
  speed: number
}

/**
 * 安装器 IPC 通道
 */
export const INSTALLER_IPC_CHANNELS = {
  /** 获取安装包清单 */
  FETCH_MANIFEST: 'installer:fetch-manifest',
  /** 下载安装包 */
  DOWNLOAD: 'installer:download',
  /** 取消下载 */
  CANCEL: 'installer:cancel',
  /** 拉起安装程序 */
  LAUNCH: 'installer:launch',
  /** 下载进度推送（main → renderer） */
  PROGRESS: 'installer:progress',
  /** 重新检测运行时 */
  REINIT_RUNTIME: 'installer:reinit-runtime',
} as const
