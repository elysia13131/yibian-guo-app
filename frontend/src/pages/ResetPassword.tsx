import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Lock, Eye, EyeOff, ArrowLeft, MailCheck, User } from 'lucide-react'
import { motion } from 'motion/react'
import PageTransition from '../components/PageTransition'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'

export default function ResetPasswordPage() {
  const navigate = useNavigate()

  const [step, setStep] = useState<'email' | 'verify' | 'reset'>('email')
  const [email, setEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  const sendResetCode = async () => {
    if (!email) {
      setError('请输入邮箱地址')
      return
    }

    setSendingCode(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/api/v1/email/send-reset-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || '发送失败')
      }

      setStep('verify')
      setCountdown(60)
    } catch (err: any) {
      setError(err.message || '发送验证码失败')
    } finally {
      setSendingCode(false)
    }
  }

  const verifyCode = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setError('请输入6位验证码')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/api/v1/email/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: verificationCode }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || '验证码错误')
      }

      setStep('reset')
    } catch (err: any) {
      setError(err.message || '验证码验证失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!newUsername.trim()) {
      setError('请输入用户名')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    if (newPassword.length < 6) {
      setError('密码至少6位')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          verification_code: verificationCode,
          new_password: newPassword,
          new_username: newUsername.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || '重置失败')
      }

      alert('重置成功，请使用新用户名和密码登录')
      navigate('/auth')
    } catch (err: any) {
      setError(err.message || '重置失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const goBack = () => {
    if (step === 'verify') {
      setStep('email')
      setVerificationCode('')
    } else if (step === 'reset') {
      setStep('verify')
      setNewUsername('')
      setNewPassword('')
      setConfirmPassword('')
    } else {
      navigate('/auth')
    }
  }

  return (
    <PageTransition>
      <motion.div
        className="min-h-screen flex items-center justify-center p-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="w-full max-w-md">
          <button
            onClick={goBack}
            className="flex items-center gap-2 text-stone-500 hover:text-stone-700 mb-6 transition-colors"
          >
          <ArrowLeft size={20} />
          <span>返回</span>
        </button>

        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              {step === 'email' ? '找回用户名或密码' : (step === 'verify' ? '验证邮箱' : '设置新用户名和密码')}
            </h1>
            <p className="text-gray-500 mt-2">
              {step === 'email' ? '输入您注册的邮箱地址' :
               step === 'verify' ? '输入发送至您邮箱的验证码' :
               '设置您的新用户名和密码'}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          {step === 'email' && (
            <form onSubmit={(e) => { e.preventDefault(); sendResetCode(); }} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱</label>
                <div className="relative">
                  <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="请输入注册的邮箱地址"
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={sendingCode}
                className="w-full bg-blue-600 text-white font-semibold py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {sendingCode ? '发送中...' : '发送验证码'}
              </button>
            </form>
          )}

          {step === 'verify' && (
            <form onSubmit={(e) => { e.preventDefault(); verifyCode(); }} className="space-y-5">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <MailCheck size={48} className="mx-auto text-blue-500 mb-2" />
                <p className="text-sm text-gray-600">
                  验证码已发送至<br />
                  <span className="font-medium text-gray-900">{email}</span>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">验证码</label>
                <div className="relative">
                  <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    placeholder="请输入6位验证码"
                    maxLength={6}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-center text-lg tracking-widest"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={sendResetCode}
                  disabled={sendingCode || countdown > 0}
                  className="flex-1 bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sendingCode ? '发送中...' : (countdown > 0 ? `${countdown}秒后重发` : '重发验证码')}
                </button>
                <button
                  type="submit"
                  disabled={loading || verificationCode.length !== 6}
                  className="flex-1 bg-blue-600 text-white font-semibold py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? '验证中...' : '下一步'}
                </button>
              </div>
            </form>
          )}

          {step === 'reset' && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">新用户名</label>
                <div className="relative">
                  <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    required
                    placeholder="请输入新的用户名"
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">新密码</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    placeholder="请输入新密码（至少6位）"
                    minLength={6}
                    className="w-full pl-10 pr-12 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">确认新密码</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    placeholder="请再次输入新密码"
                    minLength={6}
                    className="w-full pl-10 pr-12 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
                {loading ? '重置中...' : '重置用户名和密码'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-sm text-gray-500">
            想起来了？
            <button
              onClick={() => navigate('/auth')}
              className="text-blue-600 hover:text-blue-700 font-medium ml-1"
            >
              立即登录
            </button>
          </div>
        </div>
      </div>
      </motion.div>
    </PageTransition>
  )
}
