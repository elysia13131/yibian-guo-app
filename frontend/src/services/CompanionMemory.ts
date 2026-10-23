import { registerPlugin } from '@capacitor/core'

export interface MemoryItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface FactItem {
  id: string
  key: string
  value: string
  source: string
  createdAt: number
}

export interface ReflectionEntry {
  id: string
  content: string
  createdAt: number
  relatedFacts: string[]
}

export interface PersonaEntry {
  id: string
  name: string
  description: string
  systemPrompt: string
  isActive: boolean
  createdAt: number
}

export interface UserProfile {
  basic: {
    name?: string
    age?: string
    grade?: string
    school?: string
  }
  learning: {
    subjects: string[]
    goals: string[]
    painPoints: string[]
    studyHabits: string[]
  }
  ability: {
    strengths: string[]
    weaknesses: string[]
    skillLevel: Record<string, string>
  }
  personality: {
    traits: string[]
    learningStyle: string
    communicationPreference: string
  }
  interests: {
    hobbies: string[]
    favoriteSubjects: string[]
    extracurricular: string[]
  }
}

export interface ProfileSnapshot {
  recentMessages: MemoryItem[]
  facts: FactItem[]
  reflections: ReflectionEntry[]
  currentPersona: PersonaEntry | null
}

export interface NekoMemoryPlugin {
  saveRecentMessage(options: { role: string; content: string; timestamp: number; id: string }): Promise<{ success: boolean }>
  getRecentMessages(options: { limit: number }): Promise<{ messages: MemoryItem[] }>
  saveFact(options: { key: string; value: string; category: string }): Promise<{ success: boolean }>
  getAllFacts(): Promise<{ facts: FactItem[] }>
  addReflection(options: { content: string }): Promise<{ success: boolean }>
  getRecentReflections(options: { limit: number }): Promise<{ reflections: ReflectionEntry[] }>
  savePersona(options: { name: string; description: string }): Promise<{ success: boolean }>
  getAllPersona(): Promise<{ personas: PersonaEntry[] }>
  saveUserProfile(options: { profileJson: string }): Promise<{ success: boolean }>
  getUserProfile(): Promise<{ profile: UserProfile | null }>
  getProfileSnapshotForExtraction(): Promise<{ snapshot: ProfileSnapshot }>
  searchSimilarMemories(options: { query: string; topK: number }): Promise<{ results: MemoryItem[] }>
  clearAll(): Promise<{ success: boolean }>
}

const PLUGIN_NAME = 'NekoMemory'
const STORAGE_KEYS = {
  RECENT_MESSAGES: 'companion_recent_messages',
  FACTS: 'companion_facts',
  REFLECTIONS: 'companion_reflections',
  PERSONAS: 'companion_personas',
  USER_PROFILE: 'companion_user_profile',
  MESSAGE_COUNT: 'companion_message_count',
  USER_MESSAGE_COUNT: 'companion_user_message_count',
  CONSOLIDATION_JOURNAL: 'companion_consolidation_journal',
}

interface ConsolidationJournal {
  state: 'saving_summary'
  startedAt: number
  oldestIds: string[]
}

function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch (e) {
    console.warn('[CompanionMemory] localStorage write failed', e)
  }
}

export class CompanionMemoryManager {
  private nativePlugin: NekoMemoryPlugin | null = null
  private messageCount: number = 0
  private userMessageCount: number = 0
  private readonly reflectionThreshold = 30
  private readonly profileExtractionThreshold = 30

  constructor() {
    try {
      this.nativePlugin = registerPlugin<NekoMemoryPlugin>(PLUGIN_NAME)
      this.messageCount = loadFromStorage<number>(STORAGE_KEYS.MESSAGE_COUNT, 0)
      this.userMessageCount = loadFromStorage<number>(STORAGE_KEYS.USER_MESSAGE_COUNT, 0)
    } catch {
      console.warn('[CompanionMemory] 原生插件 NekoMemory 不可用，降级至 localStorage')
      this.nativePlugin = null
      this.messageCount = loadFromStorage<number>(STORAGE_KEYS.MESSAGE_COUNT, 0)
      this.userMessageCount = loadFromStorage<number>(STORAGE_KEYS.USER_MESSAGE_COUNT, 0)
    }
  }

  get isNative(): boolean {
    return this.nativePlugin !== null
  }

  async saveRecentMessage(message: MemoryItem): Promise<boolean> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.saveRecentMessage({ role: message.role, content: message.content, timestamp: message.timestamp, id: message.id })
      // native-plugin 侧自行管理计数与截断；本地层只维护内存拷贝。
      if (message.role === 'user') {
        this.userMessageCount++
        saveToStorage(STORAGE_KEYS.USER_MESSAGE_COUNT, this.userMessageCount)
      }
      return result.success
    }
    const messages = loadFromStorage<MemoryItem[]>(STORAGE_KEYS.RECENT_MESSAGES, [])
    messages.push(message)

    this.messageCount++
    saveToStorage(STORAGE_KEYS.MESSAGE_COUNT, this.messageCount)
    if (message.role === 'user') {
      this.userMessageCount++
      saveToStorage(STORAGE_KEYS.USER_MESSAGE_COUNT, this.userMessageCount)
    }

    if (messages.length >= 250) {
      saveToStorage(STORAGE_KEYS.RECENT_MESSAGES, messages)
      this.consolidateIfNeeded()
      return true
    }

    saveToStorage(STORAGE_KEYS.RECENT_MESSAGES, messages)
    return true
  }

  async getRecentMessages(limit: number = 50): Promise<MemoryItem[]> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.getRecentMessages({ limit })
      return result.messages
    }
    const messages = loadFromStorage<MemoryItem[]>(STORAGE_KEYS.RECENT_MESSAGES, [])
    return messages.slice(-limit)
  }

  async getOldestMessages(limit: number = 50): Promise<MemoryItem[]> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.getRecentMessages({ limit })
      return result.messages.slice(-limit)
    }
    const messages = loadFromStorage<MemoryItem[]>(STORAGE_KEYS.RECENT_MESSAGES, [])
    return messages.slice(0, limit)
  }

  async removeMessages(count: number): Promise<void> {
    if (this.nativePlugin) {
      return
    }
    const messages = loadFromStorage<MemoryItem[]>(STORAGE_KEYS.RECENT_MESSAGES, [])
    if (messages.length <= count) {
      saveToStorage(STORAGE_KEYS.RECENT_MESSAGES, [])
      return
    }
    const kept = messages.slice(count)
    saveToStorage(STORAGE_KEYS.RECENT_MESSAGES, kept)
  }

  private async _removeSpecificMessages(ids: Set<string>): Promise<void> {
    const messages = loadFromStorage<MemoryItem[]>(STORAGE_KEYS.RECENT_MESSAGES, [])
    const kept = messages.filter(m => !ids.has(m.id))
    saveToStorage(STORAGE_KEYS.RECENT_MESSAGES, kept)
  }

  async saveFact(fact: FactItem): Promise<boolean> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.saveFact({ key: fact.key, value: fact.value, category: fact.source })
      return result.success
    }
    const facts = loadFromStorage<FactItem[]>(STORAGE_KEYS.FACTS, [])
    const idx = facts.findIndex(f => f.key === fact.key)
    if (idx >= 0) {
      facts[idx] = fact
    } else {
      facts.push(fact)
    }
    saveToStorage(STORAGE_KEYS.FACTS, facts)
    return true
  }

  async getAllFacts(): Promise<FactItem[]> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.getAllFacts()
      return result.facts
    }
    return loadFromStorage<FactItem[]>(STORAGE_KEYS.FACTS, [])
  }

  async addReflection(reflection: ReflectionEntry): Promise<boolean> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.addReflection({ content: reflection.content })
      return result.success
    }
    const reflections = loadFromStorage<ReflectionEntry[]>(STORAGE_KEYS.REFLECTIONS, [])
    reflections.push(reflection)
    if (reflections.length > 100) {
      reflections.splice(0, reflections.length - 100)
    }
    saveToStorage(STORAGE_KEYS.REFLECTIONS, reflections)
    return true
  }

  async getRecentReflections(limit: number = 10): Promise<ReflectionEntry[]> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.getRecentReflections({ limit })
      return result.reflections
    }
    const reflections = loadFromStorage<ReflectionEntry[]>(STORAGE_KEYS.REFLECTIONS, [])
    return reflections.slice(-limit)
  }

  async savePersona(persona: PersonaEntry): Promise<boolean> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.savePersona({ name: persona.name, description: persona.description })
      return result.success
    }
    const personas = loadFromStorage<PersonaEntry[]>(STORAGE_KEYS.PERSONAS, [])
    const idx = personas.findIndex(p => p.name === persona.name)
    if (idx >= 0) {
      personas[idx] = persona
    } else {
      personas.push(persona)
    }
    saveToStorage(STORAGE_KEYS.PERSONAS, personas)
    return true
  }

  async getAllPersona(): Promise<PersonaEntry[]> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.getAllPersona()
      return result.personas
    }
    return loadFromStorage<PersonaEntry[]>(STORAGE_KEYS.PERSONAS, [])
  }

  async saveUserProfile(profile: UserProfile): Promise<boolean> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.saveUserProfile({ profileJson: JSON.stringify(profile) })
      return result.success
    }
    saveToStorage(STORAGE_KEYS.USER_PROFILE, profile)
    return true
  }

  async getUserProfile(): Promise<UserProfile | null> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.getUserProfile()
      return result.profile
    }
    return loadFromStorage<UserProfile | null>(STORAGE_KEYS.USER_PROFILE, null)
  }

  async getProfileSnapshotForExtraction(): Promise<ProfileSnapshot> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.getProfileSnapshotForExtraction()
      return result.snapshot
    }
    const recentMessages = loadFromStorage<MemoryItem[]>(STORAGE_KEYS.RECENT_MESSAGES, [])
    const facts = loadFromStorage<FactItem[]>(STORAGE_KEYS.FACTS, [])
    const reflections = loadFromStorage<ReflectionEntry[]>(STORAGE_KEYS.REFLECTIONS, [])
    const personas = loadFromStorage<PersonaEntry[]>(STORAGE_KEYS.PERSONAS, [])
    const currentPersona = personas.find(p => p.isActive) || personas[personas.length - 1] || null
    return { recentMessages, facts, reflections, currentPersona }
  }

  async searchSimilarMemories(query: string, topK: number = 5): Promise<MemoryItem[]> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.searchSimilarMemories({ query, topK })
      return result.results
    }
    const messages = loadFromStorage<MemoryItem[]>(STORAGE_KEYS.RECENT_MESSAGES, [])
    const lowerQuery = query.toLowerCase()
    const scored = messages.map(m => {
      const lowerContent = m.content.toLowerCase()
      let score = 0
      if (lowerContent.includes(lowerQuery)) score += 10
      const words = lowerQuery.split(/\s+/)
      for (const w of words) {
        if (w.length > 1 && lowerContent.includes(w)) score += 3
      }
      return { message: m, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map(s => s.message)
  }

  async recoverInterruptedConsolidation(): Promise<void> {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CONSOLIDATION_JOURNAL)
      if (!raw) return
      const journal: ConsolidationJournal = JSON.parse(raw)
      if (journal.state !== 'saving_summary' || !journal.oldestIds?.length) {
        localStorage.removeItem(STORAGE_KEYS.CONSOLIDATION_JOURNAL)
        return
      }

      const currentMessages = loadFromStorage<MemoryItem[]>(STORAGE_KEYS.RECENT_MESSAGES, [])
      const survivorIds = journal.oldestIds.filter(id => currentMessages.some(m => m.id === id))

      if (survivorIds.length > 0) {
        const { loadSummary } = await import('../utils/companionSummary')
        const summary = loadSummary()
        if (summary && summary.lastUpdated >= journal.startedAt) {
          await this._removeSpecificMessages(new Set(survivorIds))
        }
      }

      localStorage.removeItem(STORAGE_KEYS.CONSOLIDATION_JOURNAL)
    } catch {
      try { localStorage.removeItem(STORAGE_KEYS.CONSOLIDATION_JOURNAL) } catch {}
    }
  }

  private _saveJournal(j: ConsolidationJournal): void {
    try { localStorage.setItem(STORAGE_KEYS.CONSOLIDATION_JOURNAL, JSON.stringify(j)) } catch {}
  }

  async clearAll(): Promise<boolean> {
    if (this.nativePlugin) {
      const result = await this.nativePlugin.clearAll()
      return result.success
    }
    const keys = Object.values(STORAGE_KEYS)
    for (const key of keys) {
      localStorage.removeItem(key)
    }
    this.messageCount = 0
    this.userMessageCount = 0
    this._lastConsolidatedUserCount = 0
    return true
  }

  private _consolidationQueue: Promise<void> = Promise.resolve()
  private _lastConsolidatedUserCount: number = 0
  private _maxMessages = 200

  consolidateIfNeeded(): void {
    if (this._lastConsolidatedUserCount >= this.userMessageCount) return
    void this._enqueueConsolidation()
  }

  private _enqueueConsolidation(): void {
    this._consolidationQueue = this._consolidationQueue.then(() =>
      this._doConsolidation()
    ).catch((e) => {
      console.warn('[CompanionMemory] consolidation failed', e)
    })
  }

  private async _doConsolidation(): Promise<void> {
    const snapshotCount = this.userMessageCount
    const lastDone = this._lastConsolidatedUserCount

    const nextReflection = Math.ceil((lastDone + 1) / this.reflectionThreshold) * this.reflectionThreshold
    const nextProfile = Math.ceil((lastDone + 1) / this.profileExtractionThreshold) * this.profileExtractionThreshold

    const tasks: Promise<void>[] = []

    if (snapshotCount >= nextReflection) {
      tasks.push(this.generateReflection().then(() => {}))
    }
    if (snapshotCount >= nextProfile) {
      tasks.push(this.extractUserProfile().then(() => {}))
    }

    const { loadSummary, generateSummary, shouldSummarize, saveSummary } = await import('../utils/companionSummary')

    const messages = await this.getRecentMessages(this._maxMessages + 50)
    const isOverflow = messages.length >= this._maxMessages
    const lastSummary = loadSummary()
    const needPeriodic = shouldSummarize(this.userMessageCount, lastSummary?.lastUpdated || 0)

    if (isOverflow || needPeriodic) {
      const removeCount = isOverflow
        ? Math.min(100, messages.length - 150)
        : 50
      const oldest = messages.slice(0, Math.min(removeCount, messages.length))

      if (oldest.length >= 10) {
        const idsToRemove = new Set(oldest.map(m => m.id))

        this._saveJournal({
          state: 'saving_summary',
          startedAt: Date.now(),
          oldestIds: Array.from(idsToRemove),
        })

        tasks.push((async () => {
          try {
            const existingSummary = loadSummary() || lastSummary
            const summary = await generateSummary(
              oldest.map(m => ({ role: m.role, content: m.content })),
              existingSummary,
            )
            if (summary) {
              saveSummary(summary)
              await this._removeSpecificMessages(idsToRemove)
            }
          } finally {
            try { localStorage.removeItem(STORAGE_KEYS.CONSOLIDATION_JOURNAL) } catch {}
          }
        })())
      }
    }

    await Promise.all(tasks)

    this._lastConsolidatedUserCount = Math.max(this._lastConsolidatedUserCount, snapshotCount)

    const afterMessages = await this.getRecentMessages(this._maxMessages + 50)
    if (afterMessages.length >= this._maxMessages || this._lastConsolidatedUserCount < this.userMessageCount) {
      this._enqueueConsolidation()
    }
  }

  async extractUserProfile(): Promise<UserProfile | null> {
    const snapshot = await this.getProfileSnapshotForExtraction()
    const apiKey = localStorage.getItem('deepseek_api_key')
    if (!apiKey) {
      console.warn('[CompanionMemory] DeepSeek API Key 未配置，跳过画像提取')
      return null
    }
    const baseUrl = localStorage.getItem('deepseek_base_url') || 'https://api.deepseek.com/v1'

    const conversationSummary = snapshot.recentMessages.slice(-40).map(m =>
      `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`
    ).join('\n')
    const factsSummary = snapshot.facts.map(f => `${f.key}: ${f.value}`).join('\n')
    const existingProfile = await this.getUserProfile()

    const systemPrompt = '你是一个用户画像分析专家。根据对话记录和已有事实，提取用户画像信息，以严格 JSON 格式返回。不要包含任何其他文字。'
    const userPrompt = `根据以下对话记录和已知事实，提取或更新用户的画像信息（5个维度）。

已有画像（可能部分为空）：
${JSON.stringify(existingProfile, null, 2)}

已知事实：
${factsSummary}

最近对话：
${conversationSummary}

请返回以下 JSON 结构（所有字段均为可选，未知的留空）：
{
  "basic": { "name": "", "age": "", "grade": "", "school": "" },
  "learning": { "subjects": [], "goals": [], "painPoints": [], "studyHabits": [] },
  "ability": { "strengths": [], "weaknesses": [], "skillLevel": {} },
  "personality": { "traits": [], "learningStyle": "", "communicationPreference": "" },
  "interests": { "hobbies": [], "favoriteSubjects": [], "extracurricular": [] }
}`

    try {
      const { llmFetchWithRetry } = await import('../utils/companionSummary')
      const result = await llmFetchWithRetry(
        () => fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            stream: false,
            response_format: { type: 'json_object' },
          }),
        }),
        (json) => {
          const content = json.choices?.[0]?.message?.content
          if (!content) return { success: false }
          try {
            const parsed: UserProfile = JSON.parse(content)
            return { success: true, value: parsed }
          } catch { return { success: false } }
        },
      )

      if (!result.success) {
        console.warn('[CompanionMemory] 画像提取请求失败')
        return null
      }

      const parsed = result.value
      const merged: UserProfile = {
        basic: { ...existingProfile?.basic, ...parsed.basic },
        learning: {
          subjects: [...new Set([...(existingProfile?.learning?.subjects || []), ...(parsed.learning?.subjects || [])])],
          goals: [...new Set([...(existingProfile?.learning?.goals || []), ...(parsed.learning?.goals || [])])],
          painPoints: [...new Set([...(existingProfile?.learning?.painPoints || []), ...(parsed.learning?.painPoints || [])])],
          studyHabits: [...new Set([...(existingProfile?.learning?.studyHabits || []), ...(parsed.learning?.studyHabits || [])])],
        },
        ability: {
          strengths: [...new Set([...(existingProfile?.ability?.strengths || []), ...(parsed.ability?.strengths || [])])],
          weaknesses: [...new Set([...(existingProfile?.ability?.weaknesses || []), ...(parsed.ability?.weaknesses || [])])],
          skillLevel: { ...existingProfile?.ability?.skillLevel, ...parsed.ability?.skillLevel },
        },
        personality: {
          traits: [...new Set([...(existingProfile?.personality?.traits || []), ...(parsed.personality?.traits || [])])],
          learningStyle: parsed.personality?.learningStyle || existingProfile?.personality?.learningStyle || '',
          communicationPreference: parsed.personality?.communicationPreference || existingProfile?.personality?.communicationPreference || '',
        },
        interests: {
          hobbies: [...new Set([...(existingProfile?.interests?.hobbies || []), ...(parsed.interests?.hobbies || [])])],
          favoriteSubjects: [...new Set([...(existingProfile?.interests?.favoriteSubjects || []), ...(parsed.interests?.favoriteSubjects || [])])],
          extracurricular: [...new Set([...(existingProfile?.interests?.extracurricular || []), ...(parsed.interests?.extracurricular || [])])],
        },
      }

      await this.saveUserProfile(merged)
      return merged
    } catch (e) {
      console.warn('[CompanionMemory] 画像提取异常', e)
      return null
    }
  }

  private async generateReflection(): Promise<ReflectionEntry | null> {
    const messages = await this.getRecentMessages(25)
    if (messages.length < 3) return null

    const apiKey = localStorage.getItem('deepseek_api_key')
    if (!apiKey) {
      console.warn('[CompanionMemory] DeepSeek API Key 未配置，跳过反思')
      return null
    }
    const baseUrl = localStorage.getItem('deepseek_base_url') || 'https://api.deepseek.com/v1'

    const conversationText = messages.map(m =>
      `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`
    ).join('\n')

    const systemPrompt = '你是一个学习伴侣反思助手。根据最近的对话，生成一段有洞察的反思总结，并提取关键事实。以严格 JSON 格式返回。'
    const userPrompt = `根据以下对话生成反思总结和提取的事实：

对话：
${conversationText}

返回 JSON：
{
  "reflection": "反思内容...",
  "facts": [
    { "key": "fact_key", "value": "事实描述" }
  ]
}`
    interface ParsedReflection { reflection: string; facts: { key: string; value: string }[] }

    try {
      const { llmFetchWithRetry } = await import('../utils/companionSummary')
      const result = await llmFetchWithRetry(
        () => fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            stream: false,
            response_format: { type: 'json_object' },
          }),
        }),
        (json) => {
          const content = json.choices?.[0]?.message?.content
          if (!content) return { success: false }
          try {
            const parsed: ParsedReflection = JSON.parse(content)
            return { success: true, value: parsed }
          } catch { return { success: false } }
        },
      )

      if (!result.success) return null

      const parsed = result.value
      const reflectionId = generateId()
      const reflection: ReflectionEntry = {
        id: reflectionId,
        content: parsed.reflection || '',
        createdAt: Date.now(),
        relatedFacts: [],
      }

      await this.addReflection(reflection)
      await this.extractFactsFromReflection(parsed.facts || [])
      return reflection
    } catch (e) {
      console.warn('[CompanionMemory] 反思生成异常', e)
      return null
    }
  }

  private async extractFactsFromReflection(facts: { key: string; value: string }[]): Promise<void> {
    if (facts.length === 0) return

    const existingItems = await this.getAllFacts()
    const existing = existingItems.map(f => ({ id: f.id, key: f.key, value: f.value }))

    let deduped = facts
    try {
      const { deduplicateFacts } = await import('../utils/companionSummary')
      deduped = await deduplicateFacts(
        facts.map(f => ({ key: f.key, value: f.value })),
        existing,
      )
    } catch {}

    for (const f of deduped) {
      if (!f.key || !f.value) continue
      const factItem: FactItem = {
        id: generateId(),
        key: f.key,
        value: f.value,
        source: 'reflection',
        createdAt: Date.now(),
      }
      await this.saveFact(factItem)
    }
  }
}
