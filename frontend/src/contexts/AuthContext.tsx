import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

export interface UserInfo {
  id: number
  email: string
  username: string
  is_active: boolean
  is_verified: boolean
  player_title: string
  api_key?: string
  tts_api_key?: string
  deepseek_api_key?: string
  somark_api_key?: string
  created_at: string
}

interface AuthContextType {
  user: UserInfo | null
  token: string | null
  loading: boolean
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<UserInfo>
  register: (username: string, email: string, password: string, verificationCode: string) => Promise<UserInfo>
  logout: () => void
  checkAuth: () => Promise<void>
  loginPromptDismissed: boolean
  dismissLoginPrompt: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const TOKEN_KEY = 'token'
const USER_KEY = 'user'
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(() => {
    const saved = localStorage.getItem(USER_KEY)
    return saved ? JSON.parse(saved) : null
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [loading, setLoading] = useState(true)
  const [loginPromptDismissed, setLoginPromptDismissed] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    if (token && user) {
      setLoginPromptDismissed(false)
    }
  }, [token, user])

  const checkAuth = async () => {
    const savedToken = localStorage.getItem(TOKEN_KEY)
    if (!savedToken) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${savedToken}` },
      })

      if (response.ok) {
        const userData = await response.json()
        setToken(savedToken)
        setUser(userData)
        setLoginPromptDismissed(false)
        localStorage.setItem(USER_KEY, JSON.stringify(userData))
      } else {
        logout()
      }
    } catch {
      logout()
    } finally {
      setLoading(false)
    }
  }

  const login = async (username: string, password: string): Promise<UserInfo> => {
    const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.detail || '登录失败')
    }

    const data = await response.json()
    setToken(data.access_token)
    setUser(data.user)
    setLoginPromptDismissed(false)
    localStorage.setItem(TOKEN_KEY, data.access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))

    return data.user
  }

  const register = async (username: string, email: string, password: string, verificationCode: string): Promise<UserInfo> => {
    const response = await fetch(`${API_BASE}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, verification_code: verificationCode }),
    })

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.detail || '注册失败')
    }

    const data = await response.json()
    setToken(data.access_token)
    setUser(data.user)
    setLoginPromptDismissed(false)
    localStorage.setItem(TOKEN_KEY, data.access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))

    return data.user
  }

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setLoginPromptDismissed(false)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }, [])

  const dismissLoginPrompt = () => {
    setLoginPromptDismissed(true)
  }

  const isAuthenticated = !!token && !!user

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      isAuthenticated,
      login,
      register,
      logout,
      checkAuth,
      loginPromptDismissed,
      dismissLoginPrompt,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}