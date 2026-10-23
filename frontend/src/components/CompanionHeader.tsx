import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface CompanionHeaderProps {
  name: string
  avatar?: string
  typingSubtitle?: string
}

export default function CompanionHeader({ name, avatar, typingSubtitle }: CompanionHeaderProps) {
  const navigate = useNavigate()

  return (
    <div className="relative z-50 bg-white/70 backdrop-blur-xl border-b border-stone-200/40">
      <div className="relative flex items-center px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 rounded-2xl hover:bg-stone-100 active:bg-stone-200/50 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-stone-500" />
        </button>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
          <div className="relative mr-2.5">
            <div className="w-8 h-8 rounded-xl overflow-hidden bg-gradient-to-br from-rose-400 to-rose-500 flex items-center justify-center shadow-sm shadow-rose-200/50">
              {avatar ? (
                <img src={avatar} alt={name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-bold text-xs tracking-wide">{name[0]}</span>
              )}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full border-2 border-white" />
          </div>
          <span className="text-sm font-bold text-stone-700 tracking-wide">
            {typingSubtitle || name}
          </span>
        </div>
      </div>
    </div>
  )
}
