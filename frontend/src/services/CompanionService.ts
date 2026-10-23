import { CompanionMemoryManager } from './CompanionMemory'
import { ToolRegistry, type ToolDefinition } from './ToolRegistry'
import { buildSystemPrompt, buildMemoryPrompt } from '../utils/companionPrompts'
import { LifecycleEventBus } from './SessionMachine'

interface ChatMessage {
  role: string
  content: string | null
  tool_calls?: any[]
  tool_call_id?: string
}

interface ChatCompletionBody {
  model: string
  messages: ChatMessage[]
  stream: boolean
  tools?: ToolDefinition[]
  response_format?: { type: string }
}

const PRESENCE_MARKERS = {
  appear: /\[appear\]/g,
  disappear: /\[disappear\]/g,
  expression: /\[expression:\w+\]/g,
  motion: /\[motion:\w+\]/g,
}

export function stripMarkers(text: string): string {
  let cleaned = text
  for (const [, re] of Object.entries(PRESENCE_MARKERS)) {
    cleaned = cleaned.replace(re, '')
  }
  return cleaned.trim()
}

function parseControlTags(text: string): { content: string; wantContinue: boolean } {
  let content = text
  let wantContinue = false
  if (content.includes('<CONTINUE>')) {
    wantContinue = true
    content = content.replace(/<CONTINUE>/g, '')
  } else if (content.includes('<END>')) {
    content = content.replace(/<END>/g, '')
  }
  return { content: content.trim(), wantContinue }
}

const ROUND_FORMAT_INSTRUCTIONS = `
## 对话格式要求
你和用户在像微信聊天一样自然地对话。每次只说一小段话，就像真人发消息——简短、口语化、自然。

【重要】你的每一条回复末尾必须带上一个控制标签：
- <CONTINUE> 表示你还有话想说，要接着说下一句（像连续发几条消息）
- <END> 表示你的话暂时说完了，等用户回应

示例：
用户：今天学什么
你：数学第三章怎么样？我看了看你的进度，上次卡在积分的部分了<CONTINUE>
你：要不我们先复习一下不定积分，再推进定积分？<END>

【工具使用】
- 你可以在对话中悄悄使用工具（如 recall_memory），用户完全看不到这些工具调用
- 工具结果会自动注入到上下文，你直接基于结果继续自然对话即可
- 不要让用户感觉到"你刚才查了一下"
- 不要在回复中说"让我查一下""搜索结果显示"这类暴露工具使用的词

【对话风格】
- 自然的口语，带点"喵"或"呢"的尾音，像亲近的朋友
- 每条消息 1-3 句话，不要长篇大论
- 不要用"【】"或"**"等格式标记
`

export default class CompanionService {
  private memoryManager: CompanionMemoryManager
  private toolRegistry?: ToolRegistry
  private eventBus?: LifecycleEventBus
  private bargeInText: string | null = null

  constructor(memoryManager: CompanionMemoryManager, toolRegistry?: ToolRegistry, eventBus?: LifecycleEventBus) {
    this.memoryManager = memoryManager
    this.toolRegistry = toolRegistry
    this.eventBus = eventBus
  }

  setToolRegistry(registry: ToolRegistry) { this.toolRegistry = registry }
  setEventBus(bus: LifecycleEventBus) { this.eventBus = bus }

  injectBargeIn(text: string) {
    this.bargeInText = text
  }

  private getApiKey(): string {
    const key = localStorage.getItem('deepseek_api_key')
    if (!key) throw new Error('请在设置中配置 DeepSeek API Key')
    return key
  }

  private getBaseUrl(): string {
    return localStorage.getItem('deepseek_base_url') || 'https://api.deepseek.com/v1'
  }

  private async buildMessages(userText: string): Promise<ChatMessage[]> {
    const [recentMessages, facts, userProfile] = await Promise.all([
      this.memoryManager.getRecentMessages(25),
      this.memoryManager.getAllFacts(),
      this.memoryManager.getUserProfile(),
    ])

    const userName = userProfile?.basic?.name || '小伙伴'
    const systemPrompt = buildSystemPrompt(userName)
    const memoryPrompt = buildMemoryPrompt({
      userName,
      userPreferences: facts.filter(f => f.key === 'preference').map(f => f.value),
      learnedTopics: facts.filter(f => f.key === 'topic').map(f => f.value),
    })

    let systemContent = `${systemPrompt}\n\n${memoryPrompt}\n\n${ROUND_FORMAT_INSTRUCTIONS}`
    try {
      const { loadSummary, buildSummaryInject } = await import('../utils/companionSummary')
      const summary = loadSummary()
      if (summary) systemContent += '\n\n' + buildSummaryInject(summary)
    } catch {}

    return [
      { role: 'system', content: systemContent },
      ...recentMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ]
  }

  async chat(userText: string, onReply: (reply: string) => void): Promise<string[]> {
    const apiKey = this.getApiKey()
    const baseUrl = this.getBaseUrl()
    const messages = await this.buildMessages(userText)
    const replies: string[] = []

    const maxRounds = 8
    let roundCount = 0

    while (roundCount < maxRounds) {
      roundCount++

      const body: ChatCompletionBody = {
        model: 'deepseek-chat',
        messages,
        stream: false,
      }

      if (this.toolRegistry) {
        const tools = this.toolRegistry.specsForToolCall()
        if (tools.length > 0) body.tools = tools
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        throw new Error(`API 请求失败 (${response.status}): ${errBody}`)
      }

      const data = await response.json()
      const choice = data.choices?.[0]
      const msg = choice?.message
      const finishReason = choice?.finish_reason

      if (finishReason === 'tool_calls' && msg?.tool_calls) {
        messages.push({ role: 'assistant', content: null, tool_calls: msg.tool_calls })
        if (this.toolRegistry) {
          for (const tc of msg.tool_calls) {
            let args: Record<string, unknown> = {}
            try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
            try {
              const result = await this.toolRegistry.execute({
                id: tc.id,
                name: tc.function?.name || '',
                arguments: args,
                rawArguments: tc.function?.arguments || '',
              })
              messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result.output) })
            } catch {
              messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: '工具执行失败' }) })
            }
          }
        }
        continue
      }

      const rawContent = msg?.content || ''
      if (!rawContent.trim()) break

      const { content, wantContinue } = parseControlTags(rawContent)
      if (!content) break

      const displayText = stripMarkers(content)
      if (displayText) {
        replies.push(rawContent as string)
        onReply(displayText)
      }

      messages.push({ role: 'assistant', content: rawContent })

      if (!wantContinue) break

      const bargeIn = this.bargeInText
      if (bargeIn) {
        this.bargeInText = null
        messages.push({ role: 'user', content: `[用户插话] ${bargeIn}` })
        continue
      }

      await new Promise(r => setTimeout(r, 600 + Math.random() * 400))
    }

    return replies
  }
}
