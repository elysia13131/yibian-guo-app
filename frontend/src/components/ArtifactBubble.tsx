import { useState } from 'react'
import { FileText, FileSpreadsheet, FileImage, Download, Loader2, CheckCircle2, ExternalLink, X } from 'lucide-react'
import { downloadOutputFile } from '../utils/download'

interface ArtifactBubbleProps {
  artifact_type: string
  path: string
  title: string
  filename?: string
}

const FILE_TYPE_CONFIG: Record<string, {
  icon: typeof FileText
  borderColor: string
  iconBg: string
  iconColor: string
  label: string
}> = {
  pptx: { icon: FileSpreadsheet, borderColor: '#d97706', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', label: 'PPT' },
  pdf: { icon: FileText, borderColor: '#2563eb', iconBg: 'bg-blue-100', iconColor: 'text-blue-600', label: 'PDF' },
  docx: { icon: FileText, borderColor: '#4f46e5', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600', label: 'DOCX' },
  image: { icon: FileImage, borderColor: '#059669', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', label: '图片' },
}

const DEFAULT_CONFIG = {
  icon: FileText,
  borderColor: '#78716c',
  iconBg: 'bg-stone-100',
  iconColor: 'text-stone-600',
  label: '文件',
}

function isHttpUrl(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://')
}

export default function ArtifactBubble({ artifact_type, path, title, filename }: ArtifactBubbleProps) {
  const [downloading, setDownloading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const type = artifact_type.toLowerCase()
  const config = FILE_TYPE_CONFIG[type] || DEFAULT_CONFIG
  const IconComponent = config.icon
  const isImage = type === 'image'
  const imageUrl = isImage && isHttpUrl(path) ? path : null

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    setSaved(false)
    try {
      const downloadName = filename || path.replace(/^.*[/\\]/, '') || title
      if (isHttpUrl(path) && isImage) {
        const response = await fetch(path)
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = downloadName
        anchor.style.display = 'none'
        document.body.appendChild(anchor)
        anchor.click()
        setTimeout(() => {
          document.body.removeChild(anchor)
          URL.revokeObjectURL(url)
        }, 1000)
      } else {
        await downloadOutputFile(downloadName)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      // silent
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="relative bg-white/70 backdrop-blur-xl border border-stone-100/60 rounded-2xl shadow-sm overflow-hidden">
      <div
        className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
        style={{ backgroundColor: config.borderColor }}
      />
      {isImage && imageUrl ? (
        <div className="pl-4 pr-3 pt-3">
          <div
            className="aspect-[4/3] bg-stone-50 rounded-lg overflow-hidden cursor-pointer border border-stone-100/60 flex items-center justify-center"
            onClick={() => setLightbox(imageUrl)}
          >
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-full object-contain"
              loading="lazy"
            />
          </div>
          <div className="flex items-center gap-3 pt-2 pb-2.5">
            <div className={`flex-shrink-0 w-6 h-6 rounded-md ${config.iconBg} flex items-center justify-center`}>
              <IconComponent className={`w-3 h-3 ${config.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-stone-700 truncate leading-tight">{title}</p>
              <p className="text-[10px] text-stone-400 mt-0.5">{config.label}</p>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => window.open(imageUrl, '_blank')}
                className="flex-shrink-0 w-7 h-7 rounded-lg bg-stone-50 hover:bg-stone-100 border border-stone-200/50 flex items-center justify-center text-stone-500 hover:text-stone-700 transition-colors"
                title="在新窗口打开"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex-shrink-0 w-7 h-7 rounded-lg bg-stone-50 hover:bg-stone-100 border border-stone-200/50 flex items-center justify-center text-stone-500 hover:text-stone-700 transition-colors active:scale-[0.95] disabled:opacity-50"
                title="下载图片"
              >
                {downloading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : saved ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 pl-4 pr-3 py-2.5">
          <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${config.iconBg} flex items-center justify-center`}>
            <IconComponent className={`w-4 h-4 ${config.iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-stone-700 truncate leading-tight">{title}</p>
            <p className="text-[10px] text-stone-400 mt-0.5">{config.label}</p>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-shrink-0 w-7 h-7 rounded-lg bg-stone-50 hover:bg-stone-100 border border-stone-200/50 flex items-center justify-center text-stone-500 hover:text-stone-700 transition-colors active:scale-[0.95] disabled:opacity-50"
            title="下载文件"
          >
            {downloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-8 h-8 rounded-xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <img
            src={lightbox}
            alt={title}
            className="max-w-[90vw] max-h-[85vh] rounded-2xl shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}