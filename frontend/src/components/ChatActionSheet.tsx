import { motion, AnimatePresence } from 'motion/react'
import { Camera, Image, Heart } from 'lucide-react'

interface ChatActionSheetProps {
  visible: boolean
  onClose: () => void
  onAction: (action: string) => void
}

const actions = [
  { key: 'camera', icon: Camera, label: '拍照' },
  { key: 'gallery', icon: Image, label: '照片' },
  { key: 'sticker', icon: Heart, label: '收藏表情' },
]

export default function ChatActionSheet({ visible, onClose, onAction }: ChatActionSheetProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-end justify-center"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="relative w-full max-w-lg bg-white rounded-t-3xl border-t border-stone-200/60 px-2 py-3 pb-8 shadow-2xl shadow-black/5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center mb-3">
              <div className="w-8 h-1 rounded-full bg-stone-200" />
            </div>
            {actions.map((action) => (
              <button
                key={action.key}
                onClick={() => onAction(action.key)}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl hover:bg-stone-50 active:bg-stone-100 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
                  <action.icon className="w-5 h-5 text-stone-500" />
                </div>
                <span className="text-sm font-medium text-stone-700 tracking-wide">{action.label}</span>
              </button>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
