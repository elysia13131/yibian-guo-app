import { motion, AnimatePresence } from 'motion/react'
import { Check, Loader2, Users, ChevronRight, Layers } from 'lucide-react'

interface TodoItem {
  id: string
  description: string
  assignees: string[]
  status: 'pending' | 'doing' | 'done' | 'failed'
  depends_on: string[]
  batch?: number
  parent_id?: string
  is_main?: boolean
}

const AGENT_ICONS: Record<string, string> = {
  knowledge_agent: '🔍', tutor_agent: '📚', quiz_agent: '✏️',
  review_planner: '📅', companion_agent: '💛', clinical_agent: '🩺',
  analytics_agent: '📊', methods_agent: '📖', tool_agent: '🛠️',
}

interface Props {
  todos: TodoItem[]
  currentDiscussionTodoId: string | null
  onTodoClick: (todoId: string) => void
}

export default function TodoPanel({ todos, currentDiscussionTodoId, onTodoClick }: Props) {
  if (todos.length === 0) return null

  const mainTodos = todos.filter(t => t.is_main || !t.parent_id)
  const subtaskMap = new Map<string, TodoItem[]>()
  for (const t of todos) {
    const parentKey = t.parent_id || ''
    if (!subtaskMap.has(parentKey)) subtaskMap.set(parentKey, [])
    subtaskMap.get(parentKey)!.push(t)
  }

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {mainTodos.map(main => {
            const subs = subtaskMap.get(main.id) || []
            const hasSubs = subs.length > 0
            const mainStatus = main.status
            const subStatuses = subs.map(s => s.status)
            const allSubsDone = subStatuses.length > 0 && subStatuses.every(s => s === 'done' || s === 'failed')
            const anySubDoing = subStatuses.some(s => s === 'doing')

            return (
              <motion.div
                key={main.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-1"
              >
                {/* Main task */}
                <div
                  onClick={() => onTodoClick(main.id)}
                  className={`rounded-xl border p-2.5 cursor-pointer transition-all ${
                    currentDiscussionTodoId === main.id
                      ? 'border-purple-300 bg-purple-50/60 ring-1 ring-purple-200'
                      : mainStatus === 'done'
                      ? 'border-emerald-200/60 bg-emerald-50/30'
                      : mainStatus === 'doing'
                      ? 'border-amber-200/60 bg-amber-50/30'
                      : mainStatus === 'failed'
                      ? 'border-rose-200/60 bg-rose-50/30'
                      : 'border-stone-200/60 bg-white/50 hover:border-amber-200/40'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 mt-0.5">
                      {mainStatus === 'done' ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                      ) : mainStatus === 'doing' ? (
                        <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                      ) : mainStatus === 'failed' ? (
                        <span className="w-4 h-4 rounded-full border-2 border-rose-400 block" />
                      ) : (
                        <span className="w-4 h-4 rounded-full border-2 border-stone-300 block" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3 h-3 text-stone-400 flex-shrink-0" />
                        <p className="text-xs font-medium text-stone-700 leading-snug">{main.description}</p>
                      </div>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {main.assignees?.map(a => (
                          <span key={a} className="text-[10px] text-stone-400">
                            {AGENT_ICONS[a] || '🤖'}
                          </span>
                        ))}
                        {hasSubs && (
                          <span className="text-[10px] text-amber-500 flex items-center gap-0.5 ml-1">
                            <ChevronRight className="w-2.5 h-2.5" />
                            {subs.filter(s => s.status === 'done').length}/{subs.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Subtasks */}
                {hasSubs && (
                  <div className="ml-3 pl-2.5 border-l-2 border-stone-200/50 space-y-1">
                    {subs.map(sub => (
                      <div
                        key={sub.id}
                        onClick={() => onTodoClick(sub.id)}
                        className={`rounded-lg border p-2 cursor-pointer transition-all ${
                          currentDiscussionTodoId === sub.id
                            ? 'border-purple-300 bg-purple-50/60 ring-1 ring-purple-200'
                            : sub.status === 'done'
                            ? 'border-emerald-200/50 bg-emerald-50/20'
                            : sub.status === 'doing'
                            ? 'border-amber-200/50 bg-amber-50/20'
                            : sub.status === 'failed'
                            ? 'border-rose-200/50 bg-rose-50/20'
                            : 'border-stone-200/40 bg-white/30 hover:border-amber-200/30'
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          <span className="flex-shrink-0 mt-0.5">
                            {sub.status === 'done' ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : sub.status === 'doing' ? (
                              <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
                            ) : sub.status === 'failed' ? (
                              <span className="w-3 h-3 rounded-full border-2 border-rose-400 block" />
                            ) : (
                              <span className="w-3 h-3 rounded-full border-2 border-stone-300 block" />
                            )}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-stone-600 leading-snug">{sub.description}</p>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {sub.assignees?.map(a => (
                                <span key={a} className="text-[9px] text-stone-400">
                                  {AGENT_ICONS[a] || '🤖'}
                                </span>
                              ))}
                              {sub.assignees.length > 1 && (
                                <span className="text-[9px] text-purple-400 flex items-center gap-0.5">
                                  <Users className="w-2 h-2" />
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
    </div>
  )
}