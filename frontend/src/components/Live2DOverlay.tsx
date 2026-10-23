import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { companionMode, type CompanionMode } from '../services/CompanionMode'

export default function Live2DOverlay() {
  const [mode, setMode] = useState<CompanionMode>(() => companionMode.getMode())

  useEffect(() => {
    const unsub = companionMode.subscribe((m) => setMode(m))
    return unsub
  }, [])

  return (
    <AnimatePresence>
      {mode === 'live2d' && (
        <motion.div
          key="live2d"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          transition={{ type: 'spring', stiffness: 250, damping: 25 }}
          className="fixed bottom-24 right-6 z-[80] pointer-events-none"
        >
          <div className="w-32 h-48 rounded-2xl bg-gradient-to-br from-rose-400/10 to-rose-500/10 border border-rose-200/20 backdrop-blur-sm flex items-center justify-center shadow-xl">
            <span className="text-rose-400/40 text-sm font-medium tracking-wide">Live2D</span>
          </div>
        </motion.div>
      )}
      {mode === 'floating' && (
        <motion.div
          key="floating"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="fixed bottom-6 right-6 z-[80] pointer-events-none"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-400 to-rose-500 shadow-xl shadow-rose-300/30 flex items-center justify-center ring-2 ring-white/20">
            <span className="text-white text-lg font-bold">灵</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
