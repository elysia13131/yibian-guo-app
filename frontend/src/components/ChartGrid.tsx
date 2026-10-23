/**
 * 图表网格组件 — 渲染 AntV 生成的图表图片
 *
 * 最多三列网格布局，展示在对话和产物区之间。
 */
import { useState } from 'react'
import { motion } from 'motion/react'
import { X, Maximize2, Minimize2, ExternalLink } from 'lucide-react'

export interface ChartImage {
  url: string
  title?: string
}

interface ChartGridProps {
  images: ChartImage[]
  onRemove?: (url: string) => void
}

export default function ChartGrid({ images, onRemove }: ChartGridProps) {
  const [lightbox, setLightbox] = useState<string | null>(null)

  if (images.length === 0) return null

  return (
    <>
      <div className="px-3 py-2">
        <div className="text-[10px] font-medium text-stone-400 mb-1.5 flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-amber-400" />
          图表
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {images.map((img, i) => (
            <motion.div
              key={`${img.url}-${i}`}
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.06 }}
              className="group relative rounded-xl overflow-hidden bg-white/60 border border-stone-200/50 shadow-sm hover:shadow-md transition-all"
            >
              <div
                className="aspect-[4/3] cursor-pointer bg-stone-50 flex items-center justify-center overflow-hidden"
                onClick={() => setLightbox(img.url)}
              >
                <img
                  src={img.url}
                  alt={img.title || `图表 ${i + 1}`}
                  className="w-full h-full object-contain p-1"
                  loading="lazy"
                />
              </div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute top-1.5 right-1.5 flex gap-1">
                  <button
                    onClick={() => setLightbox(img.url)}
                    className="w-6 h-6 rounded-lg bg-white/90 backdrop-blur-sm border border-stone-200/60 flex items-center justify-center text-stone-500 hover:text-stone-700 shadow-sm transition-colors"
                    title="放大"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                  <a
                    href={img.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-6 h-6 rounded-lg bg-white/90 backdrop-blur-sm border border-stone-200/60 flex items-center justify-center text-stone-500 hover:text-stone-700 shadow-sm transition-colors"
                    title="在新窗口打开"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {onRemove && (
                    <button
                      onClick={() => onRemove(img.url)}
                      className="w-6 h-6 rounded-lg bg-white/90 backdrop-blur-sm border border-stone-200/60 flex items-center justify-center text-rose-400 hover:text-rose-600 shadow-sm transition-colors"
                      title="移除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              {img.title && (
                <div className="px-2 py-1 border-t border-stone-100/80">
                  <p className="text-[10px] text-stone-400 truncate">{img.title}</p>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Lightbox */}
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
          <motion.img
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            src={lightbox}
            alt="图表放大"
            className="max-w-[90vw] max-h-[85vh] rounded-2xl shadow-2xl"
          />
        </div>
      )}
    </>
  )
}


export function extractChartUrls(text: string): string[] {
  if (!text) return []
  const urlRegex = /https?:\/\/[^\s"'<>]+?\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s"'<>]*)?/gi
  const matches = text.match(urlRegex)
  if (!matches) return []
  return [...new Set(matches)]
}
