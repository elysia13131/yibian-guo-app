import { useState, useEffect, useRef, useCallback, type JSX } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, BookOpen, Menu, ArrowLeft, ChevronDown, ChevronRightIcon, Lightbulb, Sparkles, RefreshCw, Edit, Map as MapIcon, FileText, RefreshCw as RefreshIcon } from 'lucide-react'
import SectionGraph from '../components/SectionGraph'
import DocumentPreview from '../components/DocumentPreview'
import { useDocument, useChapters, useChapter, useUpdateLastReadChapter } from '../hooks/useDocuments'
import { api, analyticsApi, documentsApi } from '../api'
import { Markmap } from 'markmap-view'
import html2canvas from 'html2canvas'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/mhchem'
import { jsPDF } from 'jspdf'

function MathFormula({ formula, displayMode }: { formula: string; displayMode?: boolean }) {
  const ref = useRef<HTMLSpanElement | HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) {
      try {
        katex.render(formula, ref.current, { displayMode: displayMode ?? false, throwOnError: false })
      } catch {
        if (ref.current) {
          ref.current.textContent = formula
        }
      }
    }
  }, [formula, displayMode])

  if (displayMode) {
    return <div ref={ref as React.RefObject<HTMLDivElement>} className="my-4 flex justify-center overflow-x-auto" />
  }
  return <span ref={ref as React.RefObject<HTMLSpanElement>} />
}

interface ChapterData {
  id: number
  document_id: number
  title?: string | null
  content: string
  level: number
  order_index: number
  parent_id?: number | null
  start_offset?: number
  end_offset?: number
  created_at: string
}

export default function DocumentReaderPage() {
  const { id } = useParams<{ id: string }>()
  const documentId = id ? parseInt(id) : 0
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [viewMode, setViewMode] = useState<'chapter' | 'full' | 'preview'>('chapter')
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [reparsing, setReparsing] = useState(false)
  const [useRuleParsing, setUseRuleParsing] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set())
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const [expandedKnowledgePoints, setExpandedKnowledgePoints] = useState<Set<number>>(new Set())
  const [expandedAnalysis, setExpandedAnalysis] = useState<Set<number>>(new Set())
  const [_returnPosition, _setReturnPosition] = useState<{docId: number, chapterId: number} | null>(() => {
    const saved = sessionStorage.getItem('returnPosition')
    return saved ? JSON.parse(saved) : null
  })
  const [navigationHistory, setNavigationHistory] = useState<{docId: number, chapterId: number, title?: string}[]>(() => {
    const saved = sessionStorage.getItem('navigationHistory')
    return saved ? JSON.parse(saved) : []
  })
  const [loadingAnalysis, setLoadingAnalysis] = useState<Set<number>>(new Set())
  const [streamingAnalysis, setStreamingAnalysis] = useState<Record<number, string>>({})
  const [streamingReasoning, setStreamingReasoning] = useState<Record<number, string>>({})
  const [manualSplitMode, setManualSplitMode] = useState(false)
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set())
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [mergeProgress, setMergeProgress] = useState(0)
  const [urlParamsProcessed, setUrlParamsProcessed] = useState(false)
  const [readingSessionId, setReadingSessionId] = useState<number | null>(null)
  const [readingStartTime, setReadingStartTime] = useState<number | null>(null)
  const [currentReadingRecordId, setCurrentReadingRecordId] = useState<number | null>(null)
  
  // 思维导图相关状态
  const [showMindmap, setShowMindmap] = useState(false)
  const [mindmapData, setMindmapData] = useState<any>(null)
  const [isLoadingMindmap, setIsLoadingMindmap] = useState(false)
  const [isGeneratingMindmap, setIsGeneratingMindmap] = useState(false)
  const [selectedMindmapModel, setSelectedMindmapModel] = useState<string>('deepseek-chat')
  const mindmapContainerRef = useRef<HTMLDivElement>(null)
  const markmapInstanceRef = useRef<any>(null)



  // 创建阅读会话
  const createReadingSession = async (docId: number) => {
    try {
      const session = await analyticsApi.createSession(docId)
      console.log('📚 创建阅读会话:', session)
      setReadingSessionId(session.id)
      setReadingStartTime(Date.now())
      return session.id
    } catch (error) {
      console.error('创建阅读会话失败:', error)
      return null
    }
  }

  // 创建阅读记录
  const createReadingRecord = async (chapterId: number) => {
    if (!readingSessionId) return null
    
    try {
      const record = await analyticsApi.createReadingRecord(readingSessionId, chapterId)
      console.log('📝 创建阅读记录:', record)
      setCurrentReadingRecordId(record.id)
      return record.id
    } catch (error) {
      console.error('创建阅读记录失败:', error)
      return null
    }
  }

  // 更新阅读记录
  const updateReadingRecord = async (recordId: number, data: { is_completed?: boolean; progress?: number }) => {
    try {
      const record = await analyticsApi.updateReadingRecord(recordId, data)
      console.log('📝 更新阅读记录:', record)
      return record
    } catch (error) {
      console.error('更新阅读记录失败:', error)
      return null
    }
  }

  // 结束阅读会话
  const endReadingSession = async () => {
    if (!readingSessionId) return

    try {
      const duration = readingStartTime ? Math.round((Date.now() - readingStartTime) / 1000) : 0
      console.log('📚 结束阅读会话:', { sessionId: readingSessionId, duration })

      if (currentReadingRecordId) {
        await analyticsApi.updateReadingRecord(currentReadingRecordId, {
          is_completed: true,
          duration: duration
        })
      }

      await analyticsApi.endSession(readingSessionId)
      setReadingSessionId(null)
      setReadingStartTime(null)
      setCurrentReadingRecordId(null)
    } catch (error) {
      console.error('结束阅读会话失败:', error)
    }
  }

  // 组件卸载时结束会话
  useEffect(() => {
    return () => {
      if (readingSessionId) {
        endReadingSession()
      }
    }
  }, [readingSessionId])

  const analysisCache = useRef<Map<number, any>>(new Map())
  const knowledgePointsCache = useRef<Map<number, any>>(new Map())
  const analysisAccRef = useRef('')
  const reasoningAccRef = useRef('')
  const analysisThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('questionAnalysisCache')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        analysisCache.current = new Map(parsed)
      } catch (e) {
        console.error('Failed to load analysis cache:', e)
      }
    }
    const savedKP = localStorage.getItem('knowledgePointsCache')
    if (savedKP) {
      try {
        const parsed = JSON.parse(savedKP)
        knowledgePointsCache.current = new Map(parsed)
      } catch (e) {
        console.error('Failed to load knowledge points cache:', e)
      }
    }
  }, [])

  const saveKnowledgePointsCache = () => {
    const arr = Array.from(knowledgePointsCache.current.entries())
    localStorage.setItem('knowledgePointsCache', JSON.stringify(arr))
  }

  const addToNavigationHistory = (pos: {docId: number, chapterId: number, title?: string}) => {
    console.log('➕ 添加到导航历史:', pos)
    setNavigationHistory(prev => {
      const newHistory = [...prev, pos]
      sessionStorage.setItem('navigationHistory', JSON.stringify(newHistory))
      console.log('📍 当前导航历史:', newHistory)
      return newHistory
    })
  }

  const popFromNavigationHistory = () => {
    console.log('➖ 从导航历史弹出')
    setNavigationHistory(prev => {
      if (prev.length === 0) return prev
      const newHistory = prev.slice(0, -1)
      console.log('📍 弹出后导航历史:', newHistory)
      if (newHistory.length === 0) {
        sessionStorage.removeItem('navigationHistory')
      } else {
        sessionStorage.setItem('navigationHistory', JSON.stringify(newHistory))
      }
      return newHistory
    })
  }

  const saveAnalysisCache = () => {
    const arr = Array.from(analysisCache.current.entries())
    localStorage.setItem('questionAnalysisCache', JSON.stringify(arr))
  }

  const { data: currentDocument, isLoading: docLoading } = useDocument(documentId, searchParams.get('from') ?? undefined)
  const { data: chapters, isLoading: chaptersLoading } = useChapters(documentId)
  const updateLastRead = useUpdateLastReadChapter()

  useEffect(() => {
    if (chapters && chapters.length > 0) {
      const sectionOrderIndices = chapters.filter(c => c.level === 1).map(c => c.order_index)
      setCollapsedSections(new Set(sectionOrderIndices))
      
      // 创建阅读会话
      if (!readingSessionId && documentId) {
        createReadingSession(documentId)
      }
    }
  }, [chapters, documentId])

  // 章节变化时创建阅读记录
  useEffect(() => {
    if (selectedChapterId && readingSessionId && chapters && chapters.length > 0) {
      // 查找当前章节
      const chapter = chapters.find(c => c.id === selectedChapterId)
      if (chapter) {
        // 创建新的阅读记录
        createReadingRecord(selectedChapterId).then(recordId => {
          if (recordId) {
            // 更新最后阅读章节
            updateLastRead.mutate({ documentId, chapterId: selectedChapterId })
          }
        })
      }
    }
  }, [selectedChapterId, readingSessionId, chapters])

  // 滚动监听更新阅读进度
  useEffect(() => {
    const container = contentContainerRef.current
    if (!container || !currentReadingRecordId) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      if (scrollHeight <= clientHeight) return

      const scrollPercent = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)
      if (scrollPercent > 0) {
        updateReadingRecord(currentReadingRecordId, { progress: scrollPercent })
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [currentReadingRecordId])

  // 页面卸载时结束阅读会话
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (readingSessionId) {
        endReadingSession()
      }
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (readingSessionId) {
        endReadingSession()
      }
    }
  }, [readingSessionId])

  const { data: currentChapter } = useChapter(selectedChapterId || 0)
  const chapterRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const directoryRef = useRef<HTMLDivElement>(null)
  const contentContainerRef = useRef<HTMLDivElement>(null)

  const renderContent = (content: string) => {
    const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    const tableImgRegex = /\[表格图片:([^\]]+)\]/g
    const imgRegex = /\[图片:([^\]]+)\]/g
    const tableTextRegex = /\[表格开始\]([\s\S]*?)\[表格结束\]/g
    const parts: JSX.Element[] = []
    let lastIndex = 0
    let keyIndex = 0

    // 合并所有匹配并按索引排序处理
    const allMatches: { type: string, match: RegExpExecArray }[] = []
    
    let m
    while ((m = mdImgRegex.exec(content)) !== null) {
      allMatches.push({ type: 'mdImg', match: m })
    }
    while ((m = imgRegex.exec(content)) !== null) {
      allMatches.push({ type: 'img', match: m })
    }
    while ((m = tableImgRegex.exec(content)) !== null) {
      allMatches.push({ type: 'tableImg', match: m })
    }
    while ((m = tableTextRegex.exec(content)) !== null) {
      allMatches.push({ type: 'tableText', match: m })
    }
    
    // 按索引排序
    allMatches.sort((a, b) => a.match.index - b.match.index)
    
    for (const { type, match } of allMatches) {
      if (match.index > lastIndex) {
        const textPart = content.slice(lastIndex, match.index)
        renderTextParts(textPart, parts, keyIndex)
        keyIndex++
      }

      if (type === 'mdImg') {
        const imgPath = match[2]
        const altText = match[1] || '图片'
        // 如果是完整 URL 直接使用，否则加 API_BASE_URL 前缀
        const src = imgPath.startsWith('http') ? imgPath : `${import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'}/${imgPath}`
        parts.push(
          <div key={`mdimg-${keyIndex}`} className="my-4 overflow-x-auto">
            <img
              src={src}
              alt={altText}
              className="max-w-full h-auto border border-gray-300 dark:border-gray-600 rounded-lg"
              onError={(e) => {
                console.error(`Markdown图片加载失败:`, imgPath)
                e.currentTarget.style.display = 'none'
              }}
            />
          </div>
        )
      } else if (type === 'img' || type === 'tableImg') {
        let imgPath = match[1]
        // 规范化路径分隔符（Windows 后端可能产生反斜杠）
        imgPath = imgPath.replace(/\\/g, '/').replace(/^\.\//, '')
        const altText = type === 'tableImg' ? '表格图片' : '图片'
        parts.push(
          <div key={`${type}-${keyIndex}`} className="my-4 overflow-x-auto">
            <img
              src={`${import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'}/${imgPath}`}
              alt={altText}
              className="max-w-full h-auto border border-gray-300 dark:border-gray-600 rounded-lg"
              onError={(e) => {
                console.error(`${altText}加载失败:`, imgPath)
                e.currentTarget.style.display = 'none'
              }}
            />
          </div>
        )
      } else if (type === 'tableText') {
        const tableContent = match[1].trim()

        if (tableContent.startsWith('<table>')) {
          let styledTable = tableContent.replace(
            '<table>',
            '<table style="border-collapse:collapse;width:100%">'
          ).replace(
            /<td/g,
            '<td style="border:1px solid #d1d5db;padding:8px 12px;text-align:left"'
          ).replace(
            /<th/g,
            '<th style="border:1px solid #d1d5db;padding:8px 12px;text-align:left;font-weight:600;background-color:#f9fafb"'
          )
          // 表格内的 markdown 图片语法 → img 标签
          styledTable = styledTable.replace(
            /!\[([^\]]*)\]\(([^)]+)\)/g,
            '<img src="$2" alt="$1" style="max-width:100%;height:auto;border-radius:4px" />'
          )
          styledTable = styledTable
            .replace(/\$\$([\s\S]*?)\$\$/g, (_, f) => {
              try { return katex.renderToString(f.trim(), { displayMode: true, throwOnError: false }) }
              catch { return `$$${f}$$` }
            })
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, f) => {
              try { return katex.renderToString(f.trim(), { displayMode: true, throwOnError: false }) }
              catch { return `\\[${f}\\]` }
            })
            .replace(/\$(.+?)\$/g, (_, f) => {
              try { return katex.renderToString(f.trim(), { displayMode: false, throwOnError: false }) }
              catch { return `$${f}$` }
            })
            .replace(/\\\((.+?)\\\)/g, (_, f) => {
              try { return katex.renderToString(f.trim(), { displayMode: false, throwOnError: false }) }
              catch { return `\\(${f}\\)` }
            })
          parts.push(
            <div key={`table-html-${keyIndex}`} className="my-4 overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: styledTable }}
            />
          )
        } else {
          const rows = tableContent.split('\n').filter(row => row.trim())

          if (rows.length > 0) {
            parts.push(
              <div key={`table-text-${keyIndex}`} className="my-4 overflow-x-auto">
                <table className="min-w-full border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                  <tbody>
                    {rows.map((row, rowIdx) => {
                      const cells = row.split('|').map(cell => cell.trim())
                      return (
                        <tr key={`row-${rowIdx}`} className={rowIdx === 0 ? 'bg-gray-100 dark:bg-gray-700' : 'bg-white dark:bg-gray-800'}>
                          {cells.map((cell, cellIdx) => (
                            <td
                              key={`cell-${cellIdx}`}
                              className={`px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 ${
                                rowIdx === 0 ? 'font-semibold bg-gray-50 dark:bg-gray-700' : ''
                              }`}
                            >
                              {cell ? renderCellContent(cell, `cell-${rowIdx}-${cellIdx}`) : '\u00A0'}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        }
      }

      lastIndex = match.index + match[0].length
      keyIndex++
    }

    if (lastIndex < content.length) {
      const textPart = content.slice(lastIndex)
      renderTextParts(textPart, parts, keyIndex)
    }

    return parts.length > 0 ? parts : null
  }

  const renderLineWithMath = (line: string, lineKey: string): JSX.Element[] => {
    const elements: JSX.Element[] = []
    const displayRegex = /(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\])/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = displayRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        const beforeText = line.slice(lastIndex, match.index)
        const inlineParts = renderInlineMath(beforeText, `${lineKey}-dpre-${lastIndex}`)
        elements.push(...inlineParts)
      }
      const formula = (match[1] || match[2] || '').trim()
      elements.push(
        <MathFormula key={`${lineKey}-dmath-${match.index}`} formula={formula} displayMode />
      )
      lastIndex = match.index + match[0].length
    }

    if (lastIndex < line.length) {
      const remaining = line.slice(lastIndex)
      const inlineParts = renderInlineMath(remaining, `${lineKey}-dafter-${lastIndex}`)
      elements.push(...inlineParts)
    }

    return elements.length > 0 ? elements : [<span key={lineKey}>{line}</span>]
  }

  const renderCellContent = (cell: string, cellKey: string): JSX.Element[] => {
    // 表格单元格可能包含 markdown 图片语法，先处理图片再处理数学公式
    const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    const hasImg = mdImgRegex.test(cell)
    mdImgRegex.lastIndex = 0 // reset
    if (!hasImg) {
      return renderLineWithMath(cell, cellKey)
    }
    // 有图片：按 split(带捕获组) 逐段渲染
    // segments 格式: [text0, alt0, src0, text1, alt1, src1, ...]
    const segments = cell.split(mdImgRegex)
    const elements: JSX.Element[] = []
    for (let i = 0; i < segments.length; i++) {
      if (segments[i]) {
        elements.push(...renderLineWithMath(segments[i], `${cellKey}-seg-${i}`))
      }
      // i 为 text 段 (偶数)，且后面跟有 alt+src 时，取出图片
      if (i % 2 === 0 && i + 2 < segments.length) {
        const alt = segments[i + 1]
        const src = segments[i + 2]
        if (src) {
          const imgSrc = src.startsWith('http') ? src : `${import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'}/${src}`
          elements.push(
            <img key={`${cellKey}-img-${i}`} src={imgSrc} alt={alt || ''}
              className="max-w-full h-auto rounded my-1" style={{ maxHeight: '200px' }}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )
        }
        i += 2 // 跳过 alt 和 src 段
      }
    }
    return elements.length > 0 ? elements : [<span key={`${cellKey}-empty`}>{cell}</span>]
  }

  const renderInlineMath = (text: string, key: string): JSX.Element[] => {
    const elements: JSX.Element[] = []
    const inlineRegex = /(?:\$(.+?)\$|\\\((.+?)\\\))/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = inlineRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        elements.push(<span key={`${key}-pre-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>)
      }
      const formula = (match[1] || match[2] || '').trim()
      elements.push(
        <MathFormula key={`${key}-math-${match.index}`} formula={formula} />
      )
      lastIndex = match.index + match[0].length
    }

    if (lastIndex < text.length) {
      elements.push(<span key={`${key}-rem-${lastIndex}`}>{text.slice(lastIndex)}</span>)
    }

    return elements
  }

  const renderTextParts = (textPart: string, parts: JSX.Element[], keyIndex: number) => {
    textPart.split('\n').forEach((line, idx) => {
      if (line.trim()) {
        const rendered = renderLineWithMath(line, `text-${keyIndex}-${idx}`)
        parts.push(
          <p key={`text-${keyIndex}-${idx}`} className="mb-2 text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap w-full">
            {rendered}
          </p>
        )
      }
    })
  }

  useEffect(() => {
    setUrlParamsProcessed(false)
    setSelectedChapterId(null)
  }, [documentId])

  useEffect(() => {
    if (!chapters || chapters.length === 0) return

    const chapterIdFromUrl = searchParams.get('chapterId')
    const chapterOrderFromUrl = searchParams.get('chapterOrder')
    const targetTitleFromUrl = searchParams.get('targetTitle')

    console.log('🔍 检查URL参数:', { chapterIdFromUrl, chapterOrderFromUrl, targetTitleFromUrl })

    if (chapterIdFromUrl) {
      const targetChapterId = parseInt(chapterIdFromUrl)
      const targetChapter = chapters.find(c => c.id === targetChapterId)
      if (targetChapter) {
        console.log('🎯 URL参数跳转，章节视图(chapterId):', targetChapter.title)
        setSelectedChapterId(targetChapterId)
        setViewMode('chapter')
        setUrlParamsProcessed(true)
        return
      }
    }

    if (chapterOrderFromUrl) {
      const targetChapterOrder = parseInt(chapterOrderFromUrl)
      const targetChapter = chapters.find(c => c.order_index === targetChapterOrder)
      if (targetChapter) {
        console.log('🎯 URL参数跳转，章节视图(order):', targetChapter.title)
        setSelectedChapterId(targetChapter.id)
        setViewMode('chapter')
        setUrlParamsProcessed(true)
        return
      }
    }

    if (targetTitleFromUrl) {
      const decodedTitle = decodeURIComponent(targetTitleFromUrl)
      console.log('🔍 正在查找目标章节:', decodedTitle)
      console.log('🔍 当前章节列表:', chapters.map(c => ({ id: c.id, title: c.title })))
      const targetChapter = chapters.find(c => c.title === decodedTitle)
      if (targetChapter) {
        console.log('🎯 URL参数跳转，章节视图(targetTitle):', targetChapter.title)
        setSelectedChapterId(targetChapter.id)
        setViewMode('chapter')
        setUrlParamsProcessed(true)
        return
      } else {
        console.log('⚠️ 未找到匹配的章节，尝试模糊匹配')
        const fuzzyMatch = chapters.find(c => c.title && c.title.includes(decodedTitle))
        if (fuzzyMatch) {
          console.log('🎯 模糊匹配到章节:', fuzzyMatch.title)
          setSelectedChapterId(fuzzyMatch.id)
          setViewMode('chapter')
          setUrlParamsProcessed(true)
          return
        }
      }
    }
  }, [chapters, searchParams, documentId])

  useEffect(() => {
    if (urlParamsProcessed === false && selectedChapterId) {
      setUrlParamsProcessed(true)
    }
  }, [urlParamsProcessed, selectedChapterId])

  useEffect(() => {
    if (urlParamsProcessed && !selectedChapterId && chapters && chapters.length > 0) {
      if (currentDocument?.last_read_chapter_id) {
        setSelectedChapterId(currentDocument.last_read_chapter_id)
      } else {
        const firstContentChapter = chapters.find(c => c.level === 2)
        setSelectedChapterId(firstContentChapter?.id || chapters[0].id)
      }
    }
  }, [urlParamsProcessed, selectedChapterId, chapters, currentDocument?.last_read_chapter_id])

  useEffect(() => {
    if (selectedChapterId && documentId) {
      updateLastRead.mutate({ documentId, chapterId: selectedChapterId })
    }
  }, [selectedChapterId, documentId])

  useEffect(() => {
    if (selectedChapterId && directoryRef.current) {
      const chapterElement = chapterRefs.current.get(selectedChapterId)
      if (chapterElement) {
        chapterElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [selectedChapterId])

  useEffect(() => {
    setExpandedKnowledgePoints(new Set())
    setExpandedAnalysis(new Set())
  }, [selectedChapterId])

  const fetchAnalysis = async (chapterId: number, chapterTitle: string, chapterContent: string) => {
    if (analysisCache.current.has(chapterId)) {
      return analysisCache.current.get(chapterId)
    }

    setLoadingAnalysis(prev => new Set(prev).add(chapterId))
    try {
      const token = localStorage.getItem('token')
      const baseUrl = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
      const response = await fetch(`${baseUrl}/api/v1/analysis/analyze-question-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: chapterTitle || '',
          content: chapterContent || '',
          options: null,
          answer: null,
          knowledge_points: null
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullReasoning = ''
      let fullContent = ''

      const throttledUpdate = () => {
        if (!analysisThrottleRef.current) {
          analysisThrottleRef.current = setTimeout(() => {
            analysisThrottleRef.current = null
            setStreamingAnalysis(prev => ({ ...prev, [chapterId]: analysisAccRef.current }))
          }, 80)
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.step === 'reasoning' && data.token !== undefined) {
                fullReasoning = data.full
                reasoningAccRef.current = fullReasoning
                setStreamingReasoning(prev => ({ ...prev, [chapterId]: fullReasoning }))
              }
              if (data.step === 'content' && data.token !== undefined) {
                fullContent = data.full
                analysisAccRef.current = fullContent
                throttledUpdate()
              }
              if (data.done) {
                if (analysisThrottleRef.current) {
                  clearTimeout(analysisThrottleRef.current)
                  analysisThrottleRef.current = null
                }
                const finalReasoning = data.reasoning || fullReasoning
                const finalContent = data.content || fullContent
                setStreamingReasoning(prev => ({ ...prev, [chapterId]: finalReasoning }))
                setStreamingAnalysis(prev => ({ ...prev, [chapterId]: finalContent }))
                const result = {
                  knowledge_points: [],
                  analysis: finalContent,
                  reasoning: finalReasoning,
                  answer: null,
                  related_questions: [],
                  related_paragraphs: []
                }
                analysisCache.current.set(chapterId, result)
                saveAnalysisCache()
                setStreamingReasoning(prev => {
                  const next = { ...prev }
                  delete next[chapterId]
                  return next
                })
                setStreamingAnalysis(prev => {
                  const next = { ...prev }
                  delete next[chapterId]
                  return next
                })
                setLoadingAnalysis(prev => {
                  const newSet = new Set(prev)
                  newSet.delete(chapterId)
                  return newSet
                })
                return result
              }
              if (data.error) {
                throw new Error(data.error)
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue
              throw e
            }
          }
        }
      }
    } catch (error) {
      console.error('获取分析失败:', error)
      if (analysisThrottleRef.current) {
        clearTimeout(analysisThrottleRef.current)
        analysisThrottleRef.current = null
      }
      setStreamingAnalysis(prev => {
        const next = { ...prev }
        delete next[chapterId]
        return next
      })
      setStreamingReasoning(prev => {
        const next = { ...prev }
        delete next[chapterId]
        return next
      })
      setLoadingAnalysis(prev => {
        const newSet = new Set(prev)
        newSet.delete(chapterId)
        return newSet
      })
      return null
    }
  }

  const handleChapterSelect = (chapterId: number) => {
    const chapter = chapters?.find(c => c.id === chapterId)
    if (chapter?.level === 1) {
      if (collapsedSections.has(chapter.order_index)) {
        setCollapsedSections(prev => {
          const newSet = new Set(prev)
          newSet.delete(chapter.order_index)
          return newSet
        })
      } else {
        setCollapsedSections(prev => new Set(prev).add(chapter.order_index))
      }
    }
    setSelectedChapterId(chapterId)
    if (window.innerWidth < 768) {
      setShowSidebar(false)
    }
  }

  const hasPreviousSection = () => {
    if (!currentChapter || !chapters) return false

    if (isQuizBank) {
      if (currentChapter.level === 1) {
        const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
        for (let i = currentIndex - 1; i >= 0; i--) {
          if (chapters[i].level === 1) return true
        }
        return false
      }
      const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (chapters[i].level === 2) return true
      }
      return false
    } else {
      const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (chapters[i].level <= currentChapter.level) return true
      }
      return false
    }
  }

  const hasNextSection = () => {
    if (!currentChapter || !chapters) return false

    if (isQuizBank) {
      if (currentChapter.level === 1) {
        const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
        for (let i = currentIndex + 1; i < chapters.length; i++) {
          if (chapters[i].level === 1) return true
        }
        return false
      }
      const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
      for (let i = currentIndex + 1; i < chapters.length; i++) {
        if (chapters[i].level === 2) return true
      }
      return false
    } else {
      const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
      for (let i = currentIndex + 1; i < chapters.length; i++) {
        if (chapters[i].level <= currentChapter.level) return true
      }
      return false
    }
  }

  const handlePreviousChapter = () => {
    if (!currentChapter || !chapters) return

    if (isQuizBank) {
      if (currentChapter.level === 1) {
        const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
        for (let i = currentIndex - 1; i >= 0; i--) {
          if (chapters[i].level === 1) {
            setSelectedChapterId(chapters[i].id)
            return
          }
        }
      } else {
        const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
        for (let i = currentIndex - 1; i >= 0; i--) {
          if (chapters[i].level === 2) {
            setSelectedChapterId(chapters[i].id)
            return
          }
        }
      }
    } else {
      const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (chapters[i].level <= currentChapter.level) {
          setSelectedChapterId(chapters[i].id)
          return
        }
      }
    }
  }

  const handleNextChapter = () => {
    if (!currentChapter || !chapters) return

    if (isQuizBank) {
      if (currentChapter.level === 1) {
        const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
        for (let i = currentIndex + 1; i < chapters.length; i++) {
          if (chapters[i].level === 1) {
            setSelectedChapterId(chapters[i].id)
            return
          }
        }
      } else {
        const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
        for (let i = currentIndex + 1; i < chapters.length; i++) {
          if (chapters[i].level === 2) {
            setSelectedChapterId(chapters[i].id)
            return
          }
        }
      }
    } else {
      const currentIndex = chapters.findIndex(c => c.id === currentChapter.id)
      for (let i = currentIndex + 1; i < chapters.length; i++) {
        if (chapters[i].level <= currentChapter.level) {
          setSelectedChapterId(chapters[i].id)
          return
        }
      }
    }
  }

  const getSectionTitle = (chapter: ChapterData, chapters: ChapterData[] | undefined): string | null | undefined => {
    if (chapter.level !== 2 || !chapters) return null

    for (let i = chapter.order_index - 1; i >= 0; i--) {
      const prev = chapters.find(c => c.order_index === i)
      if (prev && prev.level === 1) {
        return prev.title
      }
    }
    return null
  }

  const filteredChapters = viewMode === 'full' 
    ? chapters 
    : chapters?.filter(chapter => {
        if (chapter.level === 1) return true
        const sectionTitle = getSectionTitle(chapter, chapters)
        if (!sectionTitle) return true
        const sectionChapter = chapters?.find(c => c.title === sectionTitle && c.level === 1)
        if (!sectionChapter) return true
        return !collapsedSections.has(sectionChapter.order_index)
      })

  // 添加调试信息
  useEffect(() => {
    if (chapters) {
      console.log('📖 文档章节数据:', {
        total: chapters.length,
        isQuizBank: chapters.some(c => c.level === 2),
        chapters: chapters.map(c => ({
          id: c.id,
          title: c.title,
          level: c.level,
          order_index: c.order_index,
          contentLength: c.content?.length || 0,
          contentPreview: c.content?.substring(0, 100)
        }))
      })
    }
  }, [chapters])

  const isQuizBank = true

  const getDisplayContent = () => {
    if (!currentChapter || !chapters) return []

    console.log('🔍 getDisplayContent 调用:', {
      currentChapter: { id: currentChapter.id, title: currentChapter.title, level: currentChapter.level, order_index: currentChapter.order_index },
      isQuizBank,
      chaptersCount: chapters.length
    })

    if (isQuizBank) {
      if (currentChapter.level === 1) {
        const nextSectionIndex = chapters.findIndex(c => c.level === 1 && c.order_index > currentChapter.order_index)
        const endIndex = nextSectionIndex === -1 ? chapters.length : nextSectionIndex

        const sectionChapters = chapters.filter(c =>
          c.order_index > currentChapter.order_index &&
          c.order_index < endIndex
        )

        const hasQuestions = sectionChapters.some(c => c.level === 2)

        if (hasQuestions) {
          return sectionChapters.filter(c => c.level === 2)
        }

        if (sectionChapters.length > 0) {
          return sectionChapters
        }

        return [currentChapter]
      }
      return [currentChapter]
    }
    return []
  }

  const displayContent = getDisplayContent()

  const [hasScrolled, setHasScrolled] = useState(false)

  useEffect(() => {
    console.log('🔄 滚动触发条件检查:', {
      selectedChapterId,
      displayContentLength: displayContent.length,
      chaptersLength: chapters?.length || 0,
      chapterIdFromUrl: searchParams.get('chapterId'),
      chapterOrderFromUrl: searchParams.get('chapterOrder'),
      hasScrolled,
      viewMode
    })
    
    if (selectedChapterId && displayContent.length > 0 && chapters) {
      const chapterIdFromUrl = searchParams.get('chapterId')
      const chapterOrderFromUrl = searchParams.get('chapterOrder')
      const isFromUrl = chapterIdFromUrl || chapterOrderFromUrl
      
      if (!hasScrolled || isFromUrl) {
        const delay = isFromUrl ? 1500 : 500
        console.log(`⏱️ 等待 ${delay}ms 后滚动`)
        
        setTimeout(() => {
          console.log('🚀 开始滚动')
          setHasScrolled(true)
        }, delay)
      }
    }
  }, [selectedChapterId, displayContent, chapters, searchParams, hasScrolled, viewMode])

  useEffect(() => {
    console.log('📄 文档切换，重置滚动状态')
    setHasScrolled(false)
  }, [documentId])

  const handleKnowledgePointsClick = async (chapter: ChapterData) => {
    const newSet = new Set(expandedKnowledgePoints)
    if (newSet.has(chapter.id)) {
      newSet.delete(chapter.id)
    } else {
      newSet.add(chapter.id)
      console.log('知识点关联开始搜索:', chapter.title)
      try {
        const queryText = [chapter.title, chapter.content].filter(Boolean).join(' ').slice(0, 500)
        const result = await api.get(`/api/v1/vector-db/search?query=${encodeURIComponent(queryText)}&n_results=20&category=question`) as any
        console.log('知识点关联搜索结果:', result)
        if (result.results && result.results.length > 0) {
          console.log('知识点关联: 第一个结果metadata:', result.results[0].metadata)
          console.log('知识点关联: 所有结果category值:', result.results.map((r: any) => r.metadata?.category))
        } else {
          console.log('知识点关联: 向量数据库中没有找到相关内容')
        }
        const analysisData = {
          knowledge_points: [],
          analysis: '',
          answer: null,
          related_questions: (() => {
            const seen = new Set<string>()
            return result.results?.filter((r: any) => {
              if (r.metadata?.category !== 'question') return false
              if (r.metadata?.title === chapter.title) return false
              // 去重：按 document_id + title + content 前200字哈希
              const dedupKey = `${r.metadata?.document_id || ''}|${r.metadata?.title || ''}|${(r.metadata?.full_content || r.content || '').slice(0, 200)}`
              if (seen.has(dedupKey)) return false
              seen.add(dedupKey)
              return true
            }).map((r: any) => ({
              id: r.id,
              content: r.metadata?.full_content || r.content,
              distance: r.distance,
              metadata: r.metadata
            })) || []
          })(),
          related_paragraphs: result.results?.filter((r: any) => {
            if (r.metadata?.category !== 'paragraph') return false
            const sameChapter = r.metadata?.chapter_order === chapter.order_index && r.metadata?.document_id === String(chapter.document_id)
            if (sameChapter) return false
            return r.distance < 0.1
          }).map((r: any) => ({
            id: r.id,
            content: r.content,
            distance: r.distance,
            metadata: r.metadata
          })) || []
        }
        console.log('知识点关联处理后的数据:', analysisData)
        knowledgePointsCache.current.set(chapter.id, analysisData)
        saveKnowledgePointsCache()
      } catch (error) {
        console.error('知识点关联搜索失败:', error)
      }
    }
    setExpandedKnowledgePoints(newSet)
  }

  const handleAnalysisClick = async (chapter: ChapterData) => {
    const newSet = new Set(expandedAnalysis)
    if (newSet.has(chapter.id)) {
      newSet.delete(chapter.id)
    } else {
      newSet.add(chapter.id)
      if (!analysisCache.current.has(chapter.id)) {
        setExpandedAnalysis(newSet)
        await fetchAnalysis(chapter.id, chapter.title || '', chapter.content || '')
        return
      }
    }
    setExpandedAnalysis(newSet)
  }

  const renderAnalysisContent = useCallback((text: string) => {
    if (!text) return { __html: '' }
    let html = text
      .replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => {
        try { return katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false }) }
        catch { return `$$${formula}$$` }
      })
      .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula) => {
        try { return katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false }) }
        catch { return `\\[${formula}\\]` }
      })
      .replace(/\$(.+?)\$/g, (_, formula) => {
        try { return katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false }) }
        catch { return `$${formula}$` }
      })
      .replace(/\\\((.+?)\\\)/g, (_, formula) => {
        try { return katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false }) }
        catch { return `\\(${formula}\\)` }
      })
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs">$1</code>')
      .replace(/^##### (.+)$/gm, '<h6 class="font-semibold mt-2 mb-1 text-[11px]">$1</h6>')
      .replace(/^#### (.+)$/gm, '<h5 class="font-semibold mt-2 mb-1 text-xs">$1</h5>')
      .replace(/^### (.+)$/gm, '<h4 class="font-semibold mt-2 mb-1 text-sm">$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 class="font-semibold mt-2 mb-1 text-sm">$1</h3>')
      .replace(/^# (.+)$/gm, '<h2 class="font-semibold mt-2 mb-1 text-sm">$1</h2>')
      .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
      .replace(/\n\n+/g, '</p><p class="mb-2">')
      .replace(/\n/g, '<br/>')
    html = '<p class="mb-2">' + html + '</p>'
    return { __html: html }
  }, [])

  const handleRefreshAnalysis = async (chapter: ChapterData) => {
    analysisCache.current.delete(chapter.id)
    await fetchAnalysis(chapter.id, chapter.title || '', chapter.content || '')
  }

  // 思维导图相关方法
  const fetchMindmap = async () => {
    if (!documentId) return
    
    setIsLoadingMindmap(true)
    try {
      const response = await documentsApi.getMindmap(documentId)
      if (response.success && response.data) {
        setMindmapData(JSON.parse(response.data))
        setIsGeneratingMindmap(false)
      } else if (response.status === 'generating') {
        // 思维导图正在生成中
        setMindmapData(null)
        setIsGeneratingMindmap(true)
        // 开始轮询检查结果
        startPollingMindmap()
      } else if (response.status === 'not_generated') {
        // 从未生成过
        setMindmapData(null)
        setIsGeneratingMindmap(false)
      } else {
        setMindmapData(null)
      }
    } catch (error) {
      console.error('获取思维导图失败:', error)
      setMindmapData(null)
    } finally {
      setIsLoadingMindmap(false)
    }
  }

  // 轮询检查思维导图生成状态
  const startPollingMindmap = useCallback(() => {
    let attempts = 0
    const maxAttempts = 200 // 最多等待10分钟（每3秒一次）
    
    const poll = async () => {
      if (attempts >= maxAttempts || !documentId) {
        setIsGeneratingMindmap(false)
        return
      }
      
      attempts++
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      try {
        const checkResponse = await documentsApi.getMindmap(documentId)
        if (checkResponse.success && checkResponse.data) {
          setMindmapData(JSON.parse(checkResponse.data))
          setIsGeneratingMindmap(false)
          return
        }
        if (checkResponse.status === 'generating') {
          poll()
        } else {
          setIsGeneratingMindmap(false)
        }
      } catch (e) {
        console.error('检查思维导图状态失败:', e)
        poll()
      }
    }
    
    poll()
  }, [documentId])

  const generateMindmap = async () => {
    if (!documentId) return

    setIsGeneratingMindmap(true)
    try {
      const response = await documentsApi.generateMindmap(documentId, selectedMindmapModel)
      if (response.success) {
        if (response.data) {
          // API直接返回了数据
          setMindmapData(JSON.parse(response.data))
          setIsGeneratingMindmap(false)
        } else {
          // 后台生成中，轮询检查结果
          alert(response.message || '思维导图生成中...')
          const pollForResult = async () => {
            let attempts = 0
            const maxAttempts = 60 // 最多等待60次（约3分钟）
            while (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 3000))
              try {
                const checkResponse = await documentsApi.getMindmap(documentId)
                if (checkResponse.success && checkResponse.data) {
                  setMindmapData(JSON.parse(checkResponse.data))
                  setIsGeneratingMindmap(false)
                  return
                }
              } catch (e) {
                console.error('检查思维导图状态失败:', e)
              }
              attempts++
            }
            // 超时后设为false
            setIsGeneratingMindmap(false)
            alert('思维导图生成超时，请稍后刷新重试')
          }
          pollForResult()
        }
      }
    } catch (error) {
      console.error('生成思维导图失败:', error)
      alert('生成思维导图失败，请稍后重试')
      setIsGeneratingMindmap(false)
    }
  }

  const regenerateMindmap = async () => {
    if (!documentId) return

    setIsGeneratingMindmap(true)
    try {
      const response = await documentsApi.regenerateMindmap(documentId, selectedMindmapModel)
      if (response.success) {
        if (response.data) {
          // API直接返回了数据
          setMindmapData(JSON.parse(response.data))
          setIsGeneratingMindmap(false)
        } else {
          // 后台生成中，轮询检查结果
          alert(response.message || '思维导图重新生成中...')
          const pollForResult = async () => {
            let attempts = 0
            const maxAttempts = 60
            while (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 3000))
              try {
                const checkResponse = await documentsApi.getMindmap(documentId)
                if (checkResponse.success && checkResponse.data) {
                  setMindmapData(JSON.parse(checkResponse.data))
                  setIsGeneratingMindmap(false)
                  return
                }
              } catch (e) {
                console.error('检查思维导图状态失败:', e)
              }
              attempts++
            }
            setIsGeneratingMindmap(false)
            alert('思维导图生成超时，请稍后刷新重试')
          }
          pollForResult()
        }
      }
    } catch (error) {
      console.error('重新生成思维导图失败:', error)
      alert('重新生成思维导图失败，请稍后重试')
      setIsGeneratingMindmap(false)
    }
  }

  const exportMindmapAsPDF = () => {
    if (!mindmapContainerRef.current || !markmapInstanceRef.current || !mindmapData) return

    const mm = markmapInstanceRef.current
    const svg = mindmapContainerRef.current.querySelector('svg')
    if (!svg) return

    try {
      const transformedData = transformMindmapData(mindmapData)
      if (!transformedData) return

      mm.setData(transformedData, { initialExpandLevel: 999 })

      requestAnimationFrame(async () => {
        try {
          const container = mindmapContainerRef.current
          if (!container) return

          // foreignObject 必须在 DOM 中才能被浏览器渲染，用 html2canvas 捕获
          const canvas = await html2canvas(container, {
            backgroundColor: '#ffffff',
            scale: 10,
            useCORS: true,
            logging: false,
          })

          const doc = new jsPDF({
            orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height],
          })

          doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height)
          doc.save(`${currentDocument?.title || 'mindmap'}.pdf`)
        } catch (e) {
          console.error('导出PDF失败:', e)
        }
      })
    } catch (e) {
      console.error('导出思维导图PDF失败:', e)
    }
  }

  const expandAllMindmap = () => {
    if (!markmapInstanceRef.current || !mindmapData) return
    const mm = markmapInstanceRef.current
    const transformedData = transformMindmapData(mindmapData)
    if (!transformedData) return
    mm.setData(transformedData, { initialExpandLevel: 999 })
    mm.fit()
  }

  const transformMindmapData = (data: any): any => {
    if (!data) return null
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        return null
      }
    }

    // 过滤节点名称中的前缀"四级叶子节点【详细知识点】："等
    const filterNodeName = (name: string): string => {
      if (!name) return ''
      // 只移除特定的前缀格式，如"四级叶子节点【详细知识点】："
      const filtered = name.replace(/^(?:一级|二级|三级|四级|五级)?\s*叶子节点\s*【[^】]+】\s*[:：]\s*/, '')
      // 每20个字符添加一个换行
      if (filtered.length > 20) {
        return filtered.match(/.{1,20}/g)?.join('\n') || filtered
      }
      return filtered
    }

    const transformNode = (node: any): any => {
      if (!node || typeof node !== 'object') return null
      const result: any = {
        content: filterNodeName(node.name || node.content || '无标题'),
        children: (node.children || []).map((child: any) => transformNode(child)).filter(Boolean)
      }
      return result
    }

    return transformNode(data)
  }

  const renderMindmap = () => {
    if (!mindmapContainerRef.current || !mindmapData) return null

    // 转换数据格式
    const transformedData = transformMindmapData(mindmapData)
    if (!transformedData) {
      console.error('思维导图数据格式无效')
      return null
    }

    try {
      // 检查markmap实例是否仍然有效（SVG元素是否还在DOM中）
      const existingMarkmap = markmapInstanceRef.current
      if (existingMarkmap) {
        // 检查SVG元素是否还在DOM中且可见
        const svgNode = existingMarkmap.svg?.node()
        const isSvgInDom = svgNode && svgNode.parentNode === mindmapContainerRef.current
        
        if (isSvgInDom) {
          // SVG仍然有效，保存当前视图状态（缩放和位置）- 使用D3 zoom API
          let currentTransform = null
          if (existingMarkmap.svg && existingMarkmap.zoom) {
            try {
              const d3 = (window as any).d3
              if (d3 && d3.zoomTransform) {
                currentTransform = d3.zoomTransform(svgNode)
              } else {
                currentTransform = existingMarkmap.zoom.transform
              }
            } catch (e) {
              console.warn('保存视图状态失败:', e)
            }
          }

          // 更新数据
          existingMarkmap.setData(transformedData)

          // 恢复视图状态
          if (currentTransform && existingMarkmap.svg && existingMarkmap.zoom) {
            try {
              existingMarkmap.svg.call(existingMarkmap.zoom.transform, currentTransform)
            } catch (e) {
              console.warn('恢复视图状态失败:', e)
            }
          }

          return existingMarkmap
        } else {
          // SVG已不在DOM中，清空实例引用
          console.log('思维导图SVG已不在DOM中，清空实例')
          markmapInstanceRef.current = null
        }
      }

      // 实例无效或不存在，需要重新创建
      // 先清空容器内容
      while (mindmapContainerRef.current.firstChild) {
        mindmapContainerRef.current.removeChild(mindmapContainerRef.current.firstChild)
      }

      // 添加CSS样式使节点文字自动换行
      const style = document.createElement('style')
      style.textContent = `
        .markmap-foreign {
          white-space: pre-wrap !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          word-break: break-all !important;
        }
        .markmap-foreign div {
          white-space: pre-wrap !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          word-break: break-all !important;
        }
      `
      mindmapContainerRef.current.appendChild(style)

      console.log('渲染思维导图，数据:', JSON.stringify(transformedData, null, 2))

      // 创建SVG元素
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.style.width = '100%'
      svg.style.height = '100%'
      svg.style.display = 'block'
      mindmapContainerRef.current.appendChild(svg)

      // 创建思维导图并设置数据和选项
      const markmap = new Markmap(svg, {
        autoFit: true,
        zoom: true,
        pan: true,
        maxInitialScale: 1.5,
        initialExpandLevel: 3,
        nodeMinHeight: 20,
        paddingX: 80,
      })
      markmap.setData(transformedData)

      // 保存实例
      markmapInstanceRef.current = markmap

      return markmap
    } catch (error) {
      console.error('渲染思维导图失败:', error)
    }
    return null
  }

  // 当文档ID变化时，获取思维导图
  useEffect(() => {
    if (documentId) {
      fetchMindmap()
    }
  }, [documentId])

  // 当显示思维导图时，渲染
  useEffect(() => {
    if (showMindmap && mindmapData) {
      renderMindmap()
    }
  }, [showMindmap, mindmapData])

  if (docLoading || chaptersLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center transition-colors duration-300">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-500 dark:text-gray-400 mt-4">加载中...</p>
        </div>
      </div>
    )
  }

  if (!currentDocument) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center transition-colors duration-300">
        <div className="text-center">
          <BookOpen size={64} className="mx-auto text-gray-300 dark:text-gray-600" />
          <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">文档未找到</h3>
          <Link to="/documents" className="mt-4 inline-flex items-center text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
            <ArrowLeft size={20} className="mr-2" />
            返回文档列表
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
      <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 sticky top-0 z-50">
        <div className="w-full px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  const from = searchParams.get('from')
                  if (from === 'public' || from === 'popular') {
                    navigate('/')
                  } else {
                    navigate('/documents')
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <ArrowLeft size={18} />
                {searchParams.get('from') === 'public' || searchParams.get('from') === 'popular'
                  ? '返回首页'
                  : '返回文档列表'
                }
              </button>
              {navigationHistory.length > 0 && (
                <button
                  onClick={() => {
                    const lastPos = navigationHistory[navigationHistory.length - 1]
                    console.log('🔙 返回按钮点击:', { lastPos, historyLength: navigationHistory.length })
                    popFromNavigationHistory()
                    if (lastPos.chapterId) {
                      console.log('🔙 使用 chapterId 返回:', lastPos.chapterId)
                      navigate(`/documents/${lastPos.docId}?chapterId=${lastPos.chapterId}`)
                    } else if (lastPos.title && lastPos.title.trim()) {
                      console.log('🔙 使用 targetTitle 返回:', lastPos.title)
                      navigate(`/documents/${lastPos.docId}?targetTitle=${encodeURIComponent(lastPos.title)}`)
                    } else {
                      console.log('🔙 直接返回文档:', lastPos.docId)
                      navigate(`/documents/${lastPos.docId}`)
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
                >
                  <ArrowLeft size={18} />
                  返回原文档 ({navigationHistory.length})
                </button>
              )}
              <button
                onClick={() => {
                  if (manualSplitMode) {
                    setManualSplitMode(false)
                    setSelectedChapters(new Set())
                  } else {
                    setManualSplitMode(true)
                    setSelectedChapters(new Set())
                    setCollapsedSections(new Set())
                  }
                }}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${manualSplitMode ? 'bg-orange-500 text-white hover:bg-orange-600' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                <Edit size={18} />
                {manualSplitMode ? '退出划分' : '手动划分'}
              </button>
              {manualSplitMode && (
                <button
                  onClick={() => {
                    if (selectedChapterId) {
                      setSelectedChapters(new Set([selectedChapterId]))
                      setShowSplitModal(true)
                    } else {
                      alert('请先选择一个章节')
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50 rounded-lg transition-colors"
                >
                  <Edit size={18} />
                  分割
                </button>
              )}
              <div>
                <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate max-w-md">
                  {currentDocument?.title}
                </h1>
                {currentChapter && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-md">
                    {currentChapter.level === 1 ? currentChapter.title : getSectionTitle(currentChapter, chapters) || currentChapter.title}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                <button
                  onClick={() => {
                    setViewMode('chapter');
                    setShowSidebar(true);
                    setShowMindmap(false);
                  }}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'chapter' && !showMindmap
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  章节模式
                </button>
                <button
                  onClick={() => {
                    setViewMode('full');
                    setShowSidebar(true);
                    setShowMindmap(false);
                  }}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'full' && !showMindmap
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  完整模式
              </button>
              <button
                onClick={() => {
                  setViewMode('preview');
                  setShowSidebar(false);
                  setShowMindmap(false);
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                原文预览
              </button>
              <button
                onClick={() => { setShowMindmap(!showMindmap); setShowSidebar(true) }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  showMindmap
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <MapIcon size={16} className="inline mr-1" />
                思维导图
              </button>
              <Link
                to={`/document-graph?docId=${documentId}`}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center gap-1"
              >
                <MapIcon size={16} />
                知识图谱
              </Link>
            </div>

            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useRuleParsing"
                  checked={useRuleParsing}
                  onChange={(e) => setUseRuleParsing(e.target.checked)}
                  className="w-3.5 h-3.5 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                />
                <label htmlFor="useRuleParsing" className="text-xs text-gray-500 dark:text-gray-400 select-none">二次规则解析</label>
                <button
                  onClick={async () => {
                    try {
                      setReparsing(true)
                      await api.post(`/api/v1/documents/${documentId}/reparse-somark?use_rule_parsing=${useRuleParsing}`)
                      const base = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
                      const wsUrl = base.replace(/^http/, 'ws') + `/api/v1/documents/ws/${documentId}`
                      const ws = new WebSocket(wsUrl)
                      ws.onmessage = (e) => {
                        const data = JSON.parse(e.data)
                        if (data.type === 'complete') {
                          ws.close()
                          if (data.success) {
                            setReparsing(false)
                            window.location.reload()
                          } else {
                            setReparsing(false)
                            alert(`SoMark 解析失败: ${data.message}`)
                          }
                        }
                      }
                      ws.onerror = () => {
                        setTimeout(() => {
                          setReparsing(false)
                          window.location.reload()
                        }, 60000)
                      }
                    } catch (e) {
                      console.error('SoMark 解析启动失败:', e)
                      setReparsing(false)
                    }
                  }}
                  disabled={reparsing}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    reparsing
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30'
                  }`}
                >
                  {reparsing ? '解析中...' : 'SoMark解析'}
                </button>
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500">效果不佳时点此重试</span>
            </div>

              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 md:hidden"
              >
                <Menu size={24} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full px-6 py-6">
        <div className="flex gap-6 w-full">
          {(showSidebar) && (
            <div className={`w-64 flex-shrink-0 ${showSidebar ? 'block' : 'hidden md:block'}`}>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 sticky top-24 max-h-[calc(100vh-120px)] overflow-hidden flex flex-col">
                <div className="p-4 border-b dark:border-gray-700 flex-shrink-0">
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100">目录</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{chapters?.length ?? '...'} 个章节</p>
                </div>
                <div className="flex-1 overflow-y-auto" ref={directoryRef}>
                  {manualSplitMode && selectedChapters.size > 0 && (
                    <div className="sticky top-0 z-10 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800 px-4 py-2">
                      {isMerging && (
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-orange-700 dark:text-orange-300">正在合并...</span>
                            <span className="text-sm text-orange-700 dark:text-orange-300">{mergeProgress}%</span>
                          </div>
                          <div className="w-full bg-orange-200 dark:bg-orange-900/50 rounded-full h-2">
                            <div 
                              className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${mergeProgress}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-orange-700 dark:text-orange-300">已选择 {selectedChapters.size} 项</span>
                        <button
                          onClick={async () => {
                            if (selectedChapters.size >= 2 && !isMerging) {
                              setIsMerging(true)
                              setMergeProgress(10)
                              try {
                                setMergeProgress(30)
                                await api.post(`/api/v1/documents/${documentId}/chapters/merge`, {
                                  chapter_ids: Array.from(selectedChapters)
                                })
                                setMergeProgress(70)
                                
                                setTimeout(() => {
                                  setMergeProgress(100)
                                  setSelectedChapters(new Set())
                                  setManualSplitMode(false)
                                  window.location.reload()
                                }, 500)
                              } catch (err) {
                                console.error('合并失败:', err)
                                alert('合并失败')
                                setIsMerging(false)
                                setMergeProgress(0)
                              }
                            }
                          }}
                          disabled={selectedChapters.size < 2 || isMerging}
                          className="px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
                        >
                          {isMerging ? '合并中...' : '合并'}
                        </button>
                        <button
                          onClick={() => setSelectedChapters(new Set())}
                          disabled={isMerging}
                          className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                        >
                          清除选择
                        </button>
                      </div>
                    </div>
                  )}
                  {chaptersLoading ? (
                    <div className="p-4 text-center text-sm text-gray-400">加载中...</div>
                  ) : !filteredChapters || filteredChapters.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-400">暂无章节</div>
                  ) : filteredChapters.map((chapter) => {
                    const isSectionHeader = chapter.level === 1
                    const isCollapsed = collapsedSections.has(chapter.order_index)
                    const isSelected = selectedChapterId === chapter.id
                    const hasQuestionsAfter = chapters?.some(
                      c => c.level === 2 && c.order_index > chapter.order_index &&
                        !chapters.some(ch => ch.level === 1 && ch.order_index > chapter.order_index && ch.order_index < c.order_index)
                    )

                    return (
                      <div
                        key={chapter.id}
                        ref={(el) => {
                          if (el) chapterRefs.current.set(chapter.id, el)
                        }}
                      >
                        <button
                          onClick={() => {
                            if (manualSplitMode) {
                              const newSet = new Set(selectedChapters)
                              if (newSet.has(chapter.id)) {
                                newSet.delete(chapter.id)
                              } else {
                                newSet.add(chapter.id)
                              }
                              setSelectedChapters(newSet)
                            } else {
                              handleChapterSelect(chapter.id)
                            }
                          }}
                          className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-l-4 border-blue-500'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border-l-4 border-transparent'
                          } ${manualSplitMode && selectedChapters.has(chapter.id) ? 'bg-orange-100 dark:bg-orange-900/30 border-l-4 border-orange-500' : ''}`}
                          style={{ paddingLeft: `${isSectionHeader ? 16 : 40}px` }}
                        >
                          {manualSplitMode && (
                            <span className={`w-5 h-5 flex items-center justify-center rounded border ${selectedChapters.has(chapter.id) ? 'bg-orange-500 border-orange-500 text-white' : 'border-gray-400 dark:border-gray-600'}`}>
                              {selectedChapters.has(chapter.id) && '✓'}
                            </span>
                          )}
                          {isSectionHeader && hasQuestionsAfter && (
                            <span className="w-4 h-4 flex items-center justify-center">
                              {isCollapsed ? (
                                <ChevronRightIcon size={14} />
                              ) : (
                                <ChevronDown size={14} />
                              )}
                            </span>
                          )}
                          <span className={isSectionHeader ? 'font-semibold' : ''}>
                            {chapter.title ? renderLineWithMath(chapter.title, `dir-${chapter.id}`) : '无标题章节'}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 w-full min-w-0">
            {viewMode === 'preview' ? (
              <DocumentPreview
                fileUrl={currentDocument?.file_path || `/uploads/${currentDocument?.filename}`}
                fileName={currentDocument?.filename || currentDocument?.title || '文档'}
                docId={String(documentId)}
              />
            ) : showMindmap ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 w-full">
                <div className="p-6 border-b dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold text-gray-900 dark:text-gray-100 text-xl">
                      思维导图
                    </h2>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedMindmapModel}
                        onChange={(e) => setSelectedMindmapModel(e.target.value)}
                        disabled={isGeneratingMindmap}
                        className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        <option value="deepseek-chat">Chat 模型（速度较快）</option>
                        <option value="deepseek-reasoner">Reasoner 模型（深度思考，等待较长）</option>
                      </select>
                      {selectedMindmapModel === 'deepseek-reasoner' && !isGeneratingMindmap && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          ⚠ Reasoner 模型需要更长的生成时间
                        </span>
                      )}
                      {mindmapData ? (
                        <>
                          <button
                            onClick={expandAllMindmap}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg text-sm font-medium hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                            title="展开所有节点"
                          >
                            <ChevronDown size={16} />
                            展开全部
                          </button>
                          <button
                            onClick={regenerateMindmap}
                            disabled={isGeneratingMindmap}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                            title="重新生成思维导图"
                          >
                            <RefreshIcon size={16} className={isGeneratingMindmap ? 'animate-spin' : ''} />
                            {isGeneratingMindmap ? '生成中...' : '重新生成'}
                          </button>
                          <span className="text-xs text-gray-400 dark:text-gray-500">仅限文档上传者</span>
                        </>
                      ) : (
                        <button
                          onClick={generateMindmap}
                          disabled={isGeneratingMindmap}
                          className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          <MapIcon size={16} />
                          {isGeneratingMindmap ? '生成中...' : '生成思维导图'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="p-8">
                  {isLoadingMindmap ? (
                    <div className="flex items-center justify-center h-96">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                      <span className="ml-3 text-gray-500 dark:text-gray-400">加载中...</span>
                    </div>
                  ) : mindmapData ? (
                    <div
                      ref={mindmapContainerRef}
                      className="w-full"
                      style={{ background: '#fff', height: 'calc(100vh - 280px)', minHeight: '600px' }}
                    ></div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-96 text-center">
                      <MapIcon size={64} className="text-gray-300 dark:text-gray-600 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">思维导图未生成</h3>
                      <p className="text-gray-500 dark:text-gray-400 mb-4">点击上方按钮生成文档的思维导图</p>
                      {selectedMindmapModel === 'deepseek-reasoner' && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                          ⚠ Reasoner 模型需要更长的生成时间
                        </p>
                      )}
                      <button
                        onClick={generateMindmap}
                        disabled={isGeneratingMindmap}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        <MapIcon size={16} />
                        {isGeneratingMindmap ? '生成中...' : '生成思维导图'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : viewMode === 'chapter' ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 w-full">
                <div 
                  id="content-container"
                  ref={contentContainerRef}
                  className="p-8 w-full overflow-y-auto"
                >
                  {currentChapter ? (
                    <>
                      <div className="mb-8">
                        <h2 className="font-bold text-gray-900 dark:text-gray-100 text-2xl">
                          {currentChapter.level === 1
                            ? (currentChapter.title ? renderLineWithMath(currentChapter.title, 'cm-h2') : '')
                            : (getSectionTitle(currentChapter, chapters) || currentChapter.title ? renderLineWithMath(getSectionTitle(currentChapter, chapters) || currentChapter.title || '', 'cm-h2') : '')}
                        </h2>
                      </div>
                      <div className="w-full">
                        {displayContent.length === 1 ? (
                          <>
                            {renderContent(displayContent[0].content)}
                            {isQuizBank && (
                              <div className="mt-6 pt-4 border-t dark:border-gray-700">
                                <div className="flex gap-3 flex-wrap">
                                  <button
                                    onClick={() => handleKnowledgePointsClick(displayContent[0])}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                      expandedKnowledgePoints.has(displayContent[0].id)
                                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                                  >
                                    <Lightbulb size={16} />
                                    知识点关联
                                  </button>
                                  <button
                                    onClick={() => handleAnalysisClick(displayContent[0])}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                      expandedAnalysis.has(displayContent[0].id)
                                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                                  >
                                    <Sparkles size={16} />
                                    AI解析
                                  </button>
                                </div>
                                {loadingAnalysis.has(displayContent[0].id) && (
                                  <div className="flex items-center gap-2 mt-3">
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                                    <span className="text-gray-500 dark:text-gray-400 text-sm">正在分析...</span>
                                  </div>
                                )}
                                <div className="mt-3 space-y-2">
                                  {expandedKnowledgePoints.has(displayContent[0].id) && knowledgePointsCache.current.has(displayContent[0].id) && (
                                      <>
                                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                                          <div className="flex flex-wrap gap-2">
                                            {knowledgePointsCache.current.get(displayContent[0].id).knowledge_points.map((kp: string, idx: number) => (
                                              <span key={idx} className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm rounded">
                                                {kp}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                        {knowledgePointsCache.current.get(displayContent[0].id).related_questions?.length > 0 && (
                                          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                                            <div className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-2">关联题目 (共{knowledgePointsCache.current.get(displayContent[0].id).related_questions.length}个)</div>
                                            {(() => {
                                              console.log('关联题目数据:', knowledgePointsCache.current.get(displayContent[0].id).related_questions)
                                              return knowledgePointsCache.current.get(displayContent[0].id).related_questions.map((rq: any, idx: number) => (
                                               <button
                                                 key={idx}
                                                 onClick={() => {
                                                   console.log('按钮被点击了!')
                                                   const targetDocId = rq.metadata?.document_id
                                                   const targetTitle = rq.metadata?.title
                                                   console.log('点击关联题目:', { targetDocId, targetTitle, documentId, type: typeof targetDocId })
                                                   if (targetDocId) {
                                                     const targetIdNum = parseInt(targetDocId)
                                                     console.log('比较文档ID:', targetIdNum, documentId, targetIdNum === documentId)
                                                     if (targetIdNum === documentId) {
                                                       if (chapters && targetTitle) {
                                                         const targetChapter = chapters.find(c => c.title === targetTitle)
                                                         console.log('查找目标章节:', targetTitle, targetChapter)
                                                         if (targetChapter) {
                                                           const currentChapterId = selectedChapterId || displayContent[0].id
                                                           const currentTitle = displayContent[0].title || ''
                                                           addToNavigationHistory({ docId: documentId, chapterId: currentChapterId, title: currentTitle })
                                                           setSelectedChapterId(targetChapter.id)
                                                         }
                                                       }
                                                     } else {
                                                       console.log('跨文档跳转，标题:', targetTitle)
                                                       const currentChapterId = selectedChapterId || displayContent[0].id
                                                       const currentTitle = displayContent[0].title || ''
                                                       addToNavigationHistory({ docId: documentId, chapterId: currentChapterId, title: currentTitle })
                                                       if (targetTitle) {
                                                         navigate(`/documents/${targetDocId}?targetTitle=${encodeURIComponent(targetTitle)}`)
                                                       } else {
                                                         navigate(`/documents/${targetDocId}`)
                                                       }
                                                     }
                                                   }
                                                 }}
                                                 className="block w-full text-left text-sm text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded p-2 mt-1"
                                               >
                                                 {rq.content.substring(0, 100)}... (相似度: {((1 - rq.distance) * 100).toFixed(0)}%)
                                               </button>
                                             ))
                                            })()}
                                          </div>
                                        )}
                                        <SectionGraph documentId={documentId.toString()} sectionId={displayContent[0].id?.toString() || ''} />
                                      </>
                                    )}
                                    {expandedAnalysis.has(displayContent[0].id) && (analysisCache.current.has(displayContent[0].id) || streamingAnalysis[displayContent[0].id] || streamingReasoning[displayContent[0].id]) && (
                                      <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">题目解析</span>
                                          <button
                                            onClick={() => handleRefreshAnalysis(displayContent[0])}
                                            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                                            title="重新分析"
                                          >
                                            <RefreshCw size={14} />
                                          </button>
                                        </div>
                                        {(analysisCache.current.get(displayContent[0].id)?.reasoning || streamingReasoning[displayContent[0].id]) && (
                                          <details open={!!streamingReasoning[displayContent[0].id]} className="bg-slate-100 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                                            <summary className="flex items-center gap-2 px-3 py-1.5 bg-slate-200/50 dark:bg-slate-700/50 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                                              <div className={`w-1.5 h-1.5 rounded-full ${streamingReasoning[displayContent[0].id] ? 'bg-amber-500' : 'bg-green-400'}`} />
                                              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">思考链</span>
                                              {streamingReasoning[displayContent[0].id] && (
                                                <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">思考中...</span>
                                              )}
                                            </summary>
                                            <div className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={renderAnalysisContent(analysisCache.current.get(displayContent[0].id)?.reasoning || streamingReasoning[displayContent[0].id] || '')} />
                                          </details>
                                        )}
                                        {analysisCache.current.get(displayContent[0].id)?.answer ? (
                                          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                                            <span className="text-blue-700 dark:text-blue-300 text-sm font-medium">答案：</span>
                                            <span className="text-blue-700 dark:text-blue-300 text-sm" dangerouslySetInnerHTML={renderAnalysisContent(analysisCache.current.get(displayContent[0].id).answer)} />
                                          </div>
                                        ) : null}
                                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                                          <div className="text-green-700 dark:text-green-300 text-sm prose prose-sm max-w-none" dangerouslySetInnerHTML={renderAnalysisContent(analysisCache.current.get(displayContent[0].id)?.analysis || streamingAnalysis[displayContent[0].id] || '暂无解析')} />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                          </>
                        ) : (
                          displayContent.map((chapter, chapterIdx) => (
                            <div
                              key={chapter.id}
                              className={chapterIdx > 0 ? 'mt-8 pt-8 border-t dark:border-gray-700 w-full' : 'w-full'}>
                              {renderContent(chapter.content)}
                              <div className="mt-4 pt-3 border-t dark:border-gray-700">
                                <div className="flex gap-3">
                                  <button
                                    onClick={() => handleKnowledgePointsClick(chapter)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                      expandedKnowledgePoints.has(chapter.id)
                                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                                  >
                                    <Lightbulb size={16} />
                                    知识点关联
                                  </button>
                                  <button
                                    onClick={() => handleAnalysisClick(chapter)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                      expandedAnalysis.has(chapter.id)
                                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                                  >
                                    <Sparkles size={16} />
                                    题目解析
                                  </button>
                                </div>
                                {loadingAnalysis.has(chapter.id) && (
                                  <div className="flex items-center gap-2 mt-3">
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                                    <span className="text-gray-500 dark:text-gray-400 text-sm">正在分析...</span>
                                  </div>
                                )}
                                <div className="mt-3 space-y-2">
                                  {expandedKnowledgePoints.has(chapter.id) && knowledgePointsCache.current.has(chapter.id) && (
                                      <>
                                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                                          <div className="flex flex-wrap gap-2">
                                            {knowledgePointsCache.current.get(chapter.id).knowledge_points.map((kp: string, idx: number) => (
                                              <span key={idx} className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm rounded">
                                                {kp}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                        {knowledgePointsCache.current.get(chapter.id).related_questions?.length > 0 && (
                                          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                                            <div className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-2">关联题目</div>
                                            {knowledgePointsCache.current.get(chapter.id).related_questions.map((rq: any, idx: number) => (
                                              <button
                                                key={idx}
                                                onClick={() => {
                                                  console.log('章节模式-关联题目按钮被点击!')
                                                  console.log('rq对象完整结构:', JSON.stringify(rq, null, 2))
                                                  console.log('rq.metadata:', rq.metadata)
                                                  const targetDocId = rq.metadata?.document_id
                                                  const targetTitle = rq.metadata?.title
                                                  console.log('章节模式-点击关联题目:', { targetDocId, targetTitle, documentId })
                                                  if (targetDocId) {
                                                    const targetIdNum = parseInt(targetDocId)
                                                    if (targetIdNum === documentId) {
                                                      if (chapters && targetTitle) {
                                                        const targetChapter = chapters.find(c => c.title === targetTitle)
                                                        console.log('章节模式-查找目标章节:', targetTitle, targetChapter)
                                                        if (targetChapter) {
                                                          addToNavigationHistory({ docId: documentId, chapterId: chapter.id, title: chapter.title || '' })
                                                          setSelectedChapterId(targetChapter.id)
                                                        }
                                                      }
                                                    } else {
                                                      console.log('章节模式-跨文档跳转，标题:', targetTitle)
                                                      addToNavigationHistory({ docId: documentId, chapterId: chapter.id, title: chapter.title || '' })
                                                      if (targetTitle) {
                                                        navigate(`/documents/${targetDocId}?targetTitle=${encodeURIComponent(targetTitle)}`)
                                                      } else {
                                                        navigate(`/documents/${targetDocId}`)
                                                      }
                                                    }
                                                  } else {
                                                    console.log('targetDocId为空，无法跳转')
                                                  }
                                                }}
                                                className="block w-full text-left text-sm text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded p-2 mt-1"
                                              >
                                                {rq.content.substring(0, 100)}... (相似度: {((1 - rq.distance) * 100).toFixed(0)}%)
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                        <SectionGraph documentId={documentId.toString()} sectionId={chapter.id?.toString() || ''} />
                                      </>
                                    )}
                                    {expandedAnalysis.has(chapter.id) && (analysisCache.current.has(chapter.id) || streamingAnalysis[chapter.id] || streamingReasoning[chapter.id]) && (
                                      <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">题目解析</span>
                                          <button
                                            onClick={() => handleRefreshAnalysis(chapter)}
                                            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                                            title="重新分析"
                                          >
                                            <RefreshCw size={14} />
                                          </button>
                                        </div>
                                        {(analysisCache.current.get(chapter.id)?.reasoning || streamingReasoning[chapter.id]) && (
                                          <details open={!!streamingReasoning[chapter.id]} className="bg-slate-100 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                                            <summary className="flex items-center gap-2 px-3 py-1.5 bg-slate-200/50 dark:bg-slate-700/50 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                                              <div className={`w-1.5 h-1.5 rounded-full ${streamingReasoning[chapter.id] ? 'bg-amber-500' : 'bg-green-400'}`} />
                                              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">思考链</span>
                                              {streamingReasoning[chapter.id] && (
                                                <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">思考中...</span>
                                              )}
                                            </summary>
                                            <div className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={renderAnalysisContent(analysisCache.current.get(chapter.id)?.reasoning || streamingReasoning[chapter.id] || '')} />
                                          </details>
                                        )}
                                        {analysisCache.current.get(chapter.id)?.answer ? (
                                          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                                            <span className="text-blue-700 dark:text-blue-300 text-sm font-medium">答案：</span>
                                            <span className="text-blue-700 dark:text-blue-300 text-sm" dangerouslySetInnerHTML={renderAnalysisContent(analysisCache.current.get(chapter.id).answer)} />
                                          </div>
                                        ) : null}
                                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                                          <div className="text-green-700 dark:text-green-300 text-sm prose prose-sm max-w-none" dangerouslySetInnerHTML={renderAnalysisContent(analysisCache.current.get(chapter.id)?.analysis || streamingAnalysis[chapter.id] || '暂无解析')} />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                      请从左侧选择一个章节开始阅读
                    </div>
                  )}
                </div>

                {currentChapter && (
                  <div className="border-t dark:border-gray-700 px-8 py-6 flex items-center justify-between">
                    <button
                      onClick={handlePreviousChapter}
                      disabled={!hasPreviousSection()}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        hasPreviousSection()
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                      }`}
                    >
                      <ChevronLeft size={20} />
                      {currentChapter.level === 1 ? '上一章' : '上一题'}
                    </button>
                    <button
                      onClick={handleNextChapter}
                      disabled={!hasNextSection()}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        hasNextSection()
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'text-gray-300 cursor-not-allowed'
                      }`}
                    >
                      {currentChapter.level === 1 ? '下一章' : '下一题'}
                      <ChevronRight size={20} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 w-full overflow-visible">
                <div
                  id="content-container"
                  ref={contentContainerRef}
                  className="p-8 w-full overflow-y-auto"
                >
                  {filteredChapters && filteredChapters.length > 0 ? (
                    filteredChapters.map((chapter) => (
                      <div
                        key={chapter.id}
                        id={`chapter-${chapter.id}`}
                        ref={(el) => {
                          if (el) chapterRefs.current.set(chapter.id, el)
                        }}
                        className={chapter.level === 1 ? 'mt-8 first:mt-0' : 'mb-6'}
                      >
                        {chapter.level === 1 ? (
                          <div>
                            <h2 className="font-bold text-gray-900 dark:text-gray-100 text-2xl mb-4 break-words overflow-visible">
                              {chapter.title ? renderLineWithMath(chapter.title, `fm-h2-${chapter.id}`) : '无标题章节'}
                            </h2>
                            {chapter.content && chapter.content.trim() && (
                              <div className="w-full mb-4">
                                {renderContent(chapter.content)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-lg mb-2 break-words overflow-visible">
                              {chapter.title ? renderLineWithMath(chapter.title, `fm-h3-${chapter.id}`) : ''}
                            </h3>
                            <div className="w-full">
                              {renderContent(chapter.content)}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                      暂无章节内容
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSplitModal && selectedChapters.size === 1 && (
        <SplitChapterModal
          chapterId={Array.from(selectedChapters)[0]}
          chapters={chapters as ChapterData[]}
          onClose={() => {
            setShowSplitModal(false)
            setSelectedChapters(new Set())
          }}
        />
      )}
    </div>
  )
}

interface SplitChapterModalProps {
  chapterId: number
  chapters: ChapterData[]
  onClose: () => void
}

function SplitChapterModal({ chapterId, chapters, onClose }: SplitChapterModalProps) {
  const chapter = chapters.find(c => c.id === chapterId)
  // 统一换行符，和 Python len() 对齐
  const rawContent = (chapter?.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const [lines] = useState(rawContent.split('\n'))
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set())
  const [isSplitting, setIsSplitting] = useState(false)
  const [progress, setProgress] = useState(0)

  if (!chapter) return null

  const handleLineClick = (idx: number) => {
    const newSet = new Set(selectedLines)
    if (newSet.has(idx)) {
      newSet.delete(idx)
    } else {
      newSet.add(idx)
    }
    setSelectedLines(newSet)
  }

  const handleSplit = async () => {
    if (selectedLines.size === 0) {
      alert('请选择至少一个分割点')
      return
    }

    const splitPositions = Array.from(selectedLines).sort((a, b) => a - b)
    const positions = splitPositions.map(pos => {
      let posSum = 0
      for (let i = 0; i < pos; i++) {
        posSum += lines[i].length + 1
      }
      return posSum
    })

    setIsSplitting(true)
    setProgress(10)

    try {
      setProgress(30)
      await api.post(`/api/v1/documents/${chapter.document_id}/chapters/split`, {
        chapter_id: chapterId,
        split_points: positions
      })
      setProgress(70)
      
      setTimeout(() => {
        setProgress(100)
        onClose()
        window.location.reload()
      }, 500)
    } catch (err: any) {
      console.error('分割失败:', err)
      alert('分割失败: ' + (err.message || '未知错误'))
      setIsSplitting(false)
      setProgress(0)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
        <div className="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">分割内容</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">点击选择分割点（会从该行前面分割）：</p>
          <div className="space-y-1 font-mono text-sm">
            {lines.map((line, idx) => (
              <div
                key={idx}
                onClick={() => handleLineClick(idx)}
                className={`flex items-start gap-2 p-2 rounded cursor-pointer ${
                  selectedLines.has(idx)
                    ? 'bg-orange-100 dark:bg-orange-900/30 border border-orange-400 dark:border-orange-600'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span className="text-gray-400 dark:text-gray-500 w-8 text-right flex-shrink-0">{idx + 1}</span>
                <span className="whitespace-pre-wrap break-all text-gray-900 dark:text-gray-100">{line || ' '}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          {isSplitting && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">正在处理...</span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isSplitting}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleSplit}
              disabled={selectedLines.size === 0 || isSplitting}
              className="px-4 py-2 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
            >
              {isSplitting ? '处理中...' : `确认分割 (${selectedLines.size} 处)`}
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}