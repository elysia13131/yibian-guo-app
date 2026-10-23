import { formatDateDivider } from '../utils/formattedTime'

interface ChatDateDividerProps {
  timestamp: number
}

export default function ChatDateDivider({ timestamp }: ChatDateDividerProps) {
  return (
    <div className="flex items-center justify-center my-5">
      <div className="flex-1 h-px bg-stone-200/60" />
      <span className="mx-3 text-[10px] text-stone-400/60 font-medium px-3 py-1 rounded-full bg-white/60 border border-stone-200/40 tracking-wide">
        {formatDateDivider(timestamp)}
      </span>
      <div className="flex-1 h-px bg-stone-200/60" />
    </div>
  )
}
