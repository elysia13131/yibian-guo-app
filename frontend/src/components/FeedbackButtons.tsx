import { useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'

interface Props {
  taskId: string | null
  visible: boolean
}

export default function FeedbackButtons({ taskId, visible }: Props) {
  const [submitted, setSubmitted] = useState<'like' | 'dislike' | null>(null)

  if (!visible || !taskId) return null

  const submit = async (rating: number) => {
    try {
      await fetch(`/api/v1/agent/tasks/${taskId}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ rating, feedback_text: '' }),
      })
      setSubmitted(rating === 1 ? 'like' : 'dislike')
    } catch {}
  }

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-stone-100">
      <span className="text-xs text-stone-400">这个回答有帮助吗？</span>
      <button onClick={() => submit(1)} disabled={submitted !== null}
        className={`p-1.5 rounded-lg transition-colors ${submitted === 'like' ? 'bg-emerald-100 text-emerald-600' : 'text-stone-400 hover:text-emerald-500 hover:bg-emerald-50'}`}
      ><ThumbsUp className="w-3.5 h-3.5" /></button>
      <button onClick={() => submit(-1)} disabled={submitted !== null}
        className={`p-1.5 rounded-lg transition-colors ${submitted === 'dislike' ? 'bg-rose-100 text-rose-600' : 'text-stone-400 hover:text-rose-500 hover:bg-rose-50'}`}
      ><ThumbsDown className="w-3.5 h-3.5" /></button>
    </div>
  )
}
