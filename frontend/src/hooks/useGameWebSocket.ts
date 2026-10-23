import { useEffect, useRef, useCallback } from 'react'
import { useAuth } from './useAuth'

interface GameWSMessage {
  type: string
  action?: string
  save_id?: number
}

interface UseGameWSOptions {
  onSaveUpdate?: (msg: GameWSMessage) => void
  onCharacterUpdate?: (msg: GameWSMessage) => void
}

export function useGameWebSocket(options: UseGameWSOptions = {}) {
  const { user } = useAuth()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const reconnectAttempts = useRef(0)
  const callbacksRef = useRef(options)

  callbacksRef.current = options

  const connect = useCallback(() => {
    if (!user?.id) return

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close(1000, 'Cleaning up')
        }
      } catch {}
      wsRef.current = null
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = undefined
    }

    try {
      const WS_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/^http/, 'ws') || 'wss://yibianguo.preview.aliyun-zeabur.cn'
      const ws = new WebSocket(`${WS_BASE_URL}/api/v1/ws/game/${user.id}`)

      ws.onopen = () => {
        reconnectAttempts.current = 0
      }

      ws.onmessage = (event) => {
        try {
          const data: GameWSMessage = JSON.parse(event.data)
          const cb = callbacksRef.current
          if (data.type === 'save_update') {
            cb.onSaveUpdate?.(data)
          } else if (data.type === 'character_update') {
            cb.onCharacterUpdate?.(data)
          }
        } catch {}
      }

      ws.onerror = () => {}

      ws.onclose = (event) => {
        if (wsRef.current === ws) {
          wsRef.current = null
        }
        if (event.code !== 1000 && event.code !== 1005) {
          reconnectAttempts.current++
          const delay = Math.min(5000 * reconnectAttempts.current, 30000)
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, delay)
        }
      }

      wsRef.current = ws
    } catch {}
  }, [user?.id])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    reconnectAttempts.current = 0
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnected')
      wsRef.current = null
    }
  }, [])

  useEffect(() => {
    connect()
    return () => { disconnect() }
  }, [connect, disconnect])

  return { disconnect, reconnect: connect }
}
