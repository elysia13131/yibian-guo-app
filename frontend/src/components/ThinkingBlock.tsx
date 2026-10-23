import { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import BouncingDots from './BouncingDots'

interface ThinkingBlockProps {
  content: string
  isFinished: boolean
}

function extractTitle(content: string): string {
  const lines = content.trim().split('\n')
  if (lines.length === 0) return '思考中…'
  const first = lines[0].trim()
  const cleaned = first.replace(/^[🤔🧠🗂️📋📝🔄✨✅✍️🔧]+/, '').trim()
  if (cleaned.length > 0) return cleaned
  if (lines.length > 1) return lines[1].trim()
  return '思考中…'
}

function Paragraphs({ text }: { text: string }) {
  const ps = text.split('\n').filter(Boolean)
  return (
    <div className="space-y-0.5">
      {ps.map((p, i) => (
        <motion.div
          key={`p-${i}`}
          initial={{ opacity: 0, y: 1 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="text-[11px] text-stone-400 italic leading-relaxed"
        >
          {p}
        </motion.div>
      ))}
    </div>
  )
}

export default function ThinkingBlock({ content, isFinished }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(false)
  const prevFinishedRef = useRef(false)

  useEffect(() => {
    if (isFinished && !prevFinishedRef.current) {
      setCollapsed(true)
    }
    prevFinishedRef.current = isFinished
  }, [isFinished])

  const title = extractTitle(content)
  const hasContent = content.length > 0

  return (
    <div className="group flex items-start gap-2 px-3 py-1 cursor-pointer select-none" onClick={() => { if (hasContent) setCollapsed(!collapsed) }}>
      <div className="flex items-center gap-1.5 mt-0.5 shrink-0">
        <div className="w-3 h-3 rounded-full border border-stone-300/40 flex items-center justify-center">
          {!isFinished ? (
            <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
          ) : (
            <span className="w-1 h-1 rounded-full bg-stone-300" />
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {!hasContent ? (
          <BouncingDots size={2} color="bg-stone-400/40" />
        ) : collapsed ? (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-stone-400 italic truncate">
              {title}
            </span>
            <ChevronDown className="w-2.5 h-2.5 text-stone-300 shrink-0" />
          </div>
        ) : (
          <div>
            <Paragraphs text={content} />
            {isFinished && (
              <div className="flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronUp className="w-2.5 h-2.5 text-stone-300" />
                <span className="text-[10px] text-stone-300">收起</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
