import { motion, AnimatePresence } from 'motion/react'
import { Check, Loader2 } from 'lucide-react'

interface FlowNodeData {
  agent_id: string
  agent_name: string
  agent_icon: string
  status: 'active' | 'thinking' | 'waiting'
}

interface Props {
  nodes: { id: string; data: FlowNodeData }[]
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  active: { color: 'text-emerald-700', bg: 'bg-emerald-100 border-emerald-300/50', label: '执行中' },
  thinking: { color: 'text-amber-700', bg: 'bg-amber-100 border-amber-300/50', label: '思考中' },
  waiting: { color: 'text-stone-400', bg: 'bg-stone-100 border-stone-200/50', label: '等待中' },
}

export default function FlowPanel({ nodes }: Props) {
  if (nodes.length === 0) return null

  return (
    <div className="flex-shrink-0 bg-white/60 backdrop-blur-xl border-b border-stone-200/50 px-6 py-2.5">
      <div className="flex items-center justify-center gap-1">
        <AnimatePresence>
          {nodes.map((node, idx) => {
            const cfg = STATUS_CONFIG[node.data.status] || STATUS_CONFIG.waiting
            return (
              <motion.div
                key={node.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-center gap-2"
              >
                {idx > 0 && (
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    className="w-10 h-px bg-stone-200 origin-left"
                  />
                )}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${cfg.bg} transition-all`}>
                  <span className="text-sm">{node.data.agent_icon || '🤖'}</span>
                  <span className={`text-xs font-medium ${cfg.color} whitespace-nowrap`}>
                    {node.data.agent_name}
                  </span>
                  {node.data.status === 'thinking' ? (
                    <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
                  ) : node.data.status === 'active' ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  ) : null}
                  <span className="text-[10px] text-stone-400 ml-0.5">{cfg.label}</span>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
