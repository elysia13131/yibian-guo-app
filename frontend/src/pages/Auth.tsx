import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Mail, Lock, User, Eye, EyeOff, ArrowLeft, MailCheck } from 'lucide-react'
import { motion } from 'motion/react'
import { useAuth } from '../contexts/AuthContext'
import PageTransition from '../components/PageTransition'

export default function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, register: registerUser } = useAuth()
  const isRegister = location.pathname === '/register'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [_codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)

  const mode = isRegister ? 'register' : 'login'

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  const sendVerificationCode = async () => {
    if (!email) {
      setError('请输入邮箱地址')
      return
    }

    setSendingCode(true)
    setError('')

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'}/api/v1/email/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || '发送失败')
      }

      setCodeSent(true)
      setCountdown(60)
    } catch (err: any) {
      setError(err.message || '发送验证码失败')
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (mode === 'register') {
      if (!username || !password || !confirmPassword || !email || !verificationCode) {
        setError('请填写完整信息')
        return
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致')
        return
      }
      if (password.length < 6) {
        setError('密码至少6位')
        return
      }
      if (verificationCode.length !== 6) {
        setError('请输入6位验证码')
        return
      }
      setLoading(true)

      try {
        await registerUser(username, email, password, verificationCode)
        navigate('/')
      } catch (err: any) {
        setError(err.message || '注册失败，请重试')
      } finally {
        setLoading(false)
      }
      return
    }

    setLoading(true)

    try {
      await login(username, password)
      navigate('/')
    } catch (err: any) {
      setError(err.message || '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const toggleMode = () => {
    if (isRegister) {
      navigate('/auth')
    } else {
      navigate('/register')
    }
  }

  const goBack = () => {
    navigate('/')
  }

  return (
    <PageTransition>
      <motion.div
        className="flex items-center justify-center p-4 min-h-[calc(100vh-80px)]"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, type: "spring", stiffness: 80 }}
      >
        <div className="w-full max-w-md">
          <button
            onClick={goBack}
            className="flex items-center gap-2 text-stone-500 hover:text-stone-700 mb-6 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>返回</span>
          </button>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-stone-100 p-8">
            <div className="text-center mb-8">
              <motion.div
                className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-200"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
              >
                {mode === 'login' ? <Lock className="w-7 h-7 text-white" /> : <User className="w-7 h-7 text-white" />}
              </motion.div>
              <h1 className="text-2xl font-bold text-stone-800">{mode === 'login' ? '欢迎回来' : '创建账户'}</h1>
              <p className="text-stone-500 mt-2">{mode === 'login' ? '登录您的账户继续学习' : '注册新账户开始学习之旅'}</p>
            </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">用户名</label>
                  <div className="relative">
                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      placeholder="请输入用户名"
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 bg-white text-gray-900 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          setCodeSent(false)
                        }}
                        required
                        placeholder="请输入邮箱地址"
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 bg-white text-gray-900 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={sendVerificationCode}
                      disabled={sendingCode || countdown > 0}
                      className="px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                    >
                      {sendingCode ? '发送中...' : (countdown > 0 ? `${countdown}s` : '发送验证码')}
                    </button>
                  </div>
                </div>

                {mode === 'register' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">验证码</label>
                    <div className="relative">
                      <MailCheck size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        required
                        placeholder="请输入6位验证码"
                        maxLength={6}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 bg-white text-gray-900 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-center text-lg tracking-widest"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">密码</label>
                  <div className="relative">
                    <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="请输入密码（至少6位）"
                      minLength={6}
                      className="w-full pl-10 pr-12 py-2.5 border border-gray-300 bg-white text-gray-900 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">确认密码</label>
                  <div className="relative">
                    <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      placeholder="请再次输入密码"
                      minLength={6}
                      className="w-full pl-10 pr-12 py-2.5 border border-gray-300 bg-white text-gray-900 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white font-semibold py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? '注册中...' : '注册'}
                </button>
              </>
            )}

            {mode === 'login' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">用户名</label>
                  <div className="relative">
                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      placeholder="请输入用户名"
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 bg-white text-gray-900 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">密码</label>
                  <div className="relative">
                    <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="请输入密码"
                      minLength={6}
                      className="w-full pl-10 pr-12 py-2.5 border border-gray-300 bg-white text-gray-900 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white font-semibold py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? '登录中...' : '登录'}
                </button>
              </>
            )}
          </form>

          {mode === 'login' && (
            <>
              <div className="mt-4 text-center">
                <button
                  onClick={() => navigate('/reset-password')}
                  className="text-sm text-blue-600 hover:text-blue-700 transition"
                >
                  忘记用户名或密码？
                </button>
              </div>
              <div className="mt-4 text-center text-sm text-gray-500">
                还没有账户？
                <button
                  onClick={toggleMode}
                  className="text-blue-600 hover:text-blue-700 font-medium ml-1 transition"
                >
                  立即注册
                </button>
              </div>
            </>
          )}

          {mode === 'register' && (
            <div className="mt-6 text-center text-sm text-gray-500">
              已有账户？
              <button
                onClick={toggleMode}
                className="text-blue-600 hover:text-blue-700 font-medium ml-1 transition"
              >
                立即登录
              </button>
            </div>
          )}
        </div>
      </div>
      </motion.div>
    </PageTransition>
  )
}
