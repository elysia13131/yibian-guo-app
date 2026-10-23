import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronUp, Sparkles, BookOpen, GraduationCap, PenTool, Clock, Heart, Activity, BarChart3, Lightbulb, Zap, MessageCircle, FileText, Monitor, TrendingUp } from 'lucide-react'
import FormattedText from './FormattedText'

interface AgentBubbleProps {
  agentName: string
  agentIcon?: string
  reasonContent: string
  finalContent: string
  streamContent: string
  isDone: boolean
  navigate?: (path: string) => void
  taskDescription?: string
}

const AGENT_COLORS: Record<string, { icon: React.ComponentType<{ className?: string }>; from: string; to: string }> = {
  '知识管家': { icon: BookOpen, from: '#F59E0B', to: '#EA580C' },
  '教学导师': { icon: GraduationCap, from: '#8B5CF6', to: '#7C3AED' },
  '题库专家': { icon: PenTool, from: '#06B6D4', to: '#3B82F6' },
  '复习规划师': { icon: Clock, from: '#10B981', to: '#0D9488' },
  '陪伴使者': { icon: Heart, from: '#FB7185', to: '#EC4899' },
  '临床思维教练': { icon: Activity, from: '#6366F1', to: '#8B5CF6' },
  '学情分析师': { icon: BarChart3, from: '#F59E0B', to: '#F43F5E' },
  '方法论教练': { icon: Lightbulb, from: '#38BDF8', to: '#6366F1' },
  '工具调度员': { icon: Zap, from: '#84CC16', to: '#10B981' },
  'PPT设计师': { icon: Monitor, from: '#F97316', to: '#EF4444' },
  '文档助手': { icon: FileText, from: '#3B82F6', to: '#06B6D4' },
  '图表专家': { icon: TrendingUp, from: '#22C55E', to: '#14B8A6' },
  '专家讨论': { icon: MessageCircle, from: '#A8A29E', to: '#78716C' },
}

const FALLBACK_COLORS = [
  { from: '#F59E0B', to: '#EA580C' },
  { from: '#8B5CF6', to: '#7C3AED' },
  { from: '#06B6D4', to: '#3B82F6' },
  { from: '#10B981', to: '#0D9488' },
  { from: '#FB7185', to: '#EC4899' },
  { from: '#6366F1', to: '#8B5CF6' },
  { from: '#38BDF8', to: '#6366F1' },
  { from: '#84CC16', to: '#10B981' },
  { from: '#F97316', to: '#EF4444' },
]

function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function getAgentColor(name: string): { icon: React.ComponentType<{ className?: string }>; from: string; to: string } {
  const lower = (name || '').toLowerCase()
  if (lower.includes('orchestrator') || lower.includes('协调器') || lower.includes('灵枢')) {
    return { icon: Sparkles, from: '#F59E0B', to: '#EA580C' }
  }
  for (const [key, val] of Object.entries(AGENT_COLORS)) {
    if (lower.includes(key)) return val
  }
  const idx = hashName(name) % FALLBACK_COLORS.length
  return { icon: Sparkles, ...FALLBACK_COLORS[idx] }
}

function AvatarSVG({ from, to, icon: Icon, isDone, uid }: { from: string; to: string; icon: React.ComponentType<{ className?: string }>; isDone: boolean; uid: string }) {
  const gradId = `ag-${uid}`
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="block">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <filter id={`ash-${uid}`}>
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor={from} floodOpacity="0.25" />
        </filter>
      </defs>
      <circle
        cx="18" cy="18" r="16"
        fill={`url(#${gradId})`}
        filter={`url(#ash-${uid})`}
      />
      <circle
        cx="18" cy="18" r="13.5"
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1"
      />
      <foreignObject x="9" y="9" width="18" height="18">
        <div className="w-full h-full flex items-center justify-center">
          <Icon className="w-[15px] h-[15px] text-white" />
        </div>
      </foreignObject>
    </svg>
  )
}

export default function AgentBubble({
  agentName,
  reasonContent,
  finalContent,
  streamContent,
  isDone,
  navigate,
  taskDescription,
}: AgentBubbleProps) {
  const [expanded, setExpanded] = useState(false)
  const [prevDone, setPrevDone] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const color = useMemo(() => getAgentColor(agentName), [agentName])
  const isOrchestrator = color.icon === Sparkles
  const avatarUid = useMemo(() => `av-${Math.random().toString(36).slice(2, 6)}`, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [reasonContent, streamContent])

  useEffect(() => {
    if (isDone && !prevDone) {
      setExpanded(false)
    }
    setPrevDone(isDone)
  }, [isDone])

  const hasStreaming = !isDone && streamContent.length > 0
  const hasThinking = reasonContent.length > 0 || hasStreaming
  const hasResult = finalContent.length > 0

  return (
    <div className={`flex gap-2.5 min-w-0 max-w-[80%] ${isOrchestrator ? '' : 'ml-6'}`}>
      {/* Avatar */}
      <div className="flex-shrink-0 relative mt-0.5">
        <div className="relative">
          <AvatarSVG from={color.from} to={color.to} icon={color.icon} isDone={isDone} uid={avatarUid} />
          {!isDone && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border-[1.5px] border-white" />
          )}
        </div>
      </div>

      {/* Bubble */}
      <div className="flex-1 min-w-0">
        <div
          className={`bg-white/70 backdrop-blur-sm border border-stone-200/40 rounded-2xl rounded-tl-sm overflow-hidden
            transition-all duration-200
            ${isDone ? 'cursor-pointer hover:border-amber-200/60 hover:shadow-lg hover:shadow-amber-500/5' : ''}
            ${isDone && !expanded ? 'shadow-sm' : 'shadow-md'}
          `}
          onClick={() => { if (isDone) setExpanded(prev => !prev) }}
        >
          {/* Header bar with agent name */}
          <div className="flex items-center justify-between px-3 pt-2 pb-0.5">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full`} style={{ backgroundColor: color.from }} />
              <span className={`text-[11px] font-semibold ${
                isOrchestrator ? 'text-amber-700' : 'text-stone-500'
              }`}>
                {agentName}
              </span>
              {!isDone && (
                <span className="flex gap-[2px] ml-1">
                  {[0, 1, 2].map(d => (
                    <span
                      key={d}
                      className="w-1 h-1 rounded-full bg-amber-400/50"
                      style={{ animation: `bounce 0.6s ${d * 0.15}s infinite` }}
                    />
                  ))}
                </span>
              )}
            </div>
            {isDone && (
              <div className="flex items-center gap-2">
                {!expanded && hasResult && (
                  <span className="text-[9px] text-emerald-500 font-medium">已完成</span>
                )}
                <button
                  onClick={e => { e.stopPropagation(); setExpanded(prev => !prev) }}
                  className="text-stone-300 hover:text-stone-500 transition-colors"
                >
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>
            )}
          </div>

          {/* Thinking / Iteration area (top, scrollable) */}
          {(hasThinking || (isDone && expanded && reasonContent)) && (
            <div
              ref={scrollRef}
              className="max-h-28 overflow-y-auto px-3 py-1.5 mx-2 mb-1 rounded-lg bg-amber-50/30 border border-amber-100/30 scrollbar-thin"
            >
              <div className="text-[11px] text-stone-500 leading-relaxed">
                {hasStreaming ? (
                  <FormattedText content={streamContent} navigate={navigate} />
                ) : (
                  <FormattedText content={reasonContent} navigate={navigate} />
                )}
                {hasStreaming && (
                  <span className="inline-block w-0.5 h-3 bg-amber-400 rounded-full ml-0.5 animate-pulse align-middle" />
                )}
              </div>
            </div>
          )}

          {/* Result area (bottom) */}
          <div className="px-3 pb-2">
            {!isDone && !hasStreaming && !hasResult && !hasThinking && (
              <span className="text-[11px] text-stone-400 italic">正在思考...</span>
            )}

            {!isDone && hasStreaming && !hasResult && (
              <span className="text-[11px] text-stone-400 italic">正在输出...</span>
            )}

            {/* Done - collapsed: show truncated result */}
            {isDone && !expanded && (
              <>
                {taskDescription && (
                  <p className="text-[10px] text-stone-400 italic truncate mb-0.5">{taskDescription}</p>
                )}
                {hasResult && (
                  <div className="text-[13px] text-stone-600 leading-relaxed truncate">
                    <FormattedText content={finalContent.slice(0, 120) + (finalContent.length > 120 ? '...' : '')} navigate={navigate} />
                  </div>
                )}
                {!hasResult && (
                  <span className="text-[11px] text-stone-400 italic">执行完成</span>
                )}
              </>
            )}

            {/* Done - expanded: show full result */}
            {isDone && expanded && (
              <div onClick={e => e.stopPropagation()}>
                {hasResult && (
                  <div className="text-[13px] text-stone-600 leading-relaxed">
                    <FormattedText content={finalContent} navigate={navigate} />
                  </div>
                )}
                {!hasResult && reasonContent && (
                  <div className="text-[13px] text-stone-500 leading-relaxed">
                    <FormattedText content={reasonContent} navigate={navigate} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
