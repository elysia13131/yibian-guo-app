import { LogIn, UserPlus } from 'lucide-react'

interface LoginPromptProps {
  children: React.ReactNode
  onDismiss: () => void
}

export default function LoginPrompt({ children, onDismiss }: LoginPromptProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {children}

      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <LogIn size={32} className="text-blue-600" />
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">登录后可查看完整内容</h2>
          <p className="text-gray-500 mb-6">
            登录后即可查看您的学习数据、上传的文档和个性化内容
          </p>

          <div className="space-y-3">
            <button
              onClick={() => window.location.href = '/auth'}
              className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
            >
              <LogIn size={20} />
              登录
            </button>

            <button
              onClick={() => window.location.href = '/register'}
              className="w-full bg-gray-100 text-gray-700 font-semibold py-3 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
            >
              <UserPlus size={20} />
              注册新账户
            </button>

            <button
              onClick={onDismiss}
              className="w-full text-gray-500 hover:text-gray-700 py-2 transition-colors"
            >
              稍后再说
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}