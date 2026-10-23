import { X, Settings, ExternalLink, Key, FileText, Image as ImageIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface ApiKeySetupModalProps {
  isOpen: boolean
  onClose: () => void
  missingKeys?: ('deepseek' | 'somark' | 'ark')[]
}

const KEY_CONFIGS: Record<string, {
  label: string
  icon: typeof Key
  color: string
  gradient: string
  docUrl: string
  docLabel: string
  info: string[]
  hasFreeQuota: boolean
  freeDetail?: string
}> = {
  deepseek: {
    label: 'DeepSeek',
    icon: Key,
    color: 'text-blue-600',
    gradient: 'from-blue-400 to-blue-600',
    docUrl: 'https://platform.deepseek.com/api_keys',
    docLabel: 'platform.deepseek.com',
    info: ['用于 AI 对话、文档分析、思维导图生成'],
    hasFreeQuota: false,
  },
  somark: {
    label: 'SoMark（文档解析）',
    icon: FileText,
    color: 'text-emerald-600',
    gradient: 'from-emerald-400 to-emerald-600',
    docUrl: 'https://somark.tech',
    docLabel: 'somark.tech',
    info: ['用于 PDF、DOCX 等文档智能解析'],
    hasFreeQuota: true,
    freeDetail: '注册即送免费额度，微信扫码关注公众号额外赠送 1000 页解析额度',
  },
  ark: {
    label: '火山引擎（AI 生图）',
    icon: ImageIcon,
    color: 'text-purple-600',
    gradient: 'from-purple-400 to-purple-600',
    docUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    docLabel: '火山引擎控制台',
    info: ['用于 AI 生成图片（Seedream 模型）'],
    hasFreeQuota: true,
    freeDetail: '新用户注册即享免费额度',
  },
}

const ApiKeySetupModal = ({ isOpen, onClose, missingKeys }: ApiKeySetupModalProps) => {
  const { user } = useAuth()

  if (!isOpen) return null

  const hasDeepseek = !!user?.deepseek_api_key
  const hasSomark = !!user?.somark_api_key
  const hasArk = !!user?.api_key

  const allConfigured = hasDeepseek && hasSomark && hasArk
  const targetKeys = missingKeys || (
    !allConfigured
      ? (['deepseek', 'somark', 'ark'] as const).filter(k => {
          if (k === 'deepseek' && !hasDeepseek) return true
          if (k === 'somark' && !hasSomark) return true
          if (k === 'ark' && !hasArk) return true
          return false
        })
      : []
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="relative bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-6 text-center shrink-0">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white transition"
          >
            <X size={24} />
          </button>
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <Key className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">配置 API Key</h2>
          <p className="text-white/80 text-sm mt-1">填写你自己的 API Key 以使用 AI 功能</p>
        </div>

        <div className="p-5 overflow-y-auto space-y-3">
          {targetKeys.length > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
              以下 API 尚未配置，请先获取并填写对应的 Key：
            </p>
          )}

          {(['deepseek', 'somark', 'ark'] as const).map(key => {
            const cfg = KEY_CONFIGS[key]
            const Icon = cfg.icon
            const isConfigured = key === 'deepseek' ? hasDeepseek : key === 'somark' ? hasSomark : hasArk
            const needsAttention = targetKeys.includes(key as any)

            return (
              <div
                key={key}
                className={`rounded-xl border p-4 transition ${
                  needsAttention
                    ? 'border-amber-300 bg-amber-50/50 shadow-sm'
                    : isConfigured
                      ? 'border-green-200 bg-green-50/50'
                      : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${cfg.gradient} flex items-center justify-center`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <span className="font-medium text-gray-800 text-sm">{cfg.label}</span>
                      {isConfigured && (
                        <span className="ml-2 text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded">已配置</span>
                      )}
                      {needsAttention && (
                        <span className="ml-2 text-xs text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">未配置</span>
                      )}
                    </div>
                  </div>
                  <a
                    href={cfg.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 shrink-0"
                  >
                    <ExternalLink size={12} />
                    获取
                  </a>
                </div>

                {cfg.info.map((line, i) => (
                  <p key={i} className="text-xs text-gray-500">{line}</p>
                ))}

                {cfg.hasFreeQuota && (
                  <div className="mt-1.5 text-xs text-green-700 bg-green-100/60 px-2 py-1 rounded">
                    {cfg.freeDetail}
                  </div>
                )}

                {key === 'somark' && (
                  <div className="mt-1.5 text-xs text-emerald-700 bg-emerald-100/60 px-2 py-1 rounded">
                    微信扫码关注 SoMark 公众号，在公众号中获取 API Key 并额外赠送 1000 页解析额度
                  </div>
                )}
              </div>
            )
          })}

          <div className="text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
            DeepSeek 官方并发限制 2500 RPM，配置后 AI 功能响应更稳定。SoMark 和火山引擎均有免费额度，可零成本使用。
          </div>
        </div>

        <div className="p-5 pt-0 shrink-0 space-y-2">
          <Link
            to="/settings"
            onClick={onClose}
            className="flex items-center justify-center gap-2 w-full bg-gradient-to-r from-amber-400 to-orange-500 text-white font-semibold py-3 px-6 rounded-xl hover:opacity-90 transition"
          >
            <Settings size={18} />
            前往个人中心配置
          </Link>
          <button
            onClick={onClose}
            className="w-full bg-gray-100 text-gray-600 font-medium py-3 px-6 rounded-xl hover:bg-gray-200 transition"
          >
            稍后再说
          </button>
        </div>
      </div>
    </div>
  )
}

export default ApiKeySetupModal
