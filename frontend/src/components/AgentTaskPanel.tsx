import { motion, AnimatePresence } from 'motion/react'
import { Check, X, Loader2, ChevronRight } from 'lucide-react'
import type { AgentStep } from '../types'

interface AgentTaskPanelProps {
  steps: AgentStep[]
  isVisible: boolean
}

export default function AgentTaskPanel({ steps, isVisible }: AgentTaskPanelProps) {
  if (!isVisible || steps.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mx-3 mb-2 bg-white/90 backdrop-blur-sm border border-stone-200/60 rounded-2xl overflow-hidden shadow-sm"
    >
      <div className="px-3 py-2 border-b border-stone-100">
        <span className="text-[11px] font-semibold text-stone-500">执行任务...</span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-2 text-[12px]">
            {step.status === 'pending' && <ChevronRight size={12} className="text-stone-300 flex-shrink-0" />}
            {step.status === 'in_progress' && <Loader2 size={12} className="text-amber-500 animate-spin flex-shrink-0" />}
            {step.status === 'completed' && <Check size={12} className="text-emerald-500 flex-shrink-0" />}
            {step.status === 'failed' && <X size={12} className="text-red-500 flex-shrink-0" />}
            <span className={`flex-1 ${step.status === 'completed' ? 'text-stone-500' : step.status === 'failed' ? 'text-red-500' : step.status === 'in_progress' ? 'text-amber-700 font-medium' : 'text-stone-400'}`}>
              {step.description}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
