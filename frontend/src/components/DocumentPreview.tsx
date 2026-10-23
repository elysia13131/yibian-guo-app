import { useState, useEffect, useRef } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'

// 前端缓存：大图用 Map（仅当前会话），位置用 localStorage
const imageCache = new Map<string, string>() // url → base64 data URL

interface Props {
  fileUrl: string
  fileName: string
  docId: string
}

interface PreviewData {
  type: 'pdf' | 'image' | 'text'
  pages?: string[]
  url?: string
  content?: string
}

export default function DocumentPreview({ fileUrl, fileName, docId }: Props) {
  const [data, setData] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(0)
  const [cachedImages, setCachedImages] = useState<Record<string, string>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const posKey = `preview-pos-${docId}`

  // 渐进加载图片并缓存
  const loadAndCacheImage = async (url: string): Promise<string> => {
    const fullUrl = `${API_BASE_URL}${url}`
    // 先从内存缓存取
    const cached = imageCache.get(fullUrl)
    if (cached) return cached
    // 再从 localStorage 取
    const lsKey = `imgcache_${url}`
    try {
      const lsCached = localStorage.getItem(lsKey)
      if (lsCached) {
        imageCache.set(fullUrl, lsCached)
        return lsCached
      }
    } catch {}
    // 从网络加载
    const blob = await fetch(fullUrl).then(r => r.blob())
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
    imageCache.set(fullUrl, dataUrl)
    try { localStorage.setItem(lsKey, dataUrl) } catch {}
    return dataUrl
  }

  // 加载预览元数据
  useEffect(() => {
    if (!fileUrl) return
    setLoading(true)
    setError('')
    fetch(`${API_BASE_URL}/api/v1/documents/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: fileUrl }),
    })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({ detail: '加载失败' }))).detail || '加载失败')
        return res.json()
      })
      .then((d: PreviewData) => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [fileUrl])

  // 当前页图片变化时加载缓存
  useEffect(() => {
    if (!data?.pages || data.type !== 'image') return
    const pageUrls = data.pages
    // 恢复上次位置
    const saved = localStorage.getItem(posKey)
    const targetPage = saved ? Math.min(parseInt(saved, 10) || 0, pageUrls.length - 1) : 0
    setCurrentPage(targetPage)

    // 预加载当前页 + 下一页
    const pagesToLoad = [targetPage, targetPage + 1].filter(p => p < pageUrls.length)
    const uniqueUrls = [...new Set(pagesToLoad.map(p => pageUrls[p]))]
    Promise.all(uniqueUrls.map(async (url) => {
      const dataUrl = await loadAndCacheImage(url)
      return { url, dataUrl }
    })).then(results => {
      const map: Record<string, string> = {}
      for (const r of results) map[r.url] = r.dataUrl
      setCachedImages(map)
    })
  }, [data, posKey])

  // 翻页时预加载
  const goToPage = async (page: number) => {
    if (!data?.pages) return
    const clamped = Math.max(0, Math.min(data.pages.length - 1, page))
    setCurrentPage(clamped)
    localStorage.setItem(posKey, String(clamped))
    // 预加载相邻页
    const targets = [clamped - 1, clamped, clamped + 1].filter(p => p >= 0 && p < data.pages.length)
    const urls = targets.map(p => data.pages![p])
    const newCached = { ...cachedImages }
    for (const url of urls) {
      if (!newCached[url]) {
        loadAndCacheImage(url).then(dataUrl => {
          setCachedImages(prev => ({ ...prev, [url]: dataUrl }))
        })
      }
    }
  }

  // 键盘翻页
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPage(currentPage - 1)
      if (e.key === 'ArrowRight') goToPage(currentPage + 1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [currentPage, data])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-400/30 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm text-gray-500">加载预览中...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-500 mb-1">加载失败</p>
          <p className="text-sm text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  // PDF: iframe
  if (data?.type === 'pdf' && data.url) {
    return (
      <iframe src={`${API_BASE_URL}${data.url}`} className="w-full h-full border-none min-h-[70vh]" title={fileName} />
    )
  }

  // TXT: pre
  if (data?.type === 'text' && data.content) {
    return (
      <div className="overflow-auto h-full p-6">
        <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-800 dark:text-gray-200">
          {data.content}
        </pre>
      </div>
    )
  }

  // 图片
  if (data?.type === 'image' && data.pages && data.pages.length > 0) {
    const currentUrl = data.pages[currentPage]
    const cachedUrl = cachedImages[currentUrl] || `${API_BASE_URL}${currentUrl}`
    const total = data.pages.length

    return (
      <div className="flex flex-col h-full">
        {/* 图片区域 */}
        <div className="flex-1 flex items-center justify-center relative overflow-auto px-4 py-2" ref={containerRef}>
          {/* 左翻页箭头 */}
          {total > 1 && currentPage > 0 && (
            <button
              onClick={() => goToPage(currentPage - 1)}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center bg-white/70 dark:bg-gray-800/70 rounded-full shadow hover:bg-white dark:hover:bg-gray-700 transition"
            >
              ◀
            </button>
          )}

          <img
            ref={imgRef}
            src={cachedUrl}
            alt={`${fileName} 第${currentPage + 1}页`}
            className="max-w-full rounded border border-gray-200 dark:border-gray-700"
            style={{ maxHeight: 'calc(80vh - 120px)' }}
          />

          {/* 右翻页箭头 */}
          {total > 1 && currentPage < total - 1 && (
            <button
              onClick={() => goToPage(currentPage + 1)}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center bg-white/70 dark:bg-gray-800/70 rounded-full shadow hover:bg-white dark:hover:bg-gray-700 transition"
            >
              ▶
            </button>
          )}
        </div>

        {/* 页码 */}
        {total > 1 && (
          <div className="text-center py-2 text-sm text-gray-500 dark:text-gray-400 border-t dark:border-gray-700">
            {currentPage + 1} / {total}
          </div>
        )}
      </div>
    )
  }

  return <div className="text-gray-400 p-8 text-center">暂不支持该格式预览</div>
}
