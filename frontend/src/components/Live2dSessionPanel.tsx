import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Mic, MicOff } from 'lucide-react'
import type { CompanionMessage } from '../types'
import type { RealtimeState } from '../services/RealtimeManager'

interface Live2dSessionPanelProps {
  messages: CompanionMessage[]
  realtimeState: RealtimeState
  isMicMuted: boolean
  onToggleMic: () => void
  onExit: () => void
  isVisible: boolean
}

export default function Live2dSessionPanel({ messages, realtimeState, isMicMuted, onToggleMic, onExit, isVisible }: Live2dSessionPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="mx-3 mb-3 rounded-2xl overflow-hidden border border-rose-200/60 bg-white/80 backdrop-blur-xl shadow-xl shadow-rose-100/30 relative z-40"
        >
          <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-rose-50 to-rose-100/50 border-b border-rose-100/40">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-rose-400 to-rose-500 flex items-center justify-center">
                  <span className="text-white text-[9px] font-bold">灵</span>
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${realtimeState === 'ready' || realtimeState === 'idle' ? 'bg-rose-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
              </div>
              <span className="text-xs font-semibold text-stone-700">
                灵枢 · 实时对话
                {realtimeState === 'connecting' && <span className="text-amber-500 ml-1 font-normal">连接中...</span>}
                {realtimeState === 'idle' && <span className="text-rose-400 ml-1 font-normal">听你说话中</span>}
                {realtimeState === 'error' && <span className="text-red-400 ml-1 font-normal">连接断开</span>}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onToggleMic}
                className={`p-1.5 rounded-xl transition-colors ${isMicMuted ? 'bg-red-100 text-red-500 hover:bg-red-200' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}
              >
                {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={onExit}
                className="text-xs px-2.5 py-1 rounded-xl bg-stone-100 text-stone-500 hover:bg-stone-200 transition-colors font-medium"
              >
                结束
              </button>
            </div>
          </div>

          <div ref={listRef} className="max-h-48 overflow-y-auto px-3 py-2 space-y-1.5">
            {messages.length === 0 && (
              <div className="text-center py-4 text-xs text-stone-400">
                {realtimeState === 'connecting' ? '正在连接语音服务...' : '开始说话吧~'}
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-2.5 py-1.5 rounded-2xl text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-rose-500 text-white rounded-br-md'
                      : 'bg-stone-100 text-stone-700 rounded-bl-md'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>

          {realtimeState === 'error' && (
            <div className="px-3 pb-2">
              <button
                onClick={onExit}
                className="w-full text-xs py-1.5 rounded-xl bg-rose-50 text-rose-500 border border-rose-200/50 hover:bg-rose-100 transition-colors font-medium"
              >
                连接失败，返回文字模式
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
