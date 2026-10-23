import { motion, AnimatePresence } from 'motion/react'

const EMOJI_LIST = [
  '😊', '😂', '🤣', '❤️', '🥰', '😘', '😍', '😭',
  '😤', '😡', '🤬', '😱', '🥺', '😅', '🤭', '😏',
  '😴', '🤔', '🤗', '🙄', '😬', '😮‍💨', '😌', '😔',
  '😋', '🤪', '😜', '😎', '🥳', '🤩', '😢', '😩',
  '👍', '👎', '👏', '🙌', '💪', '🤝', '🎉', '🎊',
  '💯', '🔥', '✨', '💖', '💗', '💝', '⭐', '🌟',
  '🙏', '👋', '✌️', '🫶', '💅', '🤳', '🐱', '🌸',
  '🍀', '🌙', '☀️', '🌈', '🍰', '☕', '🎵', '📚',
]

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="absolute bottom-full left-2 right-2 mb-2 z-50 bg-white/95 backdrop-blur-xl rounded-2xl shadow-lg shadow-black/5 border border-stone-200/60 p-3"
    >
      <div className="grid grid-cols-8 gap-1">
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            className="w-9 h-9 flex items-center justify-center text-xl hover:bg-rose-50 rounded-xl transition-colors active:scale-110"
          >
            {emoji}
          </button>
        ))}
      </div>
    </motion.div>
  )
}
