import { useState } from 'react'
import { motion } from 'motion/react'
import { X, Play, Pause, Edit3 } from 'lucide-react'
import type { CharacterResponse } from '../api'

interface Props {
  char: CharacterResponse | null
  open: boolean
  onClose: () => void
  canEdit: boolean
  onEdit: (id: number) => void
}

export default function CharacterDetailModal({ char, open, onClose, canEdit, onEdit }: Props) {
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  if (!open || !char) return null

  const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
  const portraitUrl = char.portrait_url
    ? (char.portrait_url.startsWith('http') ? char.portrait_url : `${API_BASE}${char.portrait_url}`)
    : null

  const voiceUrl = char.voice_sample_url
    ? (char.voice_sample_url.startsWith('http') ? char.voice_sample_url : `${API_BASE}${char.voice_sample_url}`)
    : null

  const imageUrls = (urls: string[]) =>
    urls.map(u => u.startsWith('http') ? u : `${API_BASE}${u}`)

  const handlePlayAudio = () => {
    if (!voiceUrl) return
    const audio = document.getElementById('char-audio-preview') as HTMLAudioElement
    if (audio) {
      if (audio.paused) {
        audio.play()
        setAudioPlaying(true)
      } else {
        audio.pause()
        setAudioPlaying(false)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 左半部 — 大立绘 */}
        <div className="w-[280px] min-h-[50vh] flex-shrink-0 bg-gradient-to-br from-pink-200 to-rose-100 relative overflow-hidden">
          {portraitUrl ? (
            <img
              src={portraitUrl}
              alt={char.name}
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-pink-300/60 text-5xl font-bold">{char.name[0]}</span>
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/70 hover:bg-white/90 transition-colors"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* 右半部 — 信息 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* 名称 + 标签 */}
            <div className="mb-3">
              <h3 className="text-xl font-bold text-gray-800">{char.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-400">UID: {char.uid}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  char.is_default ? 'bg-blue-100 text-blue-600' :
                  char.is_public ? 'bg-green-100 text-green-600' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {char.is_default ? '默认' : char.is_public ? '公开' : '私有'}
                </span>
              </div>
            </div>

            {/* 语音样本 */}
            {voiceUrl && (
              <div className="mb-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handlePlayAudio}
                    className="w-9 h-9 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors flex-shrink-0"
                  >
                    {audioPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-emerald-700">语音样本</p>
                    <p className="text-[10px] text-emerald-500 truncate">{char.voice_sample_url?.split('/').pop()}</p>
                  </div>
                </div>
                <audio
                  id="char-audio-preview"
                  src={voiceUrl}
                  onEnded={() => setAudioPlaying(false)}
                  className="hidden"
                />
              </div>
            )}

            {/* 角色描述 */}
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-500 mb-1">角色描述</p>
              {char.description ? (
                <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-xl p-3 whitespace-pre-wrap line-clamp-4">
                  {char.description}
                </p>
              ) : (
                <p className="text-sm text-gray-400 italic bg-gray-50 rounded-xl p-3">暂无描述</p>
              )}
            </div>

            {/* 表情 */}
            {char.expressions && char.expressions.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-2">
                  表情差分 ({char.expressions.length})
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {imageUrls(char.expressions).slice(0, expandedIdx !== null ? undefined : 4).map((url, idx) => (
                    <div key={idx} className="relative group">
                      <img
                        src={url}
                        alt={char.expression_descriptions?.[idx] || `表情 ${idx + 1}`}
                        className="w-full aspect-square object-cover rounded-lg border border-gray-200"
                      />
                      {char.expression_descriptions?.[idx] && (
                        <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[8px] p-1 rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity truncate">
                          {char.expression_descriptions[idx]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {char.expressions.length > 4 && expandedIdx === null && (
                  <button
                    onClick={() => setExpandedIdx(0)}
                    className="text-xs text-pink-500 mt-1 hover:text-pink-600"
                  >
                    展开全部 {char.expressions.length} 个表情
                  </button>
                )}
              </div>
            )}

            {/* CG 图片 */}
            {char.cg_images && char.cg_images.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-medium text-gray-500 mb-2">
                  CG 图片 ({char.cg_images.length})
                </p>
                <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
                  {imageUrls(char.cg_images).map((url, idx) => (
                    <img
                      key={idx}
                      src={url}
                      alt={`CG ${idx + 1}`}
                      className="h-24 rounded-lg border border-gray-200 snap-start flex-shrink-0"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="px-5 py-3 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
            >
              关闭
            </button>
            {canEdit && (
              <button
                onClick={() => { onEdit(char.id); onClose() }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
              >
                <Edit3 className="w-4 h-4" />
                编辑角色
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}