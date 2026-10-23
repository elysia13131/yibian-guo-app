import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { History, X, ChevronRight, MessageSquare, Trash2 } from 'lucide-react'

interface DrawerSession {
  id: string
  title: string
  messages: { id: string; role: string; content: string }[]
  createdAt: string
  updatedAt: string
}

interface Props {
  visible: boolean
  onClose: () => void
  sessions: DrawerSession[]
  currentSessionId: string | null
  onSelect: (session: DrawerSession) => void
  onDelete: (sessionId: string) => void
}

export default function HistoryDrawer({ visible, onClose, sessions, currentSessionId, onSelect, onDelete }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const sorted = [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ x: -320 }}
          animate={{ x: 0 }}
          exit={{ x: -320 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="absolute left-0 top-0 bottom-0 w-80 bg-white/95 backdrop-blur-xl border-r border-stone-200 shadow-2xl z-40 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200/60">
            <span className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <History className="w-4 h-4 text-amber-500" />
              历史会话
            </span>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {sorted.length === 0 ? (
              <div className="text-center text-sm text-stone-400 py-8">暂无历史记录</div>
            ) : (
              sorted.map(session => {
                const lastMsg = session.messages.length > 0
                  ? session.messages[session.messages.length - 1].content.slice(0, 60)
                  : ''
                return (
                  <div key={session.id} className="group relative">
                    <button
                      onClick={() => { onSelect(session); onClose() }}
                      className={`w-full text-left rounded-xl border p-3 transition-all ${
                        session.id === currentSessionId
                          ? 'border-amber-300 bg-amber-50/50'
                          : 'border-stone-200/60 bg-white/50 hover:border-amber-200/40 hover:bg-amber-50/30'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <MessageSquare className="w-4 h-4 text-stone-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-stone-700 truncate">{session.title || '新对话'}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-stone-400">
                              {new Date(session.updatedAt).toLocaleString('zh-CN')}
                            </span>
                            <ChevronRight className="w-3 h-3 text-stone-300 group-hover:text-amber-400 transition-colors ml-auto" />
                          </div>
                          {lastMsg && (
                            <p className="text-[11px] text-stone-500 mt-1 line-clamp-2">{lastMsg}</p>
                          )}
                        </div>
                      </div>
                    </button>
                    <div className="absolute top-2 right-2 transition-opacity">
                      {deletingId === session.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); onDelete(session.id); setDeletingId(null) }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500 text-white hover:bg-rose-600 transition-colors"
                          >确认</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingId(null) }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-stone-200 text-stone-500 hover:bg-stone-300 transition-colors"
                          >取消</button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeletingId(session.id) }}
                          className="text-stone-300 hover:text-rose-500 transition-colors"
                        ><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}