import { Upload, BookOpen, TrendingUp, Clock, Award, ChevronRight, FileText, Eye, Search, BookMarked, BarChart, FlaskConical, Sparkles, GitBranch, AlertCircle, RefreshCw } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { motion, useInView, AnimatePresence } from 'motion/react'
import { analyticsApi, documentsApi } from '../api'
import { useAuth } from '../hooks/useAuth'
import { usePublicDocuments, useTogglePublicStatus } from '../hooks/useDocuments'
import type { LearningOverview } from '../types'
import LoginReminderModal from '../components/LoginReminderModal'
import TiltCard from '../components/TiltCard'
import AnimatedNumber from '../components/AnimatedNumber'

const fileTypeIcons: Record<string, string> = {
  pdf: '📄',
  docx: '📝',
  txt: '📃',
  md: '📑',
}

interface PopularDocument {
  id: number
  title: string
  filename: string
  file_type: string
  category?: string
  view_count: number
  owner_id: number
  created_at: string
}

const springUp = {
  hidden: { opacity: 0, y: 25 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { type: "spring", stiffness: 100, damping: 20, delay: i * 0.07 }
  })
}

const fadeIn = {
  hidden: { opacity: 0, y: 18 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.45, delay: i * 0.08 }
  })
}

function SectionTitle({ icon, title, badge }: { icon: React.ReactNode; title: string; badge?: React.ReactNode }) {
  return (
    <motion.div
      className="flex items-center justify-between mb-5"
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-200">
          {icon}
        </div>
        <h2 className="text-lg font-bold text-stone-800">{title}</h2>
        {badge}
      </div>
    </motion.div>
  )
}

const Home = () => {
  const { isAuthenticated, user } = useAuth()
  const navigate = useNavigate()
  const [overview, setOverview] = useState<LearningOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [popularDocs, setPopularDocs] = useState<PopularDocument[]>([])
  const { data: publicDocuments, isLoading: publicDocsLoading, isError: publicDocsError, refetch: refetchPublicDocs } = usePublicDocuments()
  const togglePublicMutation = useTogglePublicStatus()
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [modalAction, setModalAction] = useState('进行此操作')
  const [showBgmReminder, setShowBgmReminder] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const heroRef = useRef(null)
  const heroInView = useInView(heroRef, { once: true })
  const statsRef = useRef(null)
  const statsInView = useInView(statsRef, { once: true })

  const handleTogglePublic = async (documentId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await togglePublicMutation.mutateAsync({ documentId })
    } catch (error) {
      console.error('切换公开状态失败:', error)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      fetchOverview()
    } else {
      setLoading(false)
    }
    fetchPopularDocs()
  }, [isAuthenticated])

  const fetchOverview = async () => {
    try {
      const data = await analyticsApi.getOverview()
      setOverview(data)
    } catch (error) {
      console.error('获取学习总览失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchPopularDocs = async () => {
    try {
      const docs = await documentsApi.getPopularDocuments(5)
      setPopularDocs(docs)
    } catch (error) {
      console.error('获取热门文档失败:', error)
    }
  }

  const handleSearch = async (q: string) => {
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    setIsSearching(true)
    try {
      const results = await documentsApi.searchDocuments(q)
      setSearchResults(results)
    } catch (error) {
      console.error('搜索失败:', error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => handleSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleQuickAction = (action: { label: string; path: string }) => {
    if (!isAuthenticated) {
      setModalAction(action.label)
      setShowLoginModal(true)
    }
  }

  const quickActions = [
    { icon: <Upload className="w-5 h-5" />, label: '上传文档', path: '/documents', gradient: 'from-amber-400 to-orange-500', shadow: 'shadow-amber-200' },
    { icon: <BookOpen className="w-5 h-5" />, label: '生成抽认卡', path: '/flashcards', gradient: 'from-violet-400 to-purple-500', shadow: 'shadow-purple-200' },
    { icon: <FlaskConical className="w-5 h-5" />, label: '实验报告', path: '/experiment', gradient: 'from-rose-400 to-pink-500', shadow: 'shadow-pink-200' },
    { icon: <BarChart className="w-5 h-5" />, label: '查看统计', path: '/analytics', gradient: 'from-emerald-400 to-teal-500', shadow: 'shadow-emerald-200' },
    { icon: <Sparkles className="w-5 h-5" />, label: '灵枢（Harness）', path: '/agent', gradient: 'from-amber-500 to-rose-500', shadow: 'shadow-amber-300' },
    { icon: <BookMarked className="w-5 h-5" />, label: '视觉小说（Narraleaf）', path: '/game', gradient: 'from-sky-400 to-blue-500', shadow: 'shadow-sky-200' },
    { icon: <GitBranch className="w-5 h-5" />, label: '知识图谱（Obsidian）', path: '/knowledge-graph', gradient: 'from-stone-600 to-slate-700', shadow: 'shadow-stone-300' },
  ]

  const getProgressColor = (change: number) => change > 0 ? 'text-emerald-600' : change < 0 ? 'text-rose-600' : 'text-stone-600'
  const getProgressIcon = (change: number) => change > 0 ? '↑' : change < 0 ? '↓' : '→'

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-stone-50 via-amber-50/30 to-stone-50">
      <div className="max-w-4xl mx-auto p-4 relative z-10">
        {/* ===== Hero Section ===== */}
        <motion.div
          ref={heroRef}
          className="relative mb-10 mt-4"
          initial={{ opacity: 0, y: 40 }}
          animate={heroInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, type: "spring", stiffness: 80 }}
        >
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-orange-400 to-rose-400 p-[1px] shadow-2xl shadow-amber-200/50">
            <div className="relative rounded-3xl bg-gradient-to-br from-amber-50 to-orange-50 p-7 md:p-10 overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-amber-200/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-rose-200/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
              <div className="relative z-10">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={heroInView ? { scale: 1 } : {}}
                  transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                  className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-amber-200/50 text-amber-700 text-sm font-medium mb-4"
                >
                  <Sparkles size={14} />
                  {new Date().getHours() < 12 ? '早上好' : new Date().getHours() < 18 ? '下午好' : '晚上好'}，学习者
                </motion.div>
                <motion.h1
                  className="text-3xl md:text-4xl font-bold text-stone-800 mb-3"
                  initial={{ opacity: 0, y: 20 }}
                  animate={heroInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.3, duration: 0.5 }}
                >
                  {user?.username ? `${user.username}，你好！` : '你好，学习者'}
                  <motion.span
                    className="inline-block"
                    animate={{ rotate: [0, 15, -10, 15, 0] }}
                    transition={{ delay: 1, duration: 0.8, ease: "easeInOut" }}
                  >👋</motion.span>
                </motion.h1>
                <motion.p
                  className="text-stone-600 text-base max-w-xl"
                  initial={{ opacity: 0 }}
                  animate={heroInView ? { opacity: 1 } : {}}
                  transition={{ delay: 0.4, duration: 0.5 }}
                >
                  {isAuthenticated && overview
                    ? `欢迎回来！你已学习 ${overview.total_study_minutes} 分钟，继续保持！`
                    : '探索公共文档库，开始你的学习之旅'}
                  {!isAuthenticated && (
                    <span className="ml-2">
                      <Link to="/auth" className="text-amber-600 hover:text-amber-700 font-semibold underline underline-offset-2 decoration-amber-300">
                        登录
                      </Link>
                      后可上传自己的文档
                    </span>
                  )}
                </motion.p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ===== Quick Actions ===== */}
        <motion.div
          className="grid grid-cols-5 gap-3 mb-8"
          initial="hidden"
          animate={heroInView ? "visible" : "hidden"}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.06, delayChildren: 0.5 } }
          }}
        >
          {quickActions.map((action, index) => {
            const btn = (
              <TiltCard className="relative group cursor-pointer">
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 flex flex-col items-center justify-center border border-stone-100 hover:border-amber-200 transition-colors h-full"
                  style={{ transformStyle: "preserve-3d" }}
                >
                  <motion.div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${action.gradient} flex items-center justify-center mb-3 ${action.shadow}`}
                    whileHover={{ scale: 1.15 }}
                    transition={{ type: "spring", stiffness: 300 }}
                    style={{ transformStyle: "preserve-3d", transform: "translateZ(20px)" }}
                  >
                    <div className="text-white">{action.icon}</div>
                  </motion.div>
                  <span className="text-sm font-semibold text-stone-700 text-center leading-snug" style={{ transform: "translateZ(10px)" }}>
                    {action.label}
                  </span>
                </div>
              </TiltCard>
            )
            if (action.label === '视觉小说（Narraleaf）') {
              return (
                <motion.div key={index} variants={springUp} custom={index}>
                  <button
                    onClick={() => {
                      if (!isAuthenticated) handleQuickAction(action)
                      else setShowBgmReminder(true)
                    }}
                    className="w-full"
                  >
                    {btn}
                  </button>
                </motion.div>
              )
            }
            return (
              <motion.div key={index} variants={springUp} custom={index}>
                {isAuthenticated ? (
                  <Link to={action.path} className="block">{btn}</Link>
                ) : (
                  <button onClick={() => handleQuickAction(action)} className="w-full">{btn}</button>
                )}
              </motion.div>
            )
          })}
        </motion.div>

        {/* ===== Search ===== */}
        <motion.div
          className="mb-7"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
        >
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-300 to-orange-300 rounded-2xl blur opacity-30 group-focus-within:opacity-60 transition duration-300" />
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={20} />
              <input
                type="text"
                placeholder="搜索文档名称或内容..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 bg-white/80 backdrop-blur-sm border border-stone-200 rounded-2xl focus:ring-2 focus:ring-amber-400/50 focus:border-amber-300 transition-all text-stone-700 placeholder-stone-400"
              />
            </div>
          </div>
        </motion.div>

        {/* ===== Search Results (animated) ===== */}
        <AnimatePresence mode="wait">
          {searchQuery && (
            <motion.div
              key="search-results"
              className="mb-8"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              <SectionTitle
                icon={<Search size={16} />}
                title={`搜索结果 (${searchResults.length})`}
              />
              {isSearching ? (
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-12 text-center border border-stone-100">
                  <motion.div
                    className="w-10 h-10 border-3 border-amber-400 border-t-transparent rounded-full mx-auto mb-4"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  />
                  <p className="text-stone-500">正在搜索...</p>
                </div>
              ) : searchResults.length > 0 ? (
                <motion.div
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                  initial="hidden"
                  animate="visible"
                  variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }}
                >
                  {searchResults.map((doc, i) => (
                    <motion.div
                      key={doc.id}
                      variants={fadeIn}
                      custom={i}
                      className="group relative"
                    >
                      <TiltCard>
                        <div className="bg-white/80 backdrop-blur-sm border border-stone-100 rounded-xl p-4 hover:border-amber-200 transition-all relative overflow-hidden">
                          <div
                            onClick={() => { documentsApi.incrementViewCount(doc.id); navigate(`/documents/${doc.id}?from=public`) }}
                            className="cursor-pointer"
                          >
                            <div className="flex items-start gap-3">
                              <motion.div
                                className="text-2xl"
                                whileHover={{ scale: 1.2, rotate: 10 }}
                                transition={{ type: "spring", stiffness: 300 }}
                              >
                                {fileTypeIcons[doc.file_type] || '📄'}
                              </motion.div>
                              <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-stone-800 truncate">{doc.title}</h4>
                                <p className="text-xs text-stone-500 mt-1 truncate">{doc.filename}</p>
                                {doc.category && <p className="text-xs text-amber-600 mt-1">{doc.category}</p>}
                                <p className="text-xs text-stone-400 mt-1">{new Date(doc.created_at).toLocaleDateString('zh-CN')}</p>
                              </div>
                            </div>
                          </div>
                          {doc.match_snippet && (
                            <div onClick={() => navigate(`/documents/${doc.id}?from=public`)}
                              className="mt-2 pt-2 border-t border-stone-100 cursor-pointer"
                            >
                              <p className="text-xs text-stone-600 line-clamp-2" dangerouslySetInnerHTML={{
                                __html: doc.match_snippet.replace(new RegExp(searchQuery, 'gi'), (m: string) =>
                                  `<mark class="bg-amber-200/70 text-amber-900 px-0.5 rounded">${m}</mark>`)
                              }} />
                            </div>
                          )}
                          {isAuthenticated && user?.id === doc.owner_id && (
                            <button
                              onClick={(e) => handleTogglePublic(doc.id, e)}
                              disabled={togglePublicMutation.isPending}
                              className="absolute top-2 right-2 p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Eye size={14} />
                            </button>
                          )}
                        </div>
                      </TiltCard>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  className="bg-white/80 backdrop-blur-sm rounded-2xl p-10 text-center border border-stone-100"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring" }}
                >
                  <Search size={40} className="mx-auto text-stone-300 mb-3" />
                  <p className="text-stone-500">没有找到匹配的文档</p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== Public Documents ===== */}
        {!searchQuery && (
          <motion.div
            className="mb-8"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <SectionTitle
              icon={<BookOpen size={16} />}
              title="公共文档库"
              badge={isAuthenticated && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">我的</span>}
            />
            <div className="flex justify-end -mt-2 mb-3">
              {isAuthenticated ? (
                <Link to="/documents" className="text-amber-600 text-sm font-medium flex items-center hover:text-amber-700 transition-colors">
                  上传自己的文档 <ChevronRight className="w-4 h-4 ml-0.5" />
                </Link>
              ) : (
                <button onClick={() => { setModalAction('上传文档'); setShowLoginModal(true) }}
                  className="text-amber-600 text-sm font-medium flex items-center hover:text-amber-700 transition-colors"
                >
                  上传自己的文档 <ChevronRight className="w-4 h-4 ml-0.5" />
                </button>
              )}
            </div>

            {publicDocsLoading ? (
              <motion.div
                className="bg-white/80 backdrop-blur-sm rounded-2xl p-10 text-center border border-stone-100"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-stone-400">加载公共文档库...</p>
              </motion.div>
            ) : publicDocsError ? (
              <motion.div
                className="bg-white/80 backdrop-blur-sm rounded-2xl p-10 text-center border border-stone-100"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                <AlertCircle size={40} className="mx-auto text-amber-400 mb-3" />
                <p className="text-stone-500 mb-3">加载失败，请检查网络后重试</p>
                <button onClick={() => refetchPublicDocs()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 rounded-xl hover:bg-amber-200 transition text-sm font-medium"
                >
                  <RefreshCw size={14} /> 重新加载
                </button>
              </motion.div>
            ) : !publicDocuments || Object.keys(publicDocuments).length === 0 ? (
              <motion.div
                className="bg-white/80 backdrop-blur-sm rounded-2xl p-10 text-center border border-stone-100"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                <FileText size={40} className="mx-auto text-stone-300 mb-3" />
                <p className="text-stone-500 mb-4">还没有公开文档</p>
                {isAuthenticated ? (
                  <Link to="/documents" className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white px-5 py-2.5 rounded-xl hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg shadow-amber-200 font-medium">
                    <Upload size={16} /> 上传第一个文档
                  </Link>
                ) : (
                  <button onClick={() => { setModalAction('上传文档'); setShowLoginModal(true) }}
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white px-5 py-2.5 rounded-xl hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg shadow-amber-200 font-medium"
                  >
                    <Upload size={16} /> 上传第一个文档
                  </button>
                )}
              </motion.div>
            ) : (
              <motion.div className="space-y-5"
                initial="hidden"
                animate="visible"
                variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1 } } }}
              >
                {Object.entries(publicDocuments).map(([category, docs]) => (
                  <motion.div
                    key={category}
                    variants={fadeIn}
                    custom={0}
                    className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-stone-100"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400/20 to-orange-400/20 flex items-center justify-center">
                        <BookOpen size={15} className="text-amber-600" />
                      </div>
                      <h3 className="font-semibold text-stone-800">{category}</h3>
                      <span className="text-sm text-stone-500">({docs.length} 文档)</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {docs.map((doc, i) => (
                        <motion.div
                          key={doc.id}
                          variants={{ hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0 } }}
                          transition={{ delay: i * 0.05, duration: 0.3 }}
                        >
                          <TiltCard>
                            <div className="border border-stone-100 rounded-xl p-3 hover:border-amber-200 hover:bg-amber-50/30 transition-all relative group">
                              <button
                                onClick={() => { documentsApi.incrementViewCount(doc.id); navigate(`/documents/${doc.id}?from=public`) }}
                                className="block w-full text-left"
                              >
                                <div className="flex items-start gap-3">
                                  <motion.div className="text-2xl" whileHover={{ scale: 1.15 }} transition={{ type: "spring", stiffness: 300 }}>
                                    {fileTypeIcons[doc.file_type] || '📄'}
                                  </motion.div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-medium text-stone-800 truncate">{doc.title}</h4>
                                      {isAuthenticated && user?.id === doc.owner_id && (
                                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full flex-shrink-0">我的</span>
                                      )}
                                    </div>
                                    <p className="text-xs text-stone-500 mt-1 truncate">{doc.filename}</p>
                                    <p className="text-xs text-stone-400 mt-1">{new Date(doc.created_at).toLocaleDateString('zh-CN')}</p>
                                  </div>
                                </div>
                              </button>
                              {isAuthenticated && user?.id === doc.owner_id && (
                                <button onClick={(e) => handleTogglePublic(doc.id, e)}
                                  disabled={togglePublicMutation.isPending}
                                  className="absolute top-2 right-2 p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  <Eye size={14} />
                                </button>
                              )}
                            </div>
                          </TiltCard>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ===== Learning Stats + Hot Docs ===== */}
        {isAuthenticated && (
          <motion.div
            ref={statsRef}
            className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8"
            initial="hidden"
            animate={statsInView ? "visible" : "hidden"}
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.15 } } }}
          >
            {/* Stats */}
            <motion.div variants={fadeIn} custom={0}>
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-stone-100 shadow-lg shadow-stone-200/20">
                <SectionTitle icon={<BarChart size={16} />} title="学习统计" />
                {loading ? (
                  <div className="space-y-5">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="flex items-center justify-between animate-pulse">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-stone-200 rounded-xl" />
                          <div><div className="w-16 h-3 bg-stone-200 rounded mb-1" /><div className="w-20 h-5 bg-stone-200 rounded" /></div>
                        </div>
                        <div className="w-12 h-4 bg-stone-200 rounded" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <motion.div className="space-y-5" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1 } } }}>
                    {[
                      { icon: <Clock className="w-5 h-5" />, label: '学习时长', value: `${overview?.total_study_minutes || 0} 分钟`, change: overview?.study_minutes_change || 0, bg: 'from-amber-400/20 to-orange-400/20', color: 'text-amber-600' },
                      { icon: <TrendingUp className="w-5 h-5" />, label: '学习效率', value: `${overview?.study_efficiency || 0}%`, change: overview?.efficiency_change || 0, bg: 'from-emerald-400/20 to-teal-400/20', color: 'text-emerald-600' },
                      { icon: <Award className="w-5 h-5" />, label: '连续学习', value: `${overview?.consecutive_study_days || 0} 天`, change: undefined, bg: 'from-violet-400/20 to-purple-400/20', color: 'text-violet-600' },
                    ].map((stat, i) => (
                      <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, x: -15 }}
                        animate={statsInView ? { opacity: 1, x: 0 } : {}}
                        transition={{ delay: 0.2 + i * 0.1 }}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.bg} flex items-center justify-center`}>
                            <div className={stat.color}>{stat.icon}</div>
                          </div>
                          <div>
                            <p className="text-sm text-stone-500">{stat.label}</p>
                            <p className="text-lg font-bold text-stone-800">{stat.value}</p>
                          </div>
                        </div>
                        <motion.span
                          className={`font-semibold ${stat.change !== undefined ? getProgressColor(stat.change) : 'text-amber-600'}`}
                          initial={{ scale: 0 }}
                          animate={statsInView ? { scale: 1 } : {}}
                          transition={{ type: "spring", delay: 0.3 + i * 0.1 }}
                        >
                          {stat.change !== undefined
                            ? `${getProgressIcon(stat.change)} ${Math.abs(stat.change)}%`
                            : (overview?.consecutive_study_days || 0) > 0 ? '🔥 保持中' : '✨ 开始吧'}
                        </motion.span>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </div>
            </motion.div>

            {/* Hot Docs */}
            <motion.div variants={fadeIn} custom={1}>
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-stone-100 shadow-lg shadow-stone-200/20">
                <SectionTitle icon={<TrendingUp size={16} />} title="🔥 热门文档" />
                {popularDocs.length > 0 ? (
                  <motion.div className="space-y-3" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}>
                    {popularDocs.map((doc, index) => (
                      <motion.div
                        key={doc.id}
                        variants={fadeIn}
                        custom={index}
                      >
                        <TiltCard>
                          <button
                            onClick={() => { documentsApi.incrementViewCount(doc.id); navigate(`/documents/${doc.id}?from=popular`) }}
                            className="block w-full text-left border border-stone-100 rounded-xl p-3 hover:border-amber-200 hover:bg-amber-50/30 transition-all"
                          >
                            <div className="flex items-start gap-3">
                              <motion.div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                  index === 0 ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-md shadow-amber-200' :
                                  index === 1 ? 'bg-gradient-to-br from-stone-400 to-stone-500 shadow-md' :
                                  index === 2 ? 'bg-gradient-to-br from-amber-700/70 to-amber-800/70 shadow-md' :
                                  'bg-stone-100'
                                }`}
                                whileHover={{ scale: 1.15 }}
                                transition={{ type: "spring", stiffness: 300 }}
                              >
                                <span className={`font-bold text-sm ${index < 3 ? 'text-white' : 'text-stone-500'}`}>{index + 1}</span>
                              </motion.div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-stone-800 truncate">{doc.title}</h3>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-stone-500">{doc.category || '未分类'}</span>
                                  <span className="text-xs text-stone-400">•</span>
                                  <span className="text-xs text-stone-500 flex items-center gap-1">
                                    <Eye size={12} /> {doc.view_count} 次浏览
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                        </TiltCard>
                      </motion.div>
                    ))}
                  </motion.div>
                ) : (
                  <div className="text-center py-10">
                    <FileText size={32} className="mx-auto text-stone-300 mb-2" />
                    <p className="text-sm text-stone-500">暂无热门文档</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </div>

      <LoginReminderModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} action={modalAction} />

      {/* BGM Reminder Modal */}
      <AnimatePresence>
        {showBgmReminder && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
              onClick={() => setShowBgmReminder(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            />
            <motion.div
              className="relative w-full max-w-sm bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/50"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 200, damping: 25 }}
            >
              <div className="absolute top-0 right-0 w-40 h-40 bg-rose-200/20 rounded-full blur-3xl" />
              <div className="relative p-8 text-center">
                <motion.div
                  className="w-16 h-16 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-rose-200"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.531v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                </motion.div>
                <h3 className="text-lg font-bold text-stone-800 mb-2">提示</h3>
                <p className="text-stone-600 mb-6">视觉小说（Narraleaf）功能会播放背景音乐，<br />是否继续进入？</p>
                <div className="flex gap-3">
                  <button onClick={() => setShowBgmReminder(false)}
                    className="flex-1 py-3 rounded-xl bg-stone-100 text-stone-600 font-medium hover:bg-stone-200 transition-all"
                  >
                    取消
                  </button>
                  <motion.button
                    onClick={() => { setShowBgmReminder(false); navigate('/game') }}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 text-white font-medium shadow-lg shadow-rose-200"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    进入
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default Home
