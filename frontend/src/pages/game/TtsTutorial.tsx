import { useState } from 'react'

const STEPS = [
  {
    title: '注册火山引擎账号',
    desc: '如果你还没有火山引擎账号，请先注册并完成实名认证。',
    link: 'https://console.volcengine.com/speech/new/overview',
    linkText: '前往火山引擎控制台',
    illustration: (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-pink-200 via-pink-100 to-white border-2 border-pink-300 flex items-center justify-center shadow-lg">
          <svg className="w-16 h-16 text-pink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <path d="M9 12l2 2 4-4" />
            <path d="M12 3v18M3 12h18" opacity="0.3" />
          </svg>
        </div>
        <div className="mt-4 text-center space-y-1">
          <p className="text-xs text-pink-400">① 点击注册按钮，填写信息</p>
          <p className="text-xs text-pink-400">② 完成实名认证</p>
          <p className="text-xs text-pink-400">③ 登录控制台</p>
        </div>
      </div>
    ),
  },
  {
    title: '获取 API Key',
    desc: '在 API Key 管理页面创建并复制 API Key，这就是你需要填写到个人设置中的 Key。注意不要泄露。',
    link: 'https://console.volcengine.com/speech/new/setting/apikeys',
    linkText: '前往 API Key 管理',
    illustration: (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="w-full max-w-xs bg-white rounded-xl border-2 border-pink-200 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-pink-400 to-pink-300 px-3 py-2 text-white text-xs font-medium">API Key 管理</div>
          <div className="p-3 space-y-2">
            <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
              <p className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                API Key（复制此项）
              </p>
              <p className="text-xs text-amber-800 font-mono bg-amber-100 rounded px-1 py-0.5 break-all">36b762e5-1346-403e-a97a-630f51a2f894</p>
            </div>
            <div className="flex justify-center">
              <span className="text-[10px] px-3 py-1 rounded-full bg-pink-100 text-pink-600">点击「创建 API Key」生成</span>
            </div>
          </div>
          <div className="px-3 pb-3">
            <div className="bg-red-50 rounded-lg p-2 border border-red-200">
              <p className="text-[10px] text-red-600 font-medium">⚠️ 不要将 API Key 分享给他人</p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: '开通声音复刻模型',
    desc: '在概览页面点击「畅快使用 → API 接入」，选择「豆包声音复刻模型 2.0」并开通服务。新用户有免费试用额度。',
    link: 'https://console.volcengine.com/speech/new/overview',
    linkText: '前往概览页面',
    illustration: (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="w-full max-w-xs bg-white rounded-xl border-2 border-pink-200 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-purple-400 to-pink-300 px-3 py-2 text-white text-xs font-medium">概览页面</div>
          <div className="p-3 space-y-2">
            <div className="bg-purple-50 rounded-lg p-2 border border-purple-100">
              <p className="text-[10px] text-purple-500 font-medium">操作步骤</p>
              <div className="space-y-1.5 mt-1">
                <p className="text-[11px] text-purple-700">1. 点击「畅快使用」</p>
                <p className="text-[11px] text-purple-700">2. 选择「API 接入」</p>
                <p className="text-[11px] text-purple-700">3. 找到「豆包声音复刻模型 2.0」</p>
                <p className="text-[11px] text-purple-700">4. 点击开通</p>
              </div>
            </div>
            <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
              <div className="flex items-start gap-1.5">
                <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/></svg>
                <p className="text-[10px] text-amber-700">新用户有免费额度，可直接试用</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: '上传音频生成音色',
    desc: '在声音复刻体验页面上传一段 14-30 秒的人声音频，系统会自动生成你的专属音色，并分配一个 S_xxxxx 格式的音色 ID。',
    link: 'https://console.volcengine.com/speech/new/experience/clone',
    linkText: '前往声音复刻体验',
    illustration: (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="w-full max-w-xs bg-white rounded-xl border-2 border-pink-200 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-green-400 to-emerald-300 px-3 py-2 text-white text-xs font-medium">声音复刻体验</div>
          <div className="p-3 space-y-2">
            <div className="bg-green-50 rounded-lg p-2 border border-green-100 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-green-100 border-2 border-green-300 flex items-center justify-center mb-1">
                <svg className="w-6 h-6 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/></svg>
              </div>
              <p className="text-[10px] text-green-600">点击上传音频，等待处理完成</p>
              <p className="text-[10px] text-green-500 mt-1">即可自动获得 S_xxxxx 音色 ID</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
              <p className="text-[10px] text-amber-600">💡 建议上传清晰、背景安静的人声录音</p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: '获取音色 ID',
    desc: '在音色库中可以查看所有已生成的音色，复制对应的 S_xxxxx 格式的音色 ID。你也可以在这里管理、试听或删除音色。',
    link: 'https://console.volcengine.com/speech/new/voices',
    linkText: '前往音色库',
    illustration: (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="w-full max-w-xs bg-white rounded-xl border-2 border-pink-200 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-purple-400 to-pink-300 px-3 py-2 text-white text-xs font-medium">音色库</div>
          <div className="p-3 space-y-2">
            <div className="bg-purple-50 rounded-lg p-2 border border-purple-100">
              <p className="text-[10px] text-purple-500 font-medium">我的音色</p>
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                  <span className="text-xs text-purple-700 font-mono font-bold">S_czWi1fb12</span>
                </div>
                <button className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-600">复制</button>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                  <span className="text-xs text-purple-500 font-mono">S_8mKp3xRq</span>
                </div>
                <button className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-600">复制</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: '填写配置，开始使用',
    desc: '回到本应用，在首页设置中填写 API Key，在角色编辑页填写音色 ID。选填训练音频可进一步优化音色效果，不填则直接使用已初步生成的音色。',
    illustration: (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="w-full max-w-xs bg-white rounded-xl border-2 border-green-200 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-green-400 to-emerald-300 px-3 py-2 text-white text-xs font-medium">✅ 配置完成</div>
          <div className="p-3 space-y-2">
            <div className="bg-green-50 rounded-lg p-2 border border-green-100">
              <p className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
                首页设置 → API Key
              </p>
              <p className="text-xs text-green-800 font-mono">36b762e5-1346-****-****-********f894</p>
            </div>
            <div className="bg-green-50 rounded-lg p-2 border border-green-100">
              <p className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
                角色编辑 → 音色 ID
              </p>
              <p className="text-xs text-green-800 font-mono">S_czWi1fb12</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
              <div className="flex items-start gap-1.5">
                <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                <p className="text-[10px] text-amber-700">本应用不收取任何 TTS 费用</p>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-green-600 text-xs">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
          大功告成！开始体验吧
        </div>
      </div>
    ),
  },
  {
    title: '免费额度说明',
    desc: '',
    illustration: (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="w-full max-w-xs bg-white rounded-xl border-2 border-blue-200 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-400 to-cyan-300 px-3 py-2 text-white text-xs font-medium">免费额度与费用说明</div>
          <div className="p-3 space-y-2">
            <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                <span className="text-xs font-medium text-blue-700">火山引擎免费额度</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-blue-600">音色槽位</span>
                  <span className="font-medium text-blue-800">10 个</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-blue-600">合成字符</span>
                  <span className="font-medium text-blue-800">20,000 字符</span>
                </div>
              </div>
            </div>
            <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
              <div className="flex items-start gap-1.5">
                <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/></svg>
                <div>
                  <p className="text-[10px] text-amber-700">
                    免费额度用完后可自费购买，价格约 0.0008 元/字符。
                  </p>
                  <p className="text-[10px] text-amber-600 mt-1">
                    TTS 服务由火山引擎提供，本应用不收取任何费用。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  },
]

export default function TtsTutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0)

  if (!open) return null

  const current = STEPS[step]
  const isFirst = step === 0
  const isLast = step === STEPS.length - 1

  const progressPercent = ((step + 1) / STEPS.length) * 100

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white/95 border border-pink-200 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl">
        {/* Progress bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-pink-100">
          <div
            className="h-full bg-gradient-to-r from-pink-400 to-purple-400 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Step indicator dots */}
        <div className="flex items-center justify-center gap-1.5 pt-4 pb-1">
          {STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} className={`w-2 h-2 rounded-full transition-all duration-300 ${i === step ? 'w-5 bg-pink-400' : 'bg-pink-200 hover:bg-pink-300'}`} />
          ))}
        </div>

        {/* Step counter */}
        <p className="text-center text-[10px] text-pink-400 font-medium">
          {step + 1} / {STEPS.length}
        </p>

        {/* Content */}
        <div className="px-5 py-3">
          {current.title && (
            <h3 className="text-center text-base font-bold text-pink-700 mb-1">{current.title}</h3>
          )}
          {current.desc && (
            <p className="text-center text-xs text-pink-500 leading-relaxed">{current.desc}</p>
          )}
          <div className="mt-2">{current.illustration}</div>
          {current.link && (
            <div className="flex justify-center mt-3">
              <a
                href={current.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-pink-400 to-purple-400 text-white text-xs font-medium hover:from-pink-500 hover:to-purple-500 active:scale-[0.98] transition-all shadow-md"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
                {current.linkText}
              </a>
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-pink-100">
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={isFirst}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              isFirst
                ? 'text-pink-200 cursor-not-allowed'
                : 'text-pink-600 hover:bg-pink-50 active:scale-[0.98]'
            }`}
          >
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              上一步
            </span>
          </button>

          {isLast ? (
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-pink-400 to-purple-400 text-white text-xs font-medium hover:from-pink-500 hover:to-purple-500 active:scale-[0.98] transition-all shadow-md"
            >
              完成，开始使用
            </button>
          ) : (
            <button
              onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-400 to-purple-400 text-white text-xs font-medium hover:from-pink-500 hover:to-purple-500 active:scale-[0.98] transition-all shadow-md"
            >
              <span className="flex items-center gap-1">
                下一步
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
