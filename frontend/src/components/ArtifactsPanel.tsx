import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Download, FileText, Loader2, Image as ImageIcon, Eye, Clock, Trash2, Maximize2 } from 'lucide-react'
import { downloadOutputFile } from '../utils/download'
import type { ChartImage } from './ChartGrid'

export interface FileArtifact {
  type: string
  path: string
  title: string
  filename?: string
  status?: 'pending' | 'done'
  expires_at?: string | null
}

interface ArtifactsPanelProps {
  onClose: () => void
  chartImages: ChartImage[]
  onRemoveChart: (url: string) => void
  fileArtifacts?: FileArtifact[]
  onRemoveFileArtifact?: (index: number) => void
}

type ArtifactKind = 'chart' | 'file'

interface ArtifactItem {
  id: string
  kind: ArtifactKind
  url?: string
  path?: string
  title: string
  filename?: string
  type?: string
  status?: 'pending' | 'done'
  expires_at?: string | null
}

function basename(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || ''
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return ''
  const totalSec = Math.ceil(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function ArtifactsPanel({
  onClose,
  chartImages, onRemoveChart,
  fileArtifacts = [],
  onRemoveFileArtifact,
}: ArtifactsPanelProps) {
  const [filterTab, setFilterTab] = useState<'all' | 'charts' | 'files'>('all')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    timerRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const allArtifacts = useMemo<ArtifactItem[]>(() => {
    const seenUrls = new Set<string>()
    const charts: ArtifactItem[] = []
    for (let i = 0; i < chartImages.length; i++) {
      const img = chartImages[i]
      if (seenUrls.has(img.url)) continue
      seenUrls.add(img.url)
      charts.push({
        id: `chart-${img.url}-${i}`,
        kind: 'chart' as const,
        url: img.url,
        title: img.title || `图表 ${i + 1}`,
        status: 'done' as const,
      })
    }
    const files: ArtifactItem[] = fileArtifacts
      .filter(f => !seenUrls.has(f.path))
      .map((f, i) => ({
        id: `file-${f.path || f.title}-${i}`,
        kind: 'file' as const,
        path: f.path,
        title: f.title || f.filename || '未命名产物',
        filename: f.filename,
        type: f.type,
        status: f.status || 'done',
        expires_at: f.expires_at,
      }))
    return [...charts, ...files]
  }, [chartImages, fileArtifacts])

  const expiredIds = useMemo(() => {
    if (fileArtifacts.length === 0 || !onRemoveFileArtifact) return new Set<string>()
    const expired = new Set<string>()
    fileArtifacts.forEach((f, i) => {
      if (f.expires_at && f.status === 'done') {
        const expiresMs = new Date(f.expires_at).getTime()
        if (now >= expiresMs) {
          expired.add(`file-${f.path || f.title}-${i}`)
        }
      }
    })
    return expired
  }, [fileArtifacts, now, onRemoveFileArtifact])

  const expiredFileIndexes = useMemo(() => {
    if (!onRemoveFileArtifact) return new Set<number>()
    const set = new Set<number>()
    fileArtifacts.forEach((f, i) => {
      if (f.expires_at && f.status === 'done') {
        if (now >= new Date(f.expires_at).getTime()) {
          set.add(i)
        }
      }
    })
    return set
  }, [fileArtifacts, now, onRemoveFileArtifact])

  useEffect(() => {
    if (expiredFileIndexes.size > 0 && onRemoveFileArtifact) {
      const sorted = [...expiredFileIndexes].sort((a, b) => b - a)
      sorted.forEach(i => onRemoveFileArtifact(i))
    }
  }, [expiredFileIndexes, onRemoveFileArtifact])

  const filteredArtifacts = useMemo(() => {
    const active = allArtifacts.filter(
      a => a.kind === 'chart' || !expiredIds.has(a.id) || a.status === 'pending'
    )
    if (filterTab === 'all') return active
    if (filterTab === 'charts') return active.filter(a => a.kind === 'chart')
    return active.filter(a => a.kind === 'file')
  }, [allArtifacts, filterTab, expiredIds])

  const chartCount = new Set(chartImages.map(img => img.url)).size
  const fileCount = fileArtifacts.length
  const pendingCount = fileArtifacts.filter(f => f.status === 'pending').length
  const activeFileCount = fileArtifacts.filter(f => !expiredFileIndexes.has(fileArtifacts.indexOf(f)) || f.status === 'pending').length

  return (
    <>
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 360, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex flex-col border-l border-stone-200/60 bg-white/90 backdrop-blur-xl overflow-hidden flex-shrink-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-amber-50/80 to-orange-50/50 border-b border-stone-200/50 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <span className="text-xs font-semibold text-stone-700">产物</span>
          {pendingCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-amber-500">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              {pendingCount} 生成中
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-lg hover:bg-stone-100 flex items-center justify-center text-stone-400 hover:text-stone-600 transition-colors flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 px-2.5 pt-2 flex-shrink-0">
        {(['all', 'charts', 'files'] as const).map(tab => {
          const label = tab === 'all' ? '全部' : tab === 'charts' ? '图表' : '文件'
          const count = tab === 'all' ? chartCount + activeFileCount : tab === 'charts' ? chartCount : activeFileCount
          if (count === 0 && tab !== 'all') return null
          return (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                filterTab === tab
                  ? 'bg-amber-100 text-amber-700 shadow-sm'
                  : 'text-stone-400 hover:text-stone-600 hover:bg-stone-50'
              }`}
            >
              {label}
              <span className="ml-1 text-[9px] opacity-60">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2.5 py-2 space-y-1.5">
        {filteredArtifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-stone-300">
            <FileText className="w-8 h-8 mb-2" />
            <p className="text-[10px]">暂无产物</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredArtifacts.map((item, i) => {
              let countdownMs = 0
              if (item.expires_at && item.status === 'done') {
                countdownMs = new Date(item.expires_at).getTime() - now
              }
              const isExpired = countdownMs <= 0 && item.status === 'done' && item.expires_at

              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20, scale: 0.95 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.25) }}
                  className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-xl border transition-all ${
                    item.status === 'pending'
                      ? 'bg-amber-50/40 border-amber-200/30'
                      : isExpired
                        ? 'bg-red-50/40 border-red-200/30'
                        : 'bg-white/60 border-stone-200/50 hover:border-stone-300/60 hover:shadow-sm'
                  }`}
                >
                  {/* Icon / Thumbnail */}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden ${
                    item.status === 'pending' ? 'bg-amber-100/50' : isExpired ? 'bg-red-50' : 'bg-stone-50'
                  }`}>
                    {item.status === 'pending' ? (
                      <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                    ) : item.kind === 'chart' && item.url ? (
                      <img src={item.url} alt={item.title} className="w-full h-full object-contain p-0.5" onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f5f5f5" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23ccc" font-size="10">加载失败</text></svg>' }} />
                    ) : item.kind === 'file' && item.type === 'image' && (item.path?.startsWith('http') || item.path?.startsWith('/')) ? (
                      <img src={item.path} alt={item.title} className="w-full h-full object-contain p-0.5" onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f5f5f5" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23ccc" font-size="10">加载失败</text></svg>' }} />
                    ) : (
                      <FileText className="w-4 h-4 text-stone-400" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-medium truncate ${
                      item.status === 'pending' ? 'text-amber-600' : isExpired ? 'text-red-500' : 'text-stone-600'
                    }`}>
                      {item.title}
                    </p>
                    <p className="text-[9px] text-stone-400 truncate flex items-center gap-1">
                      {item.status === 'pending' ? (
                        '生成中...'
                      ) : isExpired ? (
                        '已过期'
                      ) : countdownMs > 0 && item.expires_at ? (
                        <><Clock className="w-2.5 h-2.5 inline" /> {formatCountdown(countdownMs)}</>
                      ) : (
                        item.filename || basename(item.path || '') || item.type || ''
                      )}
                    </p>
                  </div>

                  {/* Action */}
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {item.kind === 'file' && !isExpired && (item.filename || item.path) && item.status !== 'pending' && (
                      <button
                        onClick={async () => {
                          const ext = item.path ? (item.path.match(/\.[^./]+$/) || [''])[0] : ''
                          const safeName = item.title
                            ? (item.title.includes('.') ? item.title : item.title + ext)
                            : (item.filename || basename(item.path || '') || '下载')
                          if (item.path?.startsWith('/api/v1/') || item.path?.startsWith('http')) {
                            const { downloadFile } = await import('../utils/download')
                            downloadFile(item.path!, safeName)
                          } else {
                            downloadOutputFile(safeName)
                          }
                        }}
                        className="w-7 h-7 rounded-lg hover:bg-stone-100 flex items-center justify-center text-stone-400 hover:text-stone-600"
                        title="下载"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {item.kind === 'chart' && item.url && (
                      <button
                        onClick={() => setPreviewUrl(item.url!)}
                        className="w-7 h-7 rounded-lg hover:bg-stone-100 flex items-center justify-center text-stone-400 hover:text-stone-600"
                        title="放大查看"
                      >
                        <Maximize2 className="w-3 h-3" />
                      </button>
                    )}
                    {item.kind === 'chart' && item.url && item.status !== 'pending' && (
                      <button
                        onClick={async () => {
                          const chartUrl = item.url!
                          const ext = chartUrl.match(/\.[^./]+$/) || ['']
                          const safeName = item.title
                            ? (item.title.includes('.') ? item.title : item.title + ext[0])
                            : '图表'
                          const { downloadFile } = await import('../utils/download')
                          downloadFile(chartUrl, safeName)
                        }}
                        className="w-7 h-7 rounded-lg hover:bg-stone-100 flex items-center justify-center text-stone-400 hover:text-stone-600"
                        title="下载"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Footer */}
      {activeFileCount > 0 && fileArtifacts.every(f => f.status === 'done') && (
        <div className="px-3 py-2 border-t border-stone-200/50 text-[9px] text-stone-400 text-center flex-shrink-0 flex items-center justify-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          共 {activeFileCount} 个文件产物，24 小时后自动清理
        </div>
      )}
    </motion.aside>

      {/* Image preview lightbox */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 w-8 h-8 rounded-xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <img
            src={previewUrl}
            alt="预览"
            className="max-w-[90vw] max-h-[85vh] rounded-2xl shadow-2xl"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
      )}
    </>
  )
}