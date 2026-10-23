import { useState, useEffect, useRef } from 'react'
import {
  ChevronDown, ChevronUp, Maximize2, Minimize2,
  Send, Check, RefreshCw,
  Sparkles, AlertCircle, Eye, EyeOff, Palette, Layout,
  Type, Hash, Layers
} from 'lucide-react'
import DownloadCard from './DownloadCard'

interface ToolAgentBubbleProps {
  thinkingSteps: string[]
  projectPath: string | null
  waitingFeedback: boolean
  phase: 'design' | 'export' | null
  designSpec: Record<string, unknown> | null
  onSend: (text: string) => void
  isDone: boolean
  pptxPath?: string
  filename?: string
  title?: string
  taskType?: string
  pageProgress?: { current: number; total: number } | null
}

const TASK_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  presentation: { icon: '🎨', label: 'PPT 生成', color: 'from-amber-500 to-orange-500' },
  document: { icon: '📄', label: '文档生成', color: 'from-blue-500 to-indigo-500' },
  chart: { icon: '📊', label: '图表生成', color: 'from-emerald-500 to-teal-500' },
  general: { icon: '⚙️', label: '任务执行', color: 'from-violet-500 to-purple-500' },
}

export default function ToolAgentBubble({
  thinkingSteps, projectPath, waitingFeedback, phase, designSpec, onSend,
  isDone, pptxPath, filename, title, taskType, pageProgress
}: ToolAgentBubbleProps) {

  const _colorLabel = (key: string): string => {
    const map: Record<string, string> = {
      primary: '主色', secondary: '辅色', accent: '强调色',
      background: '背景', text: '文字', textPrimary: '主文字',
      textSecondary: '辅文字', border: '边框', success: '成功',
      warning: '警告', error: '错误', info: '信息',
    }
    return map[key] || key
  }

  const _colorName = (hex: string): string => {
    const h = hex.replace('#', '').toLowerCase()
    if (h.length < 6) return ''
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const avg = (r + g + b) / 3

    if (max - min < 15 && avg > 240) return '纯白'
    if (max - min < 15 && avg > 200) return '浅灰'
    if (max - min < 15 && avg > 160) return '中灰'
    if (max - min < 15 && avg > 120) return '深灰'
    if (max - min < 15 && avg < 40) return '纯黑'

    if (r > 200 && g < 120 && b < 120) return '红色系'
    if (r > 200 && g < 150 && b > 150) return '粉色系'
    if (r > 200 && g > 150 && b < 100) return '橙色系'
    if (r > 200 && g > 180 && b < 120) return '黄色系'
    if (r < 100 && g > 180 && b < 120) return '绿色系'
    if (r < 100 && g < 180 && b > 200) return '蓝色系'
    if (r > 120 && g < 100 && b > 150) return '紫色系'
    if (r > 150 && g > 160 && b < 120) return '橄榄绿'

    if (r > 180 && g > 120 && b < 100) return '暖色'
    if (r < 80 && g < 80 && b < 80) return '深色'
    if (r < 120 && g < 120 && b < 120) return '暗色'
    if (r > 130 && g > 130 && b < 100) return '大地色'

    if (r > g && r > b) return '暖色系'
    if (b > r && b > g) return '冷色系'
    return '中性色'
  }

  const [thinkingExpanded, setThinkingExpanded] = useState(true)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [svgFiles, setSvgFiles] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [input, setInput] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const thinkingEndRef = useRef<HTMLDivElement>(null)
  const svgCountRef = useRef(0)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cfg = TASK_CONFIG[taskType || 'general'] || TASK_CONFIG.general
  const isPresentation = taskType === 'presentation'

  const fetchSvgList = async (signal?: AbortSignal) => {
    if (!projectPath) return
    const encoded = encodeURIComponent(projectPath)
    try {
      const res = await fetch(`/api/v1/image/ppt-preview/${encoded}/list`, { signal })
      const data = await res.json()
      if (data.files && data.files.length > svgCountRef.current) {
        setSvgFiles(data.files)
        svgCountRef.current = data.files.length
        setCurrentPage(data.files.length - 1)
      }
      setPreviewError('')
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setPreviewError('加载预览失败')
    }
  }

  useEffect(() => {
    if (!projectPath) return
    svgCountRef.current = 0
    setPreviewLoading(true)
    setPreviewError('')
    const ac = new AbortController()
    fetchSvgList(ac.signal).finally(() => setPreviewLoading(false))
    return () => ac.abort()
  }, [projectPath])

  useEffect(() => {
    if (!projectPath || isDone) return
    pollingRef.current = setInterval(() => fetchSvgList(), 3000)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [projectPath, isDone])

  useEffect(() => {
    if (pageProgress && pageProgress.current > 0) {
      fetchSvgList()
    }
  }, [pageProgress])

  useEffect(() => {
    thinkingEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thinkingSteps])

  useEffect(() => {
    if (!isDone || !pptxPath) return
    setCountdown(5)
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(timer); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [isDone, pptxPath])

  const currentSvgUrl = projectPath && svgFiles.length > 0
    ? `/api/v1/image/ppt-preview/${encodeURIComponent(projectPath)}?file=${svgFiles[currentPage]}`
    : null

  return (
    <div className="w-full max-w-3xl mx-auto bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.04)] border border-stone-200/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cfg.color} flex items-center justify-center text-white shadow-lg`}>
            <span className="text-sm">{cfg.icon}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-stone-800">{title || cfg.label}</h3>
              {!isDone && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium border border-amber-200/50">
                  {waitingFeedback ? (phase === 'design' ? '等待确认' : '等待反馈') :
                   phase === 'design' ? '设计中' :
                   '生成中'}
                </span>
              )}
              {isDone && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium border border-emerald-200/50">
                  已完成
                </span>
              )}
            </div>
            {isPresentation && svgFiles.length > 0 && (
              <p className="text-[11px] text-stone-400 mt-0.5">
                已生成 {svgFiles.length} 页幻灯片
              </p>
            )}
            {pageProgress && pageProgress.total > 0 && svgFiles.length === 0 && (
              <p className="text-[11px] text-stone-400 mt-0.5">
                正在生成: {pageProgress.current}/{pageProgress.total} 页
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isPresentation && svgFiles.length > 0 && (
            <button
              onClick={() => setPreviewExpanded(!previewExpanded)}
              className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
              title={previewExpanded ? '缩小预览' : '全屏预览'}
            >
              {previewExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Design Spec Card */}
      {phase === 'design' && designSpec && (
        <div className="px-5 py-4 border-b border-stone-100 bg-gradient-to-br from-blue-50/60 to-white">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-blue-100 text-blue-600">
              <Palette className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-semibold text-blue-700 tracking-wide uppercase">设计方案</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(!!designSpec.canvas || !!designSpec.canvasSize) && (
              <div className="flex items-start gap-2.5">
                <div className="p-1 rounded bg-blue-50 text-blue-400 flex-shrink-0 mt-0.5">
                  <Layout className="w-3 h-3" />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wider">画布</p>
                  <p className="text-xs font-medium text-stone-700">{designSpec.canvas as string || designSpec.canvasSize as string}</p>
                </div>
              </div>
            )}
            {!!designSpec.pages && (
              <div className="flex items-start gap-2.5">
                <div className="p-1 rounded bg-blue-50 text-blue-400 flex-shrink-0 mt-0.5">
                  <Hash className="w-3 h-3" />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wider">页数</p>
                  <p className="text-xs font-medium text-stone-700">{String(designSpec.pages)}</p>
                </div>
              </div>
            )}
            {!!designSpec.style && (
              <div className="flex items-start gap-2.5 col-span-2">
                <div className="p-1 rounded bg-blue-50 text-blue-400 flex-shrink-0 mt-0.5">
                  <Sparkles className="w-3 h-3" />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wider">风格</p>
                  <p className="text-xs text-stone-600 leading-relaxed">{String(designSpec.style)}</p>
                </div>
              </div>
            )}
            {!!designSpec.colors && typeof designSpec.colors === 'object' && (
              <div className="flex items-start gap-2.5 col-span-2">
                <div className="p-1 rounded bg-blue-50 text-blue-400 flex-shrink-0 mt-0.5">
                  <Palette className="w-3 h-3" />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wider mb-1.5">配色</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(designSpec.colors as Record<string, unknown>).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-stone-200/60 shadow-sm">
                        <div className="w-4 h-4 rounded border border-stone-200/50" style={{ backgroundColor: String(val) }} />
                        <span className="text-[10px] font-medium text-stone-500">{_colorLabel(key)}</span>
                        <span className="text-[9px] text-stone-400">{_colorName(String(val))}</span>
                        <span className="text-[9px] text-stone-300 font-mono">{String(val)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {!!designSpec.typography && typeof designSpec.typography === 'object' && (
              <div className="flex items-start gap-2.5 col-span-2">
                <div className="p-1 rounded bg-blue-50 text-blue-400 flex-shrink-0 mt-0.5">
                  <Type className="w-3 h-3" />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wider mb-1">字体</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(designSpec.typography as Record<string, unknown>).map(([key, val]) => (
                      <span key={key} className="text-[11px] text-stone-600">
                        <span className="text-stone-400">{key}:</span> {String(val)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          {!!designSpec.layout && typeof designSpec.layout === 'object' && (
            <div className="mt-3 pt-3 border-t border-stone-100 flex items-start gap-2.5">
              <div className="p-1 rounded bg-blue-50 text-blue-400 flex-shrink-0 mt-0.5">
                <Layers className="w-3 h-3" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wider mb-1">布局</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(designSpec.layout as Record<string, unknown>).map(([key, val]) => (
                    <span key={key} className="text-[11px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 font-medium">
                      {String(val)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Thinking Area */}
      {thinkingSteps.length > 0 && (
        <div className="border-b border-stone-100">
          <button
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
            className="flex items-center gap-2 px-5 py-2.5 w-full text-left hover:bg-stone-50/50 transition-colors"
          >
            <div className={`p-1 rounded-md transition-colors ${thinkingExpanded ? 'bg-amber-100 text-amber-600' : 'text-stone-400'}`}>
              {thinkingExpanded ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </div>
            <span className="text-xs font-medium text-stone-500">思考过程</span>
            <span className="text-[10px] text-stone-300">({thinkingSteps.length} 步)</span>
            <div className="ml-auto">
              {thinkingExpanded ? <ChevronUp className="w-3.5 h-3.5 text-stone-300" /> : <ChevronDown className="w-3.5 h-3.5 text-stone-300" />}
            </div>
          </button>
          {thinkingExpanded && (
            <div className="max-h-48 overflow-y-auto px-5 py-2.5 space-y-1.5 bg-stone-50/40">
              {thinkingSteps.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-stone-500 leading-relaxed">
                  <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium mt-0.5 ${
                    step.startsWith('✅') ? 'bg-emerald-100 text-emerald-600' :
                    step.startsWith('❌') ? 'bg-red-100 text-red-500' :
                    step.startsWith('⚠️') ? 'bg-amber-100 text-amber-600' :
                    step.startsWith('📋') ? 'bg-blue-100 text-blue-600' :
                    'bg-stone-100 text-stone-400'
                  }`}>
                    {step.startsWith('✅') ? '✓' :
                     step.startsWith('❌') ? '✗' :
                     step.startsWith('⚠️') ? '!' :
                     step.startsWith('📋') ? 'i' : i + 1}
                  </span>
                  <span className="pt-0.5">{step.replace(/^[✅❌⚠️📋🔄💬]\s*/, '')}</span>
                </div>
              ))}
              <div ref={thinkingEndRef} />
            </div>
          )}
        </div>
      )}

      {/* PPT Preview Area */}
      {isPresentation && (projectPath || previewLoading) && (
        <div className={`${previewExpanded ? 'min-h-[65vh]' : 'min-h-[420px]'} flex flex-col bg-stone-50/30`}>
          {/* Iteration Progress Bar */}
          {pageProgress && !isDone && pageProgress.total > 0 && (
            <div className="px-5 py-2 bg-amber-50/60 border-b border-amber-100/40">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-medium text-amber-600 whitespace-nowrap">生成进度</span>
                <div className="flex-1 h-1.5 rounded-full bg-amber-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, (pageProgress.current / Math.max(1, pageProgress.total)) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-medium text-amber-700 whitespace-nowrap">
                  {Math.min(pageProgress.current, pageProgress.total)}/{pageProgress.total} 页
                </span>
              </div>
            </div>
          )}
          {/* Preview Toolbar */}
          {svgFiles.length > 0 && (
            <div className="flex items-center justify-between px-5 py-2.5 bg-white border-b border-stone-100">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-stone-400 uppercase tracking-wider">预览</span>
                <span className="text-stone-200">|</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                    disabled={currentPage === 0}
                    className="px-2 py-1 text-xs rounded-md hover:bg-stone-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-stone-500"
                  >
                    ←
                  </button>
                  <span className="text-xs font-medium text-stone-600 min-w-[4rem] text-center">
                    {currentPage + 1} / {svgFiles.length}
                  </span>
                  <button
                    onClick={() => setCurrentPage(Math.min(svgFiles.length - 1, currentPage + 1))}
                    disabled={currentPage >= svgFiles.length - 1}
                    className="px-2 py-1 text-xs rounded-md hover:bg-stone-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-stone-500"
                  >
                    →
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-stone-400">
                {currentPage + 1} / {svgFiles.length} 页
              </div>
            </div>
          )}

          {/* SVG Content */}
          <div className="flex-1 flex items-center justify-center overflow-hidden relative bg-white">
            {previewError ? (
              <div className="flex flex-col items-center gap-2 text-stone-400">
                <AlertCircle className="w-8 h-8 text-red-300" />
                <p className="text-xs">{previewError}</p>
              </div>
            ) : currentSvgUrl ? (
              <object
                key={currentSvgUrl}
                data={currentSvgUrl}
                type="image/svg+xml"
                className={`${previewExpanded ? 'w-full h-full' : 'max-w-full max-h-[360px]'} object-contain`}
                aria-label={`幻灯片 ${currentPage + 1}`}
              >
                <div className="flex items-center gap-2 text-xs text-stone-400 p-8">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  加载中...
                </div>
              </object>
            ) : (
              <div className="flex flex-col items-center gap-3 text-stone-400">
                <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 animate-spin text-stone-300" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-stone-500">正在生成幻灯片...</p>
                  <p className="text-[11px] text-stone-400 mt-1">AI 正在逐页设计内容</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Done - Export Confirmed */}
      {isDone && (
        <div className="px-5 py-4 bg-gradient-to-br from-emerald-50/80 to-white border-t border-emerald-100/50">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Check className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800">
                {filename ? 'PPT 已导出' : '任务已完成'}
              </p>
              <p className="text-[11px] text-emerald-500 mt-0.5">
                {countdown > 0 ? `${countdown}秒后返回对话` : '已就绪'}
              </p>
            </div>
          </div>
          {filename && (
            <DownloadCard filePath={pptxPath || ''} filename={filename} fileType="pptx" />
          )}
        </div>
      )}

      {/* Feedback Input Area */}
      {isPresentation && waitingFeedback && (
        <div className="px-5 py-4 bg-white border-t border-stone-100">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <p className="text-xs font-medium text-stone-600">
              {phase === 'design' ? '设计方案已生成，可修改或直接确认' : '预览已生成，请输入修改意见或直接导出'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
                  e.preventDefault()
                  onSend(input.trim())
                  setInput('')
                }
              }}
              placeholder={phase === 'design' ? '输入对设计方案的修改意见...' : '输入修改意见，AI 会据此调整幻灯片...'}
              autoFocus
              className="flex-1 px-3.5 py-2.5 text-sm bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-300 text-stone-700 placeholder-stone-400 transition-all"
            />
            <button
              onClick={() => {
                if (input.trim()) {
                  onSend(input.trim())
                  setInput('')
                }
              }}
              disabled={!input.trim()}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center disabled:opacity-40 transition-all hover:shadow-lg hover:shadow-amber-500/25 active:scale-[0.95]"
            >
              <Send className="w-4 h-4" />
            </button>
            <button
              onClick={() => onSend('/export')}
              className={`flex-shrink-0 px-5 py-2.5 text-sm font-medium rounded-xl text-white transition-all active:scale-[0.95] shadow-lg ${
                phase === 'design'
                  ? 'bg-gradient-to-br from-blue-500 to-indigo-600 hover:shadow-blue-500/25'
                  : 'bg-gradient-to-br from-emerald-500 to-emerald-600 hover:shadow-emerald-500/25'
              }`}
            >
              {phase === 'design' ? '确认设计' : '确认导出'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}