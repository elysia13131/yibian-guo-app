import { X, Lock } from 'lucide-react'
import { Link } from 'react-router-dom'

interface LoginReminderModalProps {
  isOpen: boolean
  onClose: () => void
  action?: string
}

const LoginReminderModal = ({ isOpen, onClose, action = '进行此操作' }: LoginReminderModalProps) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-8 text-center">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white transition"
          >
            <X size={24} />
          </button>
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">登录后即可{action}</h2>
        </div>

        {/* Content */}
        <div className="p-6 text-center">
          <p className="text-gray-600 mb-6">
            加入我们，开启你的个性化学习之旅！
          </p>

          <div className="space-y-3">
            <Link
              to="/auth"
              onClick={onClose}
              className="block w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold py-3 px-6 rounded-xl hover:opacity-90 transition"
            >
              立即登录 / 注册
            </Link>
            <button
              onClick={onClose}
              className="block w-full bg-gray-100 text-gray-700 font-medium py-3 px-6 rounded-xl hover:bg-gray-200 transition"
            >
              稍后再说
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginReminderModal
