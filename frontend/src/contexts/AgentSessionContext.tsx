import React, { createContext, useContext, useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '../api'
import type { FileArtifact } from '../components/ArtifactsPanel'
import type { ChartImage } from '../components/ChartGrid'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws') + '/ws'

const STORAGE_KEY = 'normal-chat-sessions'
const COLLAB_STORAGE_KEY = 'collaboration-chat-sessions'
const ACTIVE_SESSION_KEY = 'agent-active-session'
const ACTIVE_MODE_KEY = 'agent-active-mode'

export interface Message {
  id: string
  role: 'user' | 'orchestrator' | 'agent' | 'system' | 'thinking' | 'artifact_preview' | 'toolagent'
  content: string
  agent_id?: string
  agent_name?: string
  agent_icon?: string
  done?: boolean
  artifact?: boolean
  error?: boolean
  title?: string
  reasoning?: string
  completed?: boolean
  task_id?: string
  files?: { name: string; type: string; url: string }[]
  artifact_url?: string
  artifact_type?: string
  artifact_filename?: string
  toolagent_id?: string
}

export interface NormalSession {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}



interface Stage {
  id: string
  label: string
  status: 'pending' | 'active' | 'completed'
  content?: string
}

const STAGE_LABELS: { id: string; label: string }[] = [
  { id: 'understanding', label: '意图理解' },
  { id: 'planning', label: '任务规划' },
  { id: 'execution', label: '并行执行' },
  { id: 'assembly', label: '结果汇编' },
]

function loadSessions(key: string): NormalSession[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch { return [] }
}

function saveSessions(key: string, ss: NormalSession[]) {
  localStorage.setItem(key, JSON.stringify(ss))
}

export interface AgentSessionValue {
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  messagesRef: React.MutableRefObject<Message[]>

  input: string
  setInput: (v: string) => void
  loading: boolean
  setLoading: (v: boolean) => void
  streamingContent: string
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>
  isStreaming: boolean
  setIsStreaming: (v: boolean) => void
  streamingDone: boolean
  setStreamingDone: (v: boolean) => void
  streamingMsgIdRef: React.MutableRefObject<string | null>
  streamingSessionIdRef: React.MutableRefObject<string | null>
  streamContentRef: React.MutableRefObject<Record<string, string>>
  streamBufferBySession: React.MutableRefObject<Record<string, { content: string; messageIds: Record<string, string> }>>

  uploadingFiles: string[]
  setUploadingFiles: React.Dispatch<React.SetStateAction<string[]>>

  chatMode: 'normal' | 'collaboration'
  setChatMode: (v: 'normal' | 'collaboration') => void
  outputMode: 'detailed' | 'concise'
  setOutputMode: (v: 'detailed' | 'concise') => void
  deepThink: boolean
  setDeepThink: (v: boolean) => void

  currentSessionId: string | null
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>
  normalSessions: NormalSession[]
  setNormalSessions: React.Dispatch<React.SetStateAction<NormalSession[]>>
  collabSessions: NormalSession[]
  setCollabSessions: React.Dispatch<React.SetStateAction<NormalSession[]>>

  currentTaskId: string | null
  setCurrentTaskId: React.Dispatch<React.SetStateAction<string | null>>
  currentDiscussionTodoId: string | null
  setCurrentDiscussionTodoId: React.Dispatch<React.SetStateAction<string | null>>

  todos: any[]
  setTodos: React.Dispatch<React.SetStateAction<any[]>>
  agentsStarted: boolean
  setAgentsStarted: (v: boolean) => void
  agentReasoning: Record<string, string>
  setAgentReasoning: React.Dispatch<React.SetStateAction<Record<string, string>>>
  agentFinalContent: Record<string, string>
  setAgentFinalContent: React.Dispatch<React.SetStateAction<Record<string, string>>>
  agentStreamContent: Record<string, string>
  setAgentStreamContent: React.Dispatch<React.SetStateAction<Record<string, string>>>
  agentTaskDesc: Record<string, string>
  setAgentTaskDesc: React.Dispatch<React.SetStateAction<Record<string, string>>>
  thinkingCompleted: boolean
  setThinkingCompleted: (v: boolean) => void
  thinkingFinished: boolean
  setThinkingFinished: (v: boolean) => void

  fileArtifacts: FileArtifact[]
  setFileArtifacts: React.Dispatch<React.SetStateAction<FileArtifact[]>>
  chartImages: ChartImage[]
  setChartImages: React.Dispatch<React.SetStateAction<ChartImage[]>>
  pendingArtifacts: FileArtifact[]
  setPendingArtifacts: React.Dispatch<React.SetStateAction<FileArtifact[]>>
  artifactsPanelVisible: boolean
  setArtifactsPanelVisible: (v: boolean) => void
  previewUrl: string | null
  setPreviewUrl: React.Dispatch<React.SetStateAction<string | null>>

  toolagentThinking: string[]
  setToolagentThinking: React.Dispatch<React.SetStateAction<string[]>>
  toolagentProjectPath: string | null
  setToolagentProjectPath: React.Dispatch<React.SetStateAction<string | null>>
  toolagentWaitingFeedback: boolean
  setToolagentWaitingFeedback: (v: boolean) => void
  toolagentPhase: 'design' | 'export' | null
  setToolagentPhase: React.Dispatch<React.SetStateAction<'design' | 'export' | null>>
  toolagentDesignSpec: Record<string, unknown> | null
  setToolagentDesignSpec: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>
  toolagentDone: boolean
  setToolagentDone: (v: boolean) => void
  toolagentPptxPath: string
  setToolagentPptxPath: React.Dispatch<React.SetStateAction<string>>
  toolagentFilename: string
  setToolagentFilename: React.Dispatch<React.SetStateAction<string>>
  toolagentTitle: string
  setToolagentTitle: React.Dispatch<React.SetStateAction<string>>
  toolagentTaskType: string
  setToolagentTaskType: React.Dispatch<React.SetStateAction<string>>
  toolagentPageProgress: { current: number; total: number } | null
  setToolagentPageProgress: React.Dispatch<React.SetStateAction<{ current: number; total: number } | null>>
  toolagentReasoning: string
  setToolagentReasoning: React.Dispatch<React.SetStateAction<string>>
  toolagentMsgInsertedRef: React.MutableRefObject<boolean>

  flowNodes: any[]
  setFlowNodes: React.Dispatch<React.SetStateAction<any[]>>
  flowEdges: any[]
  setFlowEdges: React.Dispatch<React.SetStateAction<any[]>>
  stages: Stage[]
  setStages: React.Dispatch<React.SetStateAction<Stage[]>>

  wsConnected: boolean
  setWsConnected: (v: boolean) => void
  wsRef: React.MutableRefObject<WebSocket | null>
  abortControllerRef: React.MutableRefObject<AbortController | null>
  sessionTaskIdRef: React.MutableRefObject<string>
  pendingArtifactTitlesRef: React.MutableRefObject<Record<string, string>>

  showTodoPanel: boolean
  setShowTodoPanel: (v: boolean) => void

  userId: number | undefined
  nextId: (prefix: string) => string

  saveCurrentSession: (msgs?: Message[], sid?: string | null) => void
  handleNewChat: () => void
  connectWebSocket: () => void
}

const AgentSessionContext = createContext<AgentSessionValue | null>(null)

let STABLE_MESSAGES_REF: React.MutableRefObject<Message[]> | null = null

export function AgentSessionProvider({ children }: { children: ReactNode }) {
  const msgIdCounter = useRef(0)
  const nextId = useCallback((prefix: string) => `${prefix}-${++msgIdCounter.current}`, [])

  const [messages, setMessages] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingDone, setStreamingDone] = useState(false)
  const streamingMsgIdRef = useRef<string | null>(null)
  const streamingSessionIdRef = useRef<string | null>(null)
  const streamContentRef = useRef<Record<string, string>>({})
  const streamBufferBySession = useRef<Record<string, { content: string; messageIds: Record<string, string> }>>({})
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])

  const [chatMode, setChatMode] = useState<'normal' | 'collaboration'>('normal')
  const [outputMode, setOutputMode] = useState<'detailed' | 'concise'>('detailed')
  const [deepThink, setDeepThink] = useState(false)

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [normalSessions, setNormalSessions] = useState<NormalSession[]>(() => loadSessions(STORAGE_KEY))
  const [collabSessions, setCollabSessions] = useState<NormalSession[]>(() => loadSessions(COLLAB_STORAGE_KEY))

  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [currentDiscussionTodoId, setCurrentDiscussionTodoId] = useState<string | null>(null)

  const [todos, setTodos] = useState<any[]>([])
  const [agentsStarted, setAgentsStarted] = useState(false)
  const [agentReasoning, setAgentReasoning] = useState<Record<string, string>>({})
  const [agentFinalContent, setAgentFinalContent] = useState<Record<string, string>>({})
  const [agentStreamContent, setAgentStreamContent] = useState<Record<string, string>>({})
  const [agentTaskDesc, setAgentTaskDesc] = useState<Record<string, string>>({})
  const [thinkingCompleted, setThinkingCompleted] = useState(false)
  const [thinkingFinished, setThinkingFinished] = useState(false)

  const [fileArtifacts, setFileArtifacts] = useState<FileArtifact[]>([])
  const [chartImages, setChartImages] = useState<ChartImage[]>([])
  const [pendingArtifacts, setPendingArtifacts] = useState<FileArtifact[]>([])
  const [artifactsPanelVisible, setArtifactsPanelVisible] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const [toolagentThinking, setToolagentThinking] = useState<string[]>([])
  const [toolagentProjectPath, setToolagentProjectPath] = useState<string | null>(null)
  const [toolagentWaitingFeedback, setToolagentWaitingFeedback] = useState(false)
  const [toolagentPhase, setToolagentPhase] = useState<'design' | 'export' | null>(null)
  const [toolagentDesignSpec, setToolagentDesignSpec] = useState<Record<string, unknown> | null>(null)
  const [toolagentDone, setToolagentDone] = useState(false)
  const [toolagentPptxPath, setToolagentPptxPath] = useState('')
  const [toolagentFilename, setToolagentFilename] = useState('')
  const [toolagentTitle, setToolagentTitle] = useState('')
  const [toolagentTaskType, setToolagentTaskType] = useState('general')
  const [toolagentPageProgress, setToolagentPageProgress] = useState<{ current: number; total: number } | null>(null)
  const [toolagentReasoning, setToolagentReasoning] = useState('')
  const toolagentMsgInsertedRef = useRef(false)

  const [flowNodes, setFlowNodes] = useState<any[]>([])
  const [flowEdges, setFlowEdges] = useState<any[]>([])
  const [stages, setStages] = useState<Stage[]>(
    STAGE_LABELS.map(s => ({ id: s.id, label: s.label, status: 'pending' as const }))
  )

  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const sessionTaskIdRef = useRef('')
  const pendingArtifactTitlesRef = useRef<Record<string, string>>({})

  const [showTodoPanel, setShowTodoPanel] = useState(true)
  const [userId, setUserId] = useState<number | undefined>(undefined)

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) {
      try {
        setUserId(JSON.parse(stored).id)
      } catch {}
    }
  }, [])

  useEffect(() => {
    messagesRef.current = messages
    STABLE_MESSAGES_REF = messagesRef
  }, [messages])

  useEffect(() => {
    if (!currentSessionId || !chatMode) return
    const key = chatMode === 'normal' ? STORAGE_KEY : COLLAB_STORAGE_KEY
    const setter = chatMode === 'normal' ? setNormalSessions : setCollabSessions
    const timer = setTimeout(() => {
      const msgs = messagesRef.current
      const userMsg = msgs.find(m => m.role === 'user')
      if (!userMsg) return
      setter(prev => {
        const exists = prev.find(s => s.id === currentSessionId)
        const updated = exists
          ? prev.map(s => s.id === currentSessionId
              ? { ...s, messages: msgs, title: s.title || userMsg.content.slice(0, 50), updatedAt: new Date().toISOString() }
              : s)
          : [...prev, { id: currentSessionId, title: userMsg.content.slice(0, 50), messages: msgs, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
        saveSessions(key, updated)
        return updated
      })
    }, 2000)
    return () => clearTimeout(timer)
  }, [messages, currentSessionId, chatMode])

  const saveCurrentSession = useCallback((msgs?: Message[], sid?: string | null) => {
    const id = sid ?? currentSessionId
    if (!id || !chatMode) return
    const messagesToSave = msgs ?? messagesRef.current
    const userMsg = messagesToSave.find(m => m.role === 'user')
    if (!userMsg) return
    const key = chatMode === 'normal' ? STORAGE_KEY : COLLAB_STORAGE_KEY
    const setter = chatMode === 'normal' ? setNormalSessions : setCollabSessions
    setter(prev => {
      const exists = prev.find(s => s.id === id)
      const updated = exists
        ? prev.map(s => s.id === id
            ? { ...s, messages: messagesToSave, title: s.title || userMsg.content.slice(0, 50), updatedAt: new Date().toISOString() }
            : s)
        : [...prev, { id, title: userMsg.content.slice(0, 50), messages: messagesToSave, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
      saveSessions(key, updated)
      return updated
    })
  }, [currentSessionId, chatMode])

  const handleNewChat = useCallback(() => {
    if (currentSessionId) {
      const currMsgs = messagesRef.current
      if (streamingMsgIdRef.current && streamingContent) {
        const idx = currMsgs.findIndex(m => m.id === streamingMsgIdRef.current)
        if (idx >= 0) {
          currMsgs[idx] = { ...currMsgs[idx], content: streamingContent, done: true } as Message
          messagesRef.current = currMsgs
        }
      }
      saveCurrentSession(messagesRef.current, currentSessionId)
    }
    setMessages([])
    messagesRef.current = []
    setInput('')
    setLoading(false)
    setIsStreaming(false)
    setStreamingContent('')
    setStreamingDone(false)
    streamingMsgIdRef.current = null
    streamContentRef.current = {}
    const prefix = chatMode === 'normal' ? 'normal' : 'collab'
    setCurrentSessionId(`${prefix}-${Date.now()}`)
    setCurrentTaskId(null)
    setCurrentDiscussionTodoId(null)
    setTodos([])
    setAgentsStarted(false)
    setAgentReasoning({})
    setAgentFinalContent({})
    setAgentStreamContent({})
    setAgentTaskDesc({})
    setThinkingCompleted(false)
    setThinkingFinished(false)
    setFileArtifacts([])
    setChartImages([])
    setPendingArtifacts([])
    setArtifactsPanelVisible(false)
    setToolagentThinking([])
    setToolagentProjectPath(null)
    setToolagentWaitingFeedback(false)
    setToolagentPhase(null)
    setToolagentDesignSpec(null)
    setToolagentDone(false)
    setToolagentPptxPath('')
    setToolagentFilename('')
    setToolagentTitle('')
    setToolagentTaskType('general')
    setToolagentPageProgress(null)
    setToolagentReasoning('')
    toolagentMsgInsertedRef.current = false
    setFlowNodes([])
    setFlowEdges([])
    setStages(STAGE_LABELS.map(s => ({ id: s.id, label: s.label, status: 'pending' as const })))
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    localStorage.removeItem('currentTaskId')
  }, [chatMode, currentSessionId, saveCurrentSession])

  const wsHandlerRef = useRef<(event: MessageEvent) => void>(() => {})

  wsHandlerRef.current = useCallback((event: MessageEvent) => {
    let data: any
    try { data = JSON.parse(event.data) } catch { return }
    const { type } = data

    switch (type) {
      case 'agent_message': {
        const { task_id, agent_id, agent_name, agent_icon, content, done, todo_id } = data
        const aidKey = `${agent_id}::${todo_id || 'default'}`
        setAgentReasoning(prev => ({ ...prev, [aidKey]: content }))
        if (done) {
          setAgentFinalContent(prev => ({ ...prev, [aidKey]: content }))
          setAgentStreamContent(prev => {
            const next = { ...prev }
            for (const key of Object.keys(next)) {
              if (key === aidKey || key.startsWith(`${aidKey}_`)) delete next[key]
            }
            return next
          })
          setLoading(false)
        } else {
          setAgentStreamContent(prev => ({ ...prev, [aidKey]: content }))
        }
        break
      }
      case 'agent_chunk': {
        const { agent_id, content, todo_id } = data
        if (agent_id && content) {
          const aidKey = `${agent_id}::${todo_id || 'default'}`
          setAgentStreamContent(prev => ({ ...prev, [aidKey]: (prev[aidKey] || '') + content }))
        }
        break
      }
      case 'agent_start': {
        const { agent_id, agent_name, agent_icon, todo_id } = data
        const agentKey = `${agent_id}::${todo_id || 'default'}`
        setAgentTaskDesc(prev => ({ ...prev, [agentKey]: data.task_description || '' }))
        setMessages(prev => prev.some(m => m.agent_id === agentKey && !m.done) ? prev : [...prev, { id: `agent-${agentKey}-${Date.now()}`, role: 'agent', content: '', agent_id: agentKey, agent_name, agent_icon, done: false }])
        break
      }
      case 'stage_update': {
        const { stage_id, stage, status, content } = data
        setStages(prev => prev.map(s => s.id === (stage_id || stage) ? { ...s, status: status || 'active', content } : s))
        break
      }
      case 'todo_update': {
        if (data.todo_list && Array.isArray(data.todo_list)) { setTodos(data.todo_list); setShowTodoPanel(true) }
        break
      }
      case 'error': case 'task_error': { console.error('Agent WS error:', data.message || data.content); setLoading(false); streamingMsgIdRef.current = null; streamingSessionIdRef.current = null; break }
      case 'abort_ack': { setLoading(false); break }
      case 'tool_call': {
        const { agent_id, tool_name, arguments: args } = data
        setAgentReasoning(prev => ({ ...prev, [agent_id || 'orchestrator']: `🔧 正在调用 ${tool_name}(${JSON.stringify(args)})` }))
        break
      }
      case 'tool_call_result': {
        if (data.agent_id) setAgentReasoning(prev => ({ ...prev, [data.agent_id]: (prev[data.agent_id] || '') + `\n✅ 工具返回: ${String(data.result).slice(0, 200)}` }))
        break
      }
      case 'discussion_update': { setCurrentDiscussionTodoId(data.todo_id); break }
      case 'discussion_start': { setMessages(prev => [...prev, { id: `discuss-start-${Date.now()}`, role: 'system', content: `💬 专家讨论开始：${data.topic || ''}` }]); break }
      case 'discussion_message': { const { expert_name, content } = data; setAgentReasoning(prev => ({ ...prev, ['discussion']: (prev['discussion'] || '') + `\n**${expert_name || '专家'}**：${content || ''}` })); break }
      case 'discussion_end': { setAgentTaskDesc(prev => ({ ...prev, ['discussion']: '讨论结束' })); setMessages(prev => [...prev, { id: `discuss-end-${Date.now()}`, role: 'system', content: '💬 专家讨论已结束' }]); break }
      case 'workflow_nodes': { if (data.nodes) setFlowNodes(data.nodes); break }
      case 'workflow_node_update': { if (data.node_id) setFlowNodes(prev => prev.map(n => n.id === data.node_id ? { ...n, status: data.status || n.status, content: data.content || n.content } : n)); break }
      case 'workflow_edge': { if (data.source && data.target) setFlowEdges(prev => { if (prev.find(e => e.source === data.source && e.target === data.target)) return prev; return [...prev, { id: `edge-${data.source}-${data.target}`, source: data.source, target: data.target, content: data.content }] }); break }
      case 'task_restored': case 'task_complete': { break }

      case 'toolagent_feedback': { setToolagentWaitingFeedback(true); setToolagentProjectPath(data.project_path || null); break }
      case 'toolagent_start': {
        setToolagentTaskType(data.task_type || 'general')
        setToolagentTitle(data.title || '')
        if (!toolagentMsgInsertedRef.current) {
          toolagentMsgInsertedRef.current = true
          setMessages(prev => [...prev, { id: `toolagent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'toolagent', content: data.title || '任务执行中...' }])
        }
        break
      }
      case 'toolagent_thinking': {
        if (!toolagentMsgInsertedRef.current) {
          toolagentMsgInsertedRef.current = true
          setMessages(prev => [...prev, { id: `toolagent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'toolagent', content: data.content || '任务执行中...' }])
        }
        setToolagentThinking(prev => [...prev, data.content || ''])
        break
      }
      case 'toolagent_reasoning': { setToolagentThinking(prev => [...prev, data.reasoning || data.content || '']); break }
      case 'toolagent_done': {
        setToolagentDone(true); setLoading(false); setTodos([]); toolagentMsgInsertedRef.current = false
        setMessages(prev => { const idx = [...prev].reverse().findIndex(m => m.role === 'toolagent'); if (idx === -1) return prev; const i = prev.length - 1 - idx; const updated = [...prev]; updated[i] = { ...updated[i], done: true }; return updated })
        if (chatMode === 'normal') saveCurrentSession(undefined, undefined)
        break
      }
      case 'toolagent_artifact_pending': {
        setPendingArtifacts(prev => [...prev, { type: data.tool_name || 'unknown', path: '', title: data.title || data.tool_name || '生成中...', status: 'pending' }])
        setArtifactsPanelVisible(true)
        break
      }
      case 'toolagent_file_artifact': {
        const art: FileArtifact = { type: data.artifact_type, path: data.path, title: data.title, filename: data.filename, status: 'done', expires_at: data.expires_at || null }
        setFileArtifacts(prev => { const filtered = prev.filter(a => a.path !== art.path || a.type !== art.type); return [...filtered, art] })
        setPendingArtifacts(prev => prev.filter(a => a.title !== art.title))
        setArtifactsPanelVisible(true)
        if (art.path && (art.path.startsWith('http') || art.path.startsWith('/')) && (art.type === 'image' || art.path.match(/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i))) {
          setChartImages(prev => { if (prev.some(c => c.url === art.path)) return prev; return [...prev, { url: art.path, title: art.title }] })
        }
        if (chatMode === 'normal') saveCurrentSession(undefined, undefined)
        break
      }
      case 'toolagent_pptx_path': { setToolagentPptxPath(data.path || ''); break }
      case 'toolagent_preview': {
        if (data.action === 'project_created' && data.project_path) { setToolagentProjectPath(data.project_path); setToolagentPageProgress(null) }
        else if (data.action === 'svg_saved' && typeof data.page_num === 'number') { setToolagentPageProgress({ current: data.page_num, total: data.total_pages || 0 }) }
        if (!toolagentMsgInsertedRef.current) {
          toolagentMsgInsertedRef.current = true
          setMessages(prev => [...prev, { id: `toolagent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'toolagent', content: 'PPT 生成中...' }])
        }
        break
      }
      case 'toolagent_state': {
        setToolagentPhase(data.phase || null); setToolagentDesignSpec(data.design_spec || null)
        if (!toolagentMsgInsertedRef.current) { toolagentMsgInsertedRef.current = true; setMessages(prev => [...prev, { id: `toolagent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'toolagent', content: data.phase || '任务执行中...' }]) }
        break
      }
      case 'chart_data': {
        if (data.url && data.title) setChartImages(prev => { if (prev.some(c => c.url === data.url)) return prev; return [...prev, { url: data.url, title: data.title }] })
        break
      }
      case 'toolagent_error': { break }

      case 'orchestrator_chunk': {
        if (streamingSessionIdRef.current && streamingSessionIdRef.current !== currentSessionId) {
          const sid = streamingSessionIdRef.current
          const buf = streamBufferBySession.current
          if (!buf[sid]) buf[sid] = { content: '', messageIds: {} }
          buf[sid].content += data.content || ''
          break
        }
        if (data.content) { setStreamingDone(false); setIsStreaming(true); setStreamingContent(prev => prev + data.content)
          if (!streamingMsgIdRef.current) { const sid = `orchestra-stream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; streamingMsgIdRef.current = sid; setMessages(prev => [...prev, { id: sid, role: 'orchestrator', content: '' }]) } }
        break
      }
      case 'orchestrator_reasoning': {
        if (streamingSessionIdRef.current && streamingSessionIdRef.current !== currentSessionId) {
          const sid = streamingSessionIdRef.current
          const buf = streamBufferBySession.current
          if (!buf[sid]) buf[sid] = { content: '', messageIds: {} }
          buf[sid].content += data.content || ''
          break
        }
        if (data.content) {
          setMessages(prev => {
            const lastThinking = [...prev].reverse().find(m => m.role === 'thinking' && !m.completed)
            if (lastThinking) {
              const updated = [...prev]
              const i = prev.indexOf(lastThinking)
              updated[i] = { ...lastThinking, content: prev[i].content + data.content } as Message
              return updated
            }
            const thinkingMsg: Message = { id: `orchestra-think-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'thinking', title: '推理中', content: data.content, completed: false }
            return [...prev, thinkingMsg]
          })
        }
        break
      }
      case 'orchestrator_thinking': {
        if (streamingSessionIdRef.current && streamingSessionIdRef.current !== currentSessionId) break
        setThinkingFinished(true)
        setMessages(prev => {
          const lastThinking = [...prev].reverse().find(m => m.role === 'thinking' && !m.completed)
          if (!lastThinking) return prev
          const idx = prev.indexOf(lastThinking)
          const updated = [...prev]
          updated[idx] = { ...updated[idx], completed: true } as Message
          return updated
        })
        break
      }
      case 'orchestrator_summary': {
        if (streamingSessionIdRef.current && streamingSessionIdRef.current !== currentSessionId) {
          const sid = streamingSessionIdRef.current
          const buf = streamBufferBySession.current
          if (!buf[sid]) buf[sid] = { content: '', messageIds: {} }
          buf[sid].content = (buf[sid].content || '') + (data.content || '')
          break
        }
        setIsStreaming(false); setStreamingDone(true); streamingMsgIdRef.current = null; streamingSessionIdRef.current = null
        if (data.content) {
          setMessages(prev => { const existing = [...prev]; const placeholderIdx = existing.length - 1; if (placeholderIdx >= 0 && existing[placeholderIdx].role === 'orchestrator') { existing[placeholderIdx] = { ...existing[placeholderIdx], content: data.content, done: true }; } else { existing.push({ id: `orchestra-summary-${Date.now()}`, role: 'orchestrator', content: data.content }) }; return existing })
        }
        setThinkingFinished(true); setTodos(prev => prev.filter(t => !t.done)); setLoading(false); localStorage.removeItem('currentTaskId');
        break
      }

      case 'task_id': case 'stage_init': case 'step_start': case 'step_end': case 'agent_thinking': case 'agent_done': case 'agent_error': case 'flow_init': case 'discussion_init': case 'collaboration_start': case 'planning_start': case 'planning_summary': case 'execution_start': case 'assembly_start': case 'workflow_init': case 'discussion_started': case 'discussion_finished': case 'all_agents_done': case 'orchestrator_start': case 'orchestrator_planning': case 'orchestrator_assign': case 'orchestrator_task_summary': case 'orchestrator_agent_done': case 'orchestrator_result': { break }
      default: { console.log('[WS event]', type, data); break }
    }
  }, [chatMode, saveCurrentSession])

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const raw = localStorage.getItem('user')
    let uid = userId
    if (!uid && raw) {
      try { uid = JSON.parse(raw).id } catch {}
    }
    if (!uid || typeof uid !== 'number') uid = 1
    const url = `${WS_BASE_URL}/agent/${uid}`
    const ws = new WebSocket(url)
    ws.onopen = () => { console.log('Agent WebSocket 已连接'); setWsConnected(true) }
    ws.onerror = (err) => { console.error('Agent WebSocket 连接失败:', url, err) }
    ws.onmessage = (event) => wsHandlerRef.current(event)
    ws.onclose = (e) => {
      console.log('Agent WebSocket 已断开:', e.code, e.reason)
      setWsConnected(false)
      setLoading(false)
      setIsStreaming(false)
      if (e.code !== 1000) setTimeout(() => connectWebSocket(), 3000)
    }
    wsRef.current = ws
  }, [userId])

  useEffect(() => {
    connectWebSocket()
    return () => { wsRef.current?.close(); wsRef.current = null }
  }, [connectWebSocket])

  useEffect(() => {
    const activeMode = (localStorage.getItem(ACTIVE_MODE_KEY) || 'normal') as 'normal' | 'collaboration'
    setChatMode(activeMode)

    if (activeMode === 'normal') {
      const ss = loadSessions(STORAGE_KEY)
      if (ss.length > 0) {
        const latest = ss.reduce((a, b) => new Date(a.updatedAt) > new Date(b.updatedAt) ? a : b)
        setMessages(latest.messages)
        messagesRef.current = latest.messages
        setCurrentSessionId(latest.id)
      } else {
        setCurrentSessionId(`normal-${Date.now()}`)
      }
    } else {
      setMessages([])
      messagesRef.current = []
      setCurrentSessionId(null)
    }
    const collabSs = loadSessions(COLLAB_STORAGE_KEY)
    if (collabSs.length > 0) setCollabSessions(collabSs)
  }, [])

  useEffect(() => {
    messagesRef.current = messages
    STABLE_MESSAGES_REF = messagesRef
  }, [messages])

  const value: AgentSessionValue = {
    messages, setMessages, messagesRef,
    input, setInput,
    loading, setLoading,
    streamingContent, setStreamingContent,
    isStreaming, setIsStreaming,
    streamingDone, setStreamingDone,
    streamingMsgIdRef, streamingSessionIdRef, streamContentRef, streamBufferBySession,
    uploadingFiles, setUploadingFiles,
    chatMode, setChatMode,
    outputMode, setOutputMode,
    deepThink, setDeepThink,
    currentSessionId, setCurrentSessionId,
    normalSessions, setNormalSessions,
    collabSessions, setCollabSessions,
    currentTaskId, setCurrentTaskId,
    currentDiscussionTodoId, setCurrentDiscussionTodoId,
    todos, setTodos,
    agentsStarted, setAgentsStarted,
    agentReasoning, setAgentReasoning,
    agentFinalContent, setAgentFinalContent,
    agentStreamContent, setAgentStreamContent,
    agentTaskDesc, setAgentTaskDesc,
    thinkingCompleted, setThinkingCompleted,
    thinkingFinished, setThinkingFinished,
    fileArtifacts, setFileArtifacts,
    chartImages, setChartImages,
    pendingArtifacts, setPendingArtifacts,
    artifactsPanelVisible, setArtifactsPanelVisible,
    previewUrl, setPreviewUrl,
    toolagentThinking, setToolagentThinking,
    toolagentProjectPath, setToolagentProjectPath,
    toolagentWaitingFeedback, setToolagentWaitingFeedback,
    toolagentPhase, setToolagentPhase,
    toolagentDesignSpec, setToolagentDesignSpec,
    toolagentDone, setToolagentDone,
    toolagentPptxPath, setToolagentPptxPath,
    toolagentFilename, setToolagentFilename,
    toolagentTitle, setToolagentTitle,
    toolagentTaskType, setToolagentTaskType,
    toolagentPageProgress, setToolagentPageProgress,
    toolagentReasoning, setToolagentReasoning,
    toolagentMsgInsertedRef,
    flowNodes, setFlowNodes,
    flowEdges, setFlowEdges,
    stages, setStages,
    wsConnected, setWsConnected,
    wsRef, abortControllerRef,
    sessionTaskIdRef, pendingArtifactTitlesRef,
    showTodoPanel, setShowTodoPanel,
    userId, nextId,
    saveCurrentSession, handleNewChat, connectWebSocket,
  }

  return (
    <AgentSessionContext.Provider value={value}>
      {children}
    </AgentSessionContext.Provider>
  )
}

export function useAgentSession() {
  const ctx = useContext(AgentSessionContext)
  if (!ctx) throw new Error('useAgentSession must be used within AgentSessionProvider')
  return ctx
}
