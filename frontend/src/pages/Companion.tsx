import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, MessageCircle } from 'lucide-react'
import CompanionMessage from '../components/CompanionMessage'
import ChatDateDivider from '../components/ChatDateDivider'
import CompanionInput from '../components/CompanionInput'
import AgentTaskPanel from '../components/AgentTaskPanel'
import Live2dSessionPanel from '../components/Live2dSessionPanel'
import Live2dActionMenu from '../components/Live2dActionMenu'
import { useCompanion, CompanionProvider } from '../contexts/CompanionContext'
import { shouldShowDateDivider } from '../utils/formattedTime'

function CompanionChat() {
  const { messages, isTyping, typingContent, sendText, sendImage, sendSticker, error, agentSteps, currentMode, visionMode, toggleMode, toggleVisionMode, realtimeState, live2dMessages, isMicMuted, toggleMic, deactivateLive2D } = useCompanion()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, typingContent])

  const showTimeForIndex = (index: number): boolean => {
    if (index === messages.length - 1) return true
    const current = messages[index].timestamp
    const next = messages[index + 1].timestamp
    return next - current > 5 * 60 * 1000
  }

  return (
    <div className="flex flex-col h-dvh bg-gradient-to-b from-[#faf8f5] to-[#f5f0eb]">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-rose-200/20 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-amber-100/30 rounded-full blur-[120px]" />
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.5' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E")`,
          backgroundSize: '100px 100px',
        }} />
      </div>

      <div className="relative z-50 bg-white/70 backdrop-blur-xl border-b border-stone-200/40">
        <div className="relative flex items-center px-4 py-3">
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
            <div className="relative mr-2.5">
              <div className="w-8 h-8 rounded-xl overflow-hidden bg-gradient-to-br from-rose-400 to-rose-500 flex items-center justify-center shadow-sm shadow-rose-200/50">
                <span className="text-white font-bold text-xs tracking-wide">灵</span>
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-white ${
                currentMode === 'live2d' ? (realtimeState === 'ready' || realtimeState === 'idle' ? 'bg-rose-400 animate-pulse' : 'bg-amber-400 animate-pulse') : 'bg-emerald-400'
              }`} />
            </div>
            <span className="text-sm font-bold text-stone-700 tracking-wide">
              {isTyping ? '对方正在输入...' : currentMode === 'live2d' ? (realtimeState === 'ready' || realtimeState === 'idle' ? '灵枢 · 陪伴中' : '灵枢 · 连接中...') : '灵枢'}
            </span>
          </div>
          <button
            onClick={toggleMode}
            className={`ml-auto p-2 rounded-2xl transition-all active:scale-95 ${currentMode === 'live2d' ? 'bg-rose-100 text-rose-500 hover:bg-rose-200' : 'bg-stone-100 text-stone-400 hover:bg-stone-200 hover:text-stone-600'}`}
          >
            {currentMode === 'live2d' ? <Sparkles className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden relative z-10"
          >
            <div className="mx-4 mt-3 px-4 py-2.5 bg-rose-50 border border-rose-200/60 rounded-2xl">
              <p className="text-xs text-rose-500 text-center font-medium tracking-wide">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1 relative z-10">
        {messages.map((msg, index) => (
          <div key={msg.id}>
            {index === 0 && <ChatDateDivider timestamp={msg.timestamp} />}
            {index > 0 && shouldShowDateDivider(msg.timestamp, messages[index - 1].timestamp) && (
              <ChatDateDivider timestamp={msg.timestamp} />
            )}
            <div className="py-1">
              <CompanionMessage
                message={msg}
                showTime={showTimeForIndex(index)}
                companionName="灵枢"
              />
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-3 py-2.5 px-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-sm shadow-rose-200/50">
              <span className="text-white text-[10px] font-bold tracking-wide">灵</span>
            </div>
            <div className="bg-white shadow-sm shadow-black/5 border border-stone-200/60 rounded-2xl rounded-bl-md px-4 py-2.5">
              <span className="text-xs text-stone-400 tracking-wide italic">对方正在输入...</span>
            </div>
          </div>
        )}

        <div className="h-3" />
      </div>

      {agentSteps.length > 0 && <AgentTaskPanel steps={agentSteps} isVisible={true} />}

      {currentMode === 'live2d' && (
        <Live2dActionMenu visionMode={visionMode} onToggleVision={toggleVisionMode} />
      )}

      <Live2dSessionPanel
        messages={live2dMessages}
        realtimeState={realtimeState}
        isMicMuted={isMicMuted}
        onToggleMic={toggleMic}
        onExit={deactivateLive2D}
        isVisible={currentMode === 'live2d'}
      />

      <CompanionInput onSend={sendText} onSendImage={sendImage} onSendSticker={sendSticker} disabled={isTyping} />
    </div>
  )
}

export default function Companion() {
  return (
    <CompanionProvider>
      <CompanionChat />
    </CompanionProvider>
  )
}
