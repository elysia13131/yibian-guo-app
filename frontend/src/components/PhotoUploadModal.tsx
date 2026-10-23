import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Camera, Image as ImageIcon, X, ChevronUp, ChevronDown, Upload, Loader2 } from 'lucide-react'

interface PhotoItem {
  id: string
  file: File
  preview: string
}

interface Props {
  open: boolean
  onClose: () => void
  onUploadComplete: (documentId: number) => void
}

export default function PhotoUploadModal({ open, onClose, onUploadComplete }: Props) {
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addPhotos = useCallback((files: FileList | File[]) => {
    const valid: PhotoItem[] = []
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue
      if (valid.length + photos.length >= 300) {
        alert('最多 300 张照片')
        break
      }
      valid.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        preview: URL.createObjectURL(f),
      })
    }
    setPhotos(prev => [...prev, ...valid])
  }, [photos.length])

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
      const target = idx + dir
      if (target < 0 || target >= prev.length) return prev
      const arr = [...prev]
      const t = arr[idx]
      arr[idx] = arr[target]
      arr[target] = t
      return arr
    })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      addPhotos(e.target.files)
      e.target.value = ''
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files?.length) {
      addPhotos(e.dataTransfer.files)
    }
  }

  const handleUpload = async () => {
    if (photos.length === 0) return
    setUploading(true)
    setError('')

    try {
      const fd = new FormData()
      for (const p of photos) {
        fd.append('files', p.file)
      }

      const token = localStorage.getItem('access_token')
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || ''}/api/v1/documents/upload-photos`,
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
      onUploadComplete(data.document_id)
      onClose()
    } catch (err: any) {
      setError(err.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">上传照片</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 提示 */}
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
          <p className="text-sm text-amber-700 flex items-center gap-2">
            <ImageIcon className="w-4 h-4 flex-shrink-0" />
            请按上下文顺序上传清晰的照片，确保文字和图表清晰可见
          </p>
        </div>

        {/* 预览区域 */}
        <div className="flex-1 overflow-y-auto p-5" onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
          {photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <ImageIcon className="w-16 h-16 mb-4" />
              <p className="text-lg font-medium mb-2">拖拽照片到此处</p>
              <p className="text-sm">或点击下方按钮选择照片 / 拍照</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-500 mb-3">共 {photos.length} 张照片</p>
              {photos.map((photo, idx) => (
                <div
                  key={photo.id}
                  className="flex items-center gap-3 bg-gray-50 rounded-xl p-2 border border-gray-200"
                >
                  <span className="w-6 text-center text-xs text-gray-400 font-mono flex-shrink-0">{idx + 1}</span>
                  <img
                    src={photo.preview}
                    alt={`照片 ${idx + 1}`}
                    className="w-16 h-16 object-cover rounded-lg flex-shrink-0 bg-white"
                  />
                  <span className="flex-1 text-sm text-gray-600 truncate">{photo.file.name}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => movePhoto(photo.id, -1)}
                      disabled={idx === 0}
                      className="p-1 hover:bg-gray-200 rounded disabled:opacity-30 transition"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => movePhoto(photo.id, 1)}
                      disabled={idx === photos.length - 1}
                      className="p-1 hover:bg-gray-200 rounded disabled:opacity-30 transition"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removePhoto(photo.id)}
                      className="p-1 hover:bg-red-100 rounded text-red-400 hover:text-red-600 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="border-t border-gray-100 p-4 space-y-3">
          {error && (
            <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 disabled:opacity-50 transition flex-1 justify-center"
            >
              <Camera className="w-4 h-4" />
              拍照 / 选择照片
            </button>

            <button
              onClick={handleUpload}
              disabled={photos.length === 0 || uploading}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-xl hover:opacity-90 disabled:opacity-50 transition flex-1 justify-center"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {uploading ? '上传中...' : `上传 ${photos.length} 张照片`}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}