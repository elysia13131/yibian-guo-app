import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import type { CompanionMessage, AgentStep } from '../types'
import CompanionService from '../services/CompanionService'
import { CompanionMemoryManager, type MemoryItem } from '../services/CompanionMemory'
import { TTSEngineManager } from '../services/TTSManager'
import { companionMode, COMPANION_ENABLED, type CompanionMode, type VisionMode, type ModeChangeReason } from '../services/CompanionMode'
import { RealtimeManager, type RealtimeState, type VideoState } from '../services/RealtimeManager'
import { shouldBargeIn } from '../utils/voiceEchoDetector'
import { ProactiveScheduler, ProactiveDeliveryManager, ProactiveGenerator, type ProactiveEvent } from '../services/ProactiveDelivery'
import { SessionStateMachine, LifecycleEventBus } from '../services/SessionMachine'
import { ToolRegistry } from '../services/ToolRegistry'
import { getAgentPlugin } from '../services/NekoAgentService'
import { buildSystemPrompt, buildMemoryPrompt } from '../utils/companionPrompts'
import { summarizeConversation, extractFactsFromConversation, deduplicateFacts, loadSummary, buildSummaryInject, type ExistingFactForDedup } from '../utils/companionSummary'
import { stripMarkers } from '../services/CompanionService'

const LIVE2D_SESSION_KEY = 'companion_live2d_session_active'
const LIVE2D_SESSION_DATA_KEY = 'companion_live2d_session_data'
const LIVE2D_EXIT_PHASE_KEY = 'companion_live2d_exit_phase'

interface CompanionContextType {
  messages: CompanionMessage[]
  isTyping: boolean
  typingContent: string
  error: string | null
  agentSteps: AgentStep[]
  sessionBus: LifecycleEventBus
  toolRegistry: ToolRegistry
  currentMode: CompanionMode
  visionMode: VisionMode
  realtimeState: RealtimeState
  live2dMessages: CompanionMessage[]
  isMicMuted: boolean
  videoState: import('../services/RealtimeManager').VideoState
  sendText: (text: string) => void
  sendImage: (file: File) => void
  sendSticker: (dataUrl: string) => void
  toggleMode: () => void
  toggleVisionMode: () => void
  toggleMic: () => void
  toggleCamera: () => void
  deactivateLive2D: () => void
}

const CompanionContext = createContext<CompanionContextType | undefined>(undefined)

function memoryToMessage(m: MemoryItem): CompanionMessage {
  return { id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, type: 'text', status: 'sent' }
}

function describeProfileChange(prevHash: string, newHash: string): string | null {
  try {
    const prev = JSON.parse(prevHash)
    const curr = JSON.parse(newHash)
    if (!prev) return null
    const parts: string[] = []
    if (JSON.stringify(curr?.basic) !== JSON.stringify(prev?.basic) && curr?.basic) {
      const b = curr.basic
      const fields = [b.name && `姓名:${b.name}`, b.age && `年龄:${b.age}`, b.grade && `年级:${b.grade}`, b.school && `学校:${b.school}`].filter(Boolean)
      if (fields.length) parts.push(...fields)
    }
    if (JSON.stringify(curr?.learning) !== JSON.stringify(prev?.learning) && curr?.learning) {
      const added = curr.learning.subjects?.filter((s: string) => !prev?.learning?.subjects?.includes(s)) || []
      if (added.length) parts.push(`学习科目:${added.join('、')}`)
      const goals = curr.learning.goals?.filter((g: string) => !prev?.learning?.goals?.includes(g)) || []
      if (goals.length) parts.push(`学习目标:${goals.join('、')}`)
    }
    if (JSON.stringify(curr?.personality) !== JSON.stringify(prev?.personality) && curr?.personality) {
      const traits = curr.personality.traits?.filter((t: string) => !prev?.personality?.traits?.includes(t)) || []
      if (traits.length) parts.push(`性格:${traits.join('、')}`)
      if (curr.personality.learningStyle && curr.personality.learningStyle !== prev?.personality?.learningStyle) {
        parts.push(`学习风格:${curr.personality.learningStyle}`)
      }
    }
    if (JSON.stringify(curr?.interests) !== JSON.stringify(prev?.interests) && curr?.interests) {
      const hobbies = curr.interests.hobbies?.filter((h: string) => !prev?.interests?.hobbies?.includes(h)) || []
      if (hobbies.length) parts.push(`爱好:${hobbies.join('、')}`)
    }
    return parts.length > 0 ? parts.join('；') : null
  } catch { return null }
}

async function sendScreenshotToOmni(): Promise<void> {
  const agent = getAgentPlugin()
  try {
    const r = await agent.captureScreen()
    if (!r.screenshot) return
    let compressed = r.screenshot
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = 'data:image/png;base64,' + r.screenshot
      })
      const canvas = document.createElement('canvas')
      const maxW = 720; const maxH = 1280
      let w = img.width; let h = img.height
      if (w > maxW || h > maxH) { const ratio = Math.min(maxW / w, maxH / h); w = Math.round(w * ratio); h = Math.round(h * ratio) }
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      compressed = canvas.toDataURL('image/jpeg', 0.7).split(',')[1]
    } catch {}
    if (compressed.length > 256 * 1024) {
      const c2 = document.createElement('canvas')
      c2.width = 360; c2.height = 640
      const ctx2 = c2.getContext('2d')!
      const fb = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = 'data:image/png;base64,' + r.screenshot
      })
      ctx2.drawImage(fb, 0, 0, 360, 640)
      compressed = c2.toDataURL('image/jpeg', 0.5).split(',')[1]
    }
    RealtimeManager.sendImage(compressed).catch(() => {})
  } catch {}
}

async function captureScreenB64(): Promise<string | null> {
  const agent = getAgentPlugin()
  try {
    const r = await agent.captureScreen()
    if (!r.screenshot) return null
    let compressed = r.screenshot
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = 'data:image/png;base64,' + r.screenshot
      })
      const canvas = document.createElement('canvas')
      const maxW = 720; const maxH = 1280
      let w = img.width; let h = img.height
      if (w > maxW || h > maxH) { const ratio = Math.min(maxW / w, maxH / h); w = Math.round(w * ratio); h = Math.round(h * ratio) }
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      compressed = canvas.toDataURL('image/jpeg', 0.7).split(',')[1]
    } catch {}
    if (compressed.length > 256 * 1024) {
      const c2 = document.createElement('canvas')
      c2.width = 360; c2.height = 640
      const ctx2 = c2.getContext('2d')!
      const fb = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = 'data:image/png;base64,' + r.screenshot
      })
      ctx2.drawImage(fb, 0, 0, 360, 640)
      compressed = c2.toDataURL('image/jpeg', 0.5).split(',')[1]
    }
    return compressed
  } catch {
    return null
  }
}

function registerDefaultTools(registry: ToolRegistry) {
  const agent = getAgentPlugin()
  registry.register({ name: 'click', description: '点击屏幕指定坐标', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }, handler: async (args: Record<string, any>) => { const r = await agent.click({ x: args.x, y: args.y }); const s = await captureScreenB64(); return { _screenshot: s, success: r.success } } })
  registry.register({ name: 'inputText', description: '在输入框中输入文字', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, handler: async (args) => { const r = await agent.inputText({ text: args.text }); const s = await captureScreenB64(); return { _screenshot: s, success: r.success } } })
  registry.register({ name: 'scroll', description: '滑动屏幕', parameters: { type: 'object', properties: { startX: { type: 'number' }, startY: { type: 'number' }, endX: { type: 'number' }, endY: { type: 'number' } }, required: ['startX', 'startY', 'endX', 'endY'] }, handler: async (args) => { const r = await agent.scroll({ startX: args.startX, startY: args.startY, endX: args.endX, endY: args.endY }); const s = await captureScreenB64(); return { _screenshot: s, success: r.success } } })
  registry.register({ name: 'goBack', description: '返回上一页', parameters: { type: 'object', properties: {} }, handler: async () => { const r = await agent.goBack(); const s = await captureScreenB64(); return { _screenshot: s, success: r.success } } })
  registry.register({ name: 'goHome', description: '回到桌面', parameters: { type: 'object', properties: {} }, handler: async () => { const r = await agent.goHome(); const s = await captureScreenB64(); return { _screenshot: s, success: r.success } } })
  registry.register({ name: 'openApp', description: '打开指定应用', parameters: { type: 'object', properties: { packageName: { type: 'string' } }, required: ['packageName'] }, handler: async (args) => { const r = await agent.openApp({ packageName: args.packageName }); const s = await captureScreenB64(); return { _screenshot: s, success: r.success } } })
  registry.register({ name: 'waitForUI', description: '等待界面稳定', parameters: { type: 'object', properties: {} }, handler: async () => { const r = await agent.waitForUI(); return { success: r.success } } })
  registry.register({
    name: 'capture_screen',
    description: '截取当前手机屏幕画面并发送给模型，让模型了解当前界面内容。模型在点击、输入等操作前应先调用此工具获取屏幕内容。',
    parameters: { type: 'object', properties: {} },
    handler: async () => { await sendScreenshotToOmni(); return { output: '屏幕截图已发送' } },
  })
}

export function CompanionProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<CompanionMessage[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [typingContent, setTypingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([])
  const [currentMode, setCurrentMode] = useState<CompanionMode>(() => companionMode.getMode())
  const [visionMode, setVisionMode] = useState<VisionMode>(() => companionMode.visionMode)
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('disconnected')
  const [live2dMessages, setLive2dMessages] = useState<CompanionMessage[]>(() => {
    try {
      const saved = localStorage.getItem(LIVE2D_SESSION_DATA_KEY)
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [videoState, setVideoState] = useState<VideoState>('inactive')

  const sessionBusRef = useRef(new LifecycleEventBus())
  const sessionSMRef = useRef(new SessionStateMachine('companion'))
  const toolRegistryRef = useRef(new ToolRegistry())
  const memoryRef = useRef(new CompanionMemoryManager())
  const serviceRef = useRef(new CompanionService(memoryRef.current, toolRegistryRef.current, sessionBusRef.current))
  const fullContentRef = useRef('')
  const ttsRef = useRef(new TTSEngineManager())
  const lastAiResponseRef = useRef('')
  const realtimeAccumRef = useRef('')
  const realtimeIdRef = useRef('')
  const schedulerRef = useRef<ProactiveScheduler | null>(null)
  const deliveryRef = useRef<ProactiveDeliveryManager | null>(null)
  const lastProfileHashRef = useRef('')
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLive2dMessage = useCallback((msg: CompanionMessage) => {
    setLive2dMessages(prev => {
      const next = [...prev, msg]
      try { localStorage.setItem(LIVE2D_SESSION_DATA_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const activateLive2DMode = useCallback(async () => {
    await companionMode.activateLive2D('user')
    localStorage.setItem(LIVE2D_SESSION_KEY, 'true')
  }, [])

  const deactivateLive2DMode = useCallback(async () => {
    if (live2dMessages.length > 0) {
      const exitPhase = localStorage.getItem(LIVE2D_EXIT_PHASE_KEY)
      if (exitPhase === 'done') {
        setLive2dMessages([])
        localStorage.removeItem(LIVE2D_SESSION_DATA_KEY)
        localStorage.removeItem(LIVE2D_SESSION_KEY)
        localStorage.removeItem(LIVE2D_EXIT_PHASE_KEY)
        await companionMode.deactivateLive2D('user')
        return
      }

      localStorage.setItem(LIVE2D_EXIT_PHASE_KEY, 'extracting')
      const conv = live2dMessages.map(m => `[${m.role === 'user' ? '用户' : '灵枢'}] ${m.content}`).join('\n')
      const profile = await memoryRef.current.getUserProfile()
      const ctx = profile?.basic?.name ? `用户是${profile.basic.name}` : '对话总结'

      const [summary, facts] = await Promise.all([
        summarizeConversation(conv, ctx),
        extractFactsFromConversation(conv),
      ])

      if (summary) {
        await memoryRef.current.saveFact({
          id: `fact_live2d_${Date.now()}`,
          key: 'live2d_conversation',
          value: summary,
          source: 'live2d_session',
          createdAt: Date.now(),
        })
      }

      if (facts.length > 0) {
        const existingFacts = await memoryRef.current.getAllFacts()
        const existingForDedup: ExistingFactForDedup[] = existingFacts.map(f => ({ id: f.id, key: f.key, value: f.value }))
        const deduped = await deduplicateFacts(facts, existingForDedup)
        for (const f of deduped) {
          await memoryRef.current.saveFact({
            id: `fact_live2d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            key: f.key,
            value: f.value,
            source: 'live2d_session',
            createdAt: Date.now(),
          })
        }
      }

      if (summary) {
        await memoryRef.current.saveRecentMessage({
          id: `mem_${Date.now()}_live2d_summary`,
          role: 'user',
          content: `[Live2D对话总结] ${summary}`,
          timestamp: Date.now(),
        })
        memoryRef.current.consolidateIfNeeded()
      }

      localStorage.setItem(LIVE2D_EXIT_PHASE_KEY, 'done')
      setLive2dMessages([])
      localStorage.removeItem(LIVE2D_SESSION_DATA_KEY)
    }
    localStorage.removeItem(LIVE2D_SESSION_KEY)
    localStorage.removeItem(LIVE2D_EXIT_PHASE_KEY)
    await companionMode.deactivateLive2D('user')
  }, [live2dMessages])

  useEffect(() => {
    const sm = sessionSMRef.current
    const bus = sessionBusRef.current

    registerDefaultTools(toolRegistryRef.current)

    toolRegistryRef.current.register({
      name: 'recall_memory',
      description: '搜索关于用户过去说过的话、做过的事的回忆。当需要回忆特定时间发生的事情时调用此工具。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索查询' }, timeRange: { type: 'string', description: '时间范围如"今天""上周""去年"' } }, required: ['query'] },
      handler: async (args) => {
        const query = args.timeRange ? `${args.query} (${args.timeRange})` : args.query
        const results = await memoryRef.current.searchSimilarMemories(query, 5)
        if (results.length === 0) return { output: '未找到相关记忆' }
        return { output: `找到以下相关记忆：\n${results.map(r => `[${r.role}] ${r.content}`).join('\n\n')}` }
      },
    })

    toolRegistryRef.current.register({
      name: 'activate_live2d',
      description: '激活实时语音陪伴模式。当用户想和你面对面聊天、或者你想主动出现陪用户时调用。会唤起灵枢的Live2D形象并启动实时语音对话。',
      parameters: { type: 'object', properties: { reason: { type: 'string', description: '简短的激活原因，如"用户想聊天"或"想主动关心用户"' } } },
      handler: async () => {
        await activateLive2DMode()
        return { output: '已进入实时语音陪伴模式，灵枢正通过语音与用户交流。此模式下对话不再通过文字显示，而是实时语音+Live2D形象。' }
      },
    })

    toolRegistryRef.current.register({
      name: 'deactivate_live2d',
      description: '退出实时语音陪伴模式，回到文字聊天。当对话结束、用户表示要走了、或灵枢觉得该回到安静的文字模式时调用。',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        await deactivateLive2DMode()
        return { output: '已退出实时语音陪伴模式，回到文字聊天。' }
      },
    })

    toolRegistryRef.current.register({
      name: 'set_expression',
      description: '切换灵枢的 Live2D 表情。在语音模式下可以随时切换表情来配合说话的情绪。',
      parameters: { type: 'object', properties: { expression: { type: 'string', enum: ['neutral', 'happy', 'sad', 'angry', 'surprise', 'tired'], description: '表情名称' } }, required: ['expression'] },
      handler: async (args: Record<string, any>) => {
        await companionMode.setExpression(args.expression as any)
        return { output: `表情已切换为 ${args.expression}` }
      },
    })

    toolRegistryRef.current.register({
      name: 'start_motion',
      description: '触发灵枢的 Live2D 动作动画。在语音模式下可以通过动作来表达情感或配合说话内容。动作名称取决于当前加载的模型。',
      parameters: { type: 'object', properties: { motion: { type: 'string', description: '动作名称' } }, required: ['motion'] },
      handler: async (args: Record<string, any>) => {
        await companionMode.startMotion(args.motion)
        return { output: `动作 ${args.motion} 已触发` }
      },
    })

    toolRegistryRef.current.register({
      name: 'activate_camera',
      description: '打开前置摄像头，让灵枢能看到你的画面。在实时语音模式下，用于视频通话。',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        if (RealtimeManager.videoState === 'inactive') {
          RealtimeManager.startCamera().catch(() => {})
          return { output: '正在开启摄像头...' }
        }
        return { output: '摄像头已开启' }
      },
    })

    toolRegistryRef.current.register({
      name: 'deactivate_camera',
      description: '关闭摄像头。',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        RealtimeManager.stopCamera().catch(() => {})
        return { output: '摄像头已关闭' }
      },
    })

    const proactCleanup = { playbackEnd: () => {}, userInput: () => {} }

    if (COMPANION_ENABLED) {
      const scheduler = new ProactiveScheduler(sm)
      schedulerRef.current = scheduler

      const delivery = new ProactiveDeliveryManager(sm, () => !sm.isResponding)
      delivery.subscribe((cue) => {
        scheduler.markActivity()
        sm.fire('proactive_phase2')
        companionMode.activateLive2D('proactive')
        const msg: CompanionMessage = { id: cue.id, role: 'assistant', content: cue.message, timestamp: Date.now(), type: 'text', status: 'sent' }
        setMessages(prev => [...prev, msg])
        if (RealtimeManager.isActive) {
          RealtimeManager.sendText(cue.message).catch(() => {})
        }
      })
      deliveryRef.current = delivery

      const generator = new ProactiveGenerator(memoryRef.current, delivery, sm)
      scheduler.setGenerator(generator)

      proactCleanup.playbackEnd = sm.subscribe('playback_end', () => delivery.onPlaybackEnd())
      proactCleanup.userInput = sm.subscribe('user_input', () => { scheduler.markActivity() })
    } else {
      proactCleanup.playbackEnd = () => {}
      proactCleanup.userInput = () => {}
    }

    const unsubMode = companionMode.subscribe((mode, reason) => {
      setCurrentMode(mode)
      if (mode === 'live2d') {
        startRealtimeSession()
      } else if (reason !== 'agent') {
        stopRealtimeSession()
      }
    })

    const unsubVision = companionMode.subscribeVision(setVisionMode)

    RealtimeManager.onStateChanged((state) => {
      setRealtimeState(state)
      if (state === 'disconnected') {
        setIsTyping(false)
        companionMode.deactivateLive2D('llm').catch(() => {})
      }
      if (state === 'idle') {
        flushToolResults()
        const accum = realtimeAccumRef.current
        if (accum.trim()) {
          const cleaned = stripMarkers(accum.trim())
          if (cleaned) {
            const finalId = realtimeIdRef.current || crypto.randomUUID()
            const aiMsg: CompanionMessage = { id: finalId, role: 'assistant', content: cleaned, timestamp: Date.now(), type: 'text', status: 'sent' }
            setMessages(prev => [...prev, aiMsg])
            addLive2dMessage(aiMsg)
            lastAiResponseRef.current = cleaned
          }

          if (accum.includes('[appear]')) companionMode.activateLive2D('llm').catch(() => {})
          if (accum.includes('[disappear]')) companionMode.deactivateLive2D('llm').catch(() => {})
          const exprMatch = accum.match(/\[expression:(\w+)\]/)
          if (exprMatch) companionMode.setExpression(exprMatch[1] as any).catch(() => {})
          const mtnMatch = accum.match(/\[motion:(\w+)\]/)
          if (mtnMatch) companionMode.startMotion(mtnMatch[1]).catch(() => {})
        }
        realtimeAccumRef.current = ''
        realtimeIdRef.current = crypto.randomUUID()
        setTypingContent('')
        setIsTyping(false)
      }
    })
    RealtimeManager.onTranscript((delta) => {
      setTypingContent(prev => prev + delta)
    })
    RealtimeManager.onTextDelta((delta) => {
      realtimeAccumRef.current += delta
      setTypingContent(realtimeAccumRef.current)
    })
    RealtimeManager.onAudioLevel((level) => {
      companionMode.setLipSyncLevel(level)
    })
    RealtimeManager.onVideoStateChanged((state) => {
      setVideoState(state)
    })
    RealtimeManager.onSpeechStarted(() => {
      flushToolResults()
      realtimeAccumRef.current = ''
      setTypingContent('')
      lastAiResponseRef.current = ''
    })
    RealtimeManager.onSpeechStopped(() => {
    })
    RealtimeManager.onInputTranscript((transcript) => {
      const id = `mem_${Date.now()}_user`
      const userMsg: CompanionMessage = { id: crypto.randomUUID(), role: 'user', content: transcript, timestamp: Date.now(), type: 'text', status: 'sent' }
      setMessages(prev => [...prev, userMsg])
      addLive2dMessage(userMsg)
    })

    const pendingToolResults: { callId: string; screenshot?: string; rest: Record<string, unknown> }[] = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    function flushToolResults() {
       if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
       const batch = pendingToolResults.splice(0)
       if (batch.length === 0) return
       const events: string[] = []
       if (companionMode.visionMode !== 'stream') {
         const firstScreenshot = batch.find(r => r.screenshot)?.screenshot
         if (firstScreenshot) {
           events.push(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${firstScreenshot}` }] } }))
         }
       }
       for (const r of batch) {
         events.push(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: r.callId, output: JSON.stringify(r.rest) } }))
       }
       RealtimeManager.sendOutputEvents(events).catch(() => {})
     }

    function startFrameStream() {
       if (frameTimerRef.current) return
       captureScreenB64().then(b64 => {
         if (b64) RealtimeManager.sendImageFrame(b64).catch(() => {})
       }).catch(() => {})
       frameTimerRef.current = setInterval(() => {
         if (!companionMode.isLive2D()) { stopFrameStream(); return }
         captureScreenB64().then(b64 => {
           if (b64) RealtimeManager.sendImageFrame(b64).catch(() => {})
         }).catch(() => {})
       }, 1000)
     }

    function stopFrameStream() {
      if (frameTimerRef.current) { clearInterval(frameTimerRef.current); frameTimerRef.current = null }
    }

    function sendFrameToStream() {
      captureScreenB64().then(b64 => {
        if (b64) RealtimeManager.sendImageFrame(b64).catch(() => {})
      }).catch(() => {})
    }

    RealtimeManager.onToolCall((callId, name, args) => {
      if (!toolRegistryRef.current) return
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(args || '{}') } catch {}
      toolRegistryRef.current.execute({ id: callId, name, arguments: parsed, rawArguments: args }).then(result => {
        if (result.output?._screenshot) {
          const { _screenshot, ...rest } = result.output
          pendingToolResults.push({ callId, screenshot: _screenshot, rest })
        } else {
          pendingToolResults.push({ callId, rest: result.output ?? {} })
        }
        if (companionMode.visionMode === 'stream') {
          sendFrameToStream()
        }
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = setTimeout(flushToolResults, 50)
      }).catch(() => {})
    })
    RealtimeManager.onError((msg) => {
      setError(msg)
    })

    async function startRealtimeSession() {
      if (RealtimeManager.isActive) return
      try {
        const profile = await memoryRef.current.getUserProfile()
        const userName = profile?.basic?.name || '小伙伴'

        const systemPrompt = buildSystemPrompt(userName, undefined, 'voice')
        const [facts, recentMsgs, recentReflections] = await Promise.all([
          memoryRef.current.getAllFacts(),
          memoryRef.current.getRecentMessages(25),
          memoryRef.current.getRecentReflections(5),
        ])
        const memoryPrompt = buildMemoryPrompt({
          userName,
          userPreferences: facts.filter(f => f.key === 'preference').map(f => f.value),
          learnedTopics: facts.filter(f => f.key === 'topic' || f.key === 'live2d_conversation').map(f => f.value),
        })

        let instructions = `${systemPrompt}\n\n${memoryPrompt}`

        if (profile && (profile.basic?.grade || profile.basic?.school || profile.personality?.learningStyle)) {
          const profileLines: string[] = []
          if (profile.basic?.grade) profileLines.push(`年级: ${profile.basic.grade}`)
          if (profile.basic?.school) profileLines.push(`学校: ${profile.basic.school}`)
          if (profile.personality?.learningStyle) profileLines.push(`学习方式: ${profile.personality.learningStyle}`)
          if (profile.personality?.traits?.length) profileLines.push(`性格: ${profile.personality.traits.join('、')}`)
          if (profile.interests?.hobbies?.length) profileLines.push(`爱好: ${profile.interests.hobbies.join('、')}`)
          if (profile.learning?.painPoints?.length) profileLines.push(`学习困难: ${profile.learning.painPoints.join('、')}`)
          instructions += `\n\n## 用户画像\n${profileLines.join('\n')}`
        }

        if (recentReflections.length > 0) {
          const reflectionText = recentReflections.map(r => `- ${r.content}`).join('\n')
          instructions += `\n\n## 最近反思\n${reflectionText}`
        }
        const recentConv = recentMsgs.map(m =>
          `[${m.role === 'user' ? userName : '灵枢'}] ${m.content}`
        ).join('\n')
        if (recentConv) instructions += `\n\n## 最近对话\n${recentConv}`

        try {
          const summary = loadSummary()
          if (summary) instructions += '\n\n' + buildSummaryInject(summary)
        } catch {}

        const toolSpecs = toolRegistryRef.current.specsForToolCall()
        const toolDefsJson = JSON.stringify(toolSpecs.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })))
        await RealtimeManager.start(instructions, toolDefsJson)
        setTimeout(() => RealtimeManager.startMic(), 500)
        if (companionMode.visionMode === 'stream') {
          setTimeout(() => startFrameStream(), 2000)
        } else {
          setTimeout(() => { sendScreenshotToOmni() }, 2000)
        }
      } catch (e: any) {
        console.warn('[Realtime] Failed to start:', e.message)
      }
    }

    async function stopRealtimeSession() {
      stopFrameStream()
      if (!RealtimeManager.isActive) return
      try { RealtimeManager.stopCamera(); await RealtimeManager.stop() } catch {}
    }

    async function recoverUnclosedSession() {
      await memoryRef.current.recoverInterruptedConsolidation()

      const wasActive = localStorage.getItem(LIVE2D_SESSION_KEY)
      if (wasActive !== 'true') return
      const savedData = localStorage.getItem(LIVE2D_SESSION_DATA_KEY)
      if (!savedData) { localStorage.removeItem(LIVE2D_SESSION_KEY); return }
      try {
        const saved: CompanionMessage[] = JSON.parse(savedData)
        if (saved.length === 0) { localStorage.removeItem(LIVE2D_SESSION_KEY); localStorage.removeItem(LIVE2D_SESSION_DATA_KEY); return }

        const exitPhase = localStorage.getItem(LIVE2D_EXIT_PHASE_KEY)

        if (exitPhase === 'done') {
          const facts = await memoryRef.current.getAllFacts()
          const existingSummary = facts.find(f => f.key === 'live2d_conversation' && f.source === 'live2d_recovery')
          if (existingSummary) {
            const recent = await memoryRef.current.getRecentMessages(5)
            const alreadyWroteMessage = recent.some(m =>
              m.role === 'user' && m.content.includes('[Live2D异常恢复]')
            )
            if (!alreadyWroteMessage) {
              await memoryRef.current.saveRecentMessage({ id: `mem_${Date.now()}_recovery_summary`, role: 'user', content: `[Live2D异常恢复] ${existingSummary.value}`, timestamp: Date.now() })
              memoryRef.current.consolidateIfNeeded()
            }
          }
          localStorage.removeItem(LIVE2D_SESSION_KEY)
          localStorage.removeItem(LIVE2D_SESSION_DATA_KEY)
          localStorage.removeItem(LIVE2D_EXIT_PHASE_KEY)
          return
        }

        localStorage.setItem(LIVE2D_EXIT_PHASE_KEY, 'extracting')
        const conv = saved.map(m => `[${m.role === 'user' ? '用户' : '灵枢'}] ${m.content}`).join('\n')
        const [summary, facts] = await Promise.all([
          summarizeConversation(conv, '上次实时对话异常中断'),
          extractFactsFromConversation(conv),
        ])
        if (summary) {
          await memoryRef.current.saveFact({ id: `fact_recovery_${Date.now()}`, key: 'live2d_conversation', value: summary, source: 'live2d_recovery', createdAt: Date.now() })
        }
        if (facts.length > 0) {
          const existingFacts = await memoryRef.current.getAllFacts()
          const existingForDedup: ExistingFactForDedup[] = existingFacts.map(f => ({ id: f.id, key: f.key, value: f.value }))
          const deduped = await deduplicateFacts(facts, existingForDedup)
          for (const f of deduped) {
            await memoryRef.current.saveFact({ id: `fact_recovery_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, key: f.key, value: f.value, source: 'live2d_recovery', createdAt: Date.now() })
          }
        }
        if (summary) {
          await memoryRef.current.saveRecentMessage({ id: `mem_${Date.now()}_recovery_summary`, role: 'user', content: `[Live2D异常恢复] ${summary}`, timestamp: Date.now() })
          memoryRef.current.consolidateIfNeeded()
        }

        localStorage.setItem(LIVE2D_EXIT_PHASE_KEY, 'done')
      } catch {} finally {
        localStorage.removeItem(LIVE2D_SESSION_KEY)
        localStorage.removeItem(LIVE2D_SESSION_DATA_KEY)
        localStorage.removeItem(LIVE2D_EXIT_PHASE_KEY)
      }
    }

    memoryRef.current.getRecentMessages(100).then(saved => {
      if (saved.length > 0) setMessages(saved.map(memoryToMessage))
    })

    if (COMPANION_ENABLED) {
      schedulerRef.current?.onSessionStart()
    }
    recoverUnclosedSession()

    return () => {
      proactCleanup.playbackEnd()
      proactCleanup.userInput()
      unsubMode()
      unsubVision()
      flushToolResults()
      stopFrameStream()
      stopRealtimeSession()
      RealtimeManager.stopCamera()
    }
  }, [])

  const sendText = useCallback(async (text: string) => {
    const sm = sessionSMRef.current
    sm.markUserInputPreempt()
    sm.fire('user_input')
    schedulerRef.current?.markActivity()

    if (currentMode === 'live2d' || companionMode.isLive2D()) {
      const userMsg: CompanionMessage = { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now(), type: 'text', status: 'sent' }
      setMessages(prev => [...prev, userMsg])
      addLive2dMessage(userMsg)
      setIsTyping(true)
      realtimeIdRef.current = crypto.randomUUID()
      try { await RealtimeManager.sendText(text) } catch (e: any) {
        console.warn('[Realtime] sendText failed:', e.message)
        setIsTyping(false)
      }
      return
    }

    if (isTyping) {
      serviceRef.current.injectBargeIn(text)
      const userMsg: CompanionMessage = { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now(), type: 'text', status: 'sent' }
      setMessages(prev => [...prev, userMsg])
      return
    }

    if (ttsRef.current.isSpeaking && lastAiResponseRef.current) {
      if (shouldBargeIn(text, lastAiResponseRef.current, true)) {
        sm.markUserInputPreempt()
        ttsRef.current.stop()
      }
    }

    const userMsg: CompanionMessage = { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now(), type: 'text', status: 'sent' }
    setMessages(prev => [...prev, userMsg])
    setError(null)
    setIsTyping(true)
    setTypingContent('')

    try {
      sm.isResponding = true
      const allReplies: string[] = []

      await serviceRef.current.chat(text, (reply) => {
        allReplies.push(reply)
        const aiMsg: CompanionMessage = { id: crypto.randomUUID(), role: 'assistant', content: reply, timestamp: Date.now(), type: 'text', status: 'sent' }
        setMessages(prev => [...prev, aiMsg])
        setTypingContent('')
        if (!companionMode.isLive2D()) {
          ttsRef.current.speak({ text: reply, engine: 'online' }).catch(() => {})
        }
      })
      sm.isResponding = false

      const combinedRaw = allReplies.join('\n')
      const combinedCleaned = allReplies.join('\n')
      lastAiResponseRef.current = combinedCleaned

      await memoryRef.current.saveRecentMessage({ id: `mem_${Date.now()}_user`, role: 'user', content: text, timestamp: Date.now() })
      await memoryRef.current.saveRecentMessage({ id: `mem_${Date.now()}_ai`, role: 'assistant', content: combinedCleaned, timestamp: Date.now() })
      memoryRef.current.consolidateIfNeeded()

      const newHash = JSON.stringify(await memoryRef.current.getUserProfile())
      if (lastProfileHashRef.current && newHash !== lastProfileHashRef.current) {
        const changes = describeProfileChange(lastProfileHashRef.current, newHash)
        if (changes) { schedulerRef.current?.trigger({ type: 'profile_discovery', description: changes }) }
      }
      lastProfileHashRef.current = newHash

      if (combinedRaw.includes('[appear]')) companionMode.activateLive2D('llm').catch(() => {})
      if (combinedRaw.includes('[disappear]')) companionMode.deactivateLive2D('llm').catch(() => {})
      const exprMatch = combinedRaw.match(/\[expression:(\w+)\]/)
      if (exprMatch) companionMode.setExpression(exprMatch[1] as any).catch(() => {})
      const motionMatch = combinedRaw.match(/\[motion:(\w+)\]/)
      if (motionMatch) companionMode.startMotion(motionMatch[1]).catch(() => {})
    } catch (e: any) {
      sm.isResponding = false
      const errMsg = e.message || '发送失败，请稍后重试'
      setError(errMsg)
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: errMsg, timestamp: Date.now(), type: 'text', status: 'failed' }])
    } finally {
      setIsTyping(false)
      setTypingContent('')
    }
  }, [currentMode, isTyping, addLive2dMessage])

  const sendImage = useCallback(async (file: File) => {
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: '[图片]', timestamp: Date.now(), type: 'image', mediaUrl: URL.createObjectURL(file), status: 'sent' }])
  }, [])

  const sendSticker = useCallback(async (dataUrl: string) => {
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: '[贴图]', timestamp: Date.now(), type: 'image', mediaUrl: dataUrl, status: 'sent' }])
  }, [])

  const toggleMode = useCallback(() => {
    if (companionMode.isLive2D()) {
      deactivateLive2DMode()
    } else {
      activateLive2DMode()
    }
  }, [deactivateLive2DMode, activateLive2DMode])

  const toggleVisionMode = useCallback(() => {
    const next: VisionMode = companionMode.visionMode === 'on-demand' ? 'stream' : 'on-demand'
    companionMode.setVisionMode(next)
  }, [])

  const toggleMic = useCallback(() => {
    if (isMicMuted) {
      RealtimeManager.unmuteMic()
      setIsMicMuted(false)
    } else {
      RealtimeManager.muteMic()
      setIsMicMuted(true)
    }
  }, [isMicMuted])

  const toggleCamera = useCallback(() => {
    if (videoState === 'active') {
      RealtimeManager.stopCamera().catch(() => {})
    } else {
      RealtimeManager.startCamera().catch(() => {})
    }
  }, [videoState])

  const rawDeactivateLive2D = useCallback(() => {
    deactivateLive2DMode()
  }, [deactivateLive2DMode])

  return (
    <CompanionContext.Provider value={{ messages, isTyping, typingContent, error, agentSteps, sessionBus: sessionBusRef.current, toolRegistry: toolRegistryRef.current, currentMode, visionMode, realtimeState, live2dMessages, isMicMuted, videoState, sendText, sendImage, sendSticker, toggleMode, toggleVisionMode, toggleMic, toggleCamera, deactivateLive2D: rawDeactivateLive2D }}>
      {children}
    </CompanionContext.Provider>
  )
}

export function useCompanion() {
  const ctx = useContext(CompanionContext)
  if (!ctx) throw new Error('useCompanion must be used within CompanionProvider')
  return ctx
}
