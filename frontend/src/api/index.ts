const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = localStorage.getItem('token')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return headers
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    }

    // 解析错误消息
    let errorMessage = '请求失败'
    try {
      const errorData = await response.json()
      errorMessage = errorData.detail || errorData.message || errorMessage
    } catch {
      errorMessage = await response.text() || errorMessage
    }

    // 检测 API Key 缺失错误，触发全局弹窗
    if (
      errorMessage.includes('个人设置中配置你的') ||
      errorMessage.includes('API Key')
    ) {
      const missingKeys: ('deepseek' | 'somark' | 'ark')[] = []
      if (errorMessage.includes('DeepSeek')) missingKeys.push('deepseek')
      if (errorMessage.includes('SoMark') || errorMessage.includes('文档解析')) missingKeys.push('somark')
      if (errorMessage.includes('火山引擎') || errorMessage.includes('AI 生图')) missingKeys.push('ark')
      if (missingKeys.length === 0) missingKeys.push('deepseek', 'somark', 'ark')
      window.dispatchEvent(new CustomEvent('api-key-missing', { detail: { missingKeys } }))
    }

    const err = new Error(errorMessage) as any
    err.status = response.status
    throw err
  }
  return response.json()
}

export const api = {
    async get<T>(url: string, signal?: AbortSignal): Promise<T> {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            headers: getAuthHeaders(),
            signal,
        })
        return handleResponse<T>(response)
    },

    async post<T>(url: string, data?: any): Promise<T> {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: data ? JSON.stringify(data) : undefined,
        })
        return handleResponse<T>(response)
    },

    async postForm<T>(url: string, formData: FormData): Promise<T> {
        const token = localStorage.getItem('token')
        const headers: Record<string, string> = {}
        if (token) {
            headers['Authorization'] = `Bearer ${token}`
        }

        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'POST',
            body: formData,
            headers,
        })
        return handleResponse<T>(response)
    },

    async delete<T>(url: string): Promise<T> {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        })
        return handleResponse<T>(response)
    },

    async put<T>(url: string, data?: any): Promise<T> {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: data ? JSON.stringify(data) : undefined,
        })
        return handleResponse<T>(response)
    },

    async putForm<T>(url: string, formData: FormData): Promise<T> {
        const token = localStorage.getItem('token')
        const headers: Record<string, string> = {}
        if (token) {
            headers['Authorization'] = `Bearer ${token}`
        }

        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'PUT',
            body: formData,
            headers,
        })
        return handleResponse<T>(response)
    },

    async patch<T>(url: string, data?: any): Promise<T> {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: data ? JSON.stringify(data) : undefined,
        })
        return handleResponse<T>(response)
    },
}

export const documentsApi = {
    async getCategories(): Promise<string[]> {
        return api.get('/api/v1/documents/categories')
    },
    async getPublicDocuments(): Promise<Record<string, any[]>> {
        return api.get('/api/v1/documents/public')
    },
    async getPopularDocuments(limit: number = 3): Promise<any[]> {
        return api.get(`/api/v1/documents/popular?limit=${limit}`)
    },
    async togglePublicStatus(documentId: number, isPublic?: boolean): Promise<{
        success: boolean;
        message: string;
        is_public: boolean;
    }> {
        const params = isPublic !== undefined ? `?is_public=${isPublic}` : ''
        return api.put(`/api/v1/documents/${documentId}/public${params}`)
    },
    async incrementViewCount(documentId: number): Promise<{
        success: boolean;
        view_count: number;
    }> {
        return api.post(`/api/v1/documents/${documentId}/view`)
    },
    async searchDocuments(q: string): Promise<any[]> {
        return api.get(`/api/v1/documents/search?q=${encodeURIComponent(q)}`)
    },
    async getMindmap(documentId: number): Promise<{
        success: boolean;
        message: string;
        status?: 'generating' | 'completed' | 'not_generated' | 'failed';
        data: string | null;
    }> {
        return api.get(`/api/v1/documents/${documentId}/mindmap`)
    },
    async generateMindmap(documentId: number, model?: string): Promise<{
        success: boolean;
        message: string;
        data?: string;
    }> {
        return api.post(`/api/v1/documents/${documentId}/mindmap/generate`, { model })
    },
    async regenerateMindmap(documentId: number, model?: string): Promise<{
        success: boolean;
        message: string;
        data?: string;
    }> {
        return api.post(`/api/v1/documents/${documentId}/mindmap/regenerate`, { model })
    },
}

export interface UserInfo {
  id: number
  email: string
  username: string
  is_active: boolean
  is_verified: boolean
  player_title: string
  api_key?: string
  tts_api_key?: string
  deepseek_api_key?: string
  somark_api_key?: string
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: UserInfo
}

export const authApi = {
  async login(username: string, password: string): Promise<AuthResponse> {
    return api.post<AuthResponse>('/api/v1/auth/login', { username, password })
  },

  async register(data: {
    username: string
    email: string
    password: string
    verification_code: string
  }): Promise<AuthResponse> {
    return api.post<AuthResponse>('/api/v1/auth/register', data)
  },

  async getCurrentUser(): Promise<UserInfo> {
    return api.get<UserInfo>('/api/v1/auth/me')
  },

  async sendVerificationCode(email: string): Promise<{ success: boolean; message: string }> {
    return api.post('/api/v1/email/send-code', { email })
  },

  async sendResetCode(email: string): Promise<{ success: boolean; message: string }> {
    return api.post('/api/v1/email/send-reset-code', { email })
  },

  async resetPassword(data: {
    email: string
    verification_code: string
    new_password: string
  }): Promise<{ success: boolean; message: string }> {
    return api.post('/api/v1/auth/reset-password', data)
  },

  async updateSettings(settings: { player_title: string; api_key?: string; tts_api_key?: string; deepseek_api_key?: string; somark_api_key?: string }): Promise<UserInfo> {
    return api.put<UserInfo>('/api/v1/auth/me/settings', settings)
  }
}

export interface GameQuestion {
  text: string
  options: { id: string; text: string }[]
  correct_id: string
  error_hints: Record<string, string>
  on_correct: string
  correct_expression?: string
  error_expressions?: Record<string, string>
}

export interface GameSection {
  text?: string
  character?: string
  expression?: string
  type?: string
  cg_images?: string[]
  character_id?: number
  character_name?: string
  portrait_url?: string
  expressions?: string[]
  expression_descriptions?: string[]
  speaker_id?: string
  voice_status?: string
  voice_sample_url?: string
  is_default?: boolean
  question?: GameQuestion
  background?: string
}

export interface GameContentResponse {
  code: number
  data: {
    document_title: string
    sections: GameSection[]
  }
}

export interface GameTaskResponse {
  task_id: number
  status: string
  document_title: string
  created_at: string
}

export interface GameTaskStatusResponse {
  task_id: number
  status: string
  document_title: string
  error_message?: string
  created_at: string
  updated_at?: string
}

export interface GameSaveListItem {
  id: number
  uid?: string
  document_id: number
  document_title: string
  parse_mode: string
  status: string
  is_public: boolean
  owner_id: number
  created_at: string
  updated_at?: string
}

export interface GameSaveDetailResponse {
  id: number
  document_id: number
  document_title: string
  parse_mode: string
  status: string
  sections?: GameSection[]
  error_message?: string
  created_at: string
  updated_at?: string
}

export interface CharacterResponse {
    id: number;
    uid: string;
    owner_id: number;
    name: string;
    description?: string | null;
    portrait_url: string;
    prompt: string;
    expressions: string[];
    expression_descriptions: string[];
    cg_images: string[];
    speaker_id: string | null;
    voice_status: string | null;
    voice_sample_url: string | null;
    is_public: boolean;
    is_default: boolean;
    created_at: string;
    updated_at: string | null;
}

export interface CharacterListResponse {
    characters: CharacterResponse[];
}

export interface BorrowByUidRequest {
    uid: string;
}

export const characterApi = {
    list: (tab: string = 'my'): Promise<CharacterListResponse> =>
        api.get<CharacterListResponse>(`/api/v1/characters?tab=${tab}`),
    get: (id: number): Promise<CharacterResponse> =>
        api.get<CharacterResponse>(`/api/v1/characters/${id}`),
    create: (formData: FormData): Promise<CharacterResponse> =>
        api.postForm<CharacterResponse>('/api/v1/characters', formData),
    update: (id: number, formData: FormData): Promise<CharacterResponse> =>
        api.putForm<CharacterResponse>(`/api/v1/characters/${id}`, formData),
    delete: (id: number): Promise<void> =>
        api.delete<void>(`/api/v1/characters/${id}`),
    borrow: (id: number): Promise<CharacterResponse> =>
        api.post<CharacterResponse>(`/api/v1/characters/${id}/borrow`),
    borrowByUid: (uid: string): Promise<CharacterResponse> =>
        api.post<CharacterResponse>('/api/v1/characters/borrow-by-uid', { uid }),
    removeBorrow: (characterId: number): Promise<void> =>
        api.post<void>(`/api/v1/characters/${characterId}/remove-borrow`),

    setSpeakerId: (characterId: number, speakerId: string): Promise<CharacterResponse> =>
        api.patch<CharacterResponse>(`/api/v1/characters/${characterId}/speaker-id`, { speaker_id: speakerId }),
    searchByUid: (uid: string): Promise<CharacterResponse> =>
        api.get<CharacterResponse>(`/api/v1/characters/search/by-uid?uid=${encodeURIComponent(uid)}`),
};

export const gameApi = {
    async getGameContent(documentId: number, parseMode?: string, signal?: AbortSignal, characterId?: number): Promise<GameContentResponse> {
        const params = new URLSearchParams()
        if (parseMode) params.set('parse_mode', parseMode)
        if (characterId) params.set('character_id', String(characterId))
        const qs = params.toString()
        return api.get<GameContentResponse>(`/api/v1/game/read/${documentId}${qs ? `?${qs}` : ''}`, signal)
    },

    async createTask(documentId: number, parseMode: string = 'smart', characterId?: number): Promise<GameTaskResponse> {
        return api.post<GameTaskResponse>('/api/v1/game/tasks', { document_id: documentId, parse_mode: parseMode, character_id: characterId })
    },

    async getTaskStatus(taskId: number): Promise<GameTaskStatusResponse> {
        return api.get<GameTaskStatusResponse>(`/api/v1/game/tasks/${taskId}`)
    },

    async listSaves(): Promise<{ saves: GameSaveListItem[] }> {
        return api.get<{ saves: GameSaveListItem[] }>('/api/v1/game/saves')
    },

    async getSaveDetail(saveId: number): Promise<GameSaveDetailResponse> {
        return api.get<GameSaveDetailResponse>(`/api/v1/game/saves/${saveId}`)
    },

    async deleteSave(saveId: number): Promise<void> {
        return api.delete<void>(`/api/v1/game/saves/${saveId}`)
    },
    async borrowSave(saveUid: string): Promise<GameSaveListItem> {
        return api.post<GameSaveListItem>('/api/v1/game/saves/borrow', { save_uid: saveUid })
    },
    async askQuestion(data: {
        character_name: string
        character_desc: string
        sections: GameSection[]
        current_section_index: number
        user_question: string
        ending_text: string
        expression_descriptions?: string[]
    }): Promise<{ data: { reply: string; expression?: string } }> {
        return api.post<{ data: { reply: string; expression?: string } }>('/api/v1/game/ask', data)
    },

    async listBgm(): Promise<{ code: number; data: { filename: string; name: string }[] }> {
        return api.get('/api/v1/game/bgm/list')
    },

    getBgmUrl(filename: string): string {
        const base = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
        return `${base}/api/v1/game/bgm/${filename}`
    }
}

import type { LearningOverview, AnalyticsResponse, ReadingSession, ReadingRecord } from '../types'

export interface TTSResponse {
    code: number;
    data?: any;
}

export const ttsApi = {
    async synthesize(text: string, speakerId: string, _characterId?: number, _encoding?: string, _speedRatio?: number): Promise<Blob> {
        const TTS_KEY = import.meta.env.VITE_TTS_API_KEY || ''
        const response = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': TTS_KEY,
                'X-Api-Resource-Id': 'seed-icl-2.0',
            },
            body: JSON.stringify({
                req_params: {
                    text,
                    speaker: speakerId,
                    audio_params: { format: 'mp3', sample_rate: 24000 },
                },
            }),
        })
        if (!response.ok) {
            throw new Error('语音合成失败')
        }
        return response.blob()
    },

    getAudioUrl(filename: string): string {
        const base = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
        return `${base}/api/v1/tts/audio/${filename}`
    },

    getKeyStatus(): Promise<Record<string, any>> {
        return api.get('/api/v1/tts/key-status')
    }
}

export const analyticsApi = {
  async getOverview(): Promise<LearningOverview> {
    return api.get<LearningOverview>('/api/v1/analysis/overview')
  },

  async getAnalytics(): Promise<AnalyticsResponse> {
    return api.get<AnalyticsResponse>('/api/v1/analysis/analytics')
  },

  async getDocumentProgress(documentId: number): Promise<{
    document_id: number
    total_chapters: number
    read_chapters: number
    progress_percent: number
  }> {
    return api.get(`/api/v1/analysis/documents/${documentId}/progress`)
  },

  async getAllDocumentsProgress(): Promise<{
    documents: Array<{
      document_id: number
      total_chapters: number
      read_chapters: number
      progress_percent: number
    }>
  }> {
    return api.get('/api/v1/analysis/documents/progress')
  },

  async createSession(documentId: number): Promise<ReadingSession> {
    return api.post<ReadingSession>('/api/v1/analysis/sessions', { document_id: documentId })
  },

  async endSession(sessionId: number): Promise<ReadingSession> {
    return api.put<ReadingSession>(`/api/v1/analysis/sessions/${sessionId}/end`)
  },

  async createReadingRecord(sessionId: number, chapterId: number): Promise<ReadingRecord> {
    return api.post<ReadingRecord>('/api/v1/analysis/records', {
      session_id: sessionId,
      chapter_id: chapterId
    })
  },

  async updateReadingRecord(
    recordId: number,
    data: Partial<Pick<ReadingRecord, 'end_time' | 'duration' | 'is_completed' | 'progress'>>
  ): Promise<ReadingRecord> {
    return api.put<ReadingRecord>(`/api/v1/analysis/records/${recordId}`, data)
  }
}
