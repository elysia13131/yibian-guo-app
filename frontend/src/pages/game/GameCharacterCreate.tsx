import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { characterApi } from '../../api'
import TtsTutorial from './TtsTutorial'

export default function GameCharacterCreate() {
  const EXPRESSION_PRESETS = ['思考、疑惑', '开心、微笑', '生气、不满']
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const docId = searchParams.get('docId') || ''
  const parseMode = searchParams.get('parseMode') || 'normal'
  const editId = searchParams.get('editId')

  const isEdit = !!editId
  const [loadingChar, setLoadingChar] = useState(false)

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [speakerId, setSpeakerId] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [portraitFile, setPortraitFile] = useState<File | null>(null)
  const [portraitPreview, setPortraitPreview] = useState<string | null>(null)
  const [existingPortrait, setExistingPortrait] = useState<string | null>(null)

  const [expressionFiles, setExpressionFiles] = useState<(File | null)[]>([])
  const [expressionPreviews, setExpressionPreviews] = useState<string[]>(['', '', ''])
  const [expressionDescriptions, setExpressionDescriptions] = useState<string[]>(['思考、疑惑', '开心、微笑', '生气、不满'])
  const [_expressionRemoved, setExpressionRemoved] = useState<boolean[]>([])
  const [autoAnalyze, setAutoAnalyze] = useState(false)

  const [cgFiles, setCgFiles] = useState<File[]>([])
  const [cgPreviews, setCgPreviews] = useState<string[]>([])
  const [existingCg, setExistingCg] = useState<string[]>([])

  const [removePortraitBg, setRemovePortraitBg] = useState(true)
  const [removeExpressionBg, setRemoveExpressionBg] = useState<boolean[]>([true, true, true])

  const [voiceAudioFile, setVoiceAudioFile] = useState<File | null>(null)
  const [voiceAudioName, setVoiceAudioName] = useState('')
  const [voiceText, setVoiceText] = useState('')
  const [showTutorial, setShowTutorial] = useState(false)

  const portraitRef = useRef<HTMLInputElement>(null)
  const expressionRef = useRef<HTMLInputElement>(null)
  const [expressionSlotTarget, setExpressionSlotTarget] = useState<number | null>(null)
  const cgRef = useRef<HTMLInputElement>(null)
  const voiceAudioRef = useRef<HTMLInputElement>(null)

  const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

  useEffect(() => {
    if (editId) {
      loadCharacter(Number(editId))
    }
  }, [editId])

  const loadCharacter = async (id: number) => {
    setLoadingChar(true)
    try {
      const char = await characterApi.get(id)
      setName(char.name)
      setPrompt(char.prompt)
      setSpeakerId(char.speaker_id || '')
      setIsPublic(char.is_public)
      if (char.portrait_url) {
        const url = char.portrait_url.startsWith('http') ? char.portrait_url : `${API_BASE}${char.portrait_url}`
        setExistingPortrait(char.portrait_url)
        setPortraitPreview(url)
      }
      if (char.expressions?.length) {
        const previews: string[] = []
        const descs: string[] = []
        for (let i = 0; i < 3; i++) {
          if (i < char.expressions.length) {
            const u = char.expressions[i]
            previews[i] = u.startsWith('http') ? u : `${API_BASE}${u}`
          } else {
            previews[i] = ''
          }
          descs[i] = char.expression_descriptions?.[i] || EXPRESSION_PRESETS[i] || ''
        }
        setExpressionPreviews(previews)
        setExpressionDescriptions(descs)
        setExpressionFiles([])
        setExpressionRemoved([])
      } else {
        setExpressionPreviews(['', '', ''])
        setExpressionDescriptions([...EXPRESSION_PRESETS])
        setExpressionFiles([])
        setExpressionRemoved([])
      }
      if (char.cg_images?.length) {
        setExistingCg(char.cg_images)
        setCgPreviews(char.cg_images.map((u: string) => u.startsWith('http') ? u : `${API_BASE}${u}`))
      }
    } catch (err) {
      console.error('加载角色失败', err)
      alert('加载角色失败')
      navigate(-1)
    } finally {
      setLoadingChar(false)
    }
  }

  const handlePortrait = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPortraitFile(file)
    setPortraitPreview(URL.createObjectURL(file))
    setExistingPortrait(null)
    if (portraitRef.current) portraitRef.current.value = ''
  }

  const handleExpressionUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const slotIdx = expressionSlotTarget
    if (!file || slotIdx === null) return
    const url = URL.createObjectURL(file)
    setExpressionPreviews((prev) => {
      const next = [...prev]
      next[slotIdx] = url
      return next
    })
    setExpressionFiles((prev) => {
      const next = [...prev]
      next[slotIdx] = file
      return next
    })
    setRemoveExpressionBg((prev) => {
      const next = [...prev]
      next[slotIdx] = true
      return next
    })
    setExpressionDescriptions((prev) => {
      const next = [...prev]
      if (!next[slotIdx]) next[slotIdx] = EXPRESSION_PRESETS[slotIdx] || ''
      return next
    })
    if (expressionRef.current) expressionRef.current.value = ''
    setExpressionSlotTarget(null)
  }

  const removeExpression = (idx: number) => {
    const prev = expressionPreviews[idx]
    if (prev) URL.revokeObjectURL(prev)
    setExpressionPreviews((prev) => {
      const next = [...prev]
      next[idx] = ''
      return next
    })
    setExpressionFiles((prev) => {
      const next = [...prev]
      delete next[idx]
      return next
    })
  }

  const clickSlotUpload = (idx: number) => {
    setExpressionSlotTarget(idx)
    setTimeout(() => expressionRef.current?.click(), 0)
  }

  const handleCg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const currentCount = cgFiles.length + existingCg.length
    const remain = 3 - currentCount
    const selected = files.slice(0, remain)
    setCgFiles((prev) => [...prev, ...selected])
    setCgPreviews((prev) => [...prev, ...selected.map((f) => URL.createObjectURL(f))])
    if (cgRef.current) cgRef.current.value = ''
  }

  const removeCg = (idx: number) => {
    const totalExisting = existingCg.length
    if (idx < totalExisting) {
      setExistingCg((prev) => prev.filter((_, i) => i !== idx))
      setCgPreviews((prev) => prev.filter((_, i) => i !== idx))
    } else {
      const fileIdx = idx - totalExisting
      setCgFiles((prev) => prev.filter((_, i) => i !== fileIdx))
      setCgPreviews((prev) => prev.filter((_, i) => i !== idx))
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) { alert('请输入角色名称'); return }
    if (!prompt.trim()) { alert('请输入人设提示词'); return }
    if (!portraitFile && !existingPortrait) { alert('请上传立绘图片'); return }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('name', name.trim())
      formData.append('prompt', prompt.trim())
      if (speakerId.trim()) formData.append('speaker_id', speakerId.trim())
      formData.append('is_public', String(isPublic))
      if (portraitFile) {
        formData.append('portrait', portraitFile)
      }
      formData.append('remove_bg_portrait', String(removePortraitBg))
      const newExprFiles = expressionFiles.filter(Boolean) as File[]
      newExprFiles.forEach((f) => formData.append('expressions', f))
      if (newExprFiles.length > 0) {
        const bgValues = expressionFiles.map((f, i) => f ? String(removeExpressionBg[i] ?? true) : '').filter(Boolean).join(',')
        formData.append('remove_bg_expressions', bgValues)
      }
      formData.append('expression_descriptions', JSON.stringify(expressionDescriptions))
      formData.append('auto_analyze', String(autoAnalyze))
      cgFiles.forEach((f) => formData.append('cg_images', f))
      if (voiceAudioFile) {
        formData.append('voice_audio', voiceAudioFile)
        if (voiceText.trim()) formData.append('voice_text', voiceText.trim())
      }

      if (isEdit && editId) {
        await characterApi.update(Number(editId), formData)
        navigate('/game/character/manage')
      } else {
        await characterApi.create(formData)
        navigate(`/game/character?docId=${docId}&parseMode=${parseMode}`)
      }
    } catch (err) {
      console.error('保存角色失败', err)
      alert('保存角色失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  if (loadingChar) {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-pink-300 border-t-pink-400 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50 overflow-y-auto">
      <div className="relative min-h-full pb-32">
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-pink-200">
          <div className="flex items-center px-4 h-14">
            <button
              onClick={() => navigate(-1)}
              className="p-2 -ml-2 text-pink-400 hover:text-pink-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="ml-2 text-lg font-semibold text-pink-700">{isEdit ? '修改角色' : '创建角色'}</h1>
          </div>
        </div>

        <div className="px-4 mt-6 space-y-6">

          <div>
            <label className="block text-sm font-medium text-pink-600 mb-2">角色名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入角色名称"
              className="w-full px-4 py-3 rounded-xl bg-pink-50/80 border border-pink-200 text-pink-700 placeholder-pink-300 focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-300 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-pink-600 mb-2">立绘图片 *</label>
            <div className="flex items-start gap-4">
              <div className="w-28 h-36 rounded-xl overflow-hidden border border-pink-200 bg-pink-50 flex-shrink-0 flex items-center justify-center">
                {portraitPreview ? (
                  <img src={portraitPreview} alt="立绘" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-10 h-10 text-pink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <button
                  onClick={() => portraitRef.current?.click()}
                  className="px-4 py-2 rounded-lg bg-white/80 text-pink-600 border border-pink-200 hover:bg-white hover:text-pink-700 active:scale-[0.98] transition-all text-sm"
                >
                  {portraitFile || existingPortrait ? '重新上传' : '上传图片'}
                </button>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => setRemovePortraitBg(!removePortraitBg)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                      removePortraitBg ? 'bg-pink-400' : 'bg-pink-200'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                        removePortraitBg ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                  <span className="text-xs text-pink-400">去除背景</span>
                </div>
                <input ref={portraitRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handlePortrait} />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-pink-600 mb-2">人设提示词 *</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：性格活泼可爱，说话语气俏皮，喜欢用比喻和夸张的方式讲解知识..."
              rows={5}
              className="w-full px-4 py-3 rounded-xl bg-pink-50/80 border border-pink-200 text-pink-700 placeholder-pink-300 focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-300 transition-all resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-pink-600 mb-2">
              自己的火山引擎音色ID
              <span className="text-pink-300 font-normal ml-1">（可选）</span>
            </label>
            <input
              type="text"
              value={speakerId}
              onChange={(e) => setSpeakerId(e.target.value)}
              placeholder="S_xxxxxxxx（在火山引擎控制台训练声音复刻后获取）"
              className="w-full px-4 py-3 rounded-xl bg-pink-50/80 border border-pink-200 text-pink-700 placeholder-pink-300 focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-300 transition-all"
            />
            <p className="text-xs text-pink-400 mt-1.5">
              在<strong>火山引擎控制台 → 声音复刻</strong>中训练音色后，将获取到的 S_xxxxx 格式音色 ID 粘贴到这里。
              配置后角色对话将使用该语音合成。<br />
              <span className="text-amber-500">注意：音色 ID 绑定你的火山引擎账号，其他用户借阅后需使用自己的音色 ID。</span>
            </p>
          </div>

          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
            <div className="flex items-start gap-2 text-amber-700 text-sm">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <div>
                <p className="font-medium">TTS 语音说明</p>
                <p className="text-xs mt-1 text-amber-600">
                  默认角色使用预置系统音色，无需配置。借用的角色可向发布者索要语音样本后在火山引擎自行克隆。
                  API Key 请在
                  <button type="button" onClick={() => navigate('/settings')} className="text-pink-500 underline mx-1">个人设置</button>
                  中填写火山引擎 API Key。
                  <br />
                  <button type="button" onClick={() => setShowTutorial(true)} className="text-pink-500 underline hover:text-pink-700 mt-1">
                    📖 查看详细配置教程
                  </button>
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-pink-600 mb-2">
              提供语音样本
              <span className="text-pink-300 font-normal ml-1">（可选，供其他用户借阅后自行克隆音色）</span>
            </label>
            <div className="p-4 rounded-xl bg-pink-50/80 border border-pink-200 space-y-3">
              <p className="text-xs text-pink-400">
                上传一段 14-30 秒的清晰人声音频作为语音样本。其他用户借阅你的角色后，可以下载此样本在火山引擎控制台中克隆该音色，
                获取自己的音色 ID。
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => voiceAudioRef.current?.click()}
                  className="px-4 py-2.5 rounded-lg bg-white/80 text-pink-600 border border-pink-200 hover:bg-white hover:text-pink-700 active:scale-[0.98] transition-all text-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                  {voiceAudioFile ? '重新选择音频' : '选择音频文件'}
                </button>
                {voiceAudioFile && (
                  <button
                    onClick={() => { setVoiceAudioFile(null); setVoiceAudioName('') }}
                    className="text-xs text-red-400 hover:text-red-500 transition-colors"
                  >
                    移除
                  </button>
                )}
              </div>
              {voiceAudioName && (
                <p className="text-xs text-pink-500 font-medium">{voiceAudioName}</p>
              )}
              <input ref={voiceAudioRef} type="file" accept=".wav,.mp3,.m4a,.ogg,.aac" className="hidden" onChange={e => {
                const file = e.target.files?.[0]
                if (file) {
                  setVoiceAudioFile(file)
                  setVoiceAudioName(file.name)
                }
                if (voiceAudioRef.current) voiceAudioRef.current.value = ''
              }} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-pink-600 mb-2">表情差分 <span className="text-pink-300 font-normal">（最多3张，缺省使用默认立绘）</span></label>
            <div className="flex gap-3 flex-wrap">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="w-36">
                  <div className="relative w-full rounded-lg overflow-hidden border border-pink-200 bg-pink-50">
                    <div className="relative h-28">
                      {expressionPreviews[idx] ? (
                        <img src={expressionPreviews[idx]} alt={`表情${idx + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <button
                          onClick={() => clickSlotUpload(idx)}
                          className="w-full h-full flex flex-col items-center justify-center gap-1 text-pink-300 hover:text-pink-500 hover:bg-pink-100/50 transition-all"
                        >
                          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                          <span className="text-[10px]">上传</span>
                        </button>
                      )}
                      {expressionPreviews[idx] && (
                        <button
                          onClick={() => removeExpression(idx)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center text-xs hover:bg-red-500 transition-colors"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="px-2 py-1.5 border-t border-pink-200">
                      <p className="text-[10px] text-pink-400 mb-1 font-medium">{EXPRESSION_PRESETS[idx]}<span className="text-pink-300 ml-1">（可修改）</span></p>
                      <input
                        type="text"
                        value={expressionDescriptions[idx] || ''}
                        onChange={e => {
                          const next = [...expressionDescriptions]
                          next[idx] = e.target.value
                          setExpressionDescriptions(next)
                        }}
                        placeholder={EXPRESSION_PRESETS[idx]}
                        className="w-full text-xs bg-transparent text-pink-600 placeholder-pink-300 focus:outline-none mb-1.5"
                      />
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            const bgNext = [...removeExpressionBg]
                            bgNext[idx] = !bgNext[idx]
                            setRemoveExpressionBg(bgNext)
                          }}
                          className={`relative w-6 h-3 rounded-full transition-colors duration-200 ${
                            removeExpressionBg[idx] ? 'bg-pink-400' : 'bg-pink-200'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full bg-white shadow transition-transform duration-200 ${
                              removeExpressionBg[idx] ? 'translate-x-3' : ''
                            }`}
                          />
                        </button>
                        <span className="text-[9px] text-pink-400 leading-none">去背景</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <input ref={expressionRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handleExpressionUpload} />
            {(expressionFiles.filter(Boolean).length > 0 || expressionPreviews.some(p => p)) && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-xs font-medium text-amber-600">AI自动分析表情描述</p>
                    <p className="text-[10px] text-amber-500 mt-0.5">开启后将用AI分析图片生成情绪描述，覆盖上方手动输入的内容。AI分析准确度较低，建议手动填写。</p>
                  </div>
                  <button
                    onClick={() => setAutoAnalyze(!autoAnalyze)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ml-3 ${
                      autoAnalyze ? 'bg-amber-500' : 'bg-pink-200'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                        autoAnalyze ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-pink-600 mb-2">结算CG <span className="text-pink-300 font-normal">（可选，最多3张）</span></label>
            <div className="flex gap-3 flex-wrap">
              {cgPreviews.map((preview, idx) => (
                <div key={idx} className="relative w-24 h-16 rounded-lg overflow-hidden border border-pink-200">
                  <img src={preview} alt={`CG${idx + 1}`} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeCg(idx)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center text-xs hover:bg-red-500 transition-colors"
                  >
                    ×
                  </button>
                </div>
              ))}
              {(cgFiles.length + existingCg.length) < 3 && (
                <button
                  onClick={() => cgRef.current?.click()}
                  className="w-24 h-16 rounded-lg border border-dashed border-pink-300 flex items-center justify-center text-pink-300 hover:text-pink-500 hover:border-pink-400 transition-all"
                >
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>
              )}
            </div>
            <input ref={cgRef} type="file" accept=".png,.jpg,.jpeg,.webp" multiple className="hidden" onChange={handleCg} />
          </div>

          <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/70 border border-pink-200">
            <div>
              <p className="text-sm font-medium text-pink-700">公开角色</p>
              <p className="text-xs text-pink-400 mt-0.5">公开后其他用户可以借阅你的角色</p>
            </div>
            <button
              onClick={() => setIsPublic(!isPublic)}
              className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                isPublic ? 'bg-pink-400' : 'bg-pink-200'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                  isPublic ? 'translate-x-6' : ''
                }`}
              />
            </button>
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-pink-200 px-4 py-4">
          <button
            onClick={handleSubmit}
            disabled={uploading}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-400 to-pink-500 text-white font-semibold shadow-lg shadow-pink-300/30 hover:shadow-xl hover:shadow-pink-300/40 hover:from-pink-300 hover:to-pink-400 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? '保存中...' : (isEdit ? '保存修改' : '创建角色')}
          </button>
        </div>
      </div>
      <TtsTutorial open={showTutorial} onClose={() => setShowTutorial(false)} />

      {uploading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white/90 rounded-2xl px-8 py-6 shadow-2xl flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-pink-300 border-t-pink-400 rounded-full animate-spin" />
            <p className="text-pink-700 font-medium text-sm">保存角色中...</p>
          </div>
        </div>
      )}
    </div>
  )
}
