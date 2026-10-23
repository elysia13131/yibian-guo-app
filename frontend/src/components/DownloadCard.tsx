import { useState } from 'react'
import { Download, Loader2, CheckCircle2 } from 'lucide-react'
import { downloadOutputFile } from '../utils/download'
import { isNativePlatform } from '../utils/capacitor-download'

interface DownloadCardProps {
  filePath: string
  filename?: string
  fileType?: 'pptx' | 'pdf' | 'docx'
}

const FILE_ICONS: Record<string, { icon: string; color: string; label: string }> = {
  pptx: { icon: '📊', color: 'from-orange-400 to-red-500', label: 'PPT 演示文稿' },
  pdf: { icon: '📄', color: 'from-red-400 to-rose-500', label: 'PDF 文档' },
  docx: { icon: '📝', color: 'from-blue-400 to-indigo-500', label: 'Word 文档' },
}

export default function DownloadCard({ filePath, filename, fileType }: DownloadCardProps) {
  const [downloading, setDownloading] = useState(false)
  const [saved, setSaved] = useState(false)
  const platformIsNative = isNativePlatform()

  const name = filename || filePath.split('/').pop() || filePath.split('\\').pop() || '文件'
  const ext = (fileType || name.split('.').pop() || '').toLowerCase()
  const info = FILE_ICONS[ext] || { icon: '📎', color: 'from-stone-400 to-stone-500', label: '文件' }

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    setSaved(false)
    try {
      await downloadOutputFile(name)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      alert('文件下载失败，请重试')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 bg-white/80 backdrop-blur border border-stone-200/60 rounded-xl shadow-sm hover:shadow-md transition-shadow">
      <div className={`flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br ${info.color} flex items-center justify-center text-sm shadow-sm`}>
        {info.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-stone-700 truncate">{name}</p>
        <p className="text-[10px] text-stone-400">
          {saved
            ? (platformIsNative ? '已保存到设备' : '已下载')
            : info.label}
        </p>
      </div>
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200/50 flex items-center justify-center text-amber-600 hover:text-amber-700 transition-colors active:scale-[0.95] disabled:opacity-50"
        title="下载文件"
      >
        {downloading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : saved ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        ) : (
          <Download className="w-4 h-4" />
        )}
      </button>
    </div>
  )
}
