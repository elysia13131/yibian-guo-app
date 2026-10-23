/**
 * Capacitor 原生文件写入工具
 *
 * 在移动端（Android/iOS）使用 @capacitor/filesystem 将文件保存到设备 Documents 目录。
 */

import { Capacitor } from '@capacitor/core'

let _isCapacitor: boolean | null = null


export function isNativePlatform(): boolean {
  if (_isCapacitor === null) {
    try {
      _isCapacitor = Capacitor.isNativePlatform()
    } catch {
      _isCapacitor = false
    }
  }
  return _isCapacitor
}


function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
}


function resolveUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('/')) return `${getApiBaseUrl()}${path}`
  return `${getApiBaseUrl()}/${path}`
}


async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}


function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'audio/mpeg': '.mp3',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/svg+xml': '.svg',
  }
  return map[mime] || ''
}


export async function saveFileToDevice(downloadUrl: string, filename: string): Promise<boolean> {
  if (!isNativePlatform()) return false

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')

    const fullUrl = resolveUrl(downloadUrl)
    const response = await fetch(fullUrl)
    if (!response.ok) throw new Error(`下载失败 (${response.status})`)

    const blob = await response.blob()
    const base64 = await blobToBase64(blob)

    let finalName = filename
    if (!finalName.includes('.')) {
      const ext = mimeToExtension(blob.type)
      if (ext) finalName += ext
    }

    await Filesystem.writeFile({
      path: finalName,
      data: base64,
      directory: Directory.Documents,
    })

    return true
  } catch (err) {
    console.error('Capacitor 文件写入失败:', err)
    return false
  }
}
