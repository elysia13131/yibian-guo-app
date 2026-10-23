/** 圆形进度条，用于显示缓存进度 */
interface CircularProgressProps {
  percent: number       // 0-100
  size?: number         // 默认 28
  strokeWidth?: number  // 默认 2.5
  className?: string
}

export default function CircularProgress({
  percent,
  size = 28,
  strokeWidth = 2.5,
  className = '',
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference

  return (
    <svg width={size} height={size} className={`transform -rotate-90 ${className}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-gray-200 dark:text-gray-600"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-blue-500 dark:text-blue-400 transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  )
}
