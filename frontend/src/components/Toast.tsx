import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

let _show: ((msg: string, type?: ToastType) => void) | null = null

/** 全局调用：显示一条 Toast 通知 */
export function showToast(message: string, type: ToastType = 'success') {
  _show?.(message, type)
}

export default function Toast() {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const add = useCallback((message: string, type: ToastType = 'success') => {
    const id = nextId.current++
    setItems((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, 3500)
  }, [])

  useEffect(() => {
    _show = add
    return () => { _show = null }
  }, [add])

  if (items.length === 0) return null

  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
      {items.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium
            backdrop-blur-md border transition-all animate-[fadeIn_0.25s_ease-out]
            ${item.type === 'success' ? 'bg-emerald-500/90 text-white border-emerald-400' : ''}
            ${item.type === 'error' ? 'bg-red-500/90 text-white border-red-400' : ''}
            ${item.type === 'info' ? 'bg-blue-500/90 text-white border-blue-400' : ''}
          `}
        >
          {item.type === 'success' && '✓ '}
          {item.type === 'error' && '✗ '}
          {item.message}
        </div>
      ))}
    </div>,
    document.body
  )
}
