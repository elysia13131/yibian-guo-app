import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Eye, EyeOff } from 'lucide-react'
import type { VisionMode } from '../services/CompanionMode'

interface Live2dActionMenuProps {
  visionMode: VisionMode
  onToggleVision: () => void
}

interface ActionButton {
  id: string
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  activeClassName: string
  inactiveClassName: string
}

const MENU_RADIUS = 100
const BUTTON_SIZE = 44

export default function Live2dActionMenu({ visionMode, onToggleVision }: Live2dActionMenuProps) {
  const [open, setOpen] = useState(false)

  const toggleOpen = useCallback(() => setOpen(p => !p), [])

  const buttons: ActionButton[] = [
    {
      id: 'vision',
      icon: visionMode === 'stream' ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />,
      label: visionMode === 'stream' ? '视频' : '省流',
      active: visionMode === 'stream',
      onClick: onToggleVision,
      activeClassName: 'bg-white/60 text-rose-500 shadow-sm shadow-rose-200/30',
      inactiveClassName: 'bg-white/40 text-stone-400',
    },
  ]

  const anglePerButton = buttons.length > 1 ? 70 / (buttons.length - 1) : 0
  const startAngle = 125
  const angles = buttons.map((_, i) => startAngle + i * anglePerButton)

  return (
    <div className="fixed inset-0 pointer-events-none z-40">
      <div className="absolute bottom-[140px] left-1/2 -translate-x-1/2">
        <AnimatePresence>
          {open && buttons.map((btn, i) => {
            const rad = (angles[i] * Math.PI) / 180
            const x = Math.cos(rad) * MENU_RADIUS
            const y = -Math.sin(rad) * MENU_RADIUS

            return (
              <motion.div
                key={btn.id}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.3 }}
                animate={{ opacity: 1, x, y, scale: 1 }}
                exit={{ opacity: 0, x: 0, y: 0, scale: 0.3, transition: { delay: (buttons.length - 1 - i) * 0.03 } }}
                transition={{
                  type: 'spring',
                  stiffness: 260,
                  damping: 20,
                  delay: i * 0.05,
                }}
                className="absolute"
                style={{ left: -BUTTON_SIZE / 2, top: -BUTTON_SIZE / 2 }}
              >
                <button
                  onClick={() => { btn.onClick(); setOpen(false) }}
                  className={`pointer-events-auto rounded-full flex items-center justify-center backdrop-blur-2xl border border-white/40 transition-colors active:scale-90 ${btn.active ? btn.activeClassName : btn.inactiveClassName}`}
                  style={{ width: BUTTON_SIZE, height: BUTTON_SIZE }}
                  title={btn.label}
                >
                  {btn.icon}
                </button>
                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2">
                  <span className="text-[10px] font-medium text-white/80 drop-shadow-sm whitespace-nowrap">
                    {btn.label}
                  </span>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        <motion.button
          onClick={toggleOpen}
          whileTap={{ scale: 0.9 }}
          whileHover={{ scale: 1.08 }}
          className="pointer-events-auto relative w-12 h-12 rounded-full bg-white/60 backdrop-blur-2xl border border-white/50 shadow-lg shadow-black/5 flex items-center justify-center"
          style={{ left: -24, top: -24 }}
        >
          <motion.div
            animate={{ rotate: open ? 45 : 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="flex flex-col items-center gap-[3px]"
          >
            <span className={`w-[3px] h-[3px] rounded-full transition-colors ${open ? 'bg-rose-400' : 'bg-stone-400'}`} />
            <span className={`w-[3px] h-[3px] rounded-full transition-colors ${open ? 'bg-rose-400' : 'bg-stone-400'}`} />
            <span className={`w-[3px] h-[3px] rounded-full transition-colors ${open ? 'bg-rose-400' : 'bg-stone-400'}`} />
          </motion.div>
        </motion.button>
      </div>
    </div>
  )
}
