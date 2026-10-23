import { useId } from 'react'

interface BouncingDotsProps {
  size?: number
  color?: string
}

export default function BouncingDots({ size = 1.5, color = 'bg-amber-400/60' }: BouncingDotsProps) {
  const id = useId()

  return (
    <span className="inline-flex items-center gap-[2px]" key={id}>
      {[0, 1, 2].map(d => (
        <span
          key={d}
          className={`rounded-full ${color}`}
          style={{
            width: `${size}px`,
            height: `${size}px`,
            animation: `bounce 0.6s ${d * 0.15}s infinite`,
          }}
        />
      ))}
    </span>
  )
}
