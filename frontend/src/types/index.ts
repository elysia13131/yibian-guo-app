export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  message?: string
}

export type DocumentStatus = 'waiting' | 'parsing' | 'completed' | 'failed'
export type DocumentType = 'pdf' | 'docx' | 'txt' | 'md'

export interface Document {
    id: number
    owner_id: number
    title: string
    filename: string
    file_path: string
    file_type: DocumentType
    file_size?: number
    status: DocumentStatus
    error_message?: string
    created_at: string
    updated_at?: string
    parsed_at?: string
    last_read_chapter_id?: number
    category?: string
    is_public: boolean
    view_count: number
}

export interface Chapter {
  id: number
  document_id: number
  title?: string
  content: string
  level: number
  order_index: number
  parent_id?: number
  start_offset?: number
  end_offset?: number
  created_at: string
  children: Chapter[]
}

export interface DocumentDetail extends Document {
  chapters: Chapter[]
}

export interface DocumentList {
  total: number
  items: Document[]
}

export interface ChapterNavigation {
  current?: Chapter
  previous?: Chapter
  next?: Chapter
}

export interface ReadingSession {
  id: number
  document_id: number
  start_time: string
  end_time?: string
  total_duration: number
}

export interface ReadingRecord {
  id: number
  session_id: number
  chapter_id: number
  start_time: string
  end_time?: string
  duration: number
  is_completed: boolean
  progress: number
}

export interface DailyStats {
  id: number
  date: string
  total_duration: number
  chapters_read: number
  documents_accessed: number
  created_at: string
  updated_at?: string
}

export interface LearningOverview {
  total_study_minutes: number
  weekly_study_minutes: number
  study_minutes_change: number
  study_efficiency: number
  efficiency_change: number
  consecutive_study_days: number
  total_chapters_read: number
  total_documents_accessed: number
}

export interface WeeklyStats {
  day: string
  minutes: number
}

export interface Achievement {
  title: string
  icon: string
  unlocked: boolean
}

export interface AnalyticsResponse {
  overview: LearningOverview
  weekly_data: WeeklyStats[]
  achievements: Achievement[]
}

export interface Flashcard {
  id: number
  question: string
  answer: string
  document_id: number
  chapter_id: number | null
  source_text: string | null
  is_public: boolean
  owner_id: number
  group_id: number | null
  ai_generated: boolean
  confidence: number | null
  // 选择题字段
  is_multiple_choice: boolean
  is_multiple: boolean
  options: { label: string; text: string }[] | null
  correct_option_label: string | null
  correct_option_labels: string[] | null
  // FSRS参数
  difficulty: number
  stability: number
  retrievability: number
  due: string | null
  elapsed_days: number
  scheduled_days: number
  reps: number
  lapses: number
  // 状态
  status: string
  last_reviewed: string | null
  next_review: string | null
  // 时间戳
  created_at: string
  updated_at: string | null
}

export interface FlashcardStats {
  total_cards: number
  new_cards: number
  learning_cards: number
  review_cards: number
  due_today: number
  overdue: number
  avg_confidence: number
  total_reviews: number
  avg_rating: number | null
}

export interface ReviewLog {
  id: number
  flashcard_id: number
  rating: string
  duration_seconds: number
  difficulty_before: number | null
  difficulty_after: number | null
  stability_before: number | null
  stability_after: number | null
  retrievability_before: number | null
  retrievability_after: number | null
  elapsed_days: number | null
  scheduled_days: number | null
  status_before: string | null
  status_after: string | null
  review_time: string
  ip_address: string | null
  user_agent: string | null
}

export interface CardGroup {
  id: number
  name: string
  description: string | null
  document_id: number
  owner_id: number
  card_count: number
  is_public: boolean
  created_at: string
  updated_at: string | null
  category?: string | null
  document_title?: string | null
}

export interface CardGroupWithFlashcards extends CardGroup {
  flashcards: Flashcard[]
}

export interface GenerationTask {
  id: number
  document_id: number
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  total_chunks: number
  processed_chunks: number
  total_cards: number
  max_cards: number
  focus_text: string | null
  error_message: string | null
  created_at: string
}

export interface GenerationTaskList {
  tasks: GenerationTask[]
  active_count: number
}

export interface PagedResponse<T> {
  items: T[]
  total: number
}
