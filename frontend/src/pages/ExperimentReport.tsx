import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { FlaskConical, Plus, Trash2, MessageSquare, FileText, Send, ChevronLeft, Loader2, Download, BarChart3, Camera, X, ChevronUp, ChevronDown } from 'lucide-react'
import { marked } from 'marked'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, RadialLinearScale, Title, Tooltip, Legend, Filler } from 'chart.js'
import { Scatter, Bar, Pie, Doughnut, PolarArea, Radar } from 'react-chartjs-2'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })

const PHOTOS_STORAGE_KEY = 'experiment_photos_cache'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, RadialLinearScale, Title, Tooltip, Legend, Filler)

interface ExperimentReportItem {
  id: number
  title: string
  status: string
  sections_config: string[] | null
  has_courseware: boolean
  created_at: string
  updated_at: string
}

interface DraftSection {
  title: string
  content: string
}

interface ChatMessage {
  role: string
  content: string
  turn: number
  type?: string
  table_data?: any
}

interface ProgressInfo {
  step: string
  percent: number
}

export default function ExperimentReport() {
  const navigate = useNavigate()
  const [reports, setReports] = useState<ExperimentReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [sectionsText, setSectionsText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [photoItems, setPhotoItems] = useState<{ id: string; file: File; preview: string }[]>([])
  const [creating, setCreating] = useState(false)
  const [activeReport, setActiveReport] = useState<any>(null)
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [tables, setTables] = useState<Record<string, any[]>>({})
  const [streamingContent, setStreamingContent] = useState('')
  const [streaming, setStreaming] = useState(false)
  const streamingRef = useRef(false)
  const streamingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamAccRef = useRef('')
  const [questionAnswers, setQuestionAnswers] = useState<string[]>([])
  const [supplementaryInput, setSupplementaryInput] = useState('')
  const [photoSlots, setPhotoSlots] = useState<string[]>([])
  const [photoFiles, setPhotoFiles] = useState<Record<string, { files: File[]; notes: string }>>({})
  const [extraPhotoNames, setExtraPhotoNames] = useState<string[]>([])
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [currentTableConfig, setCurrentTableConfig] = useState<{ columns: string[]; rows: number; tableId: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    const valid: { id: string; file: File; preview: string }[] = []
    for (const f of Array.from(e.target.files)) {
      if (!f.type.startsWith('image/')) continue
      if (photoItems.length + valid.length >= 300) break
      valid.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        preview: URL.createObjectURL(f),
      })
    }
    setPhotoItems(prev => [...prev, ...valid])
    setSelectedFile(null)
    e.target.value = ''
  }

  const handleCameraCapture = async () => {
    try {
      const { Camera: CapacitorCamera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const photo = await CapacitorCamera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        quality: 90,
      })
      if (!photo.webPath) return
      const response = await fetch(photo.webPath)
      const blob = await response.blob()
      const fileName = photo.path?.split('/').pop() || `photo_${Date.now()}.jpg`
      const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' })
      if (photoItems.length >= 300) return
      setPhotoItems(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: URL.createObjectURL(file),
      }])
      setSelectedFile(null)
    } catch (err: any) {
      if (err.message !== 'User cancelled photos app') {
        console.error('Camera capture error:', err)
      }
    }
  }

  const removePhoto = (id: string) => {
    setPhotoItems(prev => {
      const item = prev.find(p => p.id === id)
      if (item) URL.revokeObjectURL(item.preview)
      return prev.filter(p => p.id !== id)
    })
  }

  const movePhoto = (id: string, dir: -1 | 1) => {
    setPhotoItems(prev => {
      const idx = prev.findIndex(p => p.id === id)
      if (idx === -1) return prev
      const t = idx + dir
      if (t < 0 || t >= prev.length) return prev
      const arr = [...prev]
      const tmp = arr[idx]; arr[idx] = arr[t]; arr[t] = tmp
      return arr
    })
  }
  const screenshotInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const reportEndRef = useRef<HTMLDivElement>(null)
  const pendingMessageRef = useRef<string | null>(null)
  const [hasPendingMessage, setHasPendingMessage] = useState(false)
  const [progress, setProgress] = useState<ProgressInfo | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const activeIdRef = useRef<number | null>(null)
  const photosRef = useRef<Record<string, any[]>>({})
  const activeReportRef = useRef<any>(null)
  useEffect(() => { activeReportRef.current = activeReport }, [activeReport])

  useEffect(() => { fetchReports() }, [])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeReport?.chat_history])
  useEffect(() => { reportEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeReport?.draft_content])

  const chatMessages = useMemo(() =>
    (activeReport?.chat_history || []).filter((m: any) => m.type !== '_progress'),
  [activeReport?.chat_history])

  // Photos: knowledge_base.photos is the single source of truth
  const allPhotos = useMemo((): Record<string, any[]> => {
    const photos = activeReport?.knowledge_base?.photos
    if (photos && typeof photos === 'object' && Object.keys(photos).length > 0) return photos as Record<string, any[]>
    return {}
  }, [activeReport?.knowledge_base?.photos])

  // WebSocket 实时连接（按 report.id 保持长连接，唯一更新来源）
  useEffect(() => {
    if (!activeReport) return
    const id = activeReport.id
    if (id === activeIdRef.current) return
    activeIdRef.current = id

    const token = localStorage.getItem('token')
    if (!token) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const apiUrl = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
    const wsHost = apiUrl.replace(/^https?:\/\//, '')
    const wsUrl = `${protocol}//${wsHost}/api/v1/experiments/ws/${id}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ token }))
    }

    ws.onmessage = (event) => {
      const mergeKB = (prevKb: any, incKb: any) => {
        const pk = prevKb || {}, ik = incKb || {}
        const mp: Record<string, any[]> = {}
        for (const n of new Set([...Object.keys(pk.photos||{}), ...Object.keys(ik.photos||{})])) {
          mp[n] = [...(Array.isArray(pk.photos?.[n]) ? pk.photos[n] : (pk.photos?.[n] ? [pk.photos[n]] : [])),
                    ...(Array.isArray(ik.photos?.[n]) ? ik.photos[n] : (ik.photos?.[n] ? [ik.photos[n]] : []))]
        }
        return { ...pk, ...ik, photos: mp }
      }
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'progress') {
          setProgress({ step: data.step, percent: data.percent })
        } else if (data.type === 'status') {
          setActiveReport((prev: any) => ({ ...prev, status: data.status }))
          if (data.status === 'knowledge_ready') {
            setProgress({ step: '知识准备完成', percent: 100 })
          }
        } else if (data.type === 'token') {
          if (!streamingRef.current) {
            streamAccRef.current = ''
            setStreamingContent('')
            setStreaming(true)
          }
          streamingRef.current = true
          streamAccRef.current += data.content
          if (!streamingThrottleRef.current) {
            streamingThrottleRef.current = setTimeout(() => {
              streamingThrottleRef.current = null
              setStreamingContent(streamAccRef.current)
            }, 200)
          }
        } else if (data.type === 'report_update') {
          // Flush pending stream
          if (streamingThrottleRef.current) {
            clearTimeout(streamingThrottleRef.current)
            streamingThrottleRef.current = null
            setStreamingContent(streamAccRef.current)
          }
          setActiveReport((prev: any) => ({
            ...prev,
            status: data.status || prev.status,
            draft_content: (data.draft_content && data.draft_content.length > 0) ? data.draft_content : (prev.draft_content || []),
            chat_history: data.chat_history || prev.chat_history,
            knowledge_base: mergeKB(prev.knowledge_base, data.knowledge_base),
          }))
          const merged = mergeKB(activeReportRef.current?.knowledge_base, data.knowledge_base)
          if (merged?.photos) { photosRef.current = merged.photos; try { localStorage.setItem(PHOTOS_STORAGE_KEY + '_' + activeReport?.id, JSON.stringify(merged.photos)) } catch {} }
          streamingRef.current = false
          setStreaming(false)
        } else if (data.type === 'error') {
          console.error('WS error:', data.message)
        }
      } catch (e) { /* ignore */ }
    }

    ws.onerror = () => { /* ws error */ }
    ws.onclose = () => {
      wsRef.current = null
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [activeReport?.id])

  // 同步照片插槽（流式期间/过渡中不清空，避免闪烁）
  useEffect(() => {
    if (streaming || sending) return
    const slots = currentPhotoSlots()
    setPhotoSlots(slots)
    if (slots.length === 0) {
      setPhotoFiles({})
      setExtraPhotoNames([])
    }
  }, [activeReport?.chat_history, streamingContent, streaming, sending])

  // 同步当前表格（RENDER_TABLE）
  useEffect(() => {
    if (!activeReport?.chat_history) { setCurrentTableConfig(null); return }
    const msgs = activeReport.chat_history.filter((m: any) => m.type !== '_progress')
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        const m = msgs[i].content.match(/\[RENDER_TABLE:\s*columns=\[(.*?)\],\s*rows=([^\]]+?)\]/)
        if (m) {
          const cols = m[1].split(',').map((s: string) => s.trim().replace(/^"|"$/g, ''))
          const rows = parseInt(m[2].trim(), 10) || 3
          setCurrentTableConfig({ columns: cols, rows, tableId: `main_table_${i}` })
        } else {
          setCurrentTableConfig(null)
        }
        break
      }
    }
  }, [activeReport?.chat_history])

  // 持久化最新的照片数据（防止被空数据覆盖）
  useEffect(() => {
    const p = activeReport?.knowledge_base?.photos
    if (p && typeof p === 'object' && Object.keys(p).length > 0) {
      photosRef.current = p
      try { localStorage.setItem(PHOTOS_STORAGE_KEY + '_' + activeReport.id, JSON.stringify(p)) } catch {}
    }
  }, [activeReport?.knowledge_base?.photos])

  const fetchReports = async () => {
    setLoading(true)
    try {
      const res = await api.get<{ reports: ExperimentReportItem[] }>('/api/v1/experiments')
      setReports(res.reports || [])
    } catch (err) { console.error('获取实验列表失败', err) }
    finally { setLoading(false) }
  }

  const openReport = async (id: number) => {
    activeIdRef.current = null
    try {
      const res = await api.get<any>(`/api/v1/experiments/${id}`)
      setActiveReport(res)
      const p = res?.knowledge_base?.photos
      if (p && typeof p === 'object' && Object.keys(p).length > 0) {
        photosRef.current = p
        try { localStorage.setItem(PHOTOS_STORAGE_KEY + '_' + id, JSON.stringify(p)) } catch {}
      } else {
        // 从 chat_history 的 _photo_record 恢复
        const photoRecord = (res.chat_history || []).find((m: any) => m.type === '_photo_record')
        const p2 = photoRecord?.photos
        if (p2 && typeof p2 === 'object' && Object.keys(p2).length > 0) {
          photosRef.current = p2
          try { localStorage.setItem(PHOTOS_STORAGE_KEY + '_' + id, JSON.stringify(p2)) } catch {}
        } else {
          // 从 localStorage 恢复（安全网）
          try {
            const cached = localStorage.getItem(PHOTOS_STORAGE_KEY + '_' + id)
            if (cached) {
              const parsed = JSON.parse(cached)
              if (typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                photosRef.current = parsed
              }
            }
          } catch {}
        }
      }
      setProgress(null)
      const progressMsg = (res.chat_history || []).find((m: any) => m.type === '_progress')
      if (progressMsg) setProgress({ step: progressMsg.step, percent: progressMsg.percent })
    } catch (err) { console.error('获取实验详情失败', err) }
  }

  const handleCreate = async () => {
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      // 从文本框中解析章节（每行一个，去除序号前缀）
      const parsedSections = sectionsText.split('\n')
        .map(line => line.replace(/^\d+[\.\、\s]+/, '').trim())
        .filter(Boolean)
      const formData = new FormData()
      formData.append('title', newTitle.trim())
      if (parsedSections.length > 0) formData.append('sections', JSON.stringify(parsedSections))

      const result = await api.postForm<{ success: boolean; report: any }>('/api/v1/experiments', formData)

      if (selectedFile && result.report?.id) {
        const fileForm = new FormData()
        fileForm.append('file', selectedFile)
        await api.postForm(`/api/v1/experiments/${result.report.id}/upload`, fileForm)
      }

      if (photoItems.length > 0 && result.report?.id) {
        try {
          const imgForm = new FormData()
          photoItems.forEach(item => imgForm.append('files', item.file))
          await api.postForm(`/api/v1/experiments/${result.report.id}/upload-images`, imgForm)
        } catch (e) {
          console.warn('课件截图上传失败（可选），实验已创建成功', e)
        }
        photoItems.forEach(item => URL.revokeObjectURL(item.preview))
      }

      setShowCreate(false)
      setNewTitle('')
      setSectionsText('')
      setSelectedFile(null)
      setPhotoItems([])

      const reportBasic = result.report
      setActiveReport({
        id: reportBasic.id,
        title: reportBasic.title,
        status: reportBasic.status,
        sections_config: reportBasic.sections_config,
        created_at: reportBasic.created_at,
        knowledge_base: null,
        draft_content: null,
        chat_history: [],
        has_courseware: false,
      })
      // 后台获取完整详情
      openReport(reportBasic.id)
    } catch (err) { console.error('创建失败', err); alert('创建实验报告失败') }
    finally { setCreating(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该实验报告？')) return
    try {
      await api.delete(`/api/v1/experiments/${id}`)
      if (activeReport?.id === id) setActiveReport(null)
      await fetchReports()
    } catch (err) { console.error('删除失败', err) }
  }

  // 解析AI提问中的问题列表
  const extractQuestions = (content: string): string[] => {
    const askMatch = content.match(/\[ASK_USER\]\s*([\s\S]*?)(?=\[|$)/)
    if (!askMatch) return []
    const text = askMatch[1].trim()
    // 按数字序号分割（1. 2. 3. 等）
    const parts = text.split(/\d+\.\s*/).filter(Boolean).map(s => s.trim()).filter(s => s.length > 0)
    if (parts.length === 0) return [text]
    return parts
  }

  // 检测最后一条AI消息是否在提问（同时检查 streamingContent 兜底）
  const hasPendingQuestions = (): boolean => {
    if (!activeReport?.chat_history) return false
    const msgs = activeReport.chat_history.filter((m: any) => m.type !== '_progress')
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      if (last.content.includes('[ASK_USER]') || last.content.includes('[ASK_CHART]') || last.content.includes('[ASK_PHOTOS]')) return true
    }
    if (streamingContent.includes('[ASK_USER]') || streamingContent.includes('[ASK_CHART]') || streamingContent.includes('[ASK_PHOTOS]')) return true
    return false
  }

  // 获取当前问题列表（同时检查 streamingContent 兜底）
  const currentQuestions = (): string[] => {
    if (!activeReport?.chat_history) return []
    const msgs = activeReport.chat_history.filter((m: any) => m.type !== '_progress')
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      const q = extractQuestions(last.content)
      if (q.length > 0) return q
    }
    if (streamingContent) {
      const q = extractQuestions(streamingContent)
      if (q.length > 0) return q
    }
    return []
  }

  // 解析 [ASK_PHOTOS] 指令中的照片名称列表（同时检查 streamingContent 兜底）
  const currentPhotoSlots = (): string[] => {
    const extract = (text: string) => {
      const names: string[] = []
      const re = /\[ASK_PHOTOS:\s*([^\]]+)\]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        m[1].split(/[,，、]/).forEach((s: string) => {
          const t = s.trim()
          if (t) names.push(t)
        })
      }
      return names
    }
    if (activeReport?.chat_history) {
      const msgs = activeReport.chat_history.filter((m: any) => m.type !== '_progress')
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          return extract(msgs[i].content)
        }
      }
    }
    if (streamingContent) {
      return extract(streamingContent)
    }
    return []
  }

  // 提交所有问题的回答（含照片上传、表格数据）
  const submitAllAnswers = async () => {
    const parts: string[] = []

    // 收集有数据的表格
    for (const tableId of Object.keys(tables)) {
      const data = tables[tableId]
      const hasData = data && data.some((row: any) => Object.values(row).some((v: any) => v?.toString().trim()))
      if (hasData) {
        parts.push(`[TABLE_DATA: ${JSON.stringify({ tableId, data })}]\n表格数据已填写完毕。`)
      }
    }

    // 先处理照片上传
    const hasPhotos = Object.values(photoFiles).some(s => s.files.length > 0)
    if (hasPhotos) {
      const slots = currentPhotoSlots()
      const allPhotoNames = [...slots, ...extraPhotoNames.filter(n => n.trim())]
      setUploadingPhotos(true)
      const uploaded: string[] = []
      try {
        const localPhotos: Record<string, any[]> = { ...(photosRef.current || activeReport?.knowledge_base?.photos || {}) }
        for (const name of allPhotoNames) {
          const slot = photoFiles[name]
          if (!slot || slot.files.length === 0) continue
          const note = slot.notes || ''
          for (let fi = 0; fi < slot.files.length; fi++) {
            const file = slot.files[fi]
            const formData = new FormData()
            formData.append('file', file)
            formData.append('photo_name', name)
            formData.append('notes', note)
            const res = await api.postForm<{ success: boolean; url: string; notes: string }>(`/api/v1/experiments/${activeReport.id}/photos`, formData)
            if (res.success) {
              const idx = slot.files.length > 1 ? `(${fi + 1}/${slot.files.length})` : ''
              uploaded.push(`${name}${idx}${note ? ` [${note}]` : ''}`)
              if (!localPhotos[name]) localPhotos[name] = []
              localPhotos[name].push({ url: res.url, notes: res.notes || note })
            }
          }
        }
        setActiveReport((prev: any) => ({
          ...prev,
          knowledge_base: { ...(prev.knowledge_base || {}), photos: { ...(prev.knowledge_base?.photos || {}), ...localPhotos } },
        }))
        photosRef.current = localPhotos
        try { localStorage.setItem(PHOTOS_STORAGE_KEY + '_' + activeReport.id, JSON.stringify(localPhotos)) } catch {}
      } catch (err) { console.error('照片上传失败', err) }
      setUploadingPhotos(false)
      setPhotoFiles({})
      if (uploaded.length > 0) {
        const names = uploaded.join('、')
        parts.push(`[照片已上传完成通知] 照片 "${names}" 已通过独立上传功能成功上传到知识库（不是在聊天中发送的图片文件）。请你不要要求用户再次发送照片文件，而是直接重新输出当前章节的完整内容，在适当位置使用 [PHOTO: 照片名称] 标签来引用照片。请立即执行，不要再询问用户关于照片的事。`)
      }
    }

    // 收集问题回答
    const questions = currentQuestions()
    questions.forEach((q, i) => {
      const answer = questionAnswers[i]?.trim()
      if (answer) parts.push(`${i + 1}. ${answer}`)
    })

    // 补充说明
    if (supplementaryInput.trim()) parts.push(`补充: ${supplementaryInput.trim()}`)

    const reply = parts.length > 0 ? parts.join('\n') : '继续'

    // 如果 AI 正在输出，加入等待队列
    if (streaming) {
      pendingMessageRef.current = reply
      setHasPendingMessage(true)
      setQuestionAnswers([])
      setSupplementaryInput('')
      setPhotoSlots([])
      setPhotoFiles({})
      setExtraPhotoNames([])
      return
    }

    setQuestionAnswers([])
    setSupplementaryInput('')
    sendReply(reply)
  }

  const sendReply = async (overrideText?: string) => {
    const text = overrideText || chatInput.trim()
    if (!text || !activeReport || sending) return

    // 自动跳过当前待回答的问题
    let finalText = text
    if (!overrideText && hasPendingQuestions()) {
      const questions = currentQuestions()
      const skipped = questions.map((_, i) => `${i + 1}. 跳过`).join('\n')
      finalText = `${text}\n${skipped}`
    }

    // 如果 AI 正在输出，加入等待队列，输出完毕后自动发送
    if (streaming) {
      pendingMessageRef.current = finalText
      setHasPendingMessage(true)
      if (!overrideText) setChatInput('')
      return
    }

    setSending(true)
    setChatInput('')
    setStreamingContent('')
    streamingRef.current = true
    setStreaming(true)

    const token = localStorage.getItem('token')
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
    let accumulated = ''
    let streamOk = false
    const mergeKB = (prevKb: any, incKb: any) => {
      // Simple merge: inc overrides prev
      return { ...(prevKb || {}), ...(incKb || {}) }
    }

    try {
      const resp = await fetch(`${API_BASE_URL}/api/v1/experiments/${activeReport.id}/reply/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reply: finalText }),
      })

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const event = JSON.parse(data)
              if (event.type === 'token') {
                accumulated += event.content
                streamAccRef.current = accumulated
                if (!streamingThrottleRef.current) {
                  streamingThrottleRef.current = setTimeout(() => {
                    streamingThrottleRef.current = null
                    setStreamingContent(streamAccRef.current)
                  }, 200)
                }
              } else if (event.type === 'report_update' || event.type === 'complete') {
                streamOk = true
                // Flush pending stream
                if (streamingThrottleRef.current) {
                  clearTimeout(streamingThrottleRef.current)
                  streamingThrottleRef.current = null
                  setStreamingContent(streamAccRef.current)
                }
                setActiveReport((prev: any) => ({
                  ...prev,
                  status: event.status || prev.status,
                  draft_content: (event.draft_content && event.draft_content.length > 0) ? event.draft_content : (prev.draft_content || []),
                  chat_history: event.chat_history || prev.chat_history,
                  knowledge_base: mergeKB(prev.knowledge_base, event.knowledge_base),
                }))
                const merged2 = mergeKB(activeReportRef.current?.knowledge_base, event.knowledge_base)
                if (merged2?.photos) { photosRef.current = merged2.photos; try { localStorage.setItem(PHOTOS_STORAGE_KEY + '_' + activeReport?.id, JSON.stringify(merged2.photos)) } catch {} }
                streamingRef.current = false
                setStreaming(false)
              } else if (event.type === 'error') {
                console.error('SSE error:', event.message)
                streamingRef.current = false
                setStreaming(false)
                setStreamingContent('')
              }
            } catch (e) { /* ignore parse errors */ }
          }
        }
      }
    } catch (err) { console.error('流式发送失败', err) }
    finally {
      setSending(false)
      streamingRef.current = false
      if (pendingMessageRef.current) {
        const msg = pendingMessageRef.current
        pendingMessageRef.current = null
        setHasPendingMessage(false)
        sendReply(msg)
      } else if (!streamOk && activeReport?.id) {
        try {
          const fresh = await api.get<any>(`/api/v1/experiments/${activeReport.id}`)
          setActiveReport(fresh)
        } catch (_) { /* ignore refresh errors */ }
      }
      setStreaming(false)
    }
  }

  const handleExport = async (fmt: string) => {
    try {
      const token = localStorage.getItem('token')
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
      const resp = await fetch(`${API_BASE_URL}/api/v1/experiments/${activeReport.id}/export/${fmt}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) { alert('导出失败'); return }
      const contentType = resp.headers.get('content-type') || ''
      if (contentType.includes('text/plain')) {
        const text = await resp.text()
        console.error('导出返回错误:', text.slice(0, 2000))
        alert('导出失败，请查看控制台或联系管理员')
        return
      }
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeReport.title}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) { console.error('导出异常:', err); alert('导出失败') }
  }

  // 渲染报告内容（含 [PHOTO] 标记转换）
  const renderReportContent = (content: string, knowledge_base: any) => {
    let kb = knowledge_base || {}
    if (typeof kb === 'string') { try { kb = JSON.parse(kb) } catch { kb = {} } }
    const photos = allPhotos
    const imgBase = import.meta.env.VITE_API_BASE_URL || ''
    const resolveUrl = (url: string) => url.startsWith('http') ? url : `${imgBase}${url}`
    // 先替换 [PHOTO:] 标记，再交给 marked.parse，避免方括号被意外转义
    let html = content.replace(/\[PHOTO:\s*([^\]]+)\]/g, (match: string, name: string) => {
      const photo: any = photos[name.trim()]
      if (Array.isArray(photo) && photo.length > 0) {
        return photo.map((p: any, i: number) =>
          `<figure class="my-3"><img src="${resolveUrl(p.url)}" alt="${name.trim()}" class="max-w-full h-auto rounded-lg border" /><figcaption class="text-xs text-gray-500 mt-1 text-center">${name.trim()}${p.notes ? ` — ${p.notes}` : ''}${photo.length > 1 ? ` (${i + 1}/${photo.length})` : ''}</figcaption></figure>`
        ).join('')
      }
      if (photo?.url) {
        return `<figure class="my-4"><img src="${resolveUrl(photo.url)}" alt="${name.trim()}" class="max-w-full h-auto rounded-lg border" /><figcaption class="text-xs text-gray-500 mt-1 text-center">${name.trim()}</figcaption></figure>`
      }
      return `<p class="text-xs text-gray-400 italic my-2">📷 ${name.trim()}（照片待上传）</p>`
    })
    html = marked.parse(html)
    return html
  }

  // 从流式文本中实时解析章节（只保留白名单章节）
  const parseStreamSections = (text: string, whitelist: string[]): DraftSection[] => {
    const stripNum = (t: string) => t.replace(/^\d+[\.\、\s]*/, '').trim()
    const whiteClean = (whitelist || []).map(stripNum)
    const parts = text.split('[NEXT_SECTION]')
    return parts.filter(s => s.trim()).map(sec => {
      const titleMatch = sec.trim().match(/^#{1,3}\s+(.+?)$/m)
      if (!titleMatch) return null
      const sectionTitle = titleMatch[1].trim()
      if (whiteClean.length > 0 && !whiteClean.includes(stripNum(sectionTitle))) return null
      let clean = sec.trim()
      clean = clean.replace(/\[ASK_USER\].*$/s, '').replace(/\[ASK_CHART\].*$/s, '').replace(/\[SELF_CHECK\].*$/s, '').replace(/\[RENDER_TABLE:[^\]]*\]/g, '').replace(/\[REPORT_COMPLETE\]/g, '').trim()
      return { title: sectionTitle, content: clean }
    }).filter(Boolean) as DraftSection[]
  }

  // 解析章节内容为预览块（文本 / 图表 / mermaid）
  const parsePreviewContent = (content: string, skipMermaid = false): { type: string; content: string; parsed?: any }[] => {
    const blocks: { type: string; content: string }[] = []
    const chartRegex = /\[RENDER_CHART:\s*(.*?)\]/g
    let lastIdx = 0, m: RegExpExecArray | null
    while ((m = chartRegex.exec(content)) !== null) {
      if (m.index > lastIdx) blocks.push({ type: 'text', content: content.slice(lastIdx, m.index) })
      blocks.push({ type: 'chart', content: m[1].trim() })
      lastIdx = m.index + m[0].length
    }
    if (lastIdx < content.length) blocks.push({ type: 'text', content: content.slice(lastIdx) })
    if (blocks.length === 0) blocks.push({ type: 'text', content })
    // 展开 [CHART: ...][/CHART] 和 mermaid
    const expanded: { type: string; content: string; parsed?: any }[] = []
    for (const b of blocks) {
      if (b.type === 'text') {
        // 先拆 [CHART: type]...[/CHART]
        const chartBlockRegex = /\[CHART:\s*(\w+)\]([\s\S]*?)\[\/CHART\]/g
        let lastCIdx = 0, cm: RegExpExecArray | null
        while ((cm = chartBlockRegex.exec(b.content)) !== null) {
          if (cm.index > lastCIdx) {
            for (const sb of splitMermaidText(b.content.slice(lastCIdx, cm.index))) {
              if (skipMermaid && sb.type === 'mermaid') expanded.push({ type: 'text', content: sb.content })
              else expanded.push(sb)
            }
          }
          expanded.push({ type: 'label_bar', content: cm[0], parsed: parseChartBlock(cm[1], cm[0]) })
          lastCIdx = cm.index + cm[0].length
        }
        if (lastCIdx < b.content.length) {
          for (const sb of splitMermaidText(b.content.slice(lastCIdx))) {
            if (skipMermaid && sb.type === 'mermaid') expanded.push({ type: 'text', content: sb.content })
            else expanded.push(sb)
          }
        }
      } else {
        expanded.push(b)
      }
    }
    return expanded
  }

  // 解析 [CHART: type]...[/CHART] 为标准化数据
  const parseChartBlock = (chartType: string, raw: string): any => {
    let title = '', xLabel = '', yLabel = ''
    const labels: string[] = [], values: number[] = [], textValues: string[] = []
    let hasTextVal = false, autoVal = 0
    const lines = raw.split('\n')
    let inData = false
    for (const line of lines) {
      const t = line.trim()
      if (t.startsWith('[CHART:') || t === '[/CHART]') continue
      const lc = t.toLowerCase()
      if (lc.startsWith('title:')) { title = t.slice(6).trim(); continue }
      if (lc.startsWith('x-label:')) { xLabel = t.slice(8).trim(); continue }
      if (lc.startsWith('y-label:')) { yLabel = t.slice(8).trim(); continue }
      if (lc === 'data:') { inData = true; continue }
      if (inData && t) {
        const ci = t.indexOf(':')
        if (ci >= 0) {
          const lbl = t.slice(0, ci).trim()
          const rest = t.slice(ci + 1).trim()
          const parts = rest.split(',')
          const val = parseFloat(parts[0])
          if (!isNaN(val)) { labels.push(lbl); values.push(val); textValues.push(parts[0].trim()) }
          else { hasTextVal = true; autoVal++; labels.push(lbl); values.push(autoVal); textValues.push(rest) }
        } else {
          const parts = t.split(/\s+/)
          if (parts.length >= 2) {
            const lbl = parts.slice(0, -1).join(' ')
            const val = parseFloat(parts[parts.length - 1])
            if (!isNaN(val)) { labels.push(lbl); values.push(val); textValues.push(parts[parts.length - 1]) }
            else { hasTextVal = true; autoVal++; labels.push(lbl); values.push(autoVal); textValues.push(parts[parts.length - 1]) }
          }
        }
      }
    }
    const result: any = { labels, values, xLabel: xLabel || '类别', title, chartType }
    if (hasTextVal) result.textValues = textValues
    return result
  }

  // 获取预览区要渲染的章节列表（含流式覆盖逻辑）
  const previewSections = useMemo((): { title: string; blocks: { type: string; content: string; parsed?: any }[] }[] => {
    const draft = activeReport?.draft_content || []
    let sections: DraftSection[] = [...draft]
    if (streaming && streamingContent) {
      const streamSections = parseStreamSections(streamingContent, activeReport?.sections_config || [])
      for (let i = 0; i < streamSections.length; i++) {
        if (i < sections.length) sections[i] = streamSections[i]
        else sections.push(streamSections[i])
      }
    }
    return sections.map(s => ({ title: s.title, blocks: parsePreviewContent(s.content, streaming) }))
  }, [activeReport?.draft_content, activeReport?.sections_config, streamingContent, streaming])

  const getPreviewSections = () => previewSections
  const getChartData = (chartConfig: string) => {
    let type = 'scatter_with_fit', xLabel = 'X', yLabel = 'Y', showR2 = true
    try {
      const parts = chartConfig.match(/\w+=["'][^"']*["']/g) || []
      parts.forEach((p: string) => {
        const [k, v] = p.split('=')
        if (k === 'type') type = v.replace(/["']/g, '')
        if (k === 'x') xLabel = v.replace(/["']/g, '')
        if (k === 'y') yLabel = v.replace(/["']/g, '')
        if (k === 'showR2') showR2 = v.replace(/["']/g, '') === 'true'
      })
    } catch (e) { /* ignore */ }

    // 从最近提交的表格数据中收集数据
    let dataPoints: { x: number; y: number }[] = []
    if (activeReport?.chat_history) {
      for (const msg of activeReport.chat_history) {
        if (msg.table_data?.data) {
          const rows = msg.table_data.data
          const xIdx = xLabel.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '')
          const yIdx = yLabel.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '')
          dataPoints = rows
            .map((row: any) => ({ x: parseFloat(row[xLabel] || row[xIdx] || 0), y: parseFloat(row[yLabel] || row[yIdx] || 0) }))
            .filter((p: any) => !isNaN(p.x) && !isNaN(p.y))
        }
      }
    }

    // 兜底：如果没数据，生成模拟数据
    if (dataPoints.length === 0) {
      dataPoints = Array.from({ length: 5 }, (_, i) => ({ x: i + 1, y: Math.round((2.5 + i * 1.2 + Math.random()) * 100) / 100 }))
    }

    return { type, xLabel, yLabel, showR2, dataPoints }
  }

  // 线性拟合：y = ax + b
  const linearFit = (data: { x: number; y: number }[]) => {
    const n = data.length
    if (n < 2) return { a: 0, b: 0, r2: 0 }
    const sumX = data.reduce((s, p) => s + p.x, 0)
    const sumY = data.reduce((s, p) => s + p.y, 0)
    const sumXY = data.reduce((s, p) => s + p.x * p.y, 0)
    const sumX2 = data.reduce((s, p) => s + p.x * p.x, 0)
    const a = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const b = (sumY - a * sumX) / n
    const meanY = sumY / n
    const ssRes = data.reduce((s, p) => s + (p.y - (a * p.x + b)) ** 2, 0)
    const ssTot = data.reduce((s, p) => s + (p.y - meanY) ** 2, 0)
    const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
    return { a, b, r2 }
  }

  const chartColors = [
    'rgba(59, 130, 246, 0.7)', 'rgba(239, 68, 68, 0.7)', 'rgba(34, 197, 94, 0.7)',
    'rgba(234, 179, 8, 0.7)', 'rgba(168, 85, 247, 0.7)', 'rgba(249, 115, 22, 0.7)',
    'rgba(20, 184, 166, 0.7)', 'rgba(236, 72, 153, 0.7)',
  ]
  const chartBorders = chartColors.map(c => c.replace('0.7', '1'))

  const renderChart = (chartConfig: string) => {
    const { type, xLabel, yLabel, showR2, dataPoints } = getChartData(chartConfig)
    const fit = linearFit(dataPoints)
    const fitLine = type === 'scatter_with_fit' ? dataPoints.map(p => ({ x: p.x, y: fit.a * p.x + fit.b })) : []
    const labels = dataPoints.map((_, i) => `${i + 1}`)
    const values = dataPoints.map(p => p.y)
    const catLabels = dataPoints.map(p => `${p.x}`)

    const box = (title: string, children: React.ReactNode) => (
      <div className="my-3 p-4 bg-white border rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          <span className="text-sm font-medium text-gray-700">{title}</span>
        </div>
        <div className="h-64">{children}</div>
      </div>
    )

    if (type === 'pie') {
      return box(`饼图: ${yLabel}`, <Pie data={{ labels: catLabels, datasets: [{ data: values, backgroundColor: chartColors, borderColor: chartBorders, borderWidth: 1 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }} />)
    }
    if (type === 'doughnut') {
      return box(`环形图: ${yLabel}`, <Doughnut data={{ labels: catLabels, datasets: [{ data: values, backgroundColor: chartColors, borderColor: chartBorders, borderWidth: 1 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }} />)
    }
    if (type === 'polarArea') {
      return box(`极区图: ${yLabel}`, <PolarArea data={{ labels: catLabels, datasets: [{ data: values, backgroundColor: chartColors, borderColor: chartBorders, borderWidth: 1 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }} />)
    }
    if (type === 'radar') {
      return box(`雷达图: ${xLabel} vs ${yLabel}`, <Radar data={{ labels: catLabels, datasets: [{ label: yLabel, data: values, backgroundColor: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgb(59, 130, 246)', borderWidth: 2, pointBackgroundColor: 'rgb(59, 130, 246)' }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { r: { beginAtZero: true } } }} />)
    }
    if (type === 'horizontalBar') {
      return box(`水平柱状图: ${xLabel} vs ${yLabel}`, <Bar data={{ labels: catLabels, datasets: [{ label: yLabel, data: values, backgroundColor: 'rgba(59, 130, 246, 0.6)', borderColor: 'rgb(59, 130, 246)', borderWidth: 1 }] }} options={{ indexAxis: 'y' as const, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } }, scales: { x: { title: { display: true, text: yLabel } }, y: { title: { display: true, text: xLabel } } } }} />)
    }
    if (type === 'stackedBar') {
      const half = Math.ceil(values.length / 2)
      return box(`堆叠柱状图: ${xLabel} vs ${yLabel}`, <Bar data={{ labels: ['数据集1', '数据集2'], datasets: [{ label: `${yLabel} (组1)`, data: [values.slice(0, half).reduce((a: number, b: number) => a + b, 0), 0], backgroundColor: 'rgba(59, 130, 246, 0.6)' }, { label: `${yLabel} (组2)`, data: [0, values.slice(half).reduce((a: number, b: number) => a + b, 0)], backgroundColor: 'rgba(239, 68, 68, 0.6)' }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: yLabel } } } }} />)
    }
    if (type === 'line') {
      const ds: any[] = [{ label: yLabel, data: dataPoints.map(p => ({ x: p.x, y: p.y })), borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.3, pointRadius: 4 }]
      return box(`折线图: ${xLabel} vs ${yLabel}`, <Scatter data={{ datasets: ds.map(d => ({ ...d, showLine: true })) }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { type: 'linear', title: { display: true, text: xLabel } }, y: { title: { display: true, text: yLabel } } } }} />)
    }
    if (type === 'bubble') {
      const bubbleData = dataPoints.map(p => ({ x: p.x, y: p.y, r: Math.max(5, Math.abs(p.y) * 2) }))
      return box(`气泡图: ${xLabel} vs ${yLabel}`, <Scatter data={{ datasets: [{ label: yLabel, data: bubbleData, backgroundColor: 'rgba(59, 130, 246, 0.5)' }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { title: { display: true, text: xLabel } }, y: { title: { display: true, text: yLabel } } } }} />)
    }

    // bar / bar_chart (default bar)
    if (type === 'bar' || type === 'bar_chart') {
      return box(`柱状图: ${xLabel} vs ${yLabel}`, <Bar data={{ labels, datasets: [{ label: yLabel, data: values, backgroundColor: 'rgba(59, 130, 246, 0.6)', borderColor: 'rgb(59, 130, 246)', borderWidth: 1 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } }, scales: { x: { title: { display: true, text: xLabel } }, y: { title: { display: true, text: yLabel } } } }} />)
    }

    // scatter / scatter_with_fit (default)
    const datasets: any[] = [{ label: '实验数据', data: dataPoints, backgroundColor: 'rgba(59, 130, 246, 0.8)', pointRadius: 5 }]
    if (type === 'scatter_with_fit' && fitLine.length > 0) {
      datasets.push({ label: `拟合线 (y = ${fit.a.toFixed(3)}x ${fit.b >= 0 ? '+' : ''} ${fit.b.toFixed(3)})`, data: fitLine, type: 'line' as const, borderColor: 'rgb(239, 68, 68)', backgroundColor: 'rgba(239, 68, 68, 0.1)', pointRadius: 0, borderWidth: 2, fill: false, tension: 0 })
    }
    return (
      <div className="my-3 p-4 bg-white border rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <span className="text-sm font-medium text-gray-700">{type === 'scatter_with_fit' ? '散点图 + 拟合线' : '散点图'} ({xLabel} vs {yLabel})</span>
          </div>
          {showR2 && <span className="text-xs text-gray-500">R² = {fit.r2.toFixed(4)}</span>}
        </div>
        <div className="h-56"><Scatter data={{ datasets }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom' } }, scales: { x: { title: { display: true, text: xLabel } }, y: { title: { display: true, text: yLabel } } } }} /></div>
      </div>
    )
  }

  const renderLabelChart = (parsed: { labels: string[]; values: number[]; xLabel: string; title: string; chartType?: string; textValues?: string[] }) => {
    const ct = parsed.chartType || 'bar'
    const title = parsed.title || '图表'
    const textValues = parsed.textValues
    // 如有非数值文本，把文本值拼到标签上，条形统一高度
    const displayLabels = textValues ? parsed.labels.map((l, i) => `${l}${textValues[i] ? ` → ${textValues[i]}` : ''}`) : parsed.labels
    const displayValues = textValues ? Array(parsed.values.length).fill(1) : parsed.values
    const colors = ['rgba(59, 130, 246, 0.6)', 'rgba(239, 68, 68, 0.6)', 'rgba(34, 197, 94, 0.6)', 'rgba(234, 179, 8, 0.6)', 'rgba(168, 85, 247, 0.6)']
    const borders = colors.map(c => c.replace('0.6', '1'))

    const wrap = (chart: React.ReactNode) => (
      <div className="my-3 p-4 bg-white border rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          <span className="text-sm font-medium text-gray-700">{title}</span>
        </div>
        <div className="h-64">{chart}</div>
      </div>
    )

    const baseData = { labels: displayLabels, datasets: [{ data: displayValues, backgroundColor: colors, borderColor: borders, borderWidth: 1 }] }
    const barData = { labels: displayLabels, datasets: [{ label: parsed.xLabel, data: displayValues, backgroundColor: 'rgba(59, 130, 246, 0.6)', borderColor: 'rgb(59, 130, 246)', borderWidth: 1 }] }

    if (ct === 'pie') return wrap(<Pie data={baseData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }} />)
    if (ct === 'doughnut') return wrap(<Doughnut data={baseData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }} />)
    if (ct === 'polarArea') return wrap(<PolarArea data={baseData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }} />)
    if (ct === 'radar') return wrap(<Radar data={{ labels: displayLabels, datasets: [{ label: parsed.xLabel, data: displayValues, backgroundColor: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgb(59, 130, 246)', borderWidth: 2, pointBackgroundColor: 'rgb(59, 130, 246)' }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { r: { beginAtZero: true } } }} />)
    if (ct === 'horizontalBar') return wrap(<Bar data={barData} options={{ indexAxis: 'y' as const, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } }, scales: { x: { title: { display: true, text: '值' } }, y: { title: { display: true, text: parsed.xLabel } } } }} />)
    // default: bar
    return wrap(<Bar data={barData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } }, scales: { x: { title: { display: true, text: parsed.xLabel } }, y: { title: { display: true, text: '值' } } } }} />)
  }

  const renderTable = (columns: string[], rowsNum: number, tableId: string) => {
    const rows = tables[tableId] || Array.from({ length: rowsNum }, () =>
      Object.fromEntries(columns.map(c => [c, '']))
    )

    const updateCell = (rowIdx: number, col: string, val: string) => {
      const newData = [...rows]
      newData[rowIdx] = { ...newData[rowIdx], [col]: val }
      setTables({ ...tables, [tableId]: newData })
    }

    return (
      <div className="overflow-x-auto my-4 border rounded-xl bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              {columns.map(col => <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 border-b">{col}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any, ri: number) => (
              <tr key={ri} className="border-t">
                {columns.map(col => (
                  <td key={col} className="px-3 py-1.5">
                    <input
                      value={row[col] || ''}
                      onChange={e => updateCell(ri, col, e.target.value)}
                      className="w-full px-2 py-1 border border-gray-200 rounded focus:outline-none focus:border-blue-400 bg-white text-sm"
                      placeholder="输入数据"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const MermaidBlock = ({ definition }: { definition: string }) => {
    const sanitized = definition
      .replace(/\u201c/g, '"').replace(/\u201d/g, '"')
      .replace(/\u2018/g, "'").replace(/\u2019/g, "'")
      .replace(/^([ \t]*)(subgraph\s+)(.+?)$/gm, (_, indent, kw, label) => {
        if (/[()\[\]{}]/.test(label) && !label.startsWith('"')) return indent + kw + '"' + label.trim() + '"'
        return indent + kw + label
      })
    const trimmed = sanitized.trim()
    const chartKwRe = /^(bar\b|bar_chart|pie\b|doughnut|polarArea|radar\b|line\b|scatter\b|scatter_with_fit|horizontalBar|stackedBar|bubble\b)/i
    if (chartKwRe.test(trimmed)) {
      return <pre className="my-2 text-xs text-gray-500 whitespace-pre-wrap font-sans border border-gray-200 rounded-lg p-3 bg-gray-50 overflow-x-auto">{trimmed}</pre>
    }
    const id = useRef(`m-${Math.random().toString(36).slice(2, 8)}`)
    const lastDefRef = useRef('')
    const svgRef = useRef('')
    const [ready, setReady] = useState(false)
    const [error, setError] = useState('')
    useEffect(() => {
      if (!trimmed) return
      if (trimmed === lastDefRef.current && svgRef.current) { setReady(true); return }
      lastDefRef.current = trimmed; svgRef.current = ''; setReady(false); setError('')
      let cancelled = false
      mermaid.render(id.current, trimmed)
        .then(r => {
          if (!cancelled) { svgRef.current = r.svg; setReady(true) }
        })
        .catch(e => {
          if (!cancelled) {
            console.warn('mermaid render error:', e?.message || e)
            setError(String(e?.message || e)); setReady(true)
          }
        })
      return () => { cancelled = true; if (!svgRef.current) lastDefRef.current = '' }
    }, [trimmed])
    if (!trimmed) return null
    if (!ready && !error) return <div className="text-gray-400 text-xs my-2 animate-pulse">🔄 图表渲染中...</div>
    if (error) return <pre className="my-2 text-xs text-gray-500 whitespace-pre-wrap font-sans border border-gray-200 rounded-lg p-3 bg-gray-50 overflow-x-auto">{trimmed}</pre>
    return <div className="my-3 flex justify-center overflow-x-auto" dangerouslySetInnerHTML={{ __html: svgRef.current }} />
  }

  function splitMermaidText(text: string): { type: string; content: string; parsed?: any }[] {
    if (typeof text !== 'string' || !text.trim()) return [{ type: 'text', content: text || '' }]
    const mermaidStart = /^(graph\s+\w+|flowchart\s+\w+|sequenceDiagram|classDiagram|stateDiagram[-v2]*|erDiagram|gantt|journey|gitgraph\b|gitGraph|timeline|requirementDiagram|mindmap|sankey-beta|xychart-beta|block-beta|quadrantChart|zenuml|packet-beta|kanban|architecture-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|info|showInfo)/m
    const isMermaidLine = (line: string): boolean => {
      const t = line.trim()
      if (!t) return true
      return /^(subgraph\s|end\b|direction\b|accDescr\b|accTitle\b|rect\b|circle\b|class\b|link\b|click\b|style\b)/.test(t) ||
        /\[.*\]/.test(t) || /\((.*?)\)/.test(t) || /--[->]/.test(t) || /=-[->]/.test(t) || /\.->/.test(t) ||
        /==>/.test(t) || /<-[-]/.test(t) || /[-]+>/.test(t) || /\|.*\|/.test(t) ||
         /:::/.test(t) || /&&/.test(t) || /%%\{/.test(t)
    }
    const result: { type: string; content: string }[] = []
    const lines = text.split('\n')
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const trimmedLine = line.trim()
      // ```mermaid ... ``` code fence
      if (/^```\s*mermaid\s*$/i.test(trimmedLine)) {
        const fenceLines: string[] = []; i++
        while (i < lines.length && lines[i].trim() === '') i++
        while (i < lines.length) {
          const t = lines[i].trim()
          if (t === '```') { i++; break }
          fenceLines.push(lines[i]); i++
        }
        const raw = fenceLines.join('\n').trim()
        if (!raw) continue
        if (mermaidStart.test(raw.split('\n')[0]?.trim() || '')) result.push({ type: 'mermaid', content: raw })
        else result.push({ type: 'text', content: raw })
        continue
      }
      // %%% mermaid ... %%% fence
      if (/^%%%\s*mermaid/i.test(trimmedLine)) {
        const mermaidLines: string[] = []; i++
        while (i < lines.length) {
          const trimmed = lines[i].trim()
          if (trimmed === '%%%') break
          mermaidLines.push(lines[i]); i++
        }
        const raw = mermaidLines.join('\n').trim()
        if (raw) result.push({ type: 'mermaid', content: raw })
        i++
        continue
      }
      // Bare mermaid syntax
      if (mermaidStart.test(trimmedLine)) {
        const mermaidLines: string[] = [line]; i++
        while (i < lines.length) {
          const trimmed = lines[i].trim()
          if (trimmed.startsWith('## ') || trimmed.startsWith('# ') || trimmed.startsWith('[') || trimmed.startsWith('```')) break
          if (trimmed === '') {
            let peek = i + 1
            while (peek < lines.length && lines[peek].trim() === '') peek++
            if (peek >= lines.length || !isMermaidLine(lines[peek])) break
          }
          mermaidLines.push(lines[i]); i++
        }
        result.push({ type: 'mermaid', content: mermaidLines.join('\n').trim() })
      } else {
        // Plain text
        const textLines: string[] = [line]; i++
        while (i < lines.length) {
          const nl = lines[i].trim()
          if (mermaidStart.test(nl) || /^%%%\s*mermaid/i.test(nl) || /^```\s*mermaid\s*$/i.test(nl)) break
          textLines.push(lines[i]); i++
        }
        const t = textLines.join('\n').trim()
        if (t) result.push({ type: 'text', content: t })
      }
    }
    if (result.length === 0) result.push({ type: 'text', content: text })
    return result
  }

  const parseChatContent = (content: string) => {
    const parts: { type: string; content: any }[] = []
    const tableRegex = /\[RENDER_TABLE:\s*columns=\[(.*?)\],\s*rows=([^\]]+?)\]/g
    const askRegex = /\[ASK_USER\]\s*([\s\S]*?)(?=\[|$)/g
    const askChartRegex = /\[ASK_CHART\]\s*([\s\S]*?)(?=\[|$)/g
    const askPhotosRegex = /\[ASK_PHOTOS:\s*([^\]]+)\]/g
    const photoRegex = /\[PHOTO:\s*([^\]]+)\]/g
    const chartRegex = /\[RENDER_CHART:\s*(.*?)\]/g
    const chartBlockRegex = /\[CHART:\s*(\w+)\]([\s\S]*?)\[\/CHART\]/g

    let lastIdx = 0
    const matches: { index: number; match: string; type: string; data: any }[] = []

    let m
    while ((m = tableRegex.exec(content)) !== null) {
      const rowsRaw = m[2].trim()
      const rowsNum = parseInt(rowsRaw, 10)
      matches.push({ index: m.index, match: m[0], type: 'table', data: { columns: m[1].split(',').map((s: string) => s.trim().replace(/^"|"$/g, '')), rows: isNaN(rowsNum) ? 3 : rowsNum } })
    }
    while ((m = chartRegex.exec(content)) !== null) {
      matches.push({ index: m.index, match: m[0], type: 'chart', data: m[1].trim() })
    }
    while ((m = chartBlockRegex.exec(content)) !== null) {
      matches.push({ index: m.index, match: m[0], type: 'chart_block', data: { chartType: m[1], raw: m[0] } })
    }
    while ((m = askChartRegex.exec(content)) !== null) {
      matches.push({ index: m.index, match: m[0], type: 'ask_chart', data: m[1].trim() })
    }
    while ((m = askPhotosRegex.exec(content)) !== null) {
      matches.push({ index: m.index, match: m[0], type: 'ask_photos', data: m[1].split(/[,，、]/).map((s: string) => s.trim()).filter(Boolean) })
    }
    while ((m = photoRegex.exec(content)) !== null) {
      matches.push({ index: m.index, match: m[0], type: 'photo', data: m[1].trim() })
    }
    while ((m = askRegex.exec(content)) !== null) {
      matches.push({ index: m.index, match: m[0], type: 'ask', data: m[1].trim() })
    }

    matches.sort((a, b) => a.index - b.index)

    for (const match of matches) {
      if (match.index > lastIdx) {
        const txt = content.slice(lastIdx, match.index).trim()
        if (txt) parts.push({ type: 'text', content: txt })
      }
      parts.push({ type: match.type, content: match.data })
      lastIdx = match.index + match.match.length
    }
    const remaining = content.slice(lastIdx).trim()
    if (remaining) parts.push({ type: 'text', content: remaining })

    return parts
  }

  if (activeReport) {
    const statusText: Record<string, string> = {
      collecting: '正在汇集知识...',
      knowledge_ready: '知识准备完成',
      writing: '写作中...',
      completed: '已完成',
      failed: '失败'
    }

    return (
      <div className="fixed inset-0 bg-gray-100 flex flex-col">
        <div className="bg-white border-b px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => { setActiveReport(null) }} className="flex items-center gap-1 p-1.5 hover:bg-gray-100 rounded-lg text-sm text-gray-600">
            <ChevronLeft className="w-4 h-4" />
            <span>返回</span>
          </button>
          <span className="font-semibold text-gray-800">{activeReport.title}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            activeReport.status === 'completed' ? 'bg-green-100 text-green-700' :
            activeReport.status === 'writing' ? 'bg-blue-100 text-blue-700' :
            activeReport.status === 'failed' ? 'bg-red-100 text-red-700' :
            activeReport.status === 'collecting' ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-600'
          }`}>
            {statusText[activeReport.status] || activeReport.status}
          </span>
          {(activeReport.status === 'completed' || activeReport.status === 'pending_review') && (
            <div className="ml-auto flex gap-2">
              {activeReport.status === 'pending_review' && (
                <button
                  onClick={async () => {
                    const token = localStorage.getItem('token')
                    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
                    try {
                      const resp = await fetch(`${API_BASE_URL}/api/v1/experiments/${activeReport.id}/finalize`, {
                        method: 'POST',
                        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                      })
                      if (resp.ok) {
                        setActiveReport((prev: any) => ({ ...prev, status: 'completed' }))
                      }
                    } catch (e) { console.error('确认完成失败', e) }
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-purple-500 text-white text-xs rounded-lg hover:bg-purple-600"
                >
                  ✅ 确认完成
                </button>
              )}
              <button onClick={() => handleExport('docx')} className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white text-xs rounded-lg hover:bg-green-600">
                <Download className="w-3.5 h-3.5" /> Word
              </button>
              <button onClick={() => handleExport('pdf')} className="flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600">
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          )}
        </div>

        {/* 进度条 */}
        {progress && (activeReport.status === 'collecting' || activeReport.status === 'knowledge_ready') && (
          <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-yellow-600" />
              <span className="text-sm text-yellow-700">{progress.step}</span>
              <span className="text-xs text-yellow-500 ml-auto">{progress.percent}%</span>
            </div>
            <div className="mt-2 w-full bg-yellow-200 rounded-full h-1.5">
              <div className="bg-yellow-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto">
              {(activeReport.draft_content || []).length > 0 || streamingContent ? (
                <div className="bg-white rounded-xl shadow-sm border p-8" data-report-id={activeReport.id}>
                  <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center border-b pb-4">{activeReport.title}</h2>
                  {(() => {
                    const previewSections = getPreviewSections()
                    if (previewSections.length === 0) return <p className="text-gray-400 text-center text-sm">等待内容...</p>
                    return previewSections.map((section, si) => (
                      <div key={si} id={`section-${si}`}>
                        <h3 className="text-lg font-bold text-gray-800 mt-6 mb-3">{si + 1}. {section.title}</h3>
                        {section.blocks.map((block, bi) => {
                          if (block.type === 'chart') return <div key={bi}>{renderChart(block.content)}</div>
                          if (block.type === 'mermaid') return <MermaidBlock key={bi} definition={block.content} />
                          if (block.type === 'label_bar') return <div key={bi}>{renderLabelChart(block.parsed)}</div>
                          return (
                            <div key={bi}
                              className="prose prose-sm max-w-none text-gray-600 leading-relaxed"
                              dangerouslySetInnerHTML={{ __html: renderReportContent(block.content, activeReport?.knowledge_base) }}
                            />
                          )
                        })}
                      </div>
                    ))
                  })()}
                </div>
              ) : (
                <div className="text-center py-20 text-gray-400">
                  <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>{activeReport.status === 'collecting' ? '知识收集中...' : '报告内容生成中...'}</p>
                </div>
              )}
              <div ref={reportEndRef} />
            </div>
          </div>

          <div className="w-[440px] border-l bg-white flex flex-col flex-shrink-0">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-600">与助手对话</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.map((msg: ChatMessage, i: number) => {
                const parts = parseChatContent(msg.content || '')
                return (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[92%] rounded-xl px-4 py-2.5 ${
                      msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {parts.map((p, pi) => {
                        if (p.type === 'text') {
                          const subBlocks = splitMermaidText(p.content)
                          return subBlocks.map((sb, sbi) => {
                            if (sb.type === 'mermaid') {
                              return <MermaidBlock key={`${pi}_${sbi}`} definition={sb.content} />
                            }
                            if (sb.type === 'label_bar') {
                               return <div key={`${pi}_${sbi}`}>{renderLabelChart(sb.parsed)}</div>
                             }
                            return <p key={`${pi}_${sbi}`} className="text-sm prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: marked.parse(sb.content) }} />
                          })
                        }
                        if (p.type === 'ask') return <p key={pi} className="text-sm text-orange-600 font-medium mt-1">{p.content}</p>
                        if (p.type === 'ask_chart') {
                          const msgText = p.content || '是否需要绘制图表分析数据？'
                          return (
                            <div key={pi} className="my-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                              <p className="text-sm text-blue-700 mb-2">{msgText}</p>
                              <div className="flex gap-2">
                                <button onClick={() => sendReply('是，请生成图表')} className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600">是，生成图表</button>
                                <button onClick={() => sendReply('不需要，继续纯文本')} className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">不需要</button>
                              </div>
                            </div>
                          )
                        }
                        if (p.type === 'table') return <p key={pi} className="text-xs text-gray-400 italic my-1">📊 数据表格 — 请在下方填写</p>
                        if (p.type === 'chart') return <div key={pi}>{renderChart(p.content)}</div>
                        if (p.type === 'chart_block') {
                          const parsed = parseChartBlock(p.content.chartType, p.content.raw)
                          if (parsed && parsed.labels && parsed.labels.length) return <div key={pi}>{renderLabelChart(parsed)}</div>
                          return <p key={pi} className="text-sm prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: marked.parse(p.content.raw) }} />
                        }
                        if (p.type === 'ask_photos') {
                          const names: string[] = p.content || []
                          return (
                            <div key={pi} className="my-2 p-3 bg-green-50 rounded-lg border border-green-200">
                              <p className="text-sm text-green-700 mb-2 font-medium">📷 需要上传以下实验结果照片：</p>
                              <ul className="text-sm text-green-600 list-disc list-inside">
                                {names.map((n: string, ni: number) => <li key={ni}>{n}</li>)}
                              </ul>
                            </div>
                          )
                        }
                        if (p.type === 'photo') {
                          const photoName = p.content
                          const photoList = allPhotos[photoName]
                          const firstPhoto = Array.isArray(photoList) ? photoList[0] : photoList
                          return (
                            <div key={pi} className="my-2">
                              {firstPhoto ? (
                                <div>
                                  {Array.isArray(photoList) ? photoList.map((pp: any, ppi: number) => (
                                    <figure key={ppi} className="mb-2">
                                      <img src={pp.url} alt={photoName} className="max-w-full h-auto rounded-lg border" />
                                      {pp.notes && <figcaption className="text-xs text-gray-500 mt-0.5">{pp.notes}</figcaption>}
                                    </figure>
                                  )) : (
                                    <div>
                                      <p className="text-xs text-gray-500 mb-1">{photoName}</p>
                                      <img src={firstPhoto.url} alt={photoName} className="max-w-full h-auto rounded-lg border" />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400 italic">📷 {photoName}（待上传）</p>
                              )}
                            </div>
                          )
                        }
                        return null
                      })}
                    </div>
                  </div>
                )
              })}
              {/* 等待 AI 回答的加载气泡 */}
              {sending && !streamingContent && (
                <div className="flex justify-start">
                  <div className="rounded-xl px-5 py-3 bg-gray-100 flex items-center gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              {/* 流式输出实时显示 */}
              {streaming && streamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[92%] rounded-xl px-4 py-2.5 bg-gray-100 text-gray-700">
                    {(() => {
                       const subs = splitMermaidText(streamingContent)
                       return subs.map((sb, si) => {
                         if (sb.type === 'label_bar') return <div key={si}>{renderLabelChart(sb.parsed)}</div>
                         if (sb.type === 'mermaid') return <MermaidBlock key={si} definition={sb.content} />
                         return <span key={si} className="text-sm prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: renderReportContent(sb.content, activeReport.knowledge_base) }} />
                       })
                     })()}
                    <span className="inline-block w-1.5 h-4 bg-blue-500 ml-0.5 animate-pulse" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {activeReport.status !== 'completed' && !streaming && (
              <div className="border-t bg-white max-h-[50%] overflow-y-auto flex-shrink-0">
                <div className="p-3 space-y-3">
                  {/* 数据表格 */}
                  {currentTableConfig && (
                    <div className="border rounded-lg p-3 bg-blue-50">
                      <p className="text-xs font-medium text-blue-700 mb-2">📊 请填写实验数据</p>
                      {renderTable(currentTableConfig.columns, currentTableConfig.rows, currentTableConfig.tableId)}
                    </div>
                  )}
                  {/* 照片 + 问题 或 输入区 */}
                  {(currentPhotoSlots().length > 0 || currentQuestions().length > 0) ? (
                    <>
                    {currentPhotoSlots().length > 0 && (
                      <>
                        <p className="text-xs font-medium text-gray-500">📷 上传实验结果照片</p>
                        <div className="flex flex-col gap-3">
                          {currentPhotoSlots().map((name, i) => {
                            const slot = photoFiles[name] || { files: [], notes: '' }
                            return (
                              <div key={i} className="border rounded-lg p-3 bg-gray-50">
                                <label className="block text-xs font-medium text-gray-700 mb-1 truncate" title={name}>{name}</label>
                                <textarea
                                  value={slot.notes}
                                  onChange={e => setPhotoFiles({ ...photoFiles, [name]: { ...slot, notes: e.target.value } })}
                                  placeholder="备注说明（可选）..."
                                  rows={2}
                                  className="w-full text-xs px-2 py-1 mb-2 border rounded bg-white focus:outline-none focus:border-green-400 resize-none"
                                />
                                {slot.files.length > 0 && (
                                  <div className="flex flex-col gap-1 mb-2">
                                    {slot.files.map((file, fi) => (
                                      <div key={fi} className="flex items-center gap-1 text-xs text-gray-600 bg-white rounded px-2 py-1">
                                        <span className="truncate flex-1">{file.name}</span>
                                        <button onClick={() => {
                                          const newFiles = slot.files.filter((_, j) => j !== fi)
                                          setPhotoFiles({ ...photoFiles, [name]: { ...slot, files: newFiles } })
                                        }} className="text-red-400 hover:text-red-600">&times;</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <button
                                  onClick={() => {
                                    const input = document.createElement('input')
                                    input.type = 'file'
                                    input.accept = 'image/*'
                                    input.multiple = true
                                    input.onchange = () => {
                                      if (input.files && input.files.length > 0) {
                                        const newFiles = [...slot.files, ...Array.from(input.files)]
                                        setPhotoFiles({ ...photoFiles, [name]: { ...slot, files: newFiles } })
                                      }
                                    }
                                    input.click()
                                  }}
                                  className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-400 hover:border-green-400 hover:text-green-500 transition-colors"
                                >+ 选择照片（可多选）</button>
                              </div>
                            )
                          })}
                          {extraPhotoNames.map((name, i) => {
                            const slot = photoFiles[name] || { files: [], notes: '' }
                            return (
                              <div key={`extra-${i}`} className="border rounded-lg p-3 bg-gray-50">
                                <input value={name} onChange={e => { const newNames = [...extraPhotoNames]; newNames[i] = e.target.value; setExtraPhotoNames(newNames) }} placeholder="输入照片名称..." className="w-full text-xs font-medium text-gray-700 mb-1 px-1 py-0.5 border-b border-gray-300 focus:outline-none focus:border-green-400 bg-transparent" />
                                <textarea
                                  value={slot.notes}
                                  onChange={e => setPhotoFiles({ ...photoFiles, [name]: { ...slot, notes: e.target.value } })}
                                  placeholder="备注说明（可选）..."
                                  rows={2}
                                  className="w-full text-xs px-2 py-1 mb-2 border rounded bg-white focus:outline-none focus:border-green-400 resize-none"
                                />
                                {slot.files.length > 0 && (
                                  <div className="flex flex-col gap-1 mb-2">
                                    {slot.files.map((file, fi) => (
                                      <div key={fi} className="flex items-center gap-1 text-xs text-gray-600 bg-white rounded px-2 py-1">
                                        <span className="truncate flex-1">{file.name}</span>
                                        <button onClick={() => {
                                          const newFiles = slot.files.filter((_, j) => j !== fi)
                                          setPhotoFiles({ ...photoFiles, [name]: { ...slot, files: newFiles } })
                                        }} className="text-red-400 hover:text-red-600">&times;</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <button onClick={() => {
                                  const input = document.createElement('input')
                                  input.type = 'file'
                                  input.accept = 'image/*'
                                  input.multiple = true
                                  input.onchange = () => {
                                    if (input.files && input.files.length > 0) {
                                      const newFiles = [...slot.files, ...Array.from(input.files)]
                                      setPhotoFiles({ ...photoFiles, [name]: { ...slot, files: newFiles } })
                                    }
                                  }
                                  input.click()
                                }} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-400 hover:border-green-400 hover:text-green-500 transition-colors">+ 选择照片（可多选）</button>
                              </div>
                            )
                          })}
                        </div>
                        <button onClick={() => setExtraPhotoNames([...extraPhotoNames, ''])} className="text-xs text-green-600 hover:text-green-700 font-medium">+ 添加额外照片</button>
                      </>
                    )}
                    {currentQuestions().length > 0 && (
                      <>
                        {currentPhotoSlots().length > 0 && <div className="border-t border-gray-200" />}
                        <p className="text-xs font-medium text-gray-500">回答以下问题（可留空跳过）</p>
                        <div className="flex flex-col gap-3">
                          {currentQuestions().map((q, i) => (
                            <div key={i}>
                              <label className="block text-xs text-gray-600 mb-1 font-medium">{i + 1}. {q}</label>
                              <input
                                value={questionAnswers[i] || ''}
                                onChange={e => { const newAnswers = [...questionAnswers]; newAnswers[i] = e.target.value; setQuestionAnswers(newAnswers) }}
                                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submitAllAnswers())}
                                placeholder="输入回答..."
                                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-gray-50"
                              />
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">补充说明（可选）</label>
                      <textarea value={supplementaryInput} onChange={e => setSupplementaryInput(e.target.value)} placeholder="其他想告诉助手的信息..." rows={2} className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-gray-50 resize-none" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={submitAllAnswers} disabled={sending || hasPendingMessage} className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors">
                        {sending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : hasPendingMessage ? '等待发送...' : '提交'}
                      </button>
                      <button onClick={() => { setPhotoSlots([]); setPhotoFiles({}); setExtraPhotoNames([]); sendReply('已跳过') }} className="px-4 py-2.5 border border-gray-300 text-gray-500 rounded-lg text-sm hover:bg-gray-50 transition-colors">跳过</button>
                    </div>
                  </>
                ) : (
                  <div className="p-3">
                    <div className="flex gap-2">
                      <input
                        value={chatInput}
                        onChange={e => {
                          setChatInput(e.target.value)
                          setQuestionAnswers([])
                          setSupplementaryInput('')
                        }}
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendReply())}
                        placeholder={hasPendingMessage ? '消息已进入等待队列...' : '输入回复...'}
                        className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-gray-50"
                      />
                      <button
                        onClick={() => sendReply()}
                        disabled={sending || !chatInput.trim()}
                        className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 transition-colors"
                      >
                        {hasPendingMessage ? <span className="text-xs">排队中</span> : sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </div>
                    {hasPendingMessage && (
                      <p className="text-xs text-orange-500 mt-1.5 text-center">⏳ AI 输出完成后将自动发送</p>
                    )}
                  </div>
                )}
              </div>
              </div>
            )}
            {activeReport.status === 'completed' && (
              <div className="border-t p-4 text-center text-sm text-green-600 font-medium">
                ✅ 报告已完成！可点击上方 Word 或 PDF 按钮导出
              </div>
            )}
            {activeReport.status === 'pending_review' && (
              <div className="border-t p-3 text-center text-sm text-purple-600 font-medium">
                🔍 报告已初步完成，可在对话中提出修改意见，或点击上方「确认完成」按钮
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="flex items-center gap-1 p-1.5 hover:bg-gray-100 rounded-lg text-sm text-gray-600">
              <ChevronLeft className="w-4 h-4" />
              <span>返回</span>
            </button>
            <FlaskConical className="w-8 h-8 text-purple-600" />
            <h1 className="text-2xl font-bold text-gray-800">实验报告</h1>
          </div>
          <button
            onClick={() => { setSectionsText('1. 实验目的\n2. 实验原理\n3. 实验器材\n4. 实验步骤\n5. 数据记录与处理\n6. 结果分析\n7. 实验结论'); setShowCreate(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">新建实验</span>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-purple-400" /></div>
        ) : reports.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border">
            <FlaskConical className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500">还没有实验报告项目</p>
            <button onClick={() => { setSectionsText('1. 实验目的\n2. 实验原理\n3. 实验器材\n4. 实验步骤\n5. 数据记录与处理\n6. 结果分析\n7. 实验结论'); setShowCreate(true) }} className="mt-4 px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700">
              创建第一个实验报告
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map(r => (
              <div key={r.id} onClick={() => openReport(r.id)} className="bg-white rounded-xl border p-5 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FlaskConical className="w-6 h-6 text-purple-500" />
                    <div>
                      <p className="font-semibold text-gray-800">{r.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {r.has_courseware ? '含课件 · ' : ''}
                        创建于 {new Date(r.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      r.status === 'completed' ? 'bg-green-100 text-green-700' :
                      r.status === 'writing' ? 'bg-blue-100 text-blue-700' :
                      r.status === 'collecting' ? 'bg-yellow-100 text-yellow-700' :
                      r.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {r.status === 'collecting' ? '收集中' :
                       r.status === 'knowledge_ready' ? '已准备' :
                       r.status === 'writing' ? '写作中' :
                       r.status === 'completed' ? '已完成' :
                       r.status === 'failed' ? '失败' : r.status}
                    </span>
                    <button onClick={e => { e.stopPropagation(); handleDelete(r.id) }} className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">新建实验报告</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">实验名称 *</label>
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="输入实验名称" className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-purple-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2">包含的章节（每行一个，可直接修改）</label>
                <textarea
                  value={sectionsText}
                  onChange={e => setSectionsText(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-purple-400 resize-none font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">参考课件 <span className="text-gray-400 font-normal">（可选，文档和截图选一）</span></label>
                <div className="space-y-2">
                  <button onClick={() => { fileInputRef.current?.click(); setPhotoItems(prev => { prev.forEach(p => URL.revokeObjectURL(p.preview)); return [] }) }} className={`w-full py-6 border-2 border-dashed rounded-xl text-sm transition-colors ${selectedFile ? 'border-purple-400 text-purple-500 bg-purple-50' : 'border-gray-300 text-gray-400 hover:border-purple-300 hover:text-purple-500'}`}>
                    {selectedFile ? selectedFile.name : '📄 上传文档（PDF/Word/PPT/Markdown）'}
                  </button>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span>或</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">上传课件截图</span>
                      <span className="text-xs text-gray-400">{photoItems.length}/300 张</span>
                    </div>
                    <input ref={photoInputRef} type="file" accept="image/*" multiple onChange={handlePhotoSelect} className="hidden" />
                    {photoItems.length === 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={handleCameraCapture} className="py-5 border-2 border-dashed border-gray-300 rounded-xl text-center hover:border-green-300 transition-colors">
                          <Camera size={24} className="mx-auto text-gray-400" />
                          <p className="mt-1 text-xs text-gray-500 font-medium">拍照</p>
                        </button>
                        <button onClick={() => photoInputRef.current?.click()} className="py-5 border-2 border-dashed border-gray-300 rounded-xl text-center hover:border-green-300 transition-colors">
                          <FileText size={24} className="mx-auto text-gray-400" />
                          <p className="mt-1 text-xs text-gray-500 font-medium">选择照片</p>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto mb-2">
                        {photoItems.map((item, idx) => (
                          <div key={item.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2 border border-gray-200">
                            <span className="w-5 text-center text-[10px] text-gray-400 font-mono flex-shrink-0">{idx + 1}</span>
                            <img src={item.preview} alt="" className="w-12 h-12 object-cover rounded flex-shrink-0" />
                            <span className="flex-1 text-xs text-gray-600 truncate">{item.file.name}</span>
                            <button onClick={() => movePhoto(item.id, -1)} disabled={idx === 0} className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                            <button onClick={() => movePhoto(item.id, 1)} disabled={idx === photoItems.length - 1} className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                            <button onClick={() => removePhoto(item.id)} className="p-0.5 hover:bg-red-100 rounded text-red-400"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <button onClick={handleCameraCapture} className="flex-1 py-2 text-xs text-emerald-500 hover:text-emerald-600 border border-dashed border-gray-300 rounded-lg transition-colors flex items-center justify-center gap-1">
                            <Camera className="w-3.5 h-3.5" />拍照
                          </button>
                          <button onClick={() => photoInputRef.current?.click()} className="flex-1 py-2 text-xs text-blue-500 hover:text-blue-600 border border-dashed border-gray-300 rounded-lg transition-colors flex items-center justify-center gap-1">
                            <FileText className="w-3.5 h-3.5" />选择照片
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <input ref={fileInputRef} type="file" accept=".pdf,.docx,.pptx,.ppt,.txt,.md" className="hidden" onChange={e => { setSelectedFile(e.target.files?.[0] || null); if (e.target.files?.[0]) { photoItems.forEach(p => URL.revokeObjectURL(p.preview)); setPhotoItems([]) } }} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { photoItems.forEach(p => URL.revokeObjectURL(p.preview)); setShowCreate(false); setSelectedFile(null); setPhotoItems([]); setSectionsText('') }} className="flex-1 py-2.5 border rounded-xl text-sm text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={handleCreate} disabled={!newTitle.trim() || creating} className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm hover:bg-purple-700 disabled:opacity-40">
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
