import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, documentsApi } from '../../api'

interface DocumentItem {
  id: number
  title: string
  filename: string
  file_type: string
  category: string
  status: string
  created_at: string
}

interface ApiResponse<T> {
  code?: number
  data?: T
  documents?: T
  [key: string]: unknown
}

export default function GameSelect() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'my' | 'public'>('my')
  const [myDocuments, setMyDocuments] = useState<DocumentItem[]>([])
  const [publicDocuments, setPublicDocuments] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedFileType, setSelectedFileType] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [parseMode, setParseMode] = useState<'normal' | 'smart'>('normal')
  const [isPptx, setIsPptx] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchDocuments()
  }, [])

  const fetchDocuments = async () => {
    setLoading(true)
    try {
      const [myRes, pubRes] = await Promise.allSettled([
        api.get<ApiResponse<DocumentItem[]>>('/api/v1/documents?limit=100'),
        documentsApi.getPublicDocuments(),
      ])

      if (myRes.status === 'fulfilled') {
        const myData = myRes.value
        const docs = myData.items || myData.documents || myData.data || []
        setMyDocuments(Array.isArray(docs) ? docs : [])
      }

      if (pubRes.status === 'fulfilled') {
        const pubData = pubRes.value
        const docs = pubData.documents || pubData.data || pubData
        if (Array.isArray(docs)) {
          setPublicDocuments(docs)
        } else if (typeof docs === 'object' && docs !== null) {
          const allDocs: DocumentItem[] = []
          const raw = docs as Record<string, unknown>
          for (const key of Object.keys(raw)) {
            const items = raw[key]
            if (Array.isArray(items)) allDocs.push(...items)
          }
          setPublicDocuments(allDocs)
        }
      }
    } catch (err) {
      console.error('获取文档列表失败', err)
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const result = await api.postForm<{ success: boolean; document_id: number }>('/api/v1/documents/upload-only', formData)
      if (result && result.document_id) {
        await fetchDocuments()
        setSelectedId(result.document_id)
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        const isPpt = ext === 'ppt' || ext === 'pptx'
        setSelectedFileType(isPpt ? 'pptx' : '')
        if (isPpt) {
          setIsPptx(true)
          setParseMode('smart')
        } else {
          setIsPptx(false)
        }
      }
    } catch (err) {
      console.error('上传失败', err)
      alert('上传文档失败，请重试')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleStartReading = () => {
    if (!selectedId) return
    navigate(`/game/character?docId=${selectedId}&parseMode=${parseMode}`)
  }

  const documents = activeTab === 'my' ? myDocuments : publicDocuments

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50 overflow-y-auto">
      <div className="relative min-h-full pb-40">
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-pink-200">
          <div className="flex items-center px-4 h-14">
            <button
              onClick={() => navigate('/game')}
              className="p-2 -ml-2 text-pink-400 hover:text-pink-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="ml-2 text-lg font-semibold text-pink-700">选择文档</h1>
          </div>

          <div className="flex px-4 gap-1">
            <button
              onClick={() => setActiveTab('my')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'my'
                  ? 'text-pink-600 border-pink-400'
                  : 'text-pink-300 border-transparent hover:text-pink-400'
              }`}
            >
              我的文档
            </button>
            <button
              onClick={() => setActiveTab('public')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'public'
                  ? 'text-pink-600 border-pink-400'
                  : 'text-pink-300 border-transparent hover:text-pink-400'
              }`}
            >
              公共文档库
            </button>
          </div>
        </div>

        {activeTab === 'my' && (
          <div className="px-4 py-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-3 rounded-xl border-2 border-dashed border-pink-300 text-pink-400 hover:border-pink-400 hover:text-pink-600 active:scale-[0.99] transition-all duration-200 disabled:opacity-50 bg-white/40"
            >
              {uploading ? '上传中...' : '+ 上传文档'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.ppt,.pptx"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        )}

        <div className="px-4 space-y-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-pink-300 border-t-pink-400 rounded-full animate-spin" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12 text-pink-300">
              <p>{activeTab === 'my' ? '还没有文档，点击上方按钮上传' : '暂无公共文档'}</p>
            </div>
          ) : (
            documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => {
                  setSelectedId(doc.id)
                  const isPpt = doc.file_type === 'pptx'
                  setSelectedFileType(isPpt ? 'pptx' : '')
                  if (isPpt) {
                    setIsPptx(true)
                    setParseMode('smart')
                  } else {
                    setIsPptx(false)
                  }
                }}
                className={`w-full text-left p-4 rounded-xl border transition-all duration-200 ${
                  selectedId === doc.id
                    ? 'bg-pink-50 border-pink-400 shadow-lg shadow-pink-200/30'
                    : 'bg-white/60 border-pink-200 hover:bg-white hover:border-pink-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
                    selectedId === doc.id ? 'bg-pink-100' : 'bg-pink-50'
                  }`}>
                    {doc.file_type === 'pdf' ? '📄' : doc.file_type === 'docx' ? '📝' : '📃'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-pink-700 truncate">{doc.title || doc.filename}</p>
                    <p className="text-xs text-pink-300 mt-0.5">
                      {doc.file_type?.toUpperCase()}
                      {doc.category ? ` · ${doc.category}` : ''}
                    </p>
                  </div>
                  {selectedId === doc.id && (
                    <svg className="w-5 h-5 text-pink-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-pink-200 px-4 py-4 space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => { if (!isPptx) setParseMode('normal') }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all duration-200 ${
                parseMode === 'normal'
                  ? 'bg-pink-50 border-pink-400 text-pink-600'
                  : isPptx
                    ? 'bg-gray-100 border-gray-200 text-gray-300 cursor-not-allowed'
                    : 'bg-white/60 border-pink-200 text-pink-300 hover:bg-white/80'
              }`}
              disabled={isPptx}
            >
              普通解析
              {isPptx && <span className="block text-[10px] font-normal text-gray-300">PPT 不支持</span>}
            </button>
            <button
              onClick={() => setParseMode('smart')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all duration-200 ${
                parseMode === 'smart'
                  ? 'bg-pink-50 border-pink-400 text-pink-600'
                  : 'bg-white/60 border-pink-200 text-pink-300 hover:bg-white/80'
              }`}
            >
              智能解析
              {isPptx && <span className="block text-[10px] font-normal text-green-500">推荐</span>}
            </button>
          </div>

          <div className="text-xs text-center text-pink-300">
            {isPptx
              ? 'PPT 文件使用 SoMark 智能解析以保证最佳效果'
              : parseMode === 'normal'
                ? '直接提取文档原文，AI 自动生成视觉小说'
                : '使用 SoMark 智能解析文档结构，AI 生成更精准的视觉小说'}
          </div>

          <button
            onClick={handleStartReading}
            disabled={!selectedId}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-400 to-pink-500 text-white font-semibold shadow-lg shadow-pink-300/30 hover:shadow-xl hover:shadow-pink-300/40 hover:from-pink-300 hover:to-pink-400 active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            开始阅读
          </button>
        </div>
      </div>
    </div>
  )
}
