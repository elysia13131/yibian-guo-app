import { useRef, useState } from 'react'
import { motion } from 'motion/react'

export default function TiltCard({ children, className, glow = true }: { children: React.ReactNode; className?: string; glow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [glowPos, setGlowPos] = useState({ x: 50, y: 50 })
  const [isHovered, setIsHovered] = useState(false)

  const handleMouse = (e: React.MouseEvent) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setTilt({ x: (y - 0.5) * -14, y: (x - 0.5) * 14 })
    setGlowPos({ x: x * 100, y: y * 100 })
  }

  const handleLeave = () => {
    setTilt({ x: 0, y: 0 })
    setIsHovered(false)
  }

  return (
    <motion.div
      ref={ref}
      className={`relative ${className || ''}`}
      style={{ perspective: 900, transformStyle: "preserve-3d" }}
      animate={{ rotateX: tilt.x, rotateY: tilt.y }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      onMouseMove={handleMouse}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleLeave}
    >
      {glow && isHovered && (
        <div
          className="absolute -inset-[1px] rounded-[inherit] pointer-events-none transition-opacity duration-200"
          style={{
            background: `radial-gradient(circle at ${glowPos.x}% ${glowPos.y}%, rgba(234,179,8,0.15), transparent 60%)`,
          }}
        />
      )}
      {children}
    </motion.div>
  )
}
