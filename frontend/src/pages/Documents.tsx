import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, FileText, AlertCircle, CheckCircle, Clock, RefreshCw, Trash2, ArrowLeft, Eye, EyeOff, Camera, ChevronUp, ChevronDown, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useDocuments, useUploadDocument, useDeleteDocument, useCategories, useTogglePublicStatus, useReparseSomark } from '../hooks/useDocuments'
import { analyticsApi } from '../api'
import type { DocumentStatus } from '../types'
import PageTransition from '../components/PageTransition'
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from '@capacitor/camera'
import { IntentHandler } from '../plugins/IntentHandler'

interface UploadProgress {
    documentId: number
    progress: number
    status: string
    message: string
}

interface ReadingProgressInfo {
    total_chapters: number
    read_chapters: number
    progress_percent: number
}

const statusConfig: Record<DocumentStatus, { label: string; icon: any; color: string; bg: string }> = {
    waiting: {
        label: '等待解析',
        icon: Clock,
        color: 'text-yellow-600',
        bg: 'bg-yellow-100',
    },
    parsing: {
        label: '解析中',
        icon: RefreshCw,
        color: 'text-blue-600',
        bg: 'bg-blue-100',
    },
    completed: {
        label: '解析完成',
        icon: CheckCircle,
        color: 'text-green-600',
        bg: 'bg-green-100',
    },
    failed: {
        label: '解析失败',
        icon: AlertCircle,
        color: 'text-red-600',
        bg: 'bg-red-100',
    },
}

const fileTypeIcons: Record<string, string> = {
    pdf: '📄',
    docx: '📝',
    txt: '📃',
    md: '📑',
}

export default function DocumentsPage() {
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const [showUpload, setShowUpload] = useState(false)
    const [uploadMode, setUploadMode] = useState<'file' | 'photo'>('file')
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [photos, setPhotos] = useState<{ id: string; file: File; preview: string }[]>([])
    const [title, setTitle] = useState('')
    const [category, setCategory] = useState('')
    const [isPublic, setIsPublic] = useState(false)
    const [uploadProgress, setUploadProgress] = useState<Record<number, UploadProgress>>({})
    const [optimisticDocuments, setOptimisticDocuments] = useState<any[]>([])
    const wsRef = useRef<Map<number, WebSocket>>(new Map())
    const photoInputRef = useRef<HTMLInputElement>(null)
    const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; docId: number }>({
        show: false,
        docId: 0
    })
    // 临时状态，用于临时更新文档状态为解析中
    const [tempParsingDocs, setTempParsingDocs] = useState<Set<number>>(new Set())
    // 本地上传状态，避免全局 mutation isPending 影响对话框
    const [isUploading, setIsUploading] = useState(false)
    // 本地删除状态，避免 mutation 卡住导致所有删除按钮禁用
    const [isDeleting, setIsDeleting] = useState(false)
    
    // 阅读进度状态
    const [readingProgress, setReadingProgress] = useState<Record<number, ReadingProgressInfo>>({})

    const { data: documents, isLoading, refetch } = useDocuments()
    const { data: categories } = useCategories()
    const uploadMutation = useUploadDocument()
    const deleteMutation = useDeleteDocument()
    const togglePublicMutation = useTogglePublicStatus()
    const reparseSomarkMutation = useReparseSomark()

  // 合并真实文档和乐观更新的文档
  const mergedDocuments = {
    ...documents,
    items: [
      ...optimisticDocuments,
      ...(documents?.items || []).filter(d => !optimisticDocuments.some(od => od.id === d.id))
    ]
  }

  // 使用 ref 存储所有的进度 interval，方便清理
  const progressIntervalsRef = useRef<Map<number, NodeJS.Timeout>>(new Map())
  // 存储 tempId 到真实 documentId 的映射
  const tempIdToRealIdRef = useRef<Map<number, number>>(new Map())

  // 检测外部分享的文件，自动打开上传弹窗
  useEffect(() => {
    const isShared = searchParams.get('sharedFile')
    if (isShared !== '1') return
    
    const handleSharedFile = async () => {
      try {
        // 先清理旧数据
        setSelectedFile(null)
        setTitle('')
        
        const result = await IntentHandler.readSharedFile()
        if (!result.data) return
        
        // base64 → Uint8Array → File
        const binaryStr = atob(result.data)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i)
        }
        const file = new File([bytes], result.name, { type: result.mimeType })
        setSelectedFile(file)
        setShowUpload(true)
        setUploadMode('file')
        
        // 清除 URL 参数避免重复触发
        const newParams = new URLSearchParams(searchParams)
        newParams.delete('sharedFile')
        setSearchParams(newParams, { replace: true })
        
        // 清除插件中的暂存
        IntentHandler.clearPendingSharedFile()
      } catch (e) {
        console.error('[Documents] 读取分享文件失败:', e)
      }
    }
    handleSharedFile()
  }, [searchParams])

  // 监听真实文档出现，自动移除对应的乐观文档
  useEffect(() => {
    if (!documents?.items || !optimisticDocuments.length) return
    
    const optimisticDocsToRemove: any[] = []
    
    optimisticDocuments.forEach(od => {
      if (!od.tempId) return
      
      // 检查是否有对应的真实 documentId
      const realDocId = tempIdToRealIdRef.current.get(od.tempId)
      if (realDocId && documents.items.some(d => d.id === realDocId)) {
        optimisticDocsToRemove.push(od)
      }
    })
    
    if (optimisticDocsToRemove.length > 0) {
      console.log('🗑️ 自动移除乐观文档:', optimisticDocsToRemove.map(d => ({ tempId: d.tempId, title: d.title })))
      
      // 清理对应的进度 interval 和映射
      optimisticDocsToRemove.forEach(od => {
        if (od.tempId && progressIntervalsRef.current.has(od.tempId)) {
          clearInterval(progressIntervalsRef.current.get(od.tempId)!)
          progressIntervalsRef.current.delete(od.tempId)
          tempIdToRealIdRef.current.delete(od.tempId)
        }
      })
      
      setOptimisticDocuments(prev => 
        prev.filter(d => !optimisticDocsToRemove.some(odr => odr.tempId === d.tempId))
      )
      
      // 同时移除对应的进度条
      optimisticDocsToRemove.forEach(od => {
        setUploadProgress(prev => {
          const newProgress = { ...prev }
          delete newProgress[od.id]
          return newProgress
        })
      })
    }
  }, [documents, optimisticDocuments])
  
  // 组件卸载时清理所有 interval
  useEffect(() => {
    return () => {
      progressIntervalsRef.current.forEach((intervalId) => {
        clearInterval(intervalId)
      })
      progressIntervalsRef.current.clear()
    }
  }, [])

  // 获取所有文档的阅读进度
  useEffect(() => {
    const fetchProgress = async () => {
      if (!documents?.items) return
      
      try {
        const progressData = await analyticsApi.getAllDocumentsProgress()
        const progressMap: Record<number, { total_chapters: number; read_chapters: number; progress_percent: number }> = {}
        
        progressData.documents.forEach((doc: { document_id: number; total_chapters: number; read_chapters: number; progress_percent: number }) => {
          progressMap[doc.document_id] = {
            total_chapters: doc.total_chapters,
            read_chapters: doc.read_chapters,
            progress_percent: doc.progress_percent
          }
        })
        
        setReadingProgress(progressMap)
      } catch (error) {
        console.error('获取阅读进度失败:', error)
      }
    }

    fetchProgress()
  }, [documents])

  // 调试：打印文档数据
  useEffect(() => {
    console.log('📄 完整文档数据:', documents)
    console.log('🌟 乐观文档:', optimisticDocuments)
    if (documents?.items) {
      documents.items.forEach((doc, index) => {
        console.log(`  文档 #${index}:`, {
          id: doc.id,
          title: doc.title,
          status: doc.status,
          statusType: typeof doc.status,
          raw: doc
        })
      })
    }
  }, [documents, optimisticDocuments])

  useEffect(() => {
    const allDocs = [...(documents?.items || []), ...optimisticDocuments]
    
    allDocs.forEach((doc) => {
      // 连接解析中的文档或临时解析的文档
      const shouldConnect = ((doc.status === 'parsing' || doc.status === 'waiting') || tempParsingDocs.has(doc.id)) 
        && !wsRef.current.has(doc.id) 
        && !doc.tempId
      
      if (shouldConnect) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const apiUrl = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
        const wsHost = apiUrl.replace(/^https?:\/\//, '')
        const wsUrl = `${protocol}//${wsHost}/api/v1/documents/ws/${doc.id}`
        console.log('🔌 连接WebSocket:', wsUrl)
        const ws = new WebSocket(wsUrl)

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data)
          if (data.type === 'progress') {
            setUploadProgress(prev => ({
              ...prev,
              [doc.id]: {
                documentId: doc.id,
                progress: data.progress,
                status: data.status,
                message: data.message
              }
            }))
          } else if (data.type === 'complete') {
            // 清除进度条
            setUploadProgress(prev => {
              const newProgress = { ...prev }
              delete newProgress[doc.id]
              return newProgress
            })
            // 清除临时解析状态
            setTempParsingDocs(prev => {
              const newSet = new Set(prev)
              newSet.delete(doc.id)
              return newSet
            })
            // 刷新文档列表
            refetch()
            ws.close()
            wsRef.current.delete(doc.id)
          }
        }

        ws.onerror = () => {
          ws.close()
          wsRef.current.delete(doc.id)
          // 出错时也清除临时解析状态
          setTempParsingDocs(prev => {
            const newSet = new Set(prev)
            newSet.delete(doc.id)
            return newSet
          })
        }

        ws.onclose = () => {
          wsRef.current.delete(doc.id)
        }

        wsRef.current.set(doc.id, ws)
      }
    })
  }, [documents, optimisticDocuments, refetch, tempParsingDocs])

  useEffect(() => {
    return () => {
      wsRef.current.forEach((ws) => ws.close())
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setSelectedFile(file)
      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, ''))
      }
    }
  }

  const handleUpload = () => {
    if (!selectedFile) return

    // 保存文件和标题的临时副本
    const fileToUpload = selectedFile
    const titleToUpload = title || selectedFile.name.replace(/\.[^/.]+$/, '')
    const categoryToUpload = category || undefined
    const tempId = Date.now()

    // 立即添加乐观文档，状态设为解析中
    const fileExt = selectedFile.name.split('.').pop()?.toLowerCase() || 'txt'
    const optimisticDoc = {
      id: tempId,
      tempId: tempId,
      title: titleToUpload,
      filename: selectedFile.name,
      file_type: fileExt,
      file_size: selectedFile.size,
      status: 'parsing' as const,
      created_at: new Date().toISOString(),
      parsed_at: null,
      error_message: null,
      category: categoryToUpload,
      is_public: isPublic,
    }
    
    setOptimisticDocuments(prev => [optimisticDoc, ...prev])
    
    // 添加模拟进度并保存到 ref
    let progress = 0
    const progressIntervalId = setInterval(() => {
      progress += Math.random() * 5 + 2
      if (progress > 90) progress = 90
      setUploadProgress(prev => ({
        ...prev,
        [tempId]: {
          documentId: tempId,
          progress: Math.floor(progress),
          status: 'parsing',
          message: progress < 30 ? '正在读取文件...' : 
                   progress < 60 ? '正在分析文档结构...' : 
                   progress < 80 ? '正在保存章节...' : '正在完成...'
        }
      }))
    }, 500)
    
    // 保存到 ref，方便后续清理
    progressIntervalsRef.current.set(tempId, progressIntervalId)

    // 重置表单
    setShowUpload(false)
    setSelectedFile(null)
    setTitle('')
    setCategory('')
    setIsPublic(false)
    setIsUploading(true)
    
    // 开始上传
    uploadMutation.mutate(
      { file: fileToUpload, title: titleToUpload, category: categoryToUpload, isPublic },
      {
        onSuccess: (data) => {
          console.log('✅ 上传成功:', { tempId, realId: data.document_id })
          
          // 保存 tempId 到真实 documentId 的映射
          if (data.document_id) {
            tempIdToRealIdRef.current.set(tempId, data.document_id)
          }
        },
        onError: (error: any) => {
          console.error('上传失败:', error)
          if (error?.status === 409) {
            alert(error.message || '这份文档已经上传过啦，换一个试试吧~')
          } else {
            alert(error.message || '上传失败，请稍后重试')
          }
          // 上传失败，移除乐观文档和进度
          if (progressIntervalsRef.current.has(tempId)) {
            clearInterval(progressIntervalsRef.current.get(tempId)!)
            progressIntervalsRef.current.delete(tempId)
          }
          setOptimisticDocuments(prev => prev.filter(d => d.tempId !== tempId))
          setUploadProgress(prev => {
            const newProgress = { ...prev }
            delete newProgress[tempId]
            return newProgress
          })
        },
        onSettled: () => {
          setIsUploading(false)
        },
      }
    )
  }

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    const valid: { id: string; file: File; preview: string }[] = []
    for (const f of Array.from(e.target.files)) {
      if (!f.type.startsWith('image/')) continue
      if (photos.length + valid.length >= 300) break
      valid.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        preview: URL.createObjectURL(f),
      })
    }
    setPhotos(prev => [...prev, ...valid])
    e.target.value = ''
  }

  const handleCameraCapture = async () => {
    try {
      const photo = await CapacitorCamera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        quality: 90,
      })
      if (!photo.webPath) return
      const response = await fetch(photo.webPath)
      const blob = await response.blob()
      const fileName = photo.path?.split('/').pop() || `photo_${Date.now()}.jpg`
      const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' })
      if (photos.length >= 300) return
      setPhotos(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: URL.createObjectURL(file),
      }])
    } catch (err: any) {
      if (err.message !== 'User cancelled photos app') {
        console.error('Camera capture error:', err)
      }
    }
  }

  const removePhoto = (id: string) => {
    setPhotos(prev => {
      const item = prev.find(p => p.id === id)
      if (item) URL.revokeObjectURL(item.preview)
      return prev.filter(p => p.id !== id)
    })
  }

  const movePhoto = (id: string, dir: -1 | 1) => {
    setPhotos(prev => {
      const idx = prev.findIndex(p => p.id === id)
      if (idx === -1) return prev
      const t = idx + dir
      if (t < 0 || t >= prev.length) return prev
      const arr = [...prev]
      const tmp = arr[idx]; arr[idx] = arr[t]; arr[t] = tmp
      return arr
    })
  }

  const handlePhotoUpload = async () => {
    if (photos.length === 0) return
    setIsUploading(true)
    try {
      const fd = new FormData()
      for (const p of photos) fd.append('files', p.file)
      if (category) fd.append('category', category)
      fd.append('is_public', String(isPublic))
      if (title) fd.append('title', title)

      const token = localStorage.getItem('access_token')
      const res = await fetch(
        '/api/v1/documents/upload-photos',
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '上传失败')

      for (const p of photos) URL.revokeObjectURL(p.preview)
      setPhotos([])
      setShowUpload(false)
      refetch()
    } catch (err: any) {
      console.error('照片上传失败:', err)
      alert(err.message || '照片上传失败')
    } finally {
      setIsUploading(false)
    }
  }

  const handleDelete = (documentId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setDeleteConfirm({ show: true, docId: documentId })
  }

  const confirmDelete = async () => {
    setIsDeleting(true)
    try {
      await deleteMutation.mutateAsync(deleteConfirm.docId)
      setDeleteConfirm({ show: false, docId: 0 })
    } catch (error) {
      console.error('删除失败:', error)
      setDeleteConfirm({ show: false, docId: 0 })
    } finally {
      setIsDeleting(false)
    }
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  const handleTogglePublic = async (documentId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await togglePublicMutation.mutateAsync({ documentId })
    } catch (error) {
      console.error('切换公开状态失败:', error)
    }
  }

  return (
    <PageTransition>
      <motion.div
        className="min-h-screen pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/')}
                className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <ArrowLeft size={24} />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">我的文档</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-1">管理和阅读您的学习资料</p>
              </div>
            </div>
            <button
              onClick={() => { setIsUploading(false); setShowUpload(true) }}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={20} />
              上传文档
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {isLoading && !optimisticDocuments.length ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 dark:text-gray-400 mt-4">加载中...</p>
          </div>
        ) : !mergedDocuments?.items?.length ? (
          <div className="text-center py-16">
            <FileText size={64} className="mx-auto text-gray-300 dark:text-gray-600" />
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">还没有文档</h3>
            <p className="text-gray-500 dark:text-gray-400 mt-2">上传您的第一份学习资料开始学习吧</p>
            <button
              onClick={() => { setIsUploading(false); setShowUpload(true) }}
              className="mt-6 inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={20} />
              上传文档
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {mergedDocuments.items.map((doc) => {
              // 检查是否是临时解析状态
              const isTempParsing = tempParsingDocs.has(doc.id)
              const displayStatus = (isTempParsing ? 'parsing' : doc.status) as DocumentStatus
              const status = statusConfig[displayStatus]
              const StatusIcon = status.icon
              const progress = uploadProgress[doc.id]
              return (
                <div key={doc.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-start gap-4">
                    <div className="text-4xl">
                      {fileTypeIcons[doc.file_type] || '📄'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div>
                          <Link
                            to={`/documents/${doc.id}`}
                            className="text-lg font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            {doc.title}
                          </Link>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {doc.filename}
                              {doc.file_size && ` · ${formatFileSize(doc.file_size)}`}
                            </p>
                            {doc.category && (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                                {doc.category}
                              </span>
                            )}
                            {doc.is_public && (
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                                公开
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${status.bg} ${status.color}`}>
                            <StatusIcon size={16} className={doc.status === 'parsing' ? 'animate-spin' : ''} />
                            {status.label}
                          </div>
                          <button
                            onClick={(e) => handleTogglePublic(doc.id, e)}
                            disabled={togglePublicMutation.isPending}
                            className={`p-2 transition-colors ${
                              doc.is_public
                                ? 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-500'
                                : 'text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400'
                            }`}
                            title={doc.is_public ? '设为私密' : '设为公开'}
                          >
                            {doc.is_public ? <Eye size={20} /> : <EyeOff size={20} />}
                          </button>
                          <button
                            onClick={(e) => handleDelete(doc.id, e)}
                            className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title="删除"
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </div>
                      {progress && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-blue-600 dark:text-blue-400">{progress.message}</span>
                            <span className="text-gray-500 dark:text-gray-400">{progress.progress}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${progress.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {/* 阅读进度 */}
                      {doc.status === 'completed' && readingProgress[doc.id] && readingProgress[doc.id].total_chapters > 0 && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-sm mb-1.5">
                            <span className="text-gray-600 dark:text-gray-400">阅读进度</span>
                            <span className={`font-medium ${readingProgress[doc.id].progress_percent === 100 ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>
                              {readingProgress[doc.id].read_chapters}/{readingProgress[doc.id].total_chapters} 章节
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                            <div 
                              className={`h-2.5 rounded-full transition-all duration-500 ${
                                readingProgress[doc.id].progress_percent === 100 ? 'bg-green-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'
                              }`}
                              style={{ width: `${readingProgress[doc.id].progress_percent}%` }}
                            />
                          </div>
                          {readingProgress[doc.id].progress_percent > 0 && (
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 text-right">{readingProgress[doc.id].progress_percent}%</p>
                          )}
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <span>上传于 {formatDate(doc.created_at)}</span>
                        {doc.status === 'completed' && (
                          <span>解析于 {formatDate(doc.parsed_at!)}</span>
                        )}
                        {doc.status === 'failed' && (
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-red-500 dark:text-red-400">
                              {doc.error_message || '解析失败'}
                            </span>
                            <span className="text-amber-600 dark:text-amber-400 text-xs">
                              可尝试使用 SoMark 智能解析
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setTempParsingDocs(prev => new Set(prev).add(doc.id))
                                reparseSomarkMutation.mutate({ documentId: doc.id, useRuleParsing: true })
                              }}
                              disabled={tempParsingDocs.has(doc.id) || reparseSomarkMutation.isPending}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <RefreshCw size={14} className={tempParsingDocs.has(doc.id) ? 'animate-spin' : ''} />
                              {tempParsingDocs.has(doc.id) ? '解析中...' : 'SoMark 重解析'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">上传文档</h2>
                <button
                  onClick={() => { setShowUpload(false); setPhotos([]) }}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  ✕
                </button>
              </div>

              {/* 模式切换 */}
              <div className="flex gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg">
                <button
                  onClick={() => setUploadMode('file')}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    uploadMode === 'file'
                      ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100'
                  }`}
                >
                  <FileText className="w-4 h-4 inline mr-1.5" />
                  上传文档
                </button>
                <button
                  onClick={() => setUploadMode('photo')}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    uploadMode === 'photo'
                      ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100'
                  }`}
                >
                  <Camera className="w-4 h-4 inline mr-1.5" />
                  上传照片
                </button>
              </div>

              <div className="space-y-4">
                {uploadMode === 'file' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      选择文件
                    </label>
                    <div
                      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                        selectedFile 
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                          : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
                      }`}
                      onClick={() => document.getElementById('file-input')?.click()}
                    >
                      <input
                        id="file-input"
                        type="file"
                        accept=".pdf,.docx,.txt,.md,.ppt,.pptx"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                      {selectedFile ? (
                        <div>
                          <FileText size={40} className="mx-auto text-blue-500 dark:text-blue-400" />
                          <p className="mt-2 font-medium text-gray-900 dark:text-gray-100">{selectedFile.name}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{formatFileSize(selectedFile.size)}</p>
                        </div>
                      ) : (
                        <div>
                          <FileText size={40} className="mx-auto text-gray-400 dark:text-gray-500" />
                          <p className="mt-2 text-gray-600 dark:text-gray-300">点击选择或拖拽文件到此处</p>
                          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">支持 PDF、DOCX、PPTX、TXT、MD 格式</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        选择照片
                      </label>
                      <span className="text-xs text-gray-400">{photos.length}/300 张</span>
                    </div>

                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 mb-3">
                      <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5 flex-shrink-0" />
                        请按上下文顺序上传清晰的照片，确保文字和图表清晰可见
                      </p>
                    </div>

                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />

                    {photos.length === 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={handleCameraCapture}
                          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                        >
                          <Camera size={28} className="mx-auto text-gray-400 dark:text-gray-500" />
                          <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-300 font-medium">拍照</p>
                        </button>
                        <button
                          onClick={() => photoInputRef.current?.click()}
                          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                        >
                          <FileText size={28} className="mx-auto text-gray-400 dark:text-gray-500" />
                          <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-300 font-medium">选择照片</p>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {photos.map((photo, idx) => (
                          <div key={photo.id} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2 border border-gray-200 dark:border-gray-600">
                            <span className="w-5 text-center text-[10px] text-gray-400 font-mono flex-shrink-0">{idx + 1}</span>
                            <img src={photo.preview} alt="" className="w-12 h-12 object-cover rounded flex-shrink-0" />
                            <span className="flex-1 text-xs text-gray-600 dark:text-gray-300 truncate">{photo.file.name}</span>
                            <button onClick={() => movePhoto(photo.id, -1)} disabled={idx === 0} className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                            <button onClick={() => movePhoto(photo.id, 1)} disabled={idx === photos.length - 1} className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                            <button onClick={() => removePhoto(photo.id)} className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-400"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <button
                            onClick={handleCameraCapture}
                            className="flex-1 py-2 text-xs text-emerald-500 hover:text-emerald-600 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg transition-colors flex items-center justify-center gap-1"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            拍照
                          </button>
                          <button
                            onClick={() => photoInputRef.current?.click()}
                            className="flex-1 py-2 text-xs text-blue-500 hover:text-blue-600 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg transition-colors flex items-center justify-center gap-1"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            选择照片
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {uploadMode === 'photo' ? '文档标题（可选）' : '文档标题'}
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={uploadMode === 'photo' ? '自动按照片数量命名' : '请输入文档标题'}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    学科分类
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-400"
                  >
                    <option value="">-- 选择或输入 --</option>
                    {categories?.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="或输入新的分类"
                    className="w-full mt-2 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-400"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="isPublic"
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600"
                  />
                  <label htmlFor="isPublic" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    公开文档（其他用户可见）
                  </label>
                </div>
                {isPublic && (
                  <div className="mt-2 pl-6 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                    <p>• 公开文档参与全站知识图谱合并，知识关联更丰富</p>
                    <p>• 文档内容仅限系统提取的知识点，不在知识图谱中显示原文</p>
                    <p>• 私密文档的知识图谱仅自己可见，不影响全站图谱</p>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => { setShowUpload(false); setPhotos([]) }}
                    className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={uploadMode === 'file' ? handleUpload : handlePhotoUpload}
                    disabled={uploadMode === 'file' ? (!selectedFile || isUploading) : (photos.length === 0 || isUploading)}
                    className="flex-1 px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isUploading ? '上传中...' : '上传'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                  <Trash2 size={20} className="text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">删除文档</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">此操作不可恢复</p>
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-6">确定要删除这个文档吗？</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm({ show: false, docId: 0 })}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {isDeleting ? '删除中...' : '删除'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </motion.div>
    </PageTransition>
  )
}
