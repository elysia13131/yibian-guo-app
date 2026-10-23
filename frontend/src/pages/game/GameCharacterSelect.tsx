import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { characterApi, CharacterResponse } from '../../api'

type TabType = 'default' | 'my' | 'borrowed'

export default function GameCharacterSelect() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const docId = searchParams.get('docId') || ''
  const parseMode = searchParams.get('parseMode') || 'normal'

  const [activeTab, setActiveTab] = useState<TabType>('default')
  const [characters, setCharacters] = useState<CharacterResponse[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const [borrowedList, setBorrowedList] = useState<CharacterResponse[]>([])
  const [publicList, setPublicList] = useState<CharacterResponse[]>([])
  const [borrowedLoading, setBorrowedLoading] = useState(false)
  const [publicLoading, setPublicLoading] = useState(false)

  const [borrowUid, setBorrowUid] = useState('')
  const [borrowUidLoading, setBorrowUidLoading] = useState(false)
  const [borrowUidError, setBorrowUidError] = useState('')

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

  useEffect(() => {
    if (activeTab === 'borrowed') {
      fetchBorrowedTab()
    } else {
      fetchCharacters()
    }
  }, [activeTab])

  const fetchCharacters = async () => {
    setLoading(true)
    try {
      const res = await characterApi.list(activeTab)
      setCharacters(res.characters || [])
    } catch (err) {
      console.error('获取角色列表失败', err)
      setCharacters([])
    } finally {
      setLoading(false)
    }
  }

  const fetchPublicCharacters = async () => {
    setLoading(true)
    try {
      const res = await characterApi.list('public')
      setCharacters(res.characters || [])
    } catch (err) {
      console.error('获取公开角色失败', err)
      setCharacters([])
    } finally {
      setLoading(false)
    }
  }

  const fetchBorrowedTab = async () => {
    setBorrowedLoading(true)
    setPublicLoading(true)
    try {
      const [borrowedRes, publicRes] = await Promise.all([
        characterApi.list('borrowed'),
        characterApi.list('public'),
      ])
      setBorrowedList(borrowedRes.characters || [])
      setPublicList(publicRes.characters || [])
    } catch (err) {
      console.error('获取借阅角色失败', err)
    } finally {
      setBorrowedLoading(false)
      setPublicLoading(false)
    }
  }

  const handleSelect = (id: number) => {
    setSelectedId(id === selectedId ? null : id)
  }

  const handleConfirm = () => {
    if (!selectedId) return
    navigate(`/game/scene?docId=${docId}&parseMode=${parseMode}&characterId=${selectedId}`)
  }

  const doBorrow = async (id: number) => {
    try {
      await characterApi.borrow(id)
      setVoiceSampleChar(null)
      setShowVoiceDialog(false)
      if (activeTab === 'borrowed') {
        fetchBorrowedTab()
      }
    } catch (err) {
      console.error('借阅失败', err)
    }
  }

  const handleBorrow = async (id: number) => {
    const char = [...borrowedList, ...publicList, ...characters].find(c => c.id === id)
    if (char && shouldShowVoiceDialog(char)) {
      setVoiceSampleChar(char)
      setShowSpeakerInput(false)
      setSpeakerIdInput('')
      setShowVoiceDialog(true)
    } else {
      await doBorrow(id)
    }
  }

  const handleBorrowByUid = async () => {
    const uid = borrowUid.trim()
    if (!uid) return
    setBorrowUidLoading(true)
    setBorrowUidError('')
    try {
      const borrowed = await characterApi.borrowByUid(uid)
      if (borrowed && shouldShowVoiceDialog(borrowed)) {
        setVoiceSampleChar(borrowed)
        setShowSpeakerInput(false)
        setSpeakerIdInput('')
        setShowVoiceDialog(true)
      } else {
        alert('借阅成功！可在"借阅的角色"中查看')
      }
      setBorrowUid('')
      if (activeTab === 'borrowed') {
        fetchBorrowedTab()
      }
    } catch (err: any) {
      setBorrowUidError(err.message || '借阅失败')
    } finally {
      setBorrowUidLoading(false)
    }
  }

  const tabs: { key: TabType; label: string }[] = [
    { key: 'default', label: '默认角色' },
    { key: 'my', label: '我的角色' },
    { key: 'borrowed', label: '借阅的角色' },
  ]

  const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

  const renderCard = (char: CharacterResponse, showBorrow = false) => {
    const isSelected = selectedId === char.id
    const portraitUrl = char.portrait_url.startsWith('http') ? char.portrait_url : `${API_BASE}${char.portrait_url}`
    const hasTts = !!(char.speaker_id || char.is_default)
    const hasVoiceSample = !!char.voice_sample_url
    return (
      <div key={char.id} className="relative">
        <button
          onClick={() => handleSelect(char.id)}
          className={`w-full rounded-xl overflow-hidden border-2 transition-all duration-200 ${
            isSelected
              ? 'border-pink-400 shadow-lg shadow-pink-300/30'
              : 'border-pink-200 hover:border-pink-300'
          }`}
        >
          <div className="aspect-[3/4] bg-pink-50 flex items-center justify-center overflow-hidden">
            <img
              src={portraitUrl}
              alt={char.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          </div>
          <div className="p-1.5 bg-white/80">
            <div className="flex items-center justify-center gap-1">
              <p className="text-xs text-pink-700 font-medium truncate text-center">{char.name}</p>
              {hasTts && (
                <svg className="w-2.5 h-2.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.5 4.5 0 0 0 2.5-3.5zM14 3.23v2.06a7.5 7.5 0 0 1 0 13.42v2.06a9.5 9.5 0 0 0 0-17.54z"/>
                </svg>
              )}
              {!hasTts && hasVoiceSample && (
                <span className="text-[8px] text-amber-500 bg-amber-100 px-1 rounded">样本</span>
              )}
            </div>
          </div>
        </button>
        {isSelected && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-pink-400 rounded-full flex items-center justify-center shadow-lg">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        {showBorrow && (
          <button
            onClick={(e) => { e.stopPropagation(); handleBorrow(char.id) }}
            className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-pink-400 text-white text-[10px] font-medium backdrop-blur-sm hover:bg-pink-500 transition-colors"
          >
            借阅
          </button>
        )}
      </div>
    )
  }

  const renderGrid = (items: CharacterResponse[], showBorrow = false) => {
    if (items.length === 0) return null
    return (
      <div className="grid grid-cols-4 gap-2">
        {items.map(c => renderCard(c, showBorrow))}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50 overflow-y-auto">
      {showVoiceDialog && voiceSampleChar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
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
                        await doBorrow(voiceSampleChar.id)
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

      <div className="relative min-h-full pb-32">
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-pink-200">
          <div className="flex items-center justify-between px-4 h-14">
            <div className="flex items-center">
              <button
                onClick={() => navigate(-1)}
                className="p-2 -ml-2 text-pink-400 hover:text-pink-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="ml-2 text-lg font-semibold text-pink-700">选择角色</h1>
            </div>
            <button
              onClick={() => navigate(`/game/character/create?docId=${docId}&parseMode=${parseMode}`)}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-400 to-pink-500 text-white text-sm font-medium shadow-lg shadow-pink-300/25 hover:from-pink-300 hover:to-pink-400 active:scale-[0.98] transition-all duration-200"
            >
              创建角色
            </button>
          </div>

          <div className="flex px-4 gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSelectedId(null) }}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'text-pink-600 border-pink-400'
                    : 'text-pink-300 border-transparent hover:text-pink-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 mt-4 space-y-6">
          {activeTab === 'borrowed' ? (
            <>
              {borrowedLoading && publicLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-pink-300 border-t-pink-400 rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {borrowedList.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-pink-500 mb-3">我的借阅</h3>
                      {renderGrid(borrowedList)}
                    </div>
                  )}

                  {publicList.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-pink-500 mb-3">热门推荐</h3>
                      {renderGrid(publicList, true)}
                    </div>
                  )}

                  {borrowedList.length === 0 && publicList.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-pink-300">
                      <svg className="w-16 h-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                      </svg>
                      <p className="text-lg font-medium mb-1">暂无借阅角色</p>
                      <p className="text-sm">可前往默认角色或通过UID借阅</p>
                    </div>
                  )}

                  <div className="bg-white/60 backdrop-blur-sm rounded-xl p-4 border border-pink-200">
                    <h3 className="text-sm font-medium text-pink-600 mb-3">通过UID借阅</h3>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={borrowUid}
                        onChange={e => { setBorrowUid(e.target.value); setBorrowUidError('') }}
                        placeholder="输入角色UID"
                        className="flex-1 px-4 py-2 bg-white/80 border border-pink-200 rounded-lg text-pink-700 text-sm placeholder-pink-300 focus:outline-none focus:border-pink-400"
                        maxLength={8}
                      />
                      <button
                        onClick={handleBorrowByUid}
                        disabled={borrowUidLoading || !borrowUid.trim()}
                        className="px-4 py-2 bg-pink-400 hover:bg-pink-500 disabled:bg-pink-200 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
                      >
                        {borrowUidLoading ? '借阅中...' : '借阅'}
                      </button>
                    </div>
                    {borrowUidError && (
                      <p className="text-red-400 text-xs mt-2">{borrowUidError}</p>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-pink-300 border-t-pink-400 rounded-full animate-spin" />
                </div>
              ) : characters.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-pink-300">
                  <svg className="w-16 h-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  <p className="text-lg font-medium mb-1">暂无角色</p>
                  {activeTab === 'default' && <p className="text-sm">没有可用的默认角色</p>}
                  {activeTab === 'my' && (
                    <button
                      onClick={() => navigate(`/game/character/create?docId=${docId}&parseMode=${parseMode}`)}
                      className="mt-4 px-6 py-2 rounded-lg bg-white/60 text-pink-500 border border-pink-200 hover:bg-white active:scale-[0.98] transition-all duration-200"
                    >
                      去创建一个
                    </button>
                  )}
                </div>
              ) : (
                renderGrid(characters, false)
              )}
            </>
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-pink-200 px-4 py-4">
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-400 to-pink-500 text-white font-semibold shadow-lg shadow-pink-300/30 hover:shadow-xl hover:shadow-pink-300/40 hover:from-pink-300 hover:to-pink-400 active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一步：选择场景
          </button>
        </div>
      </div>
    </div>
  )
}
