import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import BottomNav from '../components/BottomNav'
import { Flashcard, FlashcardStats, PagedResponse, Document, CardGroup, CardGroupWithFlashcards, GenerationTask, GenerationTaskList } from '../types'
import { X, FileText, Globe, Search, Layers, EyeOff, Loader2, CheckCircle, AlertCircle, Play, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import PageTransition from '../components/PageTransition'
import katex from 'katex'
import 'katex/dist/katex.min.css'

function renderWithMath(text: string): string {
  let result = text
  // \[...\] display math
  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_, f) => {
    try { return katex.renderToString(f.trim(), { displayMode: true, throwOnError: false }) }
    catch { return `\\[${f}\\]` }
  })
  // $$...$$ display math
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => {
    try { return katex.renderToString(f.trim(), { displayMode: true, throwOnError: false }) }
    catch { return `$$${f}$$` }
  })
  // \(...\) inline math
  result = result.replace(/\\\(([\s\S]+?)\\\)/g, (_, f) => {
    try { return katex.renderToString(f.trim(), { displayMode: false, throwOnError: false }) }
    catch { return `\\(${f}\\)` }
  })
  // $...$ inline math
  result = result.replace(/\$([^$\n]+?)\$/g, (_, f) => {
    try { return katex.renderToString(f.trim(), { displayMode: false, throwOnError: false }) }
    catch { return `$${f}$` }
  })
  return result
}

function hasMath(text: string): boolean {
  return /\$/.test(text) || /\\\(/.test(text) || /\\\[/.test(text)
}

export default function Flashcards() {
  const { token, isAuthenticated, user } = useAuth()
  const navigate = useNavigate()
  const [dueFlashcards, setDueFlashcards] = useState<Flashcard[]>([])
  const [stats, setStats] = useState<FlashcardStats | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [publicDocuments, setPublicDocuments] = useState<Document[]>([])
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | ''>('')
  const [selectedDocumentTitle, setSelectedDocumentTitle] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [maxCards, setMaxCards] = useState(10)
  const [focusText, setFocusText] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [activeTab, setActiveTab] = useState<'review' | 'generate' | 'groups' | 'public' | 'tasks'>('review')
  const [myGroups, setMyGroups] = useState<CardGroup[]>([])
  const [publicGroups, setPublicGroups] = useState<CardGroup[]>([])
  const [publicGroupsByCategory, setPublicGroupsByCategory] = useState<{category: string; groups: CardGroup[]}[]>([])
  const [copyingGroupId, setCopyingGroupId] = useState<number | null>(null)
  const [showDocumentModal, setShowDocumentModal] = useState(false)
  const [documentFilter, setDocumentFilter] = useState<'my' | 'public'>('my')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [selectedGroupFlashcards, setSelectedGroupFlashcards] = useState<Flashcard[]>([])
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([])

  const fetchDueFlashcards = async () => {
    try {
      const response = await api.get<PagedResponse<Flashcard>>('/api/v1/flashcards/due')
      setDueFlashcards(response.items || [])
    } catch (error) {
      console.error('获取到期抽认卡失败:', error)
    }
  }

  const fetchStats = async () => {
    try {
      const response = await api.get<FlashcardStats>('/api/v1/flashcards/stats')
      setStats(response)
    } catch (error) {
      console.error('获取统计信息失败:', error)
    }
  }

  const fetchDocuments = async () => {
    try {
      const response = await api.get<PagedResponse<Document>>('/api/v1/documents')
      setDocuments(response.items || [])
    } catch (error) {
      console.error('获取文档列表失败:', error)
    }
  }

  const fetchPublicDocuments = async () => {
    try {
      const response = await api.get<Record<string, Document[]>>('/api/v1/documents/public')
      const allDocs = Object.values(response).flat()
      setPublicDocuments(allDocs)
    } catch (error) {
      console.error('获取公共文档失败:', error)
    }
  }

  const fetchGenerationTasks = async () => {
    try {
      const response = await api.get<GenerationTaskList>('/api/v1/flashcards/tasks')
      setGenerationTasks(response.tasks)
    } catch (error) {
      console.error('获取生成任务失败:', error)
    }
  }

  const fetchMyGroups = async () => {
    try {
      const response = await api.get<CardGroup[]>('/api/v1/flashcards/groups')
      setMyGroups(response)
    } catch (error) {
      console.error('获取我的卡组失败:', error)
    }
  }

  const fetchPublicGroups = async () => {
    try {
      const response = await api.get<{category: string; groups: CardGroup[]}[]>('/api/v1/flashcards/groups/public/by-category')
      setPublicGroupsByCategory(response)
      const allGroups = response.flatMap(item => item.groups)
      setPublicGroups(allGroups)
    } catch (error) {
      console.error('获取公共卡组失败:', error)
    }
  }

  const fetchData = useCallback(async () => {
    if (!token) return
    await Promise.all([
      fetchDueFlashcards(),
      fetchStats(),
      fetchDocuments(),
      fetchPublicDocuments(),
      fetchMyGroups(),
      fetchPublicGroups(),
      fetchGenerationTasks()
    ])
  }, [token])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // 使用轮询更新任务状态和卡组列表（每3秒）
  useEffect(() => {
    const interval = setInterval(() => {
      fetchGenerationTasks()
      fetchMyGroups()
      fetchPublicGroups()
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleSelectGroup = async (groupId: number) => {
    try {
      const response = await api.get<CardGroupWithFlashcards>(`/api/v1/flashcards/groups/${groupId}`)
      setSelectedGroupFlashcards(response.flashcards || [])
      setSelectedGroupId(groupId)
      setShowGroupModal(true)
    } catch (error) {
      console.error('获取卡组详情失败:', error)
    }
  }

  const handleCopyGroup = async (groupId: number) => {
    setCopyingGroupId(groupId)
    try {
      const response = await api.post<{ message: string; group_id: number }>(`/api/v1/flashcards/groups/${groupId}/copy`, {})
      alert(response.message || '卡组复制成功！')
      fetchMyGroups()
      fetchDueFlashcards()
      fetchStats()
    } catch (error: any) {
      console.error('复制卡组失败:', error)
      alert(error.message || '复制卡组失败')
    } finally {
      setCopyingGroupId(null)
    }
  }

  const handleCancelTask = async (taskId: number) => {
    if (!confirm('确定要取消这个生成任务吗？')) return
    try {
      await api.post(`/api/v1/flashcards/tasks/${taskId}/cancel`)
      fetchGenerationTasks()
      fetchMyGroups()
      fetchStats()
    } catch (error: any) {
      console.error('取消任务失败:', error)
      alert(error.response?.data?.detail || '取消任务失败')
    }
  }

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm('确定要删除这个任务吗？')) return
    try {
      await api.delete(`/api/v1/flashcards/tasks/${taskId}`)
      fetchGenerationTasks()
    } catch (error: any) {
      console.error('删除任务失败:', error)
      alert(error.message || '删除任务失败')
    }
  }

  const handleStartReview = async (groupId: number) => {
    try {
      const response = await api.get<CardGroupWithFlashcards>(`/api/v1/flashcards/groups/${groupId}`)
      if (response.flashcards && response.flashcards.length > 0) {
        navigate(`/flashcards/${response.flashcards[0].id}/review?group=${groupId}`)
      } else {
        alert('该卡组没有卡片')
      }
    } catch (error: any) {
      console.error('获取卡组失败:', error)
      alert(error.message || '获取卡组失败')
    }
  }

  const handleGenerateFlashcards = async () => {
    if (!selectedDocumentId || maxCards < 1 || maxCards > 100) {
      alert('请选择文档并设置合理的卡片数量（1-100）')
      return
    }

    setGenerating(true)
    try {
      await api.post<GenerationTask>('/api/v1/flashcards/generate', {
        document_id: selectedDocumentId,
        max_cards: maxCards,
        focus_text: focusText || undefined,
        is_public: isPublic
      })

      setSelectedDocumentId('')
      setSelectedDocumentTitle('')
      setIsPublic(false)
      setActiveTab('tasks')
      fetchGenerationTasks()
      fetchMyGroups()
      fetchPublicGroups()
    } catch (error: any) {
      console.error('生成抽认卡失败:', error)
      alert(error.message || '生成抽认卡失败')
    } finally {
      setGenerating(false)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '无'
    return new Date(dateString).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getTaskStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      case 'cancelled':
        return <AlertCircle className="w-5 h-5 text-gray-500" />
      case 'processing':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
      default:
        return <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
    }
  }

  const getTaskProgress = (task: GenerationTask) => {
    if (task.status === 'completed') return 100
    if (task.total_chunks === 0) return 0
    return Math.round((task.processed_chunks / task.total_chunks) * 100)
  }

  const handleDeleteGroup = async (groupId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定要删除这个卡组吗？删除后无法恢复。')) return

    try {
      await api.delete(`/api/v1/flashcards/groups/${groupId}`)
      fetchMyGroups()
      fetchStats()
    } catch (error: any) {
      console.error('删除卡组失败:', error)
      alert(error.message || '删除卡组失败')
    }
  }

  const handleResetGroupCache = (groupId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定要清除该卡组的选择题缓存吗？这将重置所有已选择的答案。')) return

    // 清除该卡组相关的所有 sessionStorage 项
    const prefix = `group-${groupId}-card-`
    const keysToRemove: string[] = []
    
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key)
      }
    }
    
    // 清除 lastCardGroup 记录
    keysToRemove.push(`lastCardGroup-${groupId}`)
    
    keysToRemove.forEach(key => sessionStorage.removeItem(key))
    alert(`已清除 ${Math.floor(keysToRemove.length / 2)} 张卡片的缓存`)
  }

  const handleToggleGroupPublic = async (groupId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const result: { message?: string; is_public?: boolean } = await api.put(`/api/v1/flashcards/groups/${groupId}/toggle-public`)
      alert(result.message || `卡组状态已更新为${result.is_public ? '公开' : '私有'}`)
      fetchMyGroups()
      fetchPublicGroups()
    } catch (error: any) {
      console.error('切换卡组公开状态失败:', error)
      alert(error.message || '操作失败')
    }
  }

  const currentGroups = activeTab === 'public' ? publicGroups : myGroups
  const activeTaskCount = generationTasks.filter(t => t.status === 'pending' || t.status === 'processing').length

  return (
    <PageTransition>
      <motion.div
        className="min-h-screen pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
      <div className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">抽认卡系统</h1>
          <Link to="/documents" className="text-blue-600 hover:text-blue-800">
            返回文档
          </Link>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow p-4">
              <div className="text-sm text-gray-500">总卡片数</div>
              <div className="text-2xl font-bold text-gray-800">{stats.total_cards}</div>
            </div>
            <div className="bg-white rounded-xl shadow p-4">
              <div className="text-sm text-gray-500">待复习</div>
              <div className="text-2xl font-bold text-orange-600">{stats.due_today}</div>
            </div>
            <div className="bg-white rounded-xl shadow p-4">
              <div className="text-sm text-gray-500">我的卡组</div>
              <div className="text-2xl font-bold text-blue-600">{myGroups.length}</div>
            </div>
            <div className="bg-white rounded-xl shadow p-4">
              <div className="text-sm text-gray-500">公共卡组</div>
              <div className="text-2xl font-bold text-green-600">{publicGroups.length}</div>
            </div>
          </div>
        )}

        <div className="flex border-b border-gray-200 mb-6">
          <button
            className={`px-4 py-2 font-medium ${activeTab === 'review' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('review')}
          >
            复习 ({dueFlashcards.length})
          </button>
          <button
            className={`px-4 py-2 font-medium ${activeTab === 'generate' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('generate')}
          >
            生成卡组
          </button>
          <button
            className={`px-4 py-2 font-medium ${activeTab === 'tasks' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('tasks')}
          >
            生成任务 {activeTaskCount > 0 && <span className="ml-1 bg-blue-500 text-white rounded-full px-2 py-0.5 text-xs">{activeTaskCount}</span>}
          </button>
          <button
            className={`px-4 py-2 font-medium ${activeTab === 'groups' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('groups')}
          >
            我的卡组 ({myGroups.length})
          </button>
          <button
            className={`px-4 py-2 font-medium ${activeTab === 'public' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('public')}
          >
            公共卡组 ({publicGroups.length})
          </button>
        </div>

        {activeTab === 'review' && (
          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">每日复习</h2>
            </div>

            {dueFlashcards.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-lg mb-2">太棒了！没有待复习的卡片</p>
                <p>今天的学习任务已经完成</p>
              </div>
            ) : (
              <div>
                <p className="text-gray-600 mb-4">今日有 {dueFlashcards.length} 张卡片需要复习</p>
                <Link
                  to={`/flashcards/${dueFlashcards[0]?.id}/review`}
                  className="inline-block bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:opacity-90"
                >
                  开始复习
                </Link>
              </div>
            )}
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">生成任务队列</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={fetchGenerationTasks}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  刷新
                </button>
              </div>
            </div>

            {generationTasks.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>暂无生成任务</p>
                <p className="text-sm">点击"生成卡组"创建新任务</p>
              </div>
            ) : (
              <div className="space-y-4">
                {generationTasks.map(task => (
                  <div key={task.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getTaskStatusIcon(task.status)}
                        <span className="font-medium text-gray-800">文档 #{task.document_id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${
                          task.status === 'completed' ? 'text-green-600' :
                          task.status === 'failed' ? 'text-red-600' :
                          task.status === 'cancelled' ? 'text-gray-500' :
                          'text-blue-600'
                        }`}>
                          {task.status === 'pending' && '等待中'}
                          {task.status === 'processing' && '处理中'}
                          {task.status === 'completed' && '已完成'}
                          {task.status === 'failed' && '失败'}
                          {task.status === 'cancelled' && '已取消'}
                        </span>
                        {(task.status === 'pending' || task.status === 'processing') && (
                          <button
                            onClick={() => handleCancelTask(task.id)}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            取消
                          </button>
                        )}
                        {(task.status === 'failed' || task.status === 'cancelled') && (
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="text-gray-500 hover:text-gray-700 text-sm"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mb-2">
                      <div className="flex justify-between text-sm text-gray-500 mb-1">
                        <span>进度: {task.processed_chunks}/{task.total_chunks} 块</span>
                        <span>{getTaskProgress(task)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            task.status === 'failed' ? 'bg-red-500' :
                            task.status === 'completed' ? 'bg-green-500' :
                            task.status === 'cancelled' ? 'bg-gray-400' :
                            'bg-blue-500'
                          }`}
                          style={{ width: `${getTaskProgress(task)}%` }}
                        />
                      </div>
                    </div>
                    {task.status === 'completed' && (
                      <p className="text-sm text-green-600">已生成 {task.total_cards} 张卡片</p>
                    )}
                    {task.status === 'failed' && task.error_message && (
                      <p className="text-sm text-red-600">错误: {task.error_message}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-2">创建时间: {formatDate(task.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'generate' && (
          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6">生成卡组</h2>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择文档
                </label>
                <button
                  onClick={() => setShowDocumentModal(true)}
                  className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-gray-50 transition-colors text-left flex items-center justify-between"
                >
                  {selectedDocumentId ? (
                    <span className="text-gray-800">{selectedDocumentTitle}</span>
                  ) : (
                    <span className="text-gray-500">点击选择文档（支持我的文档和公开文档）</span>
                  )}
                  <FileText className="w-5 h-5 text-gray-400" />
                </button>
                <p className="mt-2 text-sm text-gray-500">
                  文档内容将按700字符分块，多块并行处理
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  生成卡片总数 (1-100)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={maxCards}
                  onChange={(e) => setMaxCards(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-sm text-gray-500">
                  知识点将平均分配到各分块并行生成
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  侧重点（可选）
                </label>
                <input
                  type="text"
                  value={focusText}
                  onChange={(e) => setFocusText(e.target.value)}
                  placeholder="例如：只要选择题、侧重于XX知识点、只要单词翻译题..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-sm text-gray-400">
                  此规则优先于所有默认格式要求
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  公开设置
                </label>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setIsPublic(true)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
                      isPublic
                        ? 'bg-green-100 border-green-500 text-green-700'
                        : 'bg-gray-50 border-gray-300 text-gray-600'
                    }`}
                  >
                    <Globe className="w-4 h-4" />
                    公开
                  </button>
                  <button
                    onClick={() => setIsPublic(false)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
                      !isPublic
                        ? 'bg-gray-100 border-gray-500 text-gray-700'
                        : 'bg-gray-50 border-gray-300 text-gray-600'
                    }`}
                  >
                    <EyeOff className="w-4 h-4" />
                    私有
                  </button>
                </div>
              </div>

              <button
                onClick={handleGenerateFlashcards}
                disabled={generating || !selectedDocumentId}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-3 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    创建生成任务...
                  </span>
                ) : '创建生成任务'}
              </button>

              <div className="border-t border-gray-200 pt-6">
                <h3 className="font-medium text-gray-700 mb-2">生成说明</h3>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• 文档内容按700字符分块，多块并行处理</li>
                  <li>• 可同时发起多个生成任务，自动排队</li>
                  <li>• 公开后其他用户可复制此卡组</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {(activeTab === 'groups' || activeTab === 'public') && (
          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-bold text-gray-800">
                {activeTab === 'public' ? '公共卡组' : '我的卡组'}
              </h2>
              {activeTab === 'public' && isAuthenticated && (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">我的</span> 表示你上传的卡组
                </span>
              )}
            </div>

            {activeTab === 'public' && publicGroupsByCategory.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Layers className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg mb-2">暂无公共卡组</p>
              </div>
            ) : activeTab === 'groups' && currentGroups.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Layers className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg mb-2">暂无卡组</p>
                <p>点击"生成卡组"创建第一个卡组</p>
              </div>
            ) : activeTab === 'public' ? (
              <div className="space-y-6">
                {publicGroupsByCategory.map(categoryItem => (
                  <div key={categoryItem.category}>
                    <h3 className="text-lg font-medium text-gray-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                      {categoryItem.category}
                      <span className="text-sm text-gray-400">({categoryItem.groups.length})</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {categoryItem.groups.map(group => (
                        <div
                          key={group.id}
                          className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer relative"
                        >
                          <div className="flex items-start justify-between mb-4" onClick={() => handleSelectGroup(group.id)}>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-medium text-gray-800">{group.name}</h4>
                                {isAuthenticated && user?.id === group.owner_id && (
                                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                                    我的
                                  </span>
                                )}
                              </div>
                              {group.description && (
                                <p className="text-sm text-gray-500 mb-2 line-clamp-2">{group.description}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
                                <span className="flex items-center gap-1">
                                  <Layers className="w-4 h-4" />
                                  {group.card_count} 张卡片
                                </span>
                                <span>{new Date(group.created_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleCopyGroup(group.id)
                              }}
                              disabled={copyingGroupId === group.id}
                              className="flex-1 bg-blue-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-600 disabled:opacity-50"
                            >
                              {copyingGroupId === group.id ? '复制中...' : '复制到我的卡组'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {currentGroups.map(group => (
                  <div
                    key={group.id}
                    className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer relative"
                  >
                    <div className="flex items-start justify-between mb-4" onClick={() => handleSelectGroup(group.id)}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-gray-800">{group.name}</h3>
                          {group.is_public ? (
                            <Globe className="w-4 h-4 text-green-500" />
                          ) : (
                            <EyeOff className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                        {group.description && (
                          <p className="text-sm text-gray-500 mb-2 line-clamp-2">{group.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <Layers className="w-4 h-4" />
                            {group.card_count} 张卡片
                          </span>
                          <span>{new Date(group.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {activeTab === 'groups' && (
                        <button
                          onClick={(e) => handleResetGroupCache(group.id, e)}
                          className="bg-gray-100 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-gray-200 transition-colors"
                          title="清除选择题缓存"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      {activeTab === 'groups' && (
                        <button
                          onClick={(e) => handleToggleGroupPublic(group.id, e)}
                          className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                            group.is_public
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                          title={group.is_public ? '设为私有' : '设为公开'}
                        >
                          {group.is_public ? (
                            <Globe className="w-4 h-4" />
                          ) : (
                            <EyeOff className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      {activeTab === 'groups' && group.card_count > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleStartReview(group.id)
                          }}
                          className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 transition-opacity"
                        >
                          <Play className="w-4 h-4" />
                          开始复习
                        </button>
                      )}
                      {activeTab === 'groups' && (
                        <button
                          onClick={(e) => handleDeleteGroup(group.id, e)}
                          className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm hover:bg-red-100 transition-colors"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showDocumentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">选择文档</h2>
              <button
                onClick={() => setShowDocumentModal(false)}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-4 border-b border-gray-200">
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setDocumentFilter('my')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${
                    documentFilter === 'my'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  我的文档
                </button>
                <button
                  onClick={() => setDocumentFilter('public')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${
                    documentFilter === 'public'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Globe className="w-4 h-4" />
                  公开文档
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索文档..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="p-4 overflow-y-auto max-h-[50vh]">
              {documentFilter === 'my' ? (
                documents.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>暂无文档</p>
                    <p className="text-sm">请先上传文档</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {documents
                      .filter(doc => doc.title.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(doc => (
                        <button
                          key={doc.id}
                          onClick={() => {
                            setSelectedDocumentId(doc.id)
                            setSelectedDocumentTitle(doc.title)
                            setShowDocumentModal(false)
                            setSearchQuery('')
                          }}
                          className="w-full text-left p-3 rounded-lg hover:bg-blue-50 border border-gray-200"
                        >
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-blue-500" />
                            <span className="text-gray-800">{doc.title}</span>
                          </div>
                        </button>
                      ))}
                  </div>
                )
              ) : publicDocuments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>暂无公开文档</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {publicDocuments
                    .filter(doc => doc.title.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(doc => (
                      <button
                        key={doc.id}
                        onClick={() => {
                          setSelectedDocumentId(doc.id)
                          setSelectedDocumentTitle(doc.title)
                          setShowDocumentModal(false)
                          setSearchQuery('')
                        }}
                        className="w-full text-left p-3 rounded-lg hover:bg-green-50 border border-gray-200"
                      >
                        <div className="flex items-center gap-3">
                          <Globe className="w-5 h-5 text-green-500" />
                          <span className="text-gray-800">{doc.title}</span>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showGroupModal && selectedGroupId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-800">
                  {currentGroups.find(g => g.id === selectedGroupId)?.name || '卡组详情'}
                </h2>
                <p className="text-sm text-gray-500">
                  {selectedGroupFlashcards.length} 张卡片
                </p>
              </div>
              <button
                onClick={() => {
                  setShowGroupModal(false)
                  setSelectedGroupFlashcards([])
                }}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <div className="space-y-3">
                {selectedGroupFlashcards.map(card => (
                  <div key={card.id} className="border border-gray-200 rounded-lg p-4">
                    <h4 className="font-medium text-gray-800 mb-2">
                      {hasMath(card.question) ? (
                        <span dangerouslySetInnerHTML={{ __html: renderWithMath(card.question) }} />
                      ) : (
                        card.question
                      )}
                    </h4>
                    <p className="text-sm text-gray-600 mb-2">
                      {hasMath(card.answer) ? (
                        <span dangerouslySetInnerHTML={{ __html: renderWithMath(card.answer) }} />
                      ) : (
                        card.answer
                      )}
                     </p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <span>状态: <span className={`font-medium ${card.status === 'new' ? 'text-blue-600' : card.status === 'learning' ? 'text-orange-600' : 'text-green-600'}`}>{card.status}</span></span>
                      <span>难度: {card.difficulty.toFixed(2)}</span>
                      <span>复习次数: {card.reps}</span>
                      {card.next_review && (
                        <span>下次复习: {new Date(card.next_review).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
      </motion.div>
    </PageTransition>
  )
}
