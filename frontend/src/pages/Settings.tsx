import { Settings as SettingsIcon, Shield, LogOut, Trash2, Lock, Eye, User, UserX, Zap, Wifi, WifiOff, Key, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { api } from '../api'
import PageTransition from '../components/PageTransition'
import ModelDownloader from '../components/ModelDownloader'

const Settings = () => {
  const navigate = useNavigate()
  const { user, logout, checkAuth } = useAuth()
  const [dataPanelOpen, setDataPanelOpen] = useState(false)
  const [privacyPanelOpen, setPrivacyPanelOpen] = useState(false)
  const [apiKeyPanelOpen, setApiKeyPanelOpen] = useState(false)
  const [cacheSize, setCacheSize] = useState('0 KB')
  const [trackAnalytics, setTrackAnalytics] = useState(true)
  const [saveHistory, setSaveHistory] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [modelMode, setModelMode] = useState<'api' | 'local'>(() => (localStorage.getItem('agentModelMode') as 'api' | 'local') || 'api')
  const [deepseekKey, setDeepseekKey] = useState('')
  const [somarkKey, setSomarkKey] = useState('')
  const [arkKey, setArkKey] = useState('')
  const [savingKeys, setSavingKeys] = useState(false)

  useEffect(() => {
    calculateCacheSize()
  }, [])

  useEffect(() => {
    if (user) {
      setDeepseekKey(user.deepseek_api_key || '')
      setSomarkKey(user.somark_api_key || '')
      setArkKey(user.api_key || '')
    }
  }, [user])

  const calculateCacheSize = () => {
    let size = 0
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        size += localStorage[key].length * 2
      }
    }
    if (size < 1024) {
      setCacheSize(size + ' B')
    } else if (size < 1024 * 1024) {
      setCacheSize((size / 1024).toFixed(2) + ' KB')
    } else {
      setCacheSize((size / (1024 * 1024)).toFixed(2) + ' MB')
    }
  }

  const handleClearCache = () => {
    if (confirm('确定要清除所有缓存数据吗？所有对话记录将丢失且无法恢复（登录状态不受影响）。')) {
      const token = localStorage.getItem('token')
      const userData = localStorage.getItem('user')
      localStorage.clear()
      if (token) localStorage.setItem('token', token)
      if (userData) localStorage.setItem('user', userData)
      calculateCacheSize()
      alert('缓存已清除，对话记录已删除')
    }
  }

  const handleSaveApiKeys = async () => {
    setSavingKeys(true)
    try {
      await api.put('/api/v1/auth/me/settings', {
        player_title: user?.player_title || '同学',
        api_key: arkKey,
        deepseek_api_key: deepseekKey,
        somark_api_key: somarkKey,
      })
      await checkAuth()
      alert('API Key 已保存')
    } catch (error: any) {
      console.error('保存 API Key 失败:', error)
      alert(`保存失败: ${error.message || '未知错误'}`)
    } finally {
      setSavingKeys(false)
    }
  }

  const handleLogout = () => {
    if (confirm('确定要退出登录吗？')) {
      logout()
      navigate('/auth')
    }
  }

  const handleDeleteAccount = async () => {
    if (!confirm('警告！这将永久删除你的账号和所有相关数据，此操作不可恢复！\n\n你确定要继续吗？')) {
      return
    }

    if (!prompt('为确认此操作，请输入你的账号邮箱地址：', '')?.toLowerCase()) {
      alert('邮箱验证失败，操作已取消')
      return
    }

    if (!confirm('最后确认：此操作将永久删除你的账号，所有学习数据、文档记录将被永久清除且无法恢复！\n\n确定要继续吗？')) {
      return
    }

    setIsDeleting(true)
    try {
      await api.delete('/api/v1/auth/me')
      logout()
      navigate('/auth')
      alert('账号已删除成功')
    } catch (error: any) {
      console.error('删除账号失败:', error)
      alert(`删除失败: ${error.message || '未知错误'}`)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <PageTransition>
      <motion.div
        className="p-4 min-h-[calc(100vh-80px)]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
      <div className="max-w-4xl mx-auto">
        {/* 页面标题 */}
        <div className="flex items-center space-x-3 mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <SettingsIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">个人中心</h1>
            <p className="text-gray-600">管理你的账号和个性化设置</p>
          </div>
        </div>

        {/* 用户信息卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 border border-gray-200">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <User className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">{user?.username || '未登录'}</h2>
              <p className="text-gray-600 text-sm">{user?.email || '请先登录'}</p>
            </div>
          </div>
        </div>

        {/* API Key 管理 */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-6 border border-gray-200">
          <div
            className="flex items-center justify-between p-4 hover:bg-gray-50 transition cursor-pointer"
            onClick={() => setApiKeyPanelOpen(!apiKeyPanelOpen)}
          >
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center text-white shadow-md shadow-orange-500/20">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">API Key 管理</h3>
                <p className="text-sm text-gray-500">填写你自己的 API Key 以使用 AI 功能</p>
                <p className="text-xs text-amber-600/90 mt-0.5">由于 AI 限制，暂时需要配置 DeepSeek 以及火山引擎 API，后续将增加完全免费的多模态 AI 模型</p>
                <p className="text-xs text-green-600/90">公共 API 即将上线</p>
              </div>
            </div>
            <span className={`transition-transform duration-200 ${apiKeyPanelOpen ? 'rotate-90' : ''} text-gray-600`}>›</span>
          </div>

          {apiKeyPanelOpen && (
            <div className="p-4 bg-gray-50 border-t border-gray-200 space-y-4">
              <div className="space-y-1 bg-blue-50/80 px-3 py-2.5 rounded-lg border border-blue-200/50">
                <p className="text-xs text-blue-700 font-medium">💡 为什么需要配置 API Key？</p>
                <p className="text-xs text-blue-600/80">
                  使用你自己的 Key 后不再依赖公共 Key，响应更快更稳定。除 DeepSeek 外，SoMark 和火山引擎均有免费额度，可零成本使用。
                </p>
              </div>

              {/* DeepSeek */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    DeepSeek API Key
                  </label>
                  <a
                    href="https://platform.deepseek.com/api_keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                  >
                    <ExternalLink size={12} />
                    去获取
                  </a>
                </div>
                <input
                  type="password"
                  value={deepseekKey}
                  onChange={e => setDeepseekKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">用于 AI 对话、文档分析、思维导图生成</p>
              </div>

              {/* SoMark */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    SoMark API Key <span className="text-xs text-green-600 font-normal">（有免费额度）</span>
                  </label>
                  <a
                    href="https://somark.tech"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                  >
                    <ExternalLink size={12} />
                    去获取
                  </a>
                </div>
                <input
                  type="password"
                  value={somarkKey}
                  onChange={e => setSomarkKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">用于 PDF、DOCX 等文档智能解析</p>
                <div className="mt-1.5 space-y-1">
                  <p className="text-xs text-emerald-700 bg-emerald-100/70 px-2.5 py-1.5 rounded-lg border border-emerald-200/50">
                    🆓 注册即送免费解析额度
                  </p>
                  <p className="text-xs text-emerald-700 bg-emerald-100/70 px-2.5 py-1.5 rounded-lg border border-emerald-200/50">
                    📱 微信扫码关注 SoMark 公众号额外赠送 1000 页解析额度（在公众号中获取 API Key）
                  </p>
                </div>
              </div>

              {/* 火山引擎 */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    火山引擎 API Key <span className="text-xs text-green-600 font-normal">（有免费额度）</span>
                  </label>
                  <a
                    href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                  >
                    <ExternalLink size={12} />
                    去获取
                  </a>
                </div>
                <input
                  type="password"
                  value={arkKey}
                  onChange={e => setArkKey(e.target.value)}
                  placeholder="ark-..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">用于 AI 生成图片（Seedream 模型）</p>
                <p className="text-xs text-green-700 bg-green-100/70 px-2.5 py-1.5 rounded-lg border border-green-200/50 mt-1.5">
                  🆓 新用户注册即享免费生图额度
                </p>
              </div>

              <button
                onClick={handleSaveApiKeys}
                disabled={savingKeys}
                className="w-full py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-blue-600 hover:to-blue-700 transition disabled:opacity-50"
              >
                {savingKeys ? '保存中...' : '保存 API Key'}
              </button>
            </div>
          )}
        </div>

        {/* 端侧模型管理 */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8 border border-gray-200">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center shadow-md shadow-violet-500/20">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">AI 模型</h2>
                <p className="text-sm text-gray-500">管理端侧推理模型</p>
              </div>
            </div>
            <ModelDownloader />
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-3">灵枢推理模式</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { localStorage.setItem('agentModelMode', 'api'); setModelMode('api') }}
                  className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    modelMode === 'api'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm'
                      : 'bg-gray-50 text-gray-500 border border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Wifi className="w-3.5 h-3.5" />
                  云 API
                  <span className="text-[10px] opacity-60 ml-auto">默认</span>
                </button>
                <button
                  onClick={() => { localStorage.setItem('agentModelMode', 'local'); setModelMode('local') }}
                  className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    modelMode === 'local'
                      ? 'bg-violet-50 text-violet-700 border border-violet-200 shadow-sm'
                      : 'bg-gray-50 text-gray-500 border border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <WifiOff className="w-3.5 h-3.5" />
                  本地模型
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 设置选项 */}
        <h2 className="text-xl font-bold text-gray-800 mb-4">设置</h2>
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8 border border-gray-200">
          {/* 数据管理 */}
          <div className="flex items-center justify-between p-4 border-b hover:bg-gray-50 transition cursor-pointer border-gray-200" onClick={() => setDataPanelOpen(!dataPanelOpen)}>
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-700">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">数据管理</h3>
                <p className="text-sm text-gray-600">当前缓存：{cacheSize}</p>
              </div>
            </div>
            <span className={`transition-transform duration-200 ${dataPanelOpen ? 'rotate-90' : ''} text-gray-600`}>›</span>
          </div>

          {/* 数据管理展开面板 */}
          {dataPanelOpen && (
            <div className="p-4 border-b bg-gray-50 border-gray-200">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800">清除缓存</p>
                    <p className="text-sm text-gray-600">清除本地存储数据（不含 AI 模型文件）</p>
                  </div>
                  <button
                    onClick={handleClearCache}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
                  >
                    清除
                  </button>
                </div>
                <p className="text-xs text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200/30">
                  ⚠️ 清除缓存将删除所有对话记录（历史消息、产物元数据等），此操作不可恢复。
                </p>
                <p className="text-xs text-gray-500 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-200/30">
                  AI 模型文件不包含在缓存清除中，如需删除 AI 模型请在上方「AI 模型」板块操作
                </p>
              </div>
            </div>
          )}

          {/* 隐私与安全 */}
          <div className="flex items-center justify-between p-4 hover:bg-gray-50 transition cursor-pointer border-gray-200" onClick={() => setPrivacyPanelOpen(!privacyPanelOpen)}>
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-700">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">隐私与安全</h3>
                <p className="text-sm text-gray-600">管理隐私设置</p>
              </div>
            </div>
            <span className={`transition-transform duration-200 ${privacyPanelOpen ? 'rotate-90' : ''} text-gray-600`}>›</span>
          </div>

          {/* 隐私与安全展开面板 */}
          {privacyPanelOpen && (
            <div className="p-4 bg-gray-50 border-gray-200">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Eye className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="font-medium text-gray-800">分析数据</p>
                      <p className="text-sm text-gray-600">允许收集匿名使用数据</p>
                    </div>
                  </div>
                  <div
                    className={`w-12 h-7 rounded-full transition-colors ${trackAnalytics ? 'bg-blue-600' : 'bg-gray-300'} relative cursor-pointer`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setTrackAnalytics(!trackAnalytics)
                    }}
                  >
                    <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${trackAnalytics ? 'right-0.5' : 'left-0.5'}`}></div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Lock className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="font-medium text-gray-800">保存历史</p>
                      <p className="text-sm text-gray-600">保存学习历史记录</p>
                    </div>
                  </div>
                  <div
                    className={`w-12 h-7 rounded-full transition-colors ${saveHistory ? 'bg-blue-600' : 'bg-gray-300'} relative cursor-pointer`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSaveHistory(!saveHistory)
                    }}
                  >
                    <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${saveHistory ? 'right-0.5' : 'left-0.5'}`}></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 应用信息 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">应用信息</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">版本</span>
              <span className="font-medium text-gray-800">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">构建号</span>
              <span className="font-medium text-gray-800">2026.04.20</span>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="space-y-3">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 text-gray-700 font-semibold py-3 rounded-xl border border-gray-300 hover:bg-gray-50 transition"
          >
            <LogOut className="w-5 h-5" />
            <span>退出登录</span>
          </button>
          
          <button
            onClick={handleDeleteAccount}
            disabled={isDeleting}
            className="w-full flex items-center justify-center gap-2 text-red-600 font-semibold py-3 rounded-xl border border-red-300 hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UserX className="w-5 h-5" />
            <span>{isDeleting ? '注销中...' : '注销账号'}</span>
          </button>
        </div>

        {/* 关于信息 */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-600">
            一遍过学习平台 © 2026
          </p>
          <p className="text-xs mt-1 text-gray-400">
            版本 1.0.0 · 构建 2026.04.20
          </p>
        </div>
      </div>
      </motion.div>
    </PageTransition>
  )
}

export default Settings