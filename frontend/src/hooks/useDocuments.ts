import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, documentsApi } from '../api'
import type { DocumentDetail, DocumentList, Chapter, ChapterNavigation } from '../types'

export const DOCUMENTS_QUERY_KEY = ['documents']
export const DOCUMENT_QUERY_KEY = (id: number) => ['document', id]
export const CHAPTERS_QUERY_KEY = (documentId: number) => ['chapters', documentId]
export const CHAPTER_QUERY_KEY = (id: number) => ['chapter', id]
export const QUESTION_ANALYSIS_KEY = (chapterId: number) => ['question-analysis', chapterId]
export const CATEGORIES_QUERY_KEY = ['categories']
export const PUBLIC_DOCUMENTS_QUERY_KEY = ['public-documents']

export function useDocuments(skip = 0, limit = 100) {
    return useQuery({
        queryKey: DOCUMENTS_QUERY_KEY,
        queryFn: async () => {
            const result = await api.get<DocumentList>(`/api/v1/documents?skip=${skip}&limit=${limit}`)
            return result
        },
        staleTime: 0, // 不缓存，始终重新获取
        refetchOnMount: true,
    })
}

export function useCategories() {
    return useQuery({
        queryKey: CATEGORIES_QUERY_KEY,
        queryFn: async () => {
            const result = await documentsApi.getCategories()
            return result
        },
        staleTime: 0,
        refetchOnMount: true,
    })
}

export function usePublicDocuments() {
    return useQuery({
        queryKey: PUBLIC_DOCUMENTS_QUERY_KEY,
        queryFn: async () => {
            const result = await documentsApi.getPublicDocuments()
            return result
        },
        staleTime: 0,
        refetchOnMount: true,
    })
}

export function useDocument(documentId: number, fromSource?: string) {
    return useQuery({
        queryKey: DOCUMENT_QUERY_KEY(documentId),
        queryFn: async () => {
            const url = fromSource
                ? `/api/v1/documents/${documentId}?from_source=${fromSource}`
                : `/api/v1/documents/${documentId}`
            const result = await api.get<DocumentDetail>(url)
            return result
        },
        enabled: !!documentId,
        staleTime: 0, // 不缓存，始终重新获取
    })
}

export function useChapters(documentId: number) {
    return useQuery({
        queryKey: CHAPTERS_QUERY_KEY(documentId),
        queryFn: async () => {
            const result = await api.get<Chapter[]>(`/api/v1/documents/${documentId}/chapters`)
            return result
        },
        enabled: !!documentId,
        staleTime: 0, // 不缓存，始终重新获取
    })
}

export function useChapter(chapterId: number) {
    return useQuery({
        queryKey: CHAPTER_QUERY_KEY(chapterId),
        queryFn: async () => {
            const result = await api.get<Chapter>(`/api/v1/documents/chapters/${chapterId}`)
            return result
        },
        enabled: !!chapterId,
    })
}

export function useChapterNavigation(chapterId: number) {
    return useQuery({
        queryKey: ['chapter-navigation', chapterId],
        queryFn: async () => {
            const result = await api.get<ChapterNavigation>(`/api/v1/documents/chapters/${chapterId}/navigation`)
            return result
        },
        enabled: !!chapterId,
    })
}

export function useUploadDocument() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: { file: File; title?: string; category?: string; isPublic?: boolean }) => {
            const formData = new FormData()
            formData.append('file', data.file)
            if (data.title) {
                formData.append('title', data.title)
            }
            if (data.category) {
                formData.append('category', data.category)
            }
            if (data.isPublic !== undefined) {
                formData.append('is_public', data.isPublic.toString())
            }
            return api.postForm<{ success: boolean; document_id?: number; message: string }>(
                '/api/v1/documents/upload',
                formData
            )
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY })
            queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY })
            queryClient.invalidateQueries({ queryKey: PUBLIC_DOCUMENTS_QUERY_KEY })
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY })
            queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY })
            queryClient.invalidateQueries({ queryKey: PUBLIC_DOCUMENTS_QUERY_KEY })
        },
    })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: number) => {
      return api.delete<{ success: boolean; message: string }>(
        `/api/v1/documents/${documentId}`
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY })
    },
  })
}

export function useUpdateLastReadChapter() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: { documentId: number; chapterId: number }) => {
      return api.put<{ success: boolean; message: string }>(
        `/api/v1/documents/${data.documentId}/last-read?chapter_id=${data.chapterId}`
      )
    },
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: DOCUMENT_QUERY_KEY(documentId) })
    },
  })
}

export function useTogglePublicStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: { documentId: number; isPublic?: boolean }) => {
      return documentsApi.togglePublicStatus(data.documentId, data.isPublic)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: PUBLIC_DOCUMENTS_QUERY_KEY })
    },
  })
}

export interface QuestionAnalysis {
  knowledge_points: string[]
  analysis: string
  answer: string | null
  related_questions: Array<{
    id: string
    content: string
    distance: number
    metadata?: Record<string, any>
  }>
  related_paragraphs: Array<{
    id: string
    content: string
    distance: number
    metadata?: Record<string, any>
  }>
}

export function useReparseSomark() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: { documentId: number; useRuleParsing?: boolean }) => {
      return api.post<{ success: boolean; message: string }>(
        `/api/v1/documents/${data.documentId}/reparse-somark?use_rule_parsing=${data.useRuleParsing ?? true}`
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY })
    },
  })
}

export function useQuestionAnalysis(chapterId: number | null, fetchTrigger: number) {
  return useQuery({
    queryKey: QUESTION_ANALYSIS_KEY(chapterId || 0),
    queryFn: async () => {
      if (!chapterId) {
        return null
      }
      const result = await api.post<QuestionAnalysis>('/api/v1/analysis/analyze-question', {
        question: '',
        options: null,
        answer: null,
        knowledge_points: null
      })
      return result
    },
    enabled: fetchTrigger > 0,
    staleTime: 5 * 60 * 1000
  })
}
