// Agent / Companion types
export interface AgentStep {
  id: string
  type: 'thought' | 'action' | 'observation' | 'result'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  description: string
  detail: string
  tool?: string
  result?: string
}

export interface CompanionMessage {
  id: string
  role: 'user' | 'assistant' | 'companion' | 'system'
  content: string
  type: 'text' | 'image' | 'voice' | 'action'
  status: 'sending' | 'sent' | 'error' | 'failed'
  mediaUrl?: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface MemorySnapshot {
  key: string
  value: string
  updatedAt: number
}

// Vision types
export interface UIElement {
  type: string
  rect: { x: number; y: number; width: number; height: number }
  text?: string
}

export interface ScreenContent {
  elements: UIElement[]
  timestamp: number
}

// TTS types
export type TTSEngine = 'edge' | 'browser' | 'native'

export interface TTSConfig {
  engine: TTSEngine
  voice: string
  rate: number
  pitch: number
  volume: number
}

// Learning/Analytics types
export interface LearningOverview {
  totalDocuments: number
  totalChapters: number
  totalFlashcards: number
  totalStudyTime: number
  todayStudyTime: number
}

export interface AnalyticsResponse {
  overview: LearningOverview
  sessions: ReadingSession[]
}

export interface ReadingSession {
  id: number
  documentId: number
  documentTitle: string
  startTime: string
  endTime?: string
  chaptersRead: number
  duration: number
}

export interface ReadingRecord {
  id: number
  sessionId: number
  chapterId: number
  chapterTitle: string
  readAt: string
  duration: number
  progress: number
  is_completed: boolean
  end_time?: string
}
