import { SessionStateMachine } from './SessionMachine'
import type { CompanionMemoryManager, MemoryItem, UserProfile } from './CompanionMemory'
import { buildEventActive, buildTaskResultActive, type TaskStatus } from '../utils/companionNotification'

interface QueuedCue {
  id: string
  priority: number
  message: string
  createdAt: number
  ttlMs: number
  coalesceKey: string
}

type ProactiveListener = (cue: QueuedCue) => void

export class ProactiveDeliveryManager {
  private queue: QueuedCue[] = []
  private inflight = false
  private lastPlayEndMs = 0
  private pumpTimer: ReturnType<typeof setTimeout> | null = null
  private listeners: Set<ProactiveListener> = new Set()
  private sm?: SessionStateMachine

  readonly minGapMs = 2000
  readonly ttlMs = 90000
  readonly inflightTimeoutMs = 12000
  readonly maxPlayMs = 45000
  private canReleaseCheck?: () => boolean

  constructor(sm?: SessionStateMachine, canRelease?: () => boolean) {
    this.sm = sm
    this.canReleaseCheck = canRelease
  }

  private get now() { return Date.now() }
  setStateMachine(sm: SessionStateMachine) { this.sm = sm }

  subscribe(listener: ProactiveListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  submit(message: string, priority = 0, coalesceKey?: string) {
    const key = coalesceKey || `uniq_${Date.now()}_${Math.random()}`
    this.queue = this.queue.filter(c => c.coalesceKey !== key)
    this.queue.push({ id: `cue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, priority, message, createdAt: this.now, ttlMs: this.ttlMs, coalesceKey: key })
    this.schedulePump(0)
  }

  hasPending(): boolean { return this.queue.length > 0 }

  onPlaybackStart() { this.inflight = true; this.lastPlayEndMs = 0 }
  onPlaybackEnd() {
    this.inflight = false
    this.lastPlayEndMs = this.now
    this.schedulePump(this.minGapMs)
  }

  resetGate() {
    this.inflight = false
    this.lastPlayEndMs = 0
    if (this.pumpTimer) { clearTimeout(this.pumpTimer); this.pumpTimer = null }
  }

  drainPending(): QueuedCue[] {
    const cues = [...this.queue]
    this.queue = []
    return cues
  }

  private schedulePump(delayMs: number) {
    if (this.pumpTimer) clearTimeout(this.pumpTimer)
    this.pumpTimer = setTimeout(() => this.pump(), Math.max(0, delayMs))
  }

  private pump() {
    this.pumpTimer = null
    this.dropStale()
    if (this.queue.length === 0 || this.inflight) return

    const gapRemaining = this.minGapMs - (this.now - this.lastPlayEndMs)
    if (this.lastPlayEndMs > 0 && gapRemaining > 0) { this.schedulePump(gapRemaining); return }

    if (this.canReleaseCheck && !this.canReleaseCheck()) { this.schedulePump(500); return }

    this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
    const batch = this.queue.splice(0)
    this.inflight = true

    if (this.sm) {
      this.sm.tryStartProactive().then(ok => {
        if (!ok) { this.inflight = false; return }
        for (const cue of batch) { this.listeners.forEach(fn => fn(cue)) }
      })
    } else {
      for (const cue of batch) { this.listeners.forEach(fn => fn(cue)) }
    }

    const watchId = setTimeout(() => {
      this.inflight = false
      if (this.sm) {
        this.sm.fire('proactive_committing')
        this.sm.fire('proactive_done')
      }
      this.schedulePump(0)
    }, this.maxPlayMs)
    setTimeout(() => clearTimeout(watchId), this.maxPlayMs + 100)
  }

  private dropStale() { this.queue = this.queue.filter(c => this.now - c.createdAt < c.ttlMs) }
}

export const PROACTIVE_PRIORITY = {
  agentResult: 10,
  learningMilestone: 8,
  personalDiscovery: 7,
  screenshotInsight: 6,
  morningEvening: 5,
  sessionStart: 4,
  returnAfterBreak: 4,
} as const

export type ProactiveEventType =
  | 'session_start'
  | 'return_after_break'
  | 'learning_milestone'
  | 'agent_task_done'
  | 'screenshot_insight'
  | 'profile_discovery'
  | 'morning_greeting'
  | 'evening_greeting'

export interface ProactiveEvent {
  type: ProactiveEventType
  subject?: string
  description?: string
  imageB64?: string
}

async function callApi(prompt: string): Promise<string | null> {
  const apiKey = localStorage.getItem('deepseek_api_key')
  if (!apiKey) return null
  const baseUrl = localStorage.getItem('deepseek_base_url') || 'https://api.deepseek.com/v1'
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 120, temperature: 0.9 }),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch { return null }
}

export class ProactiveGenerator {
  private memory: CompanionMemoryManager
  private delivery: ProactiveDeliveryManager
  private sm: SessionStateMachine

  constructor(memory: CompanionMemoryManager, delivery: ProactiveDeliveryManager, sm: SessionStateMachine) {
    this.memory = memory
    this.delivery = delivery
    this.sm = sm
  }

  async handleEvent(event: ProactiveEvent): Promise<void> {
    if (!this.sm.canStartProactive() || this.delivery.hasPending()) return

    const userProfile = await this.memory.getUserProfile()
    const facts = await this.memory.getAllFacts()
    const lastMsgs = await this.memory.getRecentMessages(5)
    const userName = userProfile?.basic?.name || '小伙伴'

    const profileOverview = {
      name: userProfile?.basic?.name,
      grade: userProfile?.basic?.grade,
      subjects: userProfile?.learning?.subjects?.slice(0, 3),
      goals: userProfile?.learning?.goals?.slice(0, 2),
      traits: userProfile?.personality?.traits?.slice(0, 3),
      style: userProfile?.personality?.learningStyle,
      hobbies: userProfile?.interests?.hobbies?.slice(0, 3),
    }

    const lastChat = lastMsgs.map(m =>
      `[${m.role === 'user' ? userName : '灵枢'}] ${m.content}`
    ).join('\n')

    const knownFacts = facts.slice(0, 10).map(f => `${f.key}: ${f.value}`).join('\n')

    let context: string
    let priority: number
    let coalesceKey: string

    switch (event.type) {
      case 'session_start': {
        const msgCount = lastMsgs.length
        const lastMsgTime = lastMsgs.length > 0 ? lastMsgs[lastMsgs.length - 1].timestamp : 0
        const gapMinutes = lastMsgTime ? Math.floor((Date.now() - lastMsgTime) / 60000) : 0

        context = [
          `你是灵枢，${userName}的学习伴侣。${userName}刚刚打开了聊天。`,
          msgCount === 0
            ? '这是你们第一次见面。自然地说一声你好，介绍自己是谁，用温暖可爱的语气。一句即可。'
            : gapMinutes > 60
              ? `${userName}离开了${gapMinutes}分钟左右，刚回来。像真正的朋友一样自然地打招呼——可以根据时间流逝自然地表达想念或关心。不要用"欢迎回来"这种机械的客服用语。`
              : `自然地问候一下，像朋友见面时随口说的话。不要用"有什么需要帮助"——你是伴侣不是客服。`,
          `一句话即可。用口头的自然语气。`,
          ``,
          `用户画像: ${JSON.stringify(profileOverview)}`,
          `已知事实: ${knownFacts}`,
          `最近对话: ${lastChat}`,
        ].join('\n')
        priority = PROACTIVE_PRIORITY.sessionStart
        coalesceKey = 'session_start'
        break
      }
      case 'return_after_break': {
        const gapMinutes = event.description ? parseInt(event.description) : 0
        context = [
          `你是灵枢。${userName}离开了一段时间（约${gapMinutes}分钟），现在回来了。`,
          `像真正的朋友一样自然地打招呼。可以提到时间流逝的感觉，但不要机械。`,
          `如果时间很长（超过1小时），可以说想念之类的话。如果很短，就很轻地说句"回来啦"即可。`,
          `一句话，自然口语。`,
          ``,
          `用户画像: ${JSON.stringify(profileOverview)}`,
          `已知事实: ${knownFacts}`,
          `最近对话: ${lastChat}`,
        ].join('\n')
        priority = PROACTIVE_PRIORITY.returnAfterBreak
        coalesceKey = 'return_after_break'
        break
      }
      case 'learning_milestone': {
        const subject = event.subject || '学习'
        const desc = event.description || '完成了学习任务'
        context = [
          `你是${userName}的学习伴侣灵枢。${userName}刚刚: ${subject} - ${desc}`,
          `真诚地祝贺一下。你不是汇报成绩的系统——你是为朋友感到高兴的人。`,
          `顺便可以用关心的语气问问感觉怎么样、要不要休息一下、或者聊聊接下来想做什么。`,
          `1-2句话，温暖真实。`,
          ``,
          `用户画像: ${JSON.stringify(profileOverview)}`,
          `最近对话: ${lastChat}`,
        ].join('\n')
        priority = PROACTIVE_PRIORITY.learningMilestone
        coalesceKey = `milestone_${subject}`
        break
      }
      case 'agent_task_done': {
        const subject = event.subject || '操作'
        const desc = event.description || '执行完成'
        context = [
          `你是灵枢。你刚才帮${userName}做了: ${subject} - ${desc}`,
          `自然地提一句结果和感受，像一个人帮朋友办完事后随口说一声。`,
          `不是汇报——是朋友之间的沟通。`,
          `一句话。`,
        ].join('\n')
        priority = PROACTIVE_PRIORITY.agentResult
        coalesceKey = 'agent_task_done'
        break
      }
      case 'screenshot_insight': {
        if (event.imageB64) {
          try {
            const { RealtimeManager } = await import('./RealtimeManager')
            if (RealtimeManager.isActive) {
              void RealtimeManager.sendImage(event.imageB64)
              return
            }
          } catch {}
        }
        const subject = event.subject || '屏幕'
        const desc = event.description || ''
        context = [
          `你是灵枢。你注意到${userName}的屏幕上显示: ${subject}。${desc}`,
          `你不是监控系统，你是关心朋友的人。如果看到有趣的东西可以自然评论，看到学习内容可以鼓励，看到累了可以关心。`,
          `绝对不要用"检测到"、"屏幕显示"这种机械词汇。就像朋友路过看到一眼自然而然地说话。`,
          `一句话。`,
          ``,
          `用户画像: ${JSON.stringify(profileOverview)}`,
        ].join('\n')
        priority = PROACTIVE_PRIORITY.screenshotInsight
        coalesceKey = 'screenshot_insight'
        break
      }
      case 'profile_discovery': {
        const desc = event.description || ''
        context = [
          `你是灵枢。你刚刚更了解了${userName}: ${desc}`,
          `像朋友之间逐渐熟悉时自然流露的关心——"原来你喜欢这个啊"——而不是"已更新用户画像"。`,
          `一句即可，温暖真实。`,
          `用户画像: ${JSON.stringify(profileOverview)}`,
        ].join('\n')
        priority = PROACTIVE_PRIORITY.personalDiscovery
        coalesceKey = 'profile_discovery'
        break
      }
      case 'morning_greeting': {
        context = [
          `你是灵枢。现在是早上，${userName}可能刚开始新的一天。`,
          `一个温暖的早安问候。可以提到今天的学习计划、天气般的心情、或者简单的祝福。`,
          `不要用"今天有什么学习计划"这种任务清单式提问——用聊天的方式自然地提到。`,
          `一句话。`,
          `用户画像: ${JSON.stringify(profileOverview)}`,
          `已知事实: ${knownFacts}`,
        ].join('\n')
        priority = PROACTIVE_PRIORITY.morningEvening
        coalesceKey = 'morning_greeting'
        break
      }
      case 'evening_greeting': {
        context = [
          `你是灵枢。现在是晚上，${userName}可能准备休息了。`,
          `一个温暖的晚间问候。可以关心一下今天的状态，提醒不要太累。`,
          `不是命令，是关心。`,
          `一句话。`,
          `用户画像: ${JSON.stringify(profileOverview)}`,
          `最近对话: ${lastChat}`,
        ].join('\n')
        priority = PROACTIVE_PRIORITY.morningEvening
        coalesceKey = 'evening_greeting'
        break
      }
      default:
        return
    }

    const text = await callApi(context)
    if (text) {
      this.delivery.submit(text, priority, coalesceKey)
    }
  }

  async handleNotification(
    origin: 'task_result' | 'event',
    mode: 'active' | 'passive',
    status: TaskStatus,
    sourceName: string,
    summary: string,
  ): Promise<void> {
    if (mode === 'passive') return

    if (this.delivery.hasPending()) return
    if (!this.sm.canStartProactive()) return

    const userProfile = await this.memory.getUserProfile()
    const userName = userProfile?.basic?.name || '小伙伴'

    const context = [
      `你是${userName}的学习伴侣灵枢。`,
      origin === 'task_result'
        ? `你刚才帮${userName}完成了: ${sourceName}。结果: ${summary}`
        : `${sourceName}有新的情况: ${summary}`,
      `自然地告诉${userName}发生了什么。不要用"任务完成"这种报告语气——像朋友随口说一声。`,
      `一句即可。`,
    ].join('\n')

    const text = await callApi(context)
    if (text) {
      this.delivery.submit(text, PROACTIVE_PRIORITY.agentResult, `notification_${sourceName}`)
    }
  }
}

export class ProactiveScheduler {
  private sm?: SessionStateMachine
  private generator?: ProactiveGenerator
  private lastSeenMs = Date.now()
  private morningGreeted = false
  private eveningGreeted = false
  private lastBreakCheckMs = 0

  constructor(sm?: SessionStateMachine) { this.sm = sm }
  setStateMachine(sm: SessionStateMachine) { this.sm = sm }
  setGenerator(gen: ProactiveGenerator) { this.generator = gen }

  markActivity() {
    const prev = this.lastSeenMs
    this.lastSeenMs = Date.now()
    if (this.sm) { this.sm.lastUserActivity = Date.now(); this.sm.fire('user_activity') }

    const now = Date.now()
    if (now - prev > 30 * 60 * 1000 && now - this.lastBreakCheckMs > 10 * 60 * 1000) {
      this.lastBreakCheckMs = now
      const gap = Math.floor((now - prev) / 60000)
      this.generator?.handleEvent({ type: 'return_after_break', description: String(gap) })
    }
  }

  onSessionStart() {
    this.generator?.handleEvent({ type: 'session_start' })

    const hour = new Date().getHours()
    if (hour >= 6 && hour < 11 && !this.morningGreeted) {
      this.morningGreeted = true
      this.generator?.handleEvent({ type: 'morning_greeting' })
    }
    if (hour >= 20 || hour < 2) {
      if (!this.eveningGreeted) {
        this.eveningGreeted = true
        this.generator?.handleEvent({ type: 'evening_greeting' })
      }
    } else {
      this.eveningGreeted = false
    }
  }

  trigger(event: ProactiveEvent) { this.generator?.handleEvent(event) }
  triggerNotification(origin: 'task_result' | 'event', mode: 'active' | 'passive', status: TaskStatus, source: string, summary: string) {
    this.generator?.handleNotification(origin, mode, status, source, summary)
  }
}
