import { Capacitor } from '@capacitor/core'

let _isNative: boolean | null = null

function isNativePlatform(): boolean {
  if (_isNative === null) {
    try { _isNative = Capacitor.isNativePlatform() } catch { _isNative = false }
  }
  return _isNative
}

function isMobileBrowser(): boolean {
  if (isNativePlatform()) return false
  return /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent)
}

function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || ''
}

function resolveUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('/')) return `${getApiBaseUrl()}${path}`
  return `${getApiBaseUrl()}/${path}`
}

function mobileDownload(url: string): void {
  const fullUrl = resolveUrl(url)
  const w = window.open(fullUrl, '_blank')
  if (!w || w.closed) {
    const anchor = document.createElement('a')
    anchor.href = fullUrl
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    setTimeout(() => document.body.removeChild(anchor), 1000)
  }
}

async function blobDownload(url: string, filename: string): Promise<void> {
  const fullUrl = resolveUrl(url)
  const response = await fetch(fullUrl)
  if (!response.ok) throw new Error(`下载失败 (${response.status})`)

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/plain')) {
    const text = await response.text()
    console.error('下载返回错误:', text.slice(0, 500))
    throw new Error('文件不存在或无法访问')
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()

  setTimeout(() => {
    document.body.removeChild(anchor)
    URL.revokeObjectURL(objectUrl)
  }, 1000)
}

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'audio/mpeg': '.mp3',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
}

function ensureExtension(filename: string, blob: Blob): string {
  if (filename.includes('.')) return filename
  const ext = MIME_TO_EXT[blob.type] || ''
  return ext ? filename + ext : filename
}

export async function downloadFile(url: string, filename: string): Promise<void> {
  if (isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const fullUrl = resolveUrl(url)
    const response = await fetch(fullUrl)
    if (!response.ok) throw new Error(`下载失败 (${response.status})`)
    const blob = await response.blob()
    const reader = new FileReader()
    const base64 = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => {
        const result = reader.result as string
        resolve(result.split(',')[1])
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const finalName = ensureExtension(filename, blob)
    await Filesystem.writeFile({
      path: finalName,
      data: base64,
      directory: Directory.Documents,
    })
    return
  }

  if (isMobileBrowser()) {
    mobileDownload(url)
    return
  }

  await blobDownload(url, filename)
}

export function downloadOutputFile(filename: string) {
  return downloadFile(`/api/v1/image/output/${encodeURIComponent(filename)}`, filename)
}

export function downloadUploads(path: string, filename: string) {
  return downloadFile(path, filename)
}

export function downloadUploadFile(filename: string) {
  return downloadFile(`/api/v1/image/upload/${encodeURIComponent(filename)}`, filename)
}