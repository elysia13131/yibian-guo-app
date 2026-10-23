export async function llmFetchWithRetry(
  fetchFn: () => Promise<{ ok: boolean; json: () => Promise<any>; status: number; text: () => Promise<string> }>,
  parseFn: (json: any) => { success: true; value: any } | { success: false },
  options?: { maxRetries?: number; backoffMs?: number[] },
): Promise<{ success: true; value: any } | { success: false }> {
  const maxRetries = options?.maxRetries ?? 3
  const backoffs = options?.backoffMs ?? [1000, 2000, 4000]

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetchFn()
      if (!resp.ok) {
        if (resp.status === 429 || resp.status >= 500) {
          if (attempt < maxRetries) {
            const delay = backoffs[attempt] ?? 4000
            await new Promise(r => setTimeout(r, delay))
            continue
          }
        }
        return { success: false }
      }
      const json = await resp.json()
      return parseFn(json)
    } catch {
      if (attempt < maxRetries) {
        const delay = backoffs[attempt] ?? 4000
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      return { success: false }
    }
  }
  return { success: false }
}

export async function summarizeConversation(conversation: string, context: string): Promise<string> {
  const apiKey = localStorage.getItem('deepseek_api_key')
  if (!apiKey) return conversation.slice(0, 300) + (conversation.length > 300 ? '...' : '')
  const baseUrl = localStorage.getItem('deepseek_base_url') || 'https://api.deepseek.com/v1'

  const prompt = [
    '请总结以下对话内容，生成简洁但信息丰富的摘要：',
    '======以下为对话======',
    conversation,
    '======以上为对话======',
    '',
    '你的摘要应该保留关键信息、重要事实和主要讨论点，且不能具有误导性或产生歧义。',
    '以一句中文返回，不超过100字。',
    '',
    '[重要]避免在摘要中过度重复使用相同的词汇：',
    '- 对于反复出现的名词或主题词，在第一次提及后应使用代词（它/其/该/这个）或上下文指代替换',
    '- 使摘要表达更加流畅自然，避免"复读机"效果',
    '- 例如："讨论了学习计划和时间安排" 而非 "讨论了学习计划和学习的时间安排"',
    '',
    '[重要]处理事实纠正：',
    '- 当对话后段对前段已陈述的事实出现明确纠正（例如对方更正了之前说错的内容），摘要应反映这一过程：保留"原以为X，后被纠正为Y"的脉络',
    '- 这样可以让后续对话不会重复犯同样的错误',
    '',
    '[重要]保留用户的负面反馈（高价值信号）：',
    '- 用户明确表达"别再提 X / 不要做 Y / 不想聊 Z"这类祈使句时，必须原样写入摘要',
    '- 不要压缩、改写或合并，按字面记录（例如"用户明确要求：不要再提加班"）',
    '- 哪怕在对话里看起来口语化，也不可省略',
    '',
    `上下文: ${context}`,
    '不要加任何前缀标签，直接返回摘要文本。',
  ].join('\n')

  const result = await llmFetchWithRetry(
    () => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 150 }),
    }),
    (json) => {
      const text = json.choices?.[0]?.message?.content?.trim()
      return text ? { success: true, value: text } : { success: false }
    },
  )
  if (result.success) return result.value
  return conversation.slice(0, 300) + (conversation.length > 300 ? '...' : '')
}

export interface ExtractedFact {
  key: string
  value: string
}

export async function extractFactsFromConversation(conversation: string): Promise<ExtractedFact[]> {
  const apiKey = localStorage.getItem('deepseek_api_key')
  if (!apiKey) return []
  const baseUrl = localStorage.getItem('deepseek_base_url') || 'https://api.deepseek.com/v1'

  const prompt = [
    '从以下对话中提取关于用户的重要信息，作为可存储的记忆片段。',
    '每条信息应该是独立的、可被单独检索的事实。每条包含 key（简短标签，2-6个字）和 value（完整描述，10-30字）。',
    '重点关注：用户说过的事情、偏好、学习进度、计划、情绪、兴趣、习惯、个人背景。',
    '只提取有实际信息量的内容，不要提取泛泛的闲聊。',
    '以JSON数组格式返回：[{"key":"...","value":"..."}]。如果没有值得提取的信息，返回空数组[]。',
    '',
    '对话:',
    conversation,
  ].join('\n')

  const result = await llmFetchWithRetry(
    () => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 500 }),
    }),
    (json) => {
      const text = json.choices?.[0]?.message?.content?.trim()
      if (!text) return { success: false }
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return { success: false }
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (!Array.isArray(parsed)) return { success: false }
        const facts = parsed.filter((f: any) => typeof f.key === 'string' && typeof f.value === 'string' && f.key && f.value)
        return { success: true, value: facts }
      } catch { return { success: false } }
    },
  )
  if (result.success) return result.value
  return []
}

export interface ExistingFactForDedup {
  id: string
  key: string
  value: string
}

export async function deduplicateFacts(newFacts: ExtractedFact[], existingFacts: ExistingFactForDedup[]): Promise<ExtractedFact[]> {
  if (newFacts.length === 0) return []
  if (existingFacts.length === 0) return newFacts

  const apiKey = localStorage.getItem('deepseek_api_key')
  if (!apiKey) return newFacts
  const baseUrl = localStorage.getItem('deepseek_base_url') || 'https://api.deepseek.com/v1'

  const newFactsStr = newFacts.map((f, i) => `  [new_${i}] key="${f.key}" value="${f.value}"`).join('\n')
  const existingFactsStr = existingFacts.map(f => `  [existing_${f.id.slice(-6)}] key="${f.key}" value="${f.value}"`).join('\n')

  const prompt = [
    '你是一个记忆去重判断器。判断以下新提取的事实是否与已有事实语义重复。',
    '',
    '已有事实：',
    existingFactsStr || '(空)',
    '',
    '新提取的事实：',
    newFactsStr,
    '',
    '规则：如果新事实描述的内容与某条已有事实实质相同（同样的信息，仅措辞不同），则标记为重复。',
    '如果新事实包含旧事实没有的新信息，即使是同一主题的不同细节，也视为不重复。',
    '例如："用户喜欢数学" 和 "用户喜欢科学" 是不同的；"用户完成了数学第3章" 和 "用户完成了数学第3章" 是重复的。',
    '',
    '以JSON数组格式返回应保留的新事实索引列表（只返回不重复的那些索引号）：',
    '[0, 2, 5]',
    '',
    '如果所有新事实都重复，返回空数组 []。',
  ].join('\n')

  const result = await llmFetchWithRetry(
    () => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 200 }),
    }),
    (json) => {
      const text = json.choices?.[0]?.message?.content?.trim()
      if (!text) return { success: false }
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return { success: false }
      try {
        const indices: number[] = JSON.parse(jsonMatch[0])
        if (!Array.isArray(indices)) return { success: false }
        const filtered = indices.filter(i => i >= 0 && i < newFacts.length).map(i => newFacts[i])
        return { success: true, value: filtered }
      } catch { return { success: false } }
    },
  )
  if (result.success) return result.value
  return newFacts
}

export function chatWithDS(prompt: string): Promise<string> {
  const apiKey = localStorage.getItem('deepseek_api_key')
  if (!apiKey) return Promise.reject(new Error('DeepSeek API Key 未配置'))
  const baseUrl = localStorage.getItem('deepseek_base_url') || 'https://api.deepseek.com/v1'

  return llmFetchWithRetry(
    () => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 120 }),
    }),
    (json) => {
      const text = json.choices?.[0]?.message?.content?.trim()
      return text ? { success: true, value: text } : { success: false }
    },
  ).then(r => r.success ? r.value : Promise.reject(new Error('LLM调用失败')))
}

export interface ConversationSummary {
  hash: string
  createdAt: number
  lastUpdated: number
  topics: string[]
  keyPoints: string[]
  userMood: string
  lastMessageId: string
}

export function loadSummary(): ConversationSummary | null {
  try {
    const raw = localStorage.getItem('companion_summary')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveSummary(summary: ConversationSummary): void {
  localStorage.setItem('companion_summary', JSON.stringify(summary))
}

export function clearSummary(): void {
  localStorage.removeItem('companion_summary')
}

export function buildSummaryInject(summary: ConversationSummary): string {
  const lines: string[] = ['[之前的对话摘要]']
  if (summary.topics.length) lines.push(`话题: ${summary.topics.join('、')}`)
  if (summary.keyPoints.length) lines.push(`要点: ${summary.keyPoints.join('；')}`)
  if (summary.userMood) lines.push(`用户情绪: ${summary.userMood}`)
  return lines.join('\n')
}

export function shouldSummarize(totalMessages: number, lastSummaryAt: number): boolean {
  return totalMessages > 20 && Date.now() - lastSummaryAt > 10 * 60 * 1000
}

export async function generateSummary(messages: { role: string; content: string }[], existing: ConversationSummary | null): Promise<ConversationSummary | null> {
  const apiKey = localStorage.getItem('deepseek_api_key')
  if (!apiKey) return null
  const parts = messages.slice(-30).map(m => `[${m.role}] ${m.content}`).join('\n')
  const existingParts = existing ? `已有话题: ${existing.topics.join(', ')}\n已有要点: ${existing.keyPoints.join(', ')}` : ''
  const prompt = `分析以下对话，提取关键信息。以JSON格式返回，只包含以下字段: { topics: string[], keyPoints: string[], userMood: string, lastMessageId: string }\n${existingParts}\n\n对话:\n${parts}`
  const baseUrl = localStorage.getItem('deepseek_base_url') || 'https://api.deepseek.com/v1'

  const result = await llmFetchWithRetry(
    () => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 300 }),
    }),
    (json) => {
      const text = json.choices?.[0]?.message?.content?.trim()
      if (!text) return { success: false }
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return { success: false }
      try {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          success: true,
          value: {
            hash: String(Date.now()),
            createdAt: existing?.createdAt || Date.now(),
            lastUpdated: Date.now(),
            topics: parsed.topics || [],
            keyPoints: parsed.keyPoints || [],
            userMood: parsed.userMood || '',
            lastMessageId: parsed.lastMessageId || messages[messages.length - 1]?.content?.slice(0, 20) || '',
          },
        }
      } catch { return { success: false } }
    },
  )
  if (result.success) return result.value
  return null
}
