import { motion, useScroll, useTransform, useSpring } from 'motion/react'

function FloatingOrb({ className, size, duration, delay, speed }: { className: string; size: number; duration: number; delay: number; speed?: number }) {
  const { scrollYProgress } = useScroll()
  const yOffset = useTransform(scrollYProgress, [0, 1], [0, (speed || 1) * 120])
  const springY = useSpring(yOffset, { stiffness: 50, damping: 30 })
  return (
    <motion.div
      className={`absolute rounded-full blur-3xl ${className}`}
      style={{ width: size, height: size, y: springY }}
      animate={{
        x: [0, 30, -20, 40, 0],
        y: [0, -40, 20, -30, 0],
        scale: [1, 1.08, 0.96, 1.04, 1],
      }}
      transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
    />
  )
}

const pageVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }
  }
}

export default function PageTransition({ children, dense }: { children: React.ReactNode; dense?: boolean }) {
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 100, damping: 30 })

  const orbs = dense ? (
    <>
      <FloatingOrb className="bg-amber-300/12" size={350} duration={25} delay={0} speed={0.8} />
      <div className="absolute -top-40 -right-40"><FloatingOrb className="bg-orange-300/8" size={300} duration={30} delay={2} speed={1.2} /></div>
      <div className="absolute -bottom-40 -left-40"><FloatingOrb className="bg-rose-300/8" size={350} duration={28} delay={4} speed={0.6} /></div>
    </>
  ) : (
    <>
      <FloatingOrb className="bg-amber-300/15" size={420} duration={25} delay={0} speed={0.7} />
      <div className="absolute -top-40 -right-40"><FloatingOrb className="bg-orange-300/10" size={360} duration={30} delay={2} speed={1.1} /></div>
      <div className="absolute -bottom-40 -left-40"><FloatingOrb className="bg-rose-300/10" size={400} duration={28} delay={4} speed={0.5} /></div>
      <div className="absolute top-1/4 left-1/3"><FloatingOrb className="bg-amber-200/7" size={250} duration={35} delay={1} speed={0.9} /></div>
      <div className="absolute bottom-1/4 right-1/3"><FloatingOrb className="bg-yellow-200/7" size={220} duration={32} delay={3} speed={1.3} /></div>
    </>
  )

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-stone-50 via-amber-50/25 to-stone-50">
      {/* Scroll progress bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[3px] z-[100] origin-left"
        style={{ scaleX: progress, background: 'linear-gradient(90deg, #f2cf9e, #e59038, #d9741b)' }}
      />

      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ perspective: 800 }}>
        {orbs}
      </div>

      <motion.div
        className="relative z-10"
        variants={pageVariants}
        initial="hidden"
        animate="visible"
      >
        {children}
      </motion.div>
    </div>
  )
}
