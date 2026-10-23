import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuth } from './useAuth'

interface TaskUpdate {
  id: number
  status: string
  document_id: number
  group_id?: number
  total_chunks: number
  processed_chunks: number
  total_cards: number
  max_cards: number
  is_public: boolean
  error_message?: string
  created_at?: string
}

interface UseWebSocketOptions {
  onTaskUpdate?: (task: TaskUpdate, action?: string) => void
  onConnected?: () => void
  onDisconnected?: () => void
}

export function useFlashcardWebSocket(options: UseWebSocketOptions = {}) {
  const { token, user } = useAuth()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const reconnectAttempts = useRef(0)
  const [isConnected, setIsConnected] = useState(false)

  const connect = useCallback(() => {
    if (!token || !user?.id) return

    // 先清理所有现有连接
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close(1000, 'Cleaning up')
        }
      } catch (e) {
        // 忽略关闭错误
      }
      wsRef.current = null
    }

    // 清理任何待处理的超时
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = undefined
    }

    try {
      const WS_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/^http/, 'ws') || 'wss://yibianguo.preview.aliyun-zeabur.cn'
      console.log(`Connecting to WebSocket: ${WS_BASE_URL}/ws/flashcards/${user.id}`)
      const ws = new WebSocket(`${WS_BASE_URL}/ws/flashcards/${user.id}`)

      ws.onopen = () => {
        console.log('Flashcard WebSocket connected successfully')
        setIsConnected(true)
        reconnectAttempts.current = 0
        options.onConnected?.()
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('Flashcard WebSocket received:', data)

          if (data.type === 'task_update' && data.task) {
            options.onTaskUpdate?.(data.task, data.action)
          } else if (data.type === 'subscribed') {
            console.log('Subscribed to flashcard updates for user', data.user_id)
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e)
        }
      }

      ws.onerror = (error) => {
        console.warn('Flashcard WebSocket error:', error)
      }

      ws.onclose = (event) => {
        console.log('Flashcard WebSocket disconnected', event.code, event.reason)
        setIsConnected(false)
        options.onDisconnected?.()

        // 确保清理
        if (wsRef.current === ws) {
          wsRef.current = null
        }

        // 非正常关闭时重连（排除正常关闭码 1000）
        if (event.code !== 1000 && event.code !== 1005) {
          reconnectAttempts.current++
          const delay = Math.min(5000 * reconnectAttempts.current, 30000)
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`)
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('Attempting to reconnect Flashcard WebSocket...')
            connect()
          }, delay)
        }
      }

      wsRef.current = ws
    } catch (e) {
      console.error('Failed to create WebSocket:', e)
    }
  }, [token, user?.id, options])

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

    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    isConnected,
    disconnect,
    reconnect: connect
  }
}