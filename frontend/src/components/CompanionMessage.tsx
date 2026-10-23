import { motion } from 'motion/react'
import type { CompanionMessage as CompanionMessageType } from '../types'
import { formatMessageTime } from '../utils/formattedTime'

interface CompanionMessageProps {
  message: CompanionMessageType
  showTime: boolean
  companionName: string
  companionAvatar?: string
}

export default function CompanionMessage({
  message,
  showTime,
  companionName,
  companionAvatar,
}: CompanionMessageProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="flex-shrink-0 mt-1">
        {isUser ? (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stone-400 to-stone-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">
            我
          </div>
        ) : companionAvatar ? (
          <img src={companionAvatar} alt={companionName} className="w-8 h-8 rounded-full object-cover shadow-sm ring-2 ring-white" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-400 to-rose-500 flex items-center justify-center text-white text-xs font-bold shadow-sm shadow-rose-200/50">
            {companionName.charAt(0)}
          </div>
        )}
      </div>

      <div className={`flex flex-col gap-0.5 min-w-0 max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        {showTime && (
          <span className="text-[10px] text-stone-400/70 select-none px-1 font-medium tracking-wide">
            {formatMessageTime(message.timestamp)}
          </span>
        )}

        <div className="flex items-end gap-1.5">
          {isUser && message.status === 'failed' && (
            <div className="flex items-center gap-0.5 text-red-400 text-[11px] mb-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 26 }}
            className={`relative px-4 py-2.5 text-[14px] leading-relaxed break-words
              ${isUser
                ? 'bg-gradient-to-br from-rose-400 to-rose-500 text-white rounded-[20px] rounded-br-[4px] shadow-sm shadow-rose-300/30'
                : 'bg-white shadow-sm shadow-black/5 border border-stone-200/60 text-stone-700 rounded-[20px] rounded-bl-[4px]'
              }
            `}
          >
            {message.type === 'image' && message.mediaUrl && (
              <img
                src={message.mediaUrl}
                alt="图片消息"
                className="max-h-56 object-cover rounded-xl mb-2.5 -mx-1"
              />
            )}

            <p className="whitespace-pre-wrap leading-[1.6] tracking-wide">{message.content}</p>

            {isUser && message.status === 'sending' && (
              <span className="inline-block ml-1.5 w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse align-middle" />
            )}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
