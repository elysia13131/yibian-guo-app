import { motion } from 'motion/react'

export interface StageInfo {
  id: string
  label: string
  status: 'waiting' | 'active' | 'done'
  detail?: string
}

interface PipelineTimelineProps {
  stages: StageInfo[]
  currentTaskId: string | null
}

const stageIcons: Record<string, string> = {
  intent: '🎯',
  planner: '📋',
  execute: '⚡',
  assemble: '🎨',
}

export default function PipelineTimeline({ stages, currentTaskId }: PipelineTimelineProps) {
  if (!currentTaskId || stages.length === 0) return null

  const doneCount = stages.filter(s => s.status === 'done').length
  const totalCount = stages.length

  return (
    <div className="bg-white/40 backdrop-blur-md rounded-lg border border-stone-200/40 px-3 py-2 flex-1">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] font-medium text-stone-400 tracking-wide uppercase">Pipeline</div>
        <div className="text-[10px] text-stone-400">{doneCount}/{totalCount}</div>
      </div>
      <div className="flex gap-1 mb-1.5">
        {stages.map((stage) => (
          <div
            key={stage.id}
            className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
              stage.status === 'done' ? 'bg-emerald-400' :
              stage.status === 'active' ? 'bg-amber-400' :
              'bg-stone-200/60'
            }`}
          />
        ))}
      </div>
      <div className="flex justify-between">
        {stages.map((stage) => (
          <div key={stage.id} className="flex flex-col items-center gap-0.5 min-w-0 flex-1">
            <motion.div
              animate={stage.status === 'active' ? {
                scale: [1, 1.2, 1],
                transition: { repeat: Infinity, duration: 2 },
              } : {}}
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] transition-colors ${
                stage.status === 'done' ? 'bg-emerald-100 text-emerald-600' :
                stage.status === 'active' ? 'bg-amber-100 text-amber-600 ring-2 ring-amber-300' :
                'bg-stone-100/60 text-stone-400'
              }`}
            >
              {stageIcons[stage.id] || '●'}
            </motion.div>
            <div className={`text-[9px] text-center leading-tight ${
              stage.status === 'done' ? 'text-emerald-600 font-medium' :
              stage.status === 'active' ? 'text-amber-700 font-medium' :
              'text-stone-400'
            }`}>
              {stage.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
