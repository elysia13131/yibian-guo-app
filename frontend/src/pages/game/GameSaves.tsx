import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { gameApi, characterApi, GameSaveListItem } from '../../api'
import { useGameWebSocket } from '../../hooks/useGameWebSocket'

function getCurrentUserId(): number | null {
  try {
    const payload = JSON.parse(atob(localStorage.getItem('access_token')?.split('.')[1] || ''))
    return payload?.sub ? Number(payload.sub) : null
  } catch { return null }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

interface SaveWithPreview {
  save: GameSaveListItem
  portraitUrl: string | null
  backgroundUrl: string | null
  loadingDetail: boolean
}

function resolveUrl(url: string): string {
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE}${url}`
}

function SaveCard({
  item,
  onContinue,
  onDelete,
  onShare,
  deletingId,
}: {
  item: SaveWithPreview
  onContinue: (id: number) => void
  onDelete: (id: number) => void
  onShare: (save: GameSaveListItem) => void
  deletingId: number | null
}) {
  const { save, portraitUrl, backgroundUrl } = item
  const isDeleting = deletingId === save.id
  const isGenerating = save.status === 'generating'
  const isFailed = save.status === 'failed'
  const isBorrowed = save.owner_id !== getCurrentUserId()
  const [showActions, setShowActions] = useState(false)

  useEffect(() => {
    if (!showActions) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.save-card-actions')) {
        setShowActions(false)
      }
    }
    setTimeout(() => document.addEventListener('click', handler), 0)
    return () => document.removeEventListener('click', handler)
  }, [showActions])

  const handleCardClick = () => {
    if (isDeleting) return
    setShowActions(!showActions)
  }

  return (
    <div className="relative save-card-actions">
      <button
        onClick={handleCardClick}
        disabled={isDeleting}
        className={`w-full text-left rounded-xl overflow-hidden border-2 transition-all duration-200 ${
          isDeleting
            ? 'border-pink-200 opacity-60 cursor-default'
            : showActions
              ? 'border-pink-400 shadow-lg shadow-pink-200/30'
              : 'border-pink-200 hover:border-pink-300'
        }`}
      >
        <div className="aspect-[3/4] bg-gradient-to-br from-pink-200 via-rose-100 to-pink-100 relative overflow-hidden">
          {backgroundUrl && (
            <img
              src={backgroundUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}

          {portraitUrl && (
            <img
              src={portraitUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-contain p-2"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}

          {!backgroundUrl && !portraitUrl && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-12 h-12 text-pink-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/90 via-white/40 to-transparent pt-12 pb-3 px-3">
            <p className="text-pink-800 font-bold text-sm leading-tight line-clamp-2">
              {save.document_title}
            </p>
            <p className="text-pink-400 text-[10px] mt-0.5">
              {new Date(save.created_at).toLocaleDateString('zh-CN')}
              {isBorrowed && <span className="ml-1 text-blue-400">借阅</span>}
            </p>
          </div>

          {isGenerating && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <div className="w-7 h-7 rounded-full border-2 border-pink-300 border-t-pink-400 animate-spin" />
                <span className="text-pink-500 text-xs font-medium">生成中</span>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
              <span className="text-red-400 text-xs font-medium bg-white/80 px-3 py-1 rounded-full">生成失败</span>
            </div>
          )}

          {isDeleting && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-red-300 border-t-red-400 animate-spin" />
            </div>
          )}
        </div>
      </button>

      {showActions && (
        <>
          <div className="absolute top-2 right-2 flex gap-1">
            {save.status === 'completed' && !isBorrowed && (
              <button
                onClick={(e) => { e.stopPropagation(); onShare(save) }}
                className="w-7 h-7 rounded-full bg-white/80 text-blue-400 hover:bg-blue-50 hover:text-blue-500 flex items-center justify-center shadow-sm border border-pink-200 transition-colors"
                title="分享"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(save.id) }}
              disabled={isDeleting}
              className={`w-7 h-7 rounded-full bg-white/80 flex items-center justify-center shadow-sm border border-pink-200 transition-colors disabled:opacity-50 ${
                isGenerating
                  ? 'text-amber-400 hover:bg-amber-50 hover:text-amber-500'
                  : 'text-red-400 hover:bg-red-50 hover:text-red-500'
              }`}
              title={isGenerating ? '取消生成' : '删除'}
            >
              {isGenerating ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
            </button>
          </div>

          {save.status === 'completed' && (
            <div className="absolute bottom-2 right-2">
              <button
                onClick={(e) => { e.stopPropagation(); onContinue(save.id) }}
                className="w-8 h-8 rounded-full bg-pink-400 text-white hover:bg-pink-500 shadow-sm flex items-center justify-center transition-colors"
                title="继续"
              >
                <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function GameSaves() {
  const navigate = useNavigate()
  const [items, setItems] = useState<SaveWithPreview[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [shareModalVisible, setShareModalVisible] = useState(false)
  const [selectedSave, setSelectedSave] = useState<GameSaveListItem | null>(null)
  const [borrowModalVisible, setBorrowModalVisible] = useState(false)
  const [borrowUid, setBorrowUid] = useState('')
  const [borrowing, setBorrowing] = useState(false)
  // 借阅后语音配置弹窗
  const [voiceDialogVisible, setVoiceDialogVisible] = useState(false)
  const [voiceDialogCharName, setVoiceDialogCharName] = useState('')
  const [voiceDialogCharId, setVoiceDialogCharId] = useState<number | null>(null)
  const [voiceDialogSaveId, setVoiceDialogSaveId] = useState<number | null>(null)
  const [showSpeakerInput, setShowSpeakerInput] = useState(false)
  const [speakerIdInput, setSpeakerIdInput] = useState('')

  const loadSaves = useCallback(() => {
    setLoading(true)
    gameApi.listSaves().then((res) => {
      const saves = res.saves || []
      const completedIds = saves.filter(s => s.status === 'completed').map(s => s.id)

      if (completedIds.length === 0) {
        setItems(saves.map(s => ({ save: s, portraitUrl: null, backgroundUrl: null, loadingDetail: false })))
        setLoading(false)
        return
      }

      const initialBgMap: Record<number, string | null> = {}
      try {
        const bgMap = JSON.parse(localStorage.getItem('game_save_bg_map') || '{}')
        for (const idStr of Object.keys(bgMap)) {
          const id = parseInt(idStr, 10)
          if (!isNaN(id)) initialBgMap[id] = bgMap[idStr]
        }
      } catch {}

      setItems(saves.map(s => ({
        save: s,
        portraitUrl: null,
        backgroundUrl: initialBgMap[s.id] ?? null,
        loadingDetail: false,
      })))

      Promise.allSettled(
        completedIds.map(id =>
          gameApi.getSaveDetail(id).then(detail => {
            const meta = Array.isArray(detail.sections) && detail.sections.length > 0
              ? detail.sections[0]
              : null
            const portrait = meta?.portrait_url ? resolveUrl(meta.portrait_url) : null
            const sceneSection = Array.isArray(detail.sections)
              ? detail.sections.find((s: any) => s.type === 'scene' || s.background)
              : null
            const bg = sceneSection?.background
              ? resolveUrl(sceneSection.background)
              : (initialBgMap[id] ?? null)
            return { id, portrait, background: bg }
          })
        )
      ).then(results => {
        const portraitMap: Record<number, string | null> = {}
        const bgMap: Record<number, string | null> = { ...initialBgMap }
        for (const r of results) {
          if (r.status === 'fulfilled') {
            portraitMap[r.value.id] = r.value.portrait
            if (r.value.background) bgMap[r.value.id] = r.value.background
          }
        }
        setItems(prev => prev.map(item => ({
          ...item,
          portraitUrl: portraitMap[item.save.id] ?? null,
          backgroundUrl: bgMap[item.save.id] ?? null,
        })))
        setLoading(false)
      })
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  useGameWebSocket({
    onSaveUpdate: () => { loadSaves() },
  })

  useEffect(() => {
    loadSaves()
  }, [loadSaves])

  const handleContinue = (saveId: number) => {
    navigate(`/game/play/save/${saveId}`)
  }

  const handleDelete = async (saveId: number) => {
    if (deletingId === saveId) return
    setDeletingId(saveId)
    try {
      await gameApi.deleteSave(saveId)
      setItems((prev) => prev.filter(s => s.save.id !== saveId))
    } catch {
    } finally {
      setDeletingId(null)
    }
  }

  const handleShare = (save: GameSaveListItem) => {
    setSelectedSave(save)
    setShareModalVisible(true)
  }

  const copyUid = () => {
    if (selectedSave?.uid) {
      navigator.clipboard.writeText(selectedSave.uid).then(() => {
        alert('UID 已复制到剪贴板！')
      }).catch(() => {
        alert('复制失败，请手动复制')
      })
    }
  }

  const handleBorrow = async () => {
    if (!borrowUid.trim()) return
    setBorrowing(true)
    try {
      const result = await gameApi.borrowSave(borrowUid.trim())
      setBorrowModalVisible(false)
      setBorrowUid('')
      // 检查借阅的存档是否包含有语音样本但未配置音色ID的角色
      try {
        const detail = await gameApi.getSaveDetail(result.id)
        const charMeta = detail.sections?.find(s => s.type === '_character_meta' || (s.portrait_url && s.character_name))
        if (charMeta && charMeta.voice_sample_url && !charMeta.speaker_id && !charMeta.is_default) {
          setVoiceDialogCharName(charMeta.character_name || '未知角色')
          setVoiceDialogCharId(charMeta.character_id || null)
          setVoiceDialogSaveId(result.id)
          setShowSpeakerInput(false)
          setSpeakerIdInput('')
          setVoiceDialogVisible(true)
          loadSaves()
          return
        }
      } catch { /* 获取详情失败，不阻塞 */ }
      alert('借阅成功！')
      loadSaves()
    } catch (error: any) {
      alert(error.message || '借阅失败，请检查 UID 是否正确')
    } finally {
      setBorrowing(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50 overflow-y-auto">
      <div className="relative min-h-full">
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-pink-200">
          <div className="flex items-center justify-between px-4 h-14">
            <div className="flex items-center">
              <button
                onClick={() => navigate('/game')}
                className="mr-3 text-pink-400 hover:text-pink-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-lg font-semibold text-pink-700">我的存档</h1>
            </div>
            <button
              onClick={() => setBorrowModalVisible(true)}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-400 to-blue-500 text-white text-sm font-medium hover:from-blue-300 hover:to-blue-400 transition-all duration-200"
            >
              借阅存档
            </button>
          </div>
        </div>

        <div className="px-4 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 rounded-full border-2 border-pink-300/40 border-t-pink-400 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <svg className="w-16 h-16 text-pink-300/30 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <p className="text-pink-300 text-sm">暂无存档</p>
              <button
                onClick={() => navigate('/game/select')}
                className="mt-4 px-6 py-2 rounded-lg bg-gradient-to-r from-pink-400 to-pink-500 text-white text-sm font-medium hover:from-pink-300 hover:to-pink-400 transition-all duration-200"
              >
                开始新的阅读
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map((item) => (
                <SaveCard
                  key={item.save.id}
                  item={item}
                  onContinue={handleContinue}
                  onDelete={handleDelete}
                  onShare={handleShare}
                  deletingId={deletingId}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 分享弹窗 */}
      {shareModalVisible && selectedSave && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-pink-700 mb-4">分享存档</h3>
            <p className="text-sm text-pink-500 mb-2">将此 UID 分享给朋友，他们可以借阅这个存档</p>
            <div className="bg-pink-50 border border-pink-200 rounded-lg p-3 mb-4">
              <p className="text-pink-800 font-mono text-center text-lg">{selectedSave.uid}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={copyUid}
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-pink-400 to-pink-500 text-white font-medium hover:from-pink-300 hover:to-pink-400 transition-all duration-200"
              >
                复制 UID
              </button>
              <button
                onClick={() => setShareModalVisible(false)}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition-all duration-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 借阅弹窗 */}
      {borrowModalVisible && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-pink-700 mb-4">借阅存档</h3>
            <p className="text-sm text-pink-500 mb-3">输入朋友分享的 UID 来借阅存档</p>
            <input
              type="text"
              value={borrowUid}
              onChange={(e) => setBorrowUid(e.target.value)}
              placeholder="请输入 UID"
              className="w-full px-4 py-2 border border-pink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-transparent mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={handleBorrow}
                disabled={borrowing}
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-400 to-blue-500 text-white font-medium hover:from-blue-300 hover:to-blue-400 transition-all duration-200 disabled:opacity-50"
              >
                {borrowing ? '借阅中...' : '借阅'}
              </button>
              <button
                onClick={() => { setBorrowModalVisible(false); setBorrowUid('') }}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition-all duration-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 语音配置弹窗（借阅存档后如果角色有语音样本但未配置音色ID） */}
      {voiceDialogVisible && (
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
                      <p className="text-xs text-gray-500">此存档的角色提供了语音样本</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mb-4">
                    角色 <strong className="text-pink-600">{voiceDialogCharName}</strong> 提供了语音克隆样本。
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
                        onClick={() => { setVoiceDialogVisible(false) }}
                        className="flex-1 py-2 text-gray-400 text-sm hover:text-gray-500 transition border border-gray-200 rounded-xl"
                      >
                        稍后再说
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
                        if (!speakerIdInput.trim() || !voiceDialogCharId) return
                        setVoiceDialogVisible(false)
                        setShowSpeakerInput(false)
                        try {
                          await characterApi.setSpeakerId(voiceDialogCharId, speakerIdInput.trim())
                        } catch {}
                        setSpeakerIdInput('')
                        alert('借阅成功！')
                        loadSaves()
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
    </div>
  )
}
