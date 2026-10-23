import { useMotionValue, useSpring, useTransform, useMotionValueEvent } from 'motion/react'
import { useState, useEffect } from 'react'

export default function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const motionValue = useMotionValue(0)
  const spring = useSpring(motionValue, { stiffness: 80, damping: 20 })
  const display = useTransform(spring, (v) => `${Math.round(v)}${suffix}`)
  const [text, setText] = useState(`0${suffix}`)

  useMotionValueEvent(display, 'change', (v) => setText(v))

  useEffect(() => {
    motionValue.set(value)
  }, [value, motionValue])

  return <span>{text}</span>
}
