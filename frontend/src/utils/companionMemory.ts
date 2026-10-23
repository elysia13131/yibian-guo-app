import { MemorySnapshot } from '../types'

const STORAGE_KEY = 'companion_memory'

const DEFAULT_MEMORY: MemorySnapshot = {
  working: {
    recentMessages: [],
    currentTopic: '',
    lastInteractAt: ''
  },
  facts: {
    userName: '',
    userPreferences: [],
    learnedTopics: []
  },
  persona: {
    characterName: '灵枢',
    characterDesc: '温柔聪明的 AI 学习伴侣',
    systemPrompt: ''
  }
}

export function loadMemory(): MemorySnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_MEMORY, working: { ...DEFAULT_MEMORY.working }, facts: { ...DEFAULT_MEMORY.facts }, persona: { ...DEFAULT_MEMORY.persona } }
    return JSON.parse(raw) as MemorySnapshot
  } catch {
    return { ...DEFAULT_MEMORY, working: { ...DEFAULT_MEMORY.working }, facts: { ...DEFAULT_MEMORY.facts }, persona: { ...DEFAULT_MEMORY.persona } }
  }
}

export function saveMemory(memory: MemorySnapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
}

export function updateRecentMessages(memory: MemorySnapshot, role: string, content: string): MemorySnapshot {
  const recent = memory.working?.recentMessages || []
  const updated = {
    ...memory,
    working: {
      ...memory.working,
      recentMessages: [...recent, { role, content }].slice(-40)
    }
  }
  return updated
}

export function updateUserFacts(
  memory: MemorySnapshot,
  userName?: string,
  preferences?: string[],
  topics?: string[]
): MemorySnapshot {
  const updated: MemorySnapshot = {
    ...memory,
    facts: {
      ...memory.facts,
      ...(userName !== undefined ? { userName } : {}),
      ...(preferences !== undefined ? { userPreferences: [...new Set(preferences)] } : {}),
      ...(topics !== undefined ? { learnedTopics: [...new Set(topics)] } : {})
    }
  }
  return updated
}

const STICKERS_KEY = 'companion_stickers'

export interface StickerItem {
  id: string
  dataUrl: string
  createdAt: number
}

export function loadStickers(): StickerItem[] {
  try {
    const raw = localStorage.getItem(STICKERS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveSticker(dataUrl: string): StickerItem[] {
  const stickers = loadStickers()
  const item: StickerItem = { id: `st_${Date.now()}`, dataUrl, createdAt: Date.now() }
  const updated = [item, ...stickers].slice(0, 50)
  localStorage.setItem(STICKERS_KEY, JSON.stringify(updated))
  return updated
}

export function removeSticker(id: string): StickerItem[] {
  const stickers = loadStickers().filter(s => s.id !== id)
  localStorage.setItem(STICKERS_KEY, JSON.stringify(stickers))
  return stickers
}
