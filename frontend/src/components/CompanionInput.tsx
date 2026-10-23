import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Smile, Plus, Send, X } from 'lucide-react'
import EmojiPicker from './EmojiPicker'
import ChatActionSheet from './ChatActionSheet'
import { loadStickers, saveSticker, type StickerItem } from '../utils/companionMemory'

interface CompanionInputProps {
  onSend: (text: string) => void
  onSendImage: (file: File) => void
  onSendSticker: (dataUrl: string) => void
  disabled: boolean
}

export default function CompanionInput({ onSend, onSendImage, onSendSticker, disabled }: CompanionInputProps) {
  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [stickers, setStickers] = useState<StickerItem[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stickerFileInputRef = useRef<HTMLInputElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)
  const stickerPanelRef = useRef<HTMLDivElement>(null)

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const scrollH = ta.scrollHeight
    ta.style.height = `${Math.min(Math.max(scrollH, 40), 120)}px`
  }, [])

  useEffect(() => { adjustHeight() }, [text, adjustHeight])

  useEffect(() => {
    if (!showEmoji) return
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmoji(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showEmoji])

  useEffect(() => {
    if (!showStickers) return
    const handler = (e: MouseEvent) => {
      if (stickerPanelRef.current && !stickerPanelRef.current.contains(e.target as Node)) setShowStickers(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showStickers])

  const handleSend = () => {
    if (disabled) return
    const trimmed = text.trim()
    if (trimmed) { onSend(trimmed); setText('') }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleEmojiSelect = (emoji: string) => {
    setText(prev => prev + emoji)
    textareaRef.current?.focus()
  }

  const handleAction = async (action: string) => {
    setShowActionSheet(false)
    if (action === 'gallery') {
      fileInputRef.current?.click()
    } else if (action === 'camera') {
      try {
        const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
        const photo = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Camera, quality: 80 })
        if (photo.webPath) {
          const r = await fetch(photo.webPath)
          const blob = await r.blob()
          setSelectedFile(new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' }))
          setImagePreview(URL.createObjectURL(blob))
        }
      } catch {
        const input = document.createElement('input')
        input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment'
        input.onchange = (e: any) => {
          const f = e.target?.files?.[0]
          if (f) { setSelectedFile(f); setImagePreview(URL.createObjectURL(f)) }
        }
        input.click()
      }
    } else if (action === 'sticker') {
      setShowStickers(true)
      setStickers(loadStickers())
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setImagePreview(URL.createObjectURL(file))
    e.target.value = ''
  }

  const handleImageSend = () => {
    if (!selectedFile || !imagePreview) return
    onSendImage(selectedFile)
    URL.revokeObjectURL(imagePreview)
    setImagePreview(null); setSelectedFile(null)
  }

  const handleImageCancel = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(null); setSelectedFile(null)
  }

  const handleStickerSelect = (sticker: StickerItem) => {
    onSendSticker(sticker.dataUrl)
    setShowStickers(false)
  }

  const handleAddStickerImage = () => stickerFileInputRef.current?.click()

  const handleStickerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setStickers(saveSticker(reader.result as string))
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="relative z-10">
      <div ref={emojiRef}>
        <AnimatePresence>{showEmoji && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />}</AnimatePresence>
      </div>

      <AnimatePresence>
        {showStickers && (
          <motion.div ref={stickerPanelRef}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-full left-0 right-0 mb-2 mx-2 bg-white/95 backdrop-blur-xl rounded-2xl shadow-lg shadow-black/5 border border-stone-200/60 p-3 max-h-64 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-stone-500 tracking-wide">收藏表情</span>
              <div className="flex items-center gap-2">
                <button onClick={handleAddStickerImage} className="text-xs text-rose-500 font-medium hover:text-rose-600">+ 添加</button>
                <button onClick={() => setShowStickers(false)} className="p-1 rounded-full hover:bg-stone-100 transition-colors text-stone-400"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <input ref={stickerFileInputRef} type="file" accept="image/*" onChange={handleStickerFileChange} className="hidden" />
            {stickers.length === 0 ? (
              <p className="text-xs text-stone-400 text-center py-4">暂无收藏表情，点击"添加"上传图片</p>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {stickers.map(s => (
                  <button key={s.id} onClick={() => handleStickerSelect(s)}
                    className="aspect-square rounded-lg overflow-hidden hover:ring-2 hover:ring-rose-300 transition-all active:scale-95">
                    <img src={s.dataUrl} alt="sticker" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {imagePreview && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-full left-0 right-0 mb-2 mx-3 p-3 bg-white/95 backdrop-blur-xl rounded-2xl shadow-lg shadow-black/5 border border-stone-200/60 flex items-center gap-3"
          >
            <img src={imagePreview} alt="preview" className="w-12 h-12 object-cover rounded-xl border border-stone-200 flex-shrink-0" />
            <span className="flex-1 text-sm text-stone-500 truncate tracking-wide">{selectedFile?.name}</span>
            <button onClick={handleImageCancel} className="p-2 hover:bg-stone-100 rounded-xl transition-colors text-stone-400"><X className="w-4 h-4" /></button>
            <button onClick={handleImageSend} disabled={disabled}
              className="px-4 py-2 bg-gradient-to-r from-rose-400 to-rose-500 text-white text-sm font-medium rounded-xl hover:opacity-90 disabled:opacity-40 transition-all shadow-sm shadow-rose-200/50"
            >发送</button>
          </motion.div>
        )}
      </AnimatePresence>

      <ChatActionSheet visible={showActionSheet} onClose={() => setShowActionSheet(false)} onAction={handleAction} />

      <div className="bg-white/80 backdrop-blur-xl border-t border-stone-200/40 px-2 py-2.5">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <div className="flex items-center gap-0.5 pb-1">
            <button onClick={() => setShowEmoji(prev => !prev)} disabled={disabled}
              className="p-2 rounded-xl text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all disabled:opacity-30">
              <Smile className="w-5 h-5" />
            </button>
            <button onClick={() => setShowActionSheet(true)} disabled={disabled}
              className="p-2 rounded-xl text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all disabled:opacity-30">
              <Plus className="w-5 h-5" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          </div>

          <div className="flex-1 min-w-0">
            <textarea ref={textareaRef} value={text} onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown} disabled={disabled} placeholder="输入消息..."
              rows={1}
              className="w-full resize-none bg-stone-50 rounded-2xl px-4 py-[10px] text-sm text-stone-700 placeholder:text-stone-400/60 outline-none border border-stone-200/50 focus:border-rose-300/50 focus:bg-white transition-all disabled:opacity-30"
              style={{ minHeight: 40, maxHeight: 120 }}
            />
          </div>

          <div className="pb-1">
            <button onClick={handleSend} disabled={disabled || !text.trim()}
              className="p-2.5 rounded-xl bg-gradient-to-r from-rose-400 to-rose-500 text-white shadow-sm shadow-rose-200/50 hover:shadow-md hover:shadow-rose-200/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
