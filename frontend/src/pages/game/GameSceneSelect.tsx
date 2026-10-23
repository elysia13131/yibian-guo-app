import { useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

interface SceneItem {
  id: string
  name: string
  url: string
  type: 'default' | 'custom'
}

const DEFAULT_SCENES: SceneItem[] = [
  { id: 'library', name: '图书馆', url: '/scenes/图书馆.png', type: 'default' },
  { id: 'classroom', name: '教室', url: '/scenes/教室.png', type: 'default' },
  { id: 'dormitory', name: '宿舍', url: '/scenes/宿舍.png', type: 'default' },
  { id: 'lecturehall', name: '阶梯教室', url: '/scenes/阶梯教室.jpg', type: 'default' },
]

export default function GameSceneSelect() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const docId = searchParams.get('docId') || ''
  const parseMode = searchParams.get('parseMode') || 'normal'
  const characterId = searchParams.get('characterId') || ''

  const [scenes, setScenes] = useState<SceneItem[]>(DEFAULT_SCENES)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const id = `custom_${Date.now()}`
    const newScene: SceneItem = {
      id,
      name: file.name.replace(/\.[^/.]+$/, ''),
      url,
      type: 'custom',
    }
    setScenes((prev) => [newScene, ...prev])
    setSelectedId(id)
    setPreviewUrl(url)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSelect = (id: string, url: string) => {
    setSelectedId(id)
    setPreviewUrl(url)
  }

  const handleConfirm = () => {
    if (!selectedId || !previewUrl) return
    const selected = scenes.find((s) => s.id === selectedId)
    const charIdNum = characterId ? parseInt(characterId, 10) : undefined
    const sessionData = {
      docId: parseInt(docId, 10),
      parseMode,
      characterId: charIdNum,
      sceneId: selectedId,
      sceneUrl: previewUrl,
      sceneName: selected?.name || '未知场景',
    }
    localStorage.setItem('game_last_session', JSON.stringify({
      ...sessionData,
      saveId: null,
    }))
    navigate(`/game/play/${docId}?parseMode=${parseMode}`, { state: sessionData })
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50 overflow-y-auto">
      <div className="relative min-h-full pb-32">
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-pink-200">
          <div className="flex items-center px-4 h-14">
            <button
              onClick={() => navigate(-1)}
              className="p-2 -ml-2 text-pink-400 hover:text-pink-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="ml-2 text-lg font-semibold text-pink-700">选择场景</h1>
          </div>
        </div>

        {previewUrl && (
          <div className="relative w-full h-48 mx-auto overflow-hidden">
            <img
              src={previewUrl}
              alt="preview"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-pink-100/80 via-transparent to-transparent" />
            <div className="absolute bottom-3 left-4 text-pink-700 text-sm font-medium backdrop-blur-sm bg-white/60 px-3 py-1 rounded-lg border border-pink-200">
              {scenes.find((s) => s.id === selectedId)?.name || '预览'}
            </div>
          </div>
        )}

        <div className="px-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-pink-400">默认场景</h2>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-sm text-pink-400 hover:text-pink-600 transition-colors"
            >
              + 上传自定义
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={handleUpload}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {scenes.map((scene) => (
              <button
                key={scene.id}
                onClick={() => handleSelect(scene.id, scene.url)}
                className={`relative aspect-[16/9] rounded-xl overflow-hidden border-2 transition-all duration-200 group ${
                  selectedId === scene.id
                    ? 'border-pink-400 shadow-lg shadow-pink-300/30'
                    : 'border-pink-200 hover:border-pink-300'
                }`}
              >
                <img
                  src={scene.url}
                  alt={scene.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-white/60 via-transparent to-transparent" />
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                  <span className="text-xs text-pink-700 font-medium truncate">{scene.name}</span>
                  {scene.type === 'custom' && (
                    <span className="text-[10px] text-pink-400 bg-white/60 px-1.5 py-0.5 rounded border border-pink-200">自定义</span>
                  )}
                </div>
                {selectedId === scene.id && (
                  <div className="absolute top-2 right-2 w-6 h-6 bg-pink-400 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-pink-200 px-4 py-4">
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-400 to-pink-500 text-white font-semibold shadow-lg shadow-pink-300/30 hover:shadow-xl hover:shadow-pink-300/40 hover:from-pink-300 hover:to-pink-400 active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            开始阅读
          </button>
        </div>
      </div>
    </div>
  )
}
