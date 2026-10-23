import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { characterApi, CharacterResponse } from '../../api'
import { useGameWebSocket } from '../../hooks/useGameWebSocket'
import CharacterDetailModal from '../../components/CharacterDetailModal'

type TabType = 'default' | 'my' | 'borrowed' | 'market'

const GRADIENT_PRESETS = [
  'from-pink-200 via-rose-100 to-pink-100',
  'from-purple-200 via-pink-100 to-rose-100',
  'from-rose-200 via-pink-100 to-purple-100',
  'from-pink-100 via-rose-50 to-purple-100',
  'from-fuchsia-200 via-pink-100 to-rose-100',
]

function getDefaultGradient(id: number) {
  return GRADIENT_PRESETS[id % GRADIENT_PRESETS.length]
}

function CharCard({
  char,
  hasActions,
  onEdit,
  onDelete,
  onRemoveBorrow,
  onBorrow,
  onSetHome,
  onViewDetail,
  isHomeChar,
  isBorrowed = false,
}: {
  char: CharacterResponse
  hasActions: boolean
  onEdit: (id: number) => void
  onDelete: (id: number) => void
  onRemoveBorrow: (id: number) => void
  onBorrow: (char: CharacterResponse) => void
  onSetHome: (char: CharacterResponse) => void
  onViewDetail: (char: CharacterResponse) => void
  isHomeChar: boolean
  isBorrowed: boolean
}) {
  const [showActions, setShowActions] = useState(false)
  const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

  useEffect(() => {
    if (!showActions) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(`.char-card-${char.id}`)) {
        setShowActions(false)
      }
    }
    setTimeout(() => document.addEventListener('click', handler), 0)
    return () => document.removeEventListener('click', handler)
  }, [showActions, char.id])

  const portraitUrl = char.portrait_url
    ? (char.portrait_url.startsWith('http') ? char.portrait_url : `${API_BASE}${char.portrait_url}`)
    : null

  const handleCardClick = () => {
    if (!showActions) {
      setShowActions(true)
      return
    }
    onViewDetail(char)
  }

  const hasTts = !!char.speaker_id || char.is_default
  const hasVoiceSample = !!char.voice_sample_url

  return (
    <div className={`relative char-card-${char.id}`}>
      <button
        onClick={handleCardClick}
        className={`w-full text-left rounded-xl overflow-hidden border-2 transition-all duration-200 ${
          isHomeChar
            ? 'border-amber-400 shadow-lg shadow-amber-200/40'
            : showActions
              ? 'border-pink-400 shadow-lg shadow-pink-200/30'
              : 'border-pink-200 hover:border-pink-300'
        }`}
      >
        <div className={`aspect-[3/4] bg-gradient-to-br ${getDefaultGradient(char.id)} relative overflow-hidden`}>
          {isHomeChar && (
            <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full bg-amber-400 text-white text-[9px] font-bold shadow-sm">
              首页立绘
            </div>
          )}
          {portraitUrl ? (
            <img
              src={portraitUrl}
              alt={char.name}
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-pink-300 text-3xl">?</span>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/90 via-white/40 to-transparent pt-10 pb-2 px-2">
            <div className="flex items-center justify-center gap-1">
              <p className="text-pink-800 font-bold text-xs text-center truncate">{char.name}</p>
              {hasTts && (
                <svg className="w-3 h-3 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.5 4.5 0 0 0 2.5-3.5zM14 3.23v2.06a7.5 7.5 0 0 1 0 13.42v2.06a9.5 9.5 0 0 0 0-17.54z"/>
                </svg>
              )}
            </div>
            <div className="flex items-center justify-center gap-1 mt-0.5">
              <span className="text-[9px] text-pink-400">UID:</span>
              <span className="text-[9px] text-pink-500 font-mono">{char.uid}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  navigator.clipboard.writeText(char.uid)
                }}
                className="text-pink-300 hover:text-pink-500 text-[9px]"
                title="复制UID"
              >
                📋
              </button>
            </div>
          </div>
        </div>
      </button>

      {showActions && (
        <div className="absolute top-2 right-2 flex flex-col gap-1.5">
          {isBorrowed ? (
            <button
              onClick={(e) => { e.stopPropagation(); onRemoveBorrow(char.id) }}
              className="px-2 py-1 rounded-md bg-red-400 hover:bg-red-500 text-white text-[10px] font-medium transition-colors shadow-sm"
            >
              移除借阅
            </button>
          ) : (
            <>
              {hasActions && !char.is_default && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(char.id) }}
                  className="px-2 py-1 rounded-md bg-pink-400 hover:bg-pink-500 text-white text-[10px] font-medium transition-colors shadow-sm"
                >
                  修改
                </button>
              )}
              {hasActions && !char.is_default && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(char.id) }}
                  className="px-2 py-1 rounded-md bg-red-400 hover:bg-red-500 text-white text-[10px] font-medium transition-colors shadow-sm"
                >
                  删除
                </button>
              )}
              {char.is_public && !hasActions && (
                <button
                  onClick={(e) => { e.stopPropagation(); onBorrow(char) }}
                  className="px-2 py-1 rounded-md bg-pink-400 hover:bg-pink-500 text-white text-[10px] font-medium transition-colors shadow-sm"
                >
                  借阅
                </button>
              )}
              {hasVoiceSample && isBorrowed && !hasTts && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const url = char.voice_sample_url?.startsWith('http')
                      ? char.voice_sample_url
                      : `${API_BASE}${char.voice_sample_url}`
                    window.open(url, '_blank')
                  }}
                  className="px-2 py-1 rounded-md bg-emerald-400 hover:bg-emerald-500 text-white text-[10px] font-medium transition-colors shadow-sm"
                >
                  下载语音样本
                </button>
              )}
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onViewDetail(char) }}
            className="px-2 py-1 rounded-md bg-blue-400 hover:bg-blue-500 text-white text-[10px] font-medium transition-colors shadow-sm"
          >
            查看详情
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSetHome(char) }}
            className="px-2 py-1 rounded-md bg-pink-300 hover:bg-pink-400 text-white text-[10px] font-medium transition-colors shadow-sm"
          >
            设为首页立绘
          </button>
        </div>
      )}
    </div>
  )
}

export default function GameCharacterManage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabType>('default')
  const [detailChar, setDetailChar] = useState<CharacterResponse | null>(null)
  const [defaultCharacters, setDefaultCharacters] = useState<CharacterResponse[]>([])
  const [myCharacters, setMyCharacters] = useState<CharacterResponse[]>([])
  const [borrowedCharacters, setBorrowedCharacters] = useState<CharacterResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [borrowUid, setBorrowUid] = useState('')
  const [borrowLoading, setBorrowLoading] = useState(false)
  const [borrowError, setBorrowError] = useState('')
  const [publicList, setPublicList] = useState<CharacterResponse[]>([])
  const [marketSearchQuery, setMarketSearchQuery] = useState('')
  const [voiceSampleChar, setVoiceSampleChar] = useState<CharacterResponse | null>(null)
  const [showVoiceDialog, setShowVoiceDialog] = useState(false)
  const [showSpeakerInput, setShowSpeakerInput] = useState(false)
  const [speakerIdInput, setSpeakerIdInput] = useState('')

  const getDismissedIds = (): number[] => {
    try {
      return JSON.parse(localStorage.getItem('tts_dismissed_ids') || '[]')
    } catch { return [] }
  }

  const getSourceId = (char: CharacterResponse): number => {
    return char.id
  }

  const isTtsDismissed = (char: CharacterResponse): boolean => {
    return getDismissedIds().includes(getSourceId(char))
  }

  const dismissTts = (char: CharacterResponse) => {
    const ids = getDismissedIds()
    ids.push(getSourceId(char))
    localStorage.setItem('tts_dismissed_ids', JSON.stringify(ids))
  }

  const shouldShowVoiceDialog = (char: CharacterResponse): boolean => {
    return !!(char.voice_sample_url && !char.speaker_id && !char.is_default && !isTtsDismissed(char))
  }
  const [homeCharPortrait, setHomeCharPortrait] = useState<string | null>(null)

  useGameWebSocket({
    onCharacterUpdate: () => {
      if (activeTab === 'my') fetchMyCharacters()
      else if (activeTab === 'borrowed') fetchBorrowedCharacters()
      else fetchDefaultCharacters()
    },
  })

  useEffect(() => {
    try {
      const saved = localStorage.getItem('game_home_character')
      if (saved) {
        const parsed = JSON.parse(saved)
        setHomeCharPortrait(parsed.portrait_url || null)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (activeTab === 'my') {
      fetchMyCharacters()
    } else if (activeTab === 'borrowed') {
      fetchBorrowedCharacters()
    } else if (activeTab === 'market') {
      fetchPublicCharacters()
    } else {
      fetchDefaultCharacters()
    }
  }, [activeTab])

  const fetchDefaultCharacters = async () => {
    setLoading(true)
    try {
      const res = await characterApi.list('default')
      setDefaultCharacters(res.characters || [])
    } catch {
      setDefaultCharacters([])
    } finally {
      setLoading(false)
    }
  }

  const fetchMyCharacters = async () => {
    setLoading(true)
    try {
      const res = await characterApi.list('my')
      setMyCharacters(res.characters || [])
    } catch {
      setMyCharacters([])
    } finally {
      setLoading(false)
    }
  }

  const fetchBorrowedCharacters = async () => {
    setLoading(true)
    try {
      const res = await characterApi.list('borrowed')
      setBorrowedCharacters(res.characters || [])
    } catch {
      setBorrowedCharacters([])
    } finally {
      setLoading(false)
    }
  }

  const fetchPublicCharacters = async () => {
    setLoading(true)
    try {
      const res = await characterApi.list('public')
      setPublicList(res.characters || [])
    } catch {
      setPublicList([])
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该角色吗？此操作不可撤销。')) return
    try {
      await characterApi.delete(id)
      setMyCharacters(prev => prev.filter(c => c.id !== id))
    } catch (err: any) {
      alert(err.message || '删除失败')
    }
  }

  const handleEdit = (id: number) => {
    navigate(`/game/character/create?editId=${id}`)
  }

  const handleBorrowByUid = async () => {
    const uid = borrowUid.trim()
    if (!uid) return
    setBorrowLoading(true)
    setBorrowError('')
    try {
      const borrowed = await characterApi.borrowByUid(uid)
      if (borrowed && shouldShowVoiceDialog(borrowed)) {
        setVoiceSampleChar(borrowed)
        setShowSpeakerInput(false)
        setSpeakerIdInput('')
        setShowVoiceDialog(true)
      } else {
        alert('借阅成功！')
      }
      setBorrowUid('')
      if (activeTab === 'borrowed') {
        fetchBorrowedCharacters()
      }
    } catch (err: any) {
      setBorrowError(err.message || '借阅失败，请检查UID是否正确')
    } finally {
      setBorrowLoading(false)
    }
  }

  const handleRemoveBorrow = async (id: number) => {
    if (!confirm('确定要移除该借阅角色吗？')) return
    try {
      await characterApi.delete(id)
      setBorrowedCharacters(prev => prev.filter(c => c.id !== id))
    } catch (err: any) {
      alert(err.message || '移除失败')
    }
  }

  const handleBorrow = async (char: CharacterResponse) => {
    if (shouldShowVoiceDialog(char)) {
      setVoiceSampleChar(char)
      setShowSpeakerInput(false)
      setSpeakerIdInput('')
      setShowVoiceDialog(true)
      return
    }
    try {
      await characterApi.borrow(char.id)
      localStorage.setItem('game_home_character', JSON.stringify({
        portrait_url: char.portrait_url,
        name: char.name,
      }))
      setHomeCharPortrait(char.portrait_url)
      fetchBorrowedCharacters()
      alert(`已借阅「${char.name}」并设为首页立绘`)
    } catch (err) {
      console.error('借阅失败', err)
    }
  }

  const doBorrowChar = async (char: CharacterResponse) => {
    try {
      await characterApi.borrow(char.id)
      localStorage.setItem('game_home_character', JSON.stringify({
        portrait_url: char.portrait_url,
        name: char.name,
      }))
      setHomeCharPortrait(char.portrait_url)
      setShowVoiceDialog(false)
      setVoiceSampleChar(null)
      fetchBorrowedCharacters()
      alert(`已借阅「${char.name}」并设为首页立绘`)
    } catch (err) {
      console.error('借阅失败', err)
    }
  }

  const handleSetHome = (char: CharacterResponse) => {
    localStorage.setItem('game_home_character', JSON.stringify({
      portrait_url: char.portrait_url,
      name: char.name,
    }))
    setHomeCharPortrait(char.portrait_url)
    alert(`已设置「${char.name}」为首页立绘`)
  }

  const renderCharGrid = (chars: CharacterResponse[], showActions: boolean, isBorrowed = false) => {
    if (chars.length === 0) return null
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {chars.map(c => (
          <CharCard
            key={c.id}
            char={c}
            hasActions={showActions}
            isBorrowed={isBorrowed}
            isHomeChar={homeCharPortrait === c.portrait_url}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onRemoveBorrow={handleRemoveBorrow}
            onBorrow={handleBorrow}
            onSetHome={handleSetHome}
            onViewDetail={(ch) => setDetailChar(ch)}
          />
        ))}
      </div>
    )
  }

  return (
    <><div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/game')}
            className="text-pink-400 hover:text-pink-600 transition-colors text-lg"
          >
            ← 返回
          </button>
          <h1 className="text-2xl font-bold text-pink-700">角色管理</h1>
          <button
            onClick={() => navigate('/game/character/create')}
            className="px-4 py-2 bg-pink-400 hover:bg-pink-500 text-white text-sm rounded-lg transition-colors shadow-sm"
          >
            + 创建角色
          </button>
        </div>

        <div className="flex gap-1 bg-white/60 rounded-xl p-1 mb-6 border border-pink-200">
          <button
            onClick={() => setActiveTab('default')}
            className={`flex-1 py-2 text-sm rounded-lg font-medium transition-all ${
              activeTab === 'default'
                ? 'bg-pink-400 text-white shadow-sm'
                : 'text-pink-400 hover:text-pink-600'
            }`}
          >
            默认角色
          </button>
          <button
            onClick={() => setActiveTab('my')}
            className={`flex-1 py-2 text-sm rounded-lg font-medium transition-all ${
              activeTab === 'my'
                ? 'bg-pink-400 text-white shadow-sm'
                : 'text-pink-400 hover:text-pink-600'
            }`}
          >
            我的角色
          </button>
          <button
            onClick={() => setActiveTab('borrowed')}
            className={`flex-1 py-2 text-sm rounded-lg font-medium transition-all ${
              activeTab === 'borrowed'
                ? 'bg-pink-400 text-white shadow-sm'
                : 'text-pink-400 hover:text-pink-600'
            }`}
          >
            已借阅
          </button>
          <button
            onClick={() => setActiveTab('market')}
            className={`flex-1 py-2 text-sm rounded-lg font-medium transition-all ${
              activeTab === 'market'
                ? 'bg-pink-400 text-white shadow-sm'
                : 'text-pink-400 hover:text-pink-600'
            }`}
          >
            人才市场
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pink-300 border-t-pink-400 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === 'market' ? (
              <>
                <div className="mb-4">
                  <input
                    type="text"
                    value={marketSearchQuery}
                    onChange={e => setMarketSearchQuery(e.target.value)}
                    placeholder="搜索角色名称、UID、人设..."
                    className="w-full px-4 py-2.5 bg-white/80 border border-pink-200 rounded-xl text-pink-700 text-sm placeholder-pink-300 focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-300 transition-all"
                  />
                </div>
                {publicList.length > 0 ? (
                  (() => {
                    const q = marketSearchQuery.trim().toLowerCase()
                    const filtered = q
                      ? publicList.filter(c =>
                          c.name.toLowerCase().includes(q) ||
                          c.uid.toLowerCase().includes(q) ||
                          (c.prompt && c.prompt.toLowerCase().includes(q))
                        )
                      : publicList
                    return filtered.length > 0
                      ? renderCharGrid(filtered, false)
                      : <p className="text-center py-16 text-pink-300">没有匹配的角色</p>
                  })()
                ) : (
                  <p className="text-center py-16 text-pink-300">暂时没有公开的角色</p>
                )}
              </>
            ) : activeTab === 'my' ? (
              renderCharGrid(myCharacters, true)
            ) : activeTab === 'borrowed' ? (
              renderCharGrid(borrowedCharacters, false, true)
            ) : (
              renderCharGrid(defaultCharacters, false)
            )}

            {activeTab === 'my' && myCharacters.length === 0 && (
              <div className="text-center py-16">
                <p className="text-pink-300 mb-4">还没有创建角色</p>
                <button
                  onClick={() => navigate('/game/character/create')}
                  className="px-6 py-2 bg-pink-400 hover:bg-pink-500 text-white rounded-lg transition-colors"
                >
                  立即创建
                </button>
              </div>
            )}

            {activeTab === 'borrowed' && borrowedCharacters.length === 0 && (
              <div className="text-center py-16">
                <p className="text-pink-300 mb-4">还没有借阅角色</p>
              </div>
            )}

            {activeTab === 'default' && defaultCharacters.length === 0 && (
              <div className="text-center py-16">
                <p className="text-pink-300">没有可用的默认角色</p>
              </div>
            )}
          </>
        )}

        <div className="mt-8 bg-white/60 backdrop-blur-sm rounded-xl p-5 border border-pink-200">
          <h2 className="text-pink-700 font-medium mb-3">通过UID借阅角色</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={borrowUid}
              onChange={e => { setBorrowUid(e.target.value); setBorrowError('') }}
              placeholder="输入角色UID（如：aB3xK7pQ）"
              className="flex-1 px-4 py-2 bg-white/80 border border-pink-200 rounded-lg text-pink-700 text-sm placeholder-pink-300 focus:outline-none focus:border-pink-400"
              maxLength={8}
            />
            <button
              onClick={handleBorrowByUid}
              disabled={borrowLoading || !borrowUid.trim()}
              className="px-6 py-2 bg-pink-400 hover:bg-pink-500 disabled:bg-pink-200 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
            >
              {borrowLoading ? '借阅中...' : '借阅'}
            </button>
          </div>
          {borrowError && (
            <p className="text-red-400 text-sm mt-2">{borrowError}</p>
          )}
          <p className="text-pink-300 text-xs mt-2">
            向角色创建者获取UID，输入后即可将角色借阅到你的账号
          </p>
        </div>
      </div>
    </div>

    {showVoiceDialog && voiceSampleChar && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
          <div className="px-5 pt-6 pb-4">
            {!showSpeakerInput ? (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg className="w-5 h-5 text-emerald-500" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.5 4.5 0 0 0 2.5-3.5zM14 3.23v2.06a7.5 7.5 0 0 1 0 13.42v2.06a9.5 9.5 0 0 0 0-17.54z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">提供 TTS 语音</h3>
                    <p className="text-xs text-gray-500">此角色提供了语音样本</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  角色 <strong className="text-pink-600">{voiceSampleChar.name}</strong> 提供了语音克隆样本。
                  是否前往火山引擎控制台获取音色 ID？
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => window.open('https://console.volcengine.com/speech/new/clone', '_blank')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-emerald-400 to-emerald-500 text-white font-medium rounded-xl hover:opacity-90 transition"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    去火山引擎克隆音色
                  </button>
                  <button
                    onClick={() => { setShowSpeakerInput(true); setSpeakerIdInput('') }}
                    className="w-full py-2.5 bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200 transition"
                  >
                    已有音色 ID
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowVoiceDialog(false); setVoiceSampleChar(null) }}
                      className="flex-1 py-2 text-gray-400 text-sm hover:text-gray-500 transition border border-gray-200 rounded-xl"
                    >
                      稍后再说
                    </button>
                    <button
                      onClick={() => {
                        if (voiceSampleChar) dismissTts(voiceSampleChar)
                        setShowVoiceDialog(false)
                        setVoiceSampleChar(null)
                      }}
                      className="flex-1 py-2 text-gray-400 text-sm hover:text-red-500 transition border border-gray-200 rounded-xl"
                    >
                      不再提醒
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg className="w-5 h-5 text-emerald-500" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.5 4.5 0 0 0 2.5-3.5zM14 3.23v2.06a7.5 7.5 0 0 1 0 13.42v2.06a9.5 9.5 0 0 0 0-17.54z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">填写音色 ID</h3>
                    <p className="text-xs text-gray-500">输入你在火山引擎获取到的音色 ID</p>
                  </div>
                </div>
                <input
                  type="text"
                  value={speakerIdInput}
                  onChange={e => setSpeakerIdInput(e.target.value)}
                  placeholder="S_xxxxxxxx"
                  className="w-full px-4 py-3 rounded-xl border border-pink-200 text-pink-700 placeholder-pink-300 focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-300 transition-all mb-3"
                />
                <p className="text-xs text-gray-400 mb-4">
                  可在<strong>火山引擎控制台 → 声音复刻</strong>中获取
                </p>
                <div className="space-y-2">
                  <button
                    onClick={async () => {
                      if (!speakerIdInput.trim()) return
                      setShowVoiceDialog(false)
                      setVoiceSampleChar(null)
                      await doBorrowChar(voiceSampleChar)
                      if (voiceSampleChar) {
                        try {
                          await characterApi.setSpeakerId(voiceSampleChar.id, speakerIdInput.trim())
                        } catch {}
                      }
                      setSpeakerIdInput('')
                      setShowSpeakerInput(false)
                    }}
                    disabled={!speakerIdInput.trim()}
                    className="w-full py-2.5 bg-gradient-to-r from-pink-400 to-pink-500 text-white font-medium rounded-xl hover:opacity-90 transition disabled:opacity-40"
                  >
                    确认借阅
                  </button>
                  <button
                    onClick={() => { setShowSpeakerInput(false); setSpeakerIdInput('') }}
                    className="w-full py-2 text-gray-400 text-sm hover:text-gray-500 transition"
                  >
                    返回
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )}

    <CharacterDetailModal
      char={detailChar}
      open={detailChar !== null}
      onClose={() => setDetailChar(null)}
      canEdit={detailChar !== null && activeTab === 'my' && !detailChar.is_default}
      onEdit={handleEdit}
    />
  </>
)
}
