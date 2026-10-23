import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { marked } from 'marked'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { GameProviders, Player, Story, Scene, Character, Script, Control } from 'narraleaf-react'
import type { PlayerEventContext, LiveGame } from 'narraleaf-react'
import { gameApi, GameSection, GameQuestion } from '../../api'
import { synthesizeTts } from '../../services/TtsService'
import ErrorBoundary from '../../components/ErrorBoundary'
import { usePreloadImages } from '../../hooks/usePreloadImages'
import { Capacitor } from '@capacitor/core'
import { ScreenOrientation } from '@capacitor/screen-orientation'

const THEME_STORAGE_KEY = 'game_theme_colors'

const THEME_PRESETS = [
  { name: '樱花粉', primary: '#FFB7C5', primaryDark: '#FF8FA3', accent: '#c44a6a', text: '#4a2030', textLight: '#a83555' },
  { name: '薰衣草', primary: '#C9B1FF', primaryDark: '#A78BFA', accent: '#7C3AED', text: '#3B1F6E', textLight: '#5B21B6' },
  { name: '天空蓝', primary: '#BAE6FD', primaryDark: '#7DD3FC', accent: '#0284C7', text: '#0C4A6E', textLight: '#0369A1' },
  { name: '薄荷绿', primary: '#A7F3D0', primaryDark: '#6EE7B7', accent: '#059669', text: '#064E3B', textLight: '#047857' },
]

const DEFAULT_THEME = { primary: '#FFB7C5', primaryDark: '#FF8FA3', accent: '#c44a6a', text: '#4a2030', textLight: '#a83555' }

function loadTheme() {
  try { return JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || '{}') } catch { return {} }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

const POLL_INTERVAL = 2000

const LOCAL_STORAGE_KEY = 'game_last_session'

type PlayMode = 'new' | 'load'

interface TaskState {
  status: 'creating' | 'generating' | 'completed' | 'failed'
  taskId: number | null
  saveId: number | null
  documentTitle: string
  sections: GameSection[] | null
  errorMessage?: string
}

function LoadingScreen({
  documentTitle,
  taskId,
  onBack,
}: {
  documentTitle: string
  taskId: number | null
  onBack: () => void
}) {
  const [dots, setDots] = useState('')
  useEffect(() => {
    const timer = setInterval(() => {
      setDots((d) => (d.length >= 6 ? '' : d + '.'))
    }, 500)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50 flex flex-col items-center justify-center px-6">
      <div className="relative mb-12">
        <div className="w-24 h-24 rounded-full border-4 border-pink-300/40 border-t-pink-400 animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="w-10 h-10 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
      </div>

      <h2 className="text-2xl font-bold text-pink-700 mb-3 text-center">
        正在生成视觉小说
      </h2>
      <p className="text-base text-pink-400 mb-2 text-center max-w-md">
        《{documentTitle}》
      </p>
      <p className="text-sm text-pink-300 mb-10">
        AI 正在解读文档内容{dots}
      </p>
      {taskId && (
        <p className="text-xs text-pink-300 mb-6 font-mono">
          任务 ID: {taskId}
        </p>
      )}

      <div className="w-full max-w-sm bg-pink-200/50 rounded-full h-1.5 mb-10 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-pink-400 to-pink-300 rounded-full animate-pulse" style={{ width: '45%' }} />
      </div>

      <button
        onClick={onBack}
        className="px-8 py-3 rounded-xl bg-white/80 text-pink-600 border border-pink-200 hover:bg-white hover:text-pink-700 active:scale-[0.98] transition-all duration-200 shadow-sm"
      >
        返回（生成仍在后台继续）
      </button>
      <p className="text-xs text-pink-300 mt-3">
        您可以随时从「我的存档」中继续阅读
      </p>
    </div>
    )
  }

function ErrorScreen({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50 flex flex-col items-center justify-center px-6">
      <div className="w-16 h-16 rounded-full bg-pink-100 border border-pink-200 flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-pink-700 mb-3">生成失败</h2>
      <p className="text-sm text-pink-400 mb-8 text-center max-w-md">{message}</p>
      <button
        onClick={onBack}
        className="px-8 py-3 rounded-xl bg-white/80 text-pink-600 border border-pink-200 hover:bg-white hover:text-pink-700 active:scale-[0.98] transition-all duration-200 shadow-sm"
      >
        返回
      </button>
    </div>
  )
}

interface CharacterMeta {
  character_id: number
  character_name: string
  portrait_url: string
  expressions: string[]
  expression_descriptions: string[]
  cg_images: string[]
  speaker_id?: string
  voice_status?: string
  voice_sample_url?: string
  is_default?: boolean
}

function extractCharacterMeta(sections: GameSection[]): { meta: CharacterMeta | null; storySections: GameSection[] } {
  if (sections.length > 0 && sections[0].type === '_character_meta') {
    const meta: CharacterMeta = {
      character_id: sections[0].character_id || 0,
      character_name: sections[0].character_name || '',
      portrait_url: sections[0].portrait_url || '',
      expressions: sections[0].expressions || [],
      expression_descriptions: sections[0].expression_descriptions || [],
      cg_images: sections[0].cg_images || [],
      speaker_id: sections[0].speaker_id || undefined,
      voice_status: sections[0].voice_status || undefined,
      voice_sample_url: sections[0].voice_sample_url || undefined,
      is_default: sections[0].is_default || undefined,
    }
    return { meta, storySections: sections.slice(1) }
  }
  return { meta: null, storySections: sections }
}

function resolveUrl(url: string | undefined): string {
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE}${url}`
}

function getExpressionImage(meta: CharacterMeta, expression: string): string {
  if (expression === 'portrait' || !expression) return resolveUrl(meta.portrait_url)
  const match = expression.match(/^expression_(\d+)$/)
  if (match) {
    const idx = parseInt(match[1], 10)
    if (meta.expressions && meta.expressions[idx]) return resolveUrl(meta.expressions[idx])
  }
  return resolveUrl(meta.portrait_url)
}

function ReadingPlayer({ docTitle, sections, backgroundUrl }: { docTitle: string; sections: GameSection[]; backgroundUrl?: string }) {
  const bgUrl = backgroundUrl || ''
  const navigate = useNavigate()
  const liveGameRef = useRef<LiveGame | null>(null)
  const [ended, setEnded] = useState(false)
  const [fadeToEnd, setFadeToEnd] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [cleanMode, setCleanMode] = useState(false)
  const [askMode, setAskMode] = useState(false)
  const [askInput, setAskInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [askReply, setAskReply] = useState('')
  const [askDialogText, setAskDialogText] = useState('')
  const [askDialogDone, setAskDialogDone] = useState(false)
  const [historyList, setHistoryList] = useState<{token: string; text: string}[]>([])
  const [currentExpr, setCurrentExpr] = useState('portrait')
  const [showQuestion, setShowQuestion] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState<GameQuestion | null>(null)
  const [questionCharName, setQuestionCharName] = useState('')
  const [questionDialogue, setQuestionDialogue] = useState('')
  const [questionCorrect, setQuestionCorrect] = useState(false)
  const [_questionExpr, setQuestionExpr] = useState('portrait')
  const deferredExprRef = useRef<string | null>(null)
  const showQuestionRef = useRef(false)
  const currentExprRef = useRef('portrait')
  const questionResolversRef = useRef<(() => void)[]>([])
  const dialogCountRef = useRef(0)
  const endingDialogCountRef = useRef(0)
  const endingStartedRef = useRef(false)
  const prevCGRef = useRef(0)
  const [isEndingPhase, setIsEndingPhase] = useState(false)
  const [endingCGIndex, setEndingCGIndex] = useState(0)
  const [fadeToEnding, setFadeToEnding] = useState(false)
  const [cgFade, setCgFade] = useState(false)
  const [showRotatePrompt, setShowRotatePrompt] = useState(false)
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const [toolbarBottom, setToolbarBottom] = useState(200)
  const [bgmSrc, setBgmSrc] = useState('')
  const [bgmMuted, setBgmMuted] = useState(() => localStorage.getItem('game_bgm_muted') === 'true')
  const [ttsSpeed, setTtsSpeed] = useState(() => {
    const saved = localStorage.getItem('game_tts_speed')
    return saved ? Number(saved) : 1.0
  })
  const [ttsVolume, setTtsVolume] = useState(() => {
    const saved = localStorage.getItem('game_tts_volume')
    return saved ? Number(saved) : 1.0
  })
  const [showSettings, setShowSettings] = useState(false)
  const [theme, setTheme] = useState(() => ({ ...DEFAULT_THEME, ...loadTheme() }))
  const [bgmList, setBgmList] = useState<{ filename: string; name: string }[]>([])
  const [bgmVolume, setBgmVolume] = useState(() => {
    const saved = localStorage.getItem('game_bgm_volume')
    return saved ? parseFloat(saved) : 0.5
  })
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null)
  const ttsEnabledRef = useRef(true)
  const ttsMutedRef = useRef(false)
  const [ttsMuted, setTtsMuted] = useState(() => localStorage.getItem('game_tts_muted') === 'true')
  const ttsUnlockedRef = useRef(false)
  const ttsErrorCountRef = useRef(0)
  const ttsRequestIdRef = useRef(0)
  const ttsPendingAudiosRef = useRef<Set<HTMLAudioElement>>(new Set())
  const [showTtsQuotaBanner, setShowTtsQuotaBanner] = useState(false)
  const [autoRead, setAutoRead] = useState(false)
  const autoReadRef = useRef(false)
  const autoReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearAutoReadTimer = useCallback(() => {
    if (autoReadTimerRef.current) {
      clearTimeout(autoReadTimerRef.current)
      autoReadTimerRef.current = null
    }
  }, [])
  const askModeRef = useRef(false)

  const [voiceBanner, setVoiceBanner] = useState<{ type: 'training' | 'failed'; charName: string } | null>(null)
  const [showTtsHint, setShowTtsHint] = useState(false)

  const { meta: characterMeta, storySections } = useMemo(() => extractCharacterMeta(sections), [sections])

  useEffect(() => {
    if (!ttsUnlockedRef.current) {
      const unlock = () => {
        if (!ttsUnlockedRef.current) {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
          const buf = ctx.createBuffer(1, 1, 22050)
          const src = ctx.createBufferSource()
          src.buffer = buf
          src.connect(ctx.destination)
          src.start(0)
          ctx.close()
        }
        ttsUnlockedRef.current = true
        document.removeEventListener('click', unlock, true)
        document.removeEventListener('touchstart', unlock, true)
      }
      document.addEventListener('click', unlock, true)
      document.addEventListener('touchstart', unlock, true)
    }
  }, [])

  useEffect(() => {
    if (characterMeta?.voice_status === 'training') {
      setVoiceBanner({ type: 'training', charName: characterMeta.character_name })
      ttsEnabledRef.current = false
    } else if (characterMeta?.voice_status === 'failed' && !characterMeta?.speaker_id) {
      setVoiceBanner({ type: 'failed', charName: characterMeta.character_name })
      ttsEnabledRef.current = false
    } else {
      setVoiceBanner(null)
      ttsEnabledRef.current = true
    }
  }, [characterMeta, ttsSpeed, ttsVolume])

  useEffect(() => {
    if (!characterMeta?.voice_sample_url || characterMeta?.speaker_id) return
    const ids: number[] = (() => { try { return JSON.parse(localStorage.getItem('tts_dismissed_ids') || '[]') } catch { return [] } })()
    if (ids.includes(characterMeta.character_id)) return
    setShowTtsHint(true)
  }, [characterMeta])

  // 组件卸载时清理所有 TTS 音频和定时器
  useEffect(() => {
    return () => {
      ttsRequestIdRef.current = -1
      clearAutoReadTimer()
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause()
        ttsAudioRef.current.currentTime = 0
        ttsAudioRef.current = null
      }
      for (const audio of ttsPendingAudiosRef.current) {
        audio.pause()
        audio.currentTime = 0
      }
      ttsPendingAudiosRef.current.clear()
    }
  }, [clearAutoReadTimer])

  // 一次性预加载该存档所有图片（角色立绘、表情、CG、背景）
  const preloadUrls = useMemo(() => {
    const urls: (string | undefined)[] = []
    if (characterMeta) {
      urls.push(
        resolveUrl(characterMeta.portrait_url),
        ...characterMeta.expressions.map(e => resolveUrl(e)),
        ...characterMeta.cg_images.map(c => resolveUrl(c)),
      )
    }
    // 扫描所有section中的图片（CG、背景、立绘）
    if (storySections) {
      for (const s of storySections) {
        urls.push(resolveUrl(s.portrait_url))
        urls.push(resolveUrl(s.background))
        if (s.cg_images) urls.push(...s.cg_images.map(c => resolveUrl(c)))
      }
    }
    return [...new Set(urls.filter(Boolean))]
  }, [characterMeta, storySections])

  usePreloadImages(preloadUrls)

  // 动态追踪对话框位置，让工具栏紧贴对话框顶部
  useEffect(() => {
    let observer: ResizeObserver | null = null
    let attempts = 0
    const maxAttempts = 20
    const interval = 300

    const setupObserver = () => {
      const dialog = document.querySelector<HTMLElement>('[data-element-type="dialog"]')
      if (!dialog) {
        if (attempts < maxAttempts) {
          attempts++
          setTimeout(setupObserver, interval)
        }
        return
      }
      const updatePosition = () => {
        const d = document.querySelector<HTMLElement>('[data-element-type="dialog"]')
        if (!d) return
        const wrapper = document.querySelector<HTMLElement>('.game-reader-wrapper')
        if (!wrapper) return
        const wRect = wrapper.getBoundingClientRect()
        const dRect = d.getBoundingClientRect()
        setToolbarBottom(wRect.bottom - dRect.top + 8)
      }
      updatePosition()
      observer = new ResizeObserver(updatePosition)
      observer.observe(dialog)
    }

    setupObserver()
    const handleResize = () => {
      const d = document.querySelector<HTMLElement>('[data-element-type="dialog"]')
      const wrapper = document.querySelector<HTMLElement>('.game-reader-wrapper')
      if (d && wrapper) setToolbarBottom(wrapper.getBoundingClientRect().bottom - d.getBoundingClientRect().top + 8)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [ended])

  const endingSection = useMemo(() => {
    return storySections.find(s => s.type === 'ending') || null
  }, [storySections])

  const endingCGList = useMemo(() => {
    if (!endingSection || !endingSection.cg_images) return []
    return endingSection.cg_images
  }, [endingSection])

  const endingText = useMemo(() => {
    if (!endingSection || !endingSection.text) return ''
    return endingSection.text
  }, [endingSection])

  const endingSentences = useMemo(() => {
    if (!endingSection || !endingSection.text) return []
    return endingSection.text.split(/(?<=[。！？\.!\?])/g).map(s => s.trim()).filter(s => s.length > 0)
  }, [endingSection])

  const sentencesPerCG = useMemo(() => {
    if (endingCGList.length <= 1 || endingSentences.length === 0) return 0
    return Math.ceil(endingSentences.length / endingCGList.length)
  }, [endingCGList, endingSentences])

  const regularSections = useMemo(() => {
    return storySections.filter(s => s.type !== 'ending' && s.type !== '_character_meta')
  }, [storySections])

  const builtStory = useMemo(() => {
    const story = new Story(docTitle || '文档阅读')
    const scene = new Scene('main', { background: bgUrl || '#ffe8ef' })
    const actions: any[] = []

    for (let i = 0; i < regularSections.length; i++) {
      const sec = regularSections[i]
      const charName = sec.character || '叙述者'
      const character = new Character(charName)

      actions.push(character.say(sec.text || ''))

      if (sec.question) {
        actions.push(Script.execute(() => {
          setCurrentQuestion(sec.question!)
          setQuestionCharName(charName)
          setQuestionDialogue(sec.text || '')
          setQuestionCorrect(false)
          setQuestionExpr(sec.expression || 'portrait')
          setShowQuestion(true)
          showQuestionRef.current = true
        }))
        const promise = new Promise<void>(resolve => {
          questionResolversRef.current.push(resolve)
        })
        actions.push(Control.sleep(promise))
      }
    }

    if (endingSection && endingSection.text) {
      const endingChar = endingSection.character || '叙述者'
      const ec = new Character(endingChar)
      const sentences = endingSection.text.split(/(?<=[。！？\.!\?])/g).map(s => s.trim()).filter(s => s.length > 0)
      if (sentences.length > 0) {
        for (const s of sentences) {
          actions.push(ec.say(s))
        }
      } else {
        actions.push(ec.say(endingSection.text))
      }
    }

    scene.action(actions)
    story.entry(scene)
    return story
  }, [regularSections, endingSection, docTitle, bgUrl])

  useEffect(() => {
    const style = document.createElement('style')
    const savedTheme = (() => { try { return JSON.parse(localStorage.getItem('game_theme_colors') || '{}') } catch { return {} } })()
    const t = {
      primary: savedTheme.primary || '#FFB7C5',
      primaryDark: savedTheme.primaryDark || '#FF8FA3',
      accent: savedTheme.accent || '#c44a6a',
      text: savedTheme.text || '#4a2030',
      textLight: savedTheme.textLight || '#a83555',
    }
    style.textContent = `
      :root {
        --theme-primary: ${t.primary};
        --theme-primary-dark: ${t.primaryDark};
        --theme-accent: ${t.accent};
        --theme-text: ${t.text};
        --theme-text-light: ${t.textLight};
      }
      .game-reader-wrapper {
        position: relative;
        width: 100%;
        height: 100vh;
        height: 100dvh;
        overflow: hidden;
      }
      .game-reader-wrapper .game-reader-player {
        width: 100%;
        height: 100%;
      }
      .game-reader-wrapper .__narraleaf_content-player .bg-cover {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 0 !important;
        background-size: cover !important;
        background-position: center !important;
        background-repeat: no-repeat !important;
      }
      .game-reader-wrapper .__narraleaf_content-player > div:first-child {
        aspect-ratio: unset !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        max-height: 100dvh !important;
        min-height: 100vh !important;
        min-height: 100dvh !important;
        min-width: 100vw !important;
        height: 100% !important;
        width: 100% !important;
      }
      .game-reader-wrapper .__narraleaf_content-player,
      .game-reader-wrapper .game-reader-player,
      .game-reader-wrapper .game-reader-player > div {
        width: 100% !important;
        min-width: 100vw !important;
        height: 100% !important;
        min-height: 100vh !important;
        min-height: 100dvh !important;
      }
      .game-reader-wrapper [data-element-type="dialog"] {
        pointer-events: auto !important;
        position: relative !important;
        z-index: 100 !important;
      }
      .game-reader-wrapper [data-element-type="dialog"] > div:first-child {
        height: auto !important;
        max-height: none !important;
      }
      .game-reader-wrapper [data-element-type="dialog"] > div:first-child > div:first-child {
        width: 80% !important;
        margin: 0 auto !important;
        min-height: 200px !important;
        padding: 18px 32px 24px !important;
        background: linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 20%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.95) 100%) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border-radius: 16px !important;
        box-sizing: border-box !important;
        pointer-events: auto !important;
        border: 1px solid var(--theme-primary) !important;
        position: relative !important;
        bottom: 40px !important;
      }
      .game-reader-wrapper [data-element-type="dialog"] > div:first-child > div:first-child > div:nth-child(1) {
        display: inline-flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 6px 16px !important;
        margin-bottom: 0 !important;
        background: linear-gradient(135deg, color-mix(in srgb, var(--theme-primary) 40%, transparent), color-mix(in srgb, var(--theme-primary-dark) 30%, transparent)) !important;
        border: 1px solid var(--theme-primary) !important;
        border-radius: 10px !important;
        color: var(--theme-accent) !important;
        font-size: 21px !important;
        font-weight: 700 !important;
        letter-spacing: 0.5px !important;
        backdrop-filter: blur(4px) !important;
        -webkit-backdrop-filter: blur(4px) !important;
        box-shadow: 0 2px 16px color-mix(in srgb, var(--theme-primary) 35%, transparent) !important;
      }
      .game-reader-wrapper [data-element-type="dialog"] > div:first-child > div:first-child > div:nth-child(1) span {
        color: inherit !important;
        font-size: inherit !important;
        font-weight: inherit !important;
      }
      .game-reader-wrapper [data-element-type="dialog"] > div:first-child > div:first-child > div:nth-child(2) {
        color: var(--theme-text) !important;
        font-size: 25px !important;
        line-height: 1.5 !important;
        font-weight: 800 !important;
        padding: 0 4px !important;
        margin-top: 0 !important;
        letter-spacing: 0.5px !important;
        position: relative !important;
      }
      .game-reader-wrapper [data-element-type="dialog"] > div:first-child > div:first-child > div:nth-child(2)::after {
        content: '▍';
        color: var(--theme-accent);
        font-weight: 800;
        font-size: 25px;
        animation: cursorBlink 0.6s step-end infinite;
      }
      .game-reader-wrapper [data-element-type="dialog"] .inline-block.break-all {
        font-size: 25px !important;
      }
      .game-reader-wrapper [data-element-type="dialog"] > div:first-child > div:first-child > div:nth-child(2) em {
        font-style: italic !important;
      }
      .character-display {
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        z-index: 50;
        pointer-events: none;
        transition: left 0.5s ease, transform 0.5s ease;
        display: flex;
        align-items: flex-end;
        justify-content: center;
      }
      .question-mode .character-display {
        left: 10%;
        transform: translateX(0);
      }
      .character-display img {
        height: calc(100vh - 20px);
        max-height: 96vh;
        max-width: 55vw;
        width: auto;
        object-fit: contain;
        filter: drop-shadow(0 8px 32px rgba(0,0,0,0.4));
        transition: opacity 0.5s ease;
      }
      .ending-cg-overlay {
        position: absolute;
        inset: 0;
        z-index: 50;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .ending-cg-bg {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        z-index: 0;
      }
      .ending-cg-bg-fade {
        animation: cgFadeIn 1s ease-in-out;
      }
      .ending-cg-content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        padding: 40px 24px;
        border-radius: 16px;
        max-width: 800px;
        max-height: 80vh;
        overflow-y: auto;
      }
      .ending-cg-image {
        display: none;
      }
      .ending-text-box {
        max-width: 700px;
        text-align: center;
      }
      .ending-character-name {
        color: #a5b4fc;
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 8px;
      }
      .ending-text {
        color: #e0e7ff;
        font-size: 20px;
        line-height: 1.7;
        font-weight: 600;
      }
      .ending-back-btn {
        margin-top: 28px;
        padding: 12px 32px;
        border-radius: 14px;
        background: rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.8);
        border: 1px solid rgba(255,255,255,0.2);
        cursor: pointer;
        transition: all 0.2s;
        font-size: 16px;
      }
      .ending-back-btn:hover {
        background: rgba(255,255,255,0.18);
        color: #fff;
      }
      @keyframes cgFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .cg-fade-in {
        animation: cgFadeIn 1s ease-in-out;
      }
      @keyframes cursorBlink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
      .fade-overlay-in {
        position: fixed;
        inset: 0;
        z-index: 120;
        background: #000;
        animation: fadeIn 0.35s ease-out forwards;
      }
      .fade-overlay-out {
        position: fixed;
        inset: 0;
        z-index: 120;
        background: #000;
        animation: fadeOut 0.35s ease-in forwards;
      }
      .reader-toolbar {
        position: absolute;
        right: 10%;
        z-index: 150;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;
        background: rgba(255, 255, 255, 0.25);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 14px;
        pointer-events: auto;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
      }
      .reader-toolbar button {
        min-width: 52px;
        height: 44px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        border-radius: 10px;
        background: transparent;
        border: none;
        color: var(--theme-accent);
        cursor: pointer;
        transition: all 0.2s;
        font-size: 10px;
        line-height: 1.1;
      }
      .reader-toolbar button:hover {
        background: color-mix(in srgb, var(--theme-primary) 20%, transparent);
        color: var(--theme-text-light);
      }
      .reader-toolbar button.active {
        color: var(--theme-primary-dark);
      }
      .clean-mode [data-element-type="dialog"],
      .clean-mode .reader-toolbar,
      .clean-mode .q-overlay,
      .clean-mode .ask-input-wrapper,
      .clean-mode .ask-overlay-backdrop,
      .clean-mode .top-buttons {
        display: none !important;
      }
      .ask-mode [data-element-type="dialog"],
      .ask-mode .reader-toolbar,
      .ask-mode .top-buttons {
        display: none !important;
      }
      .top-buttons button {
        width: 28px !important;
        height: 28px !important;
      }
      .history-modal {
        width: 88%;
        max-width: 500px;
        max-height: 70vh;
        background: linear-gradient(180deg, #fff5f7, #ffe8ef);
        border: 1px solid rgba(255,183,197,0.3);
        border-radius: 20px;
        padding: 20px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
      }
      .history-modal h3 {
        color: #a83555;
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 16px;
      }
      .history-entry {
        padding: 10px 12px;
        margin-bottom: 8px;
        background: rgba(255,255,255,0.6);
        border-radius: 10px;
        color: #5a2535;
        font-size: 14px;
        line-height: 1.5;
        cursor: pointer;
        transition: background 0.2s;
      }
      .history-entry:hover {
          background: rgba(255,183,197,0.3);
        }
        .history-entry:last-child {
          margin-bottom: 0;
        }
        .top-buttons {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 250;
          display: flex;
          gap: 10px;
        }
        .clean-overlay {
          position: fixed;
          inset: 0;
          z-index: 190;
          background: transparent;
        }
        .ask-overlay-backdrop {
          position: fixed;
          inset: 0;
          z-index: 105;
          background: transparent;
        }
        .ask-input-wrapper {
           position: absolute;
           bottom: 0;
           left: 10%;
           width: 80%;
           padding: 18px 32px 24px;
           background: linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 20%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.95) 100%);
           backdrop-filter: blur(12px);
           -webkit-backdrop-filter: blur(12px);
           border-radius: 16px;
           box-sizing: border-box;
           z-index: 110;
           pointer-events: auto;
           display: flex;
           flex-direction: column;
           border: 1px solid var(--theme-primary);
         }
         .ask-actions {
           display: flex;
           gap: 8px;
           margin-top: 10px;
           justify-content: flex-end;
         }
         .ask-btn {
           padding: 6px 16px;
           border-radius: 10px;
           font-size: 14px;
           font-weight: 600;
           cursor: pointer;
           border: none;
           transition: all 0.2s;
         }
         .ask-btn-primary {
           background: linear-gradient(135deg, var(--theme-primary), var(--theme-primary-dark));
           color: #fff;
         }
         .ask-btn-primary:hover {
           transform: translateY(-1px);
           box-shadow: 0 4px 16px color-mix(in srgb, var(--theme-primary) 40%, transparent);
         }
         .ask-btn-primary:disabled {
           opacity: 0.5;
           cursor: not-allowed;
           transform: none;
         }
         .ask-btn-secondary {
           background: rgba(255,255,255,0.8);
           color: var(--theme-accent);
           border: 1px solid var(--theme-primary);
         }
         .ask-btn-secondary:hover {
           background: #fff;
           color: var(--theme-text-light);
         }
         .ask-loading {
           display: flex;
           align-items: center;
           gap: 12px;
           color: var(--theme-accent);
           font-size: 15px;
           font-weight: 700;
           padding: 12px 4px;
         }
         .ask-loading-dot {
           width: 8px;
           height: 8px;
           border-radius: 50%;
           background: var(--theme-primary);
           animation: askBounce 0.6s ease-in-out infinite;
         }
        .ask-loading-dot:nth-child(2) { animation-delay: 0.15s; }
        .ask-loading-dot:nth-child(3) { animation-delay: 0.3s; }
        @keyframes askBounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-6px); opacity: 1; }
        }
        .ask-dialog-char {
           display: inline-flex;
           align-self: flex-start;
           align-items: center;
           gap: 8px;
           padding: 6px 16px;
           margin-bottom: 0;
           background: linear-gradient(135deg, color-mix(in srgb, var(--theme-primary) 40%, transparent), color-mix(in srgb, var(--theme-primary-dark) 30%, transparent));
           border: 1px solid var(--theme-primary);
           border-radius: 10px;
           color: var(--theme-accent);
          font-size: 21px;
          font-weight: 700;
          letter-spacing: 0.5px;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          box-shadow: 0 2px 16px color-mix(in srgb, var(--theme-primary) 35%, transparent);
        }
        .ask-dialog-text {
          color: var(--theme-text);
          font-size: 18px;
          line-height: 1.5;
          font-weight: 700;
          padding: 0 4px;
          margin-top: 0;
          letter-spacing: 0.3px;
          position: relative;
        }
        .ask-dialog-md {
          display: inline;
        }
        .ask-dialog-md p {
          display: inline;
          margin: 0;
        }
        .ask-dialog-md ul, .ask-dialog-md ol {
          display: block;
          margin: 4px 0;
          padding-left: 20px;
        }
        .ask-dialog-md li {
          display: list-item;
          list-style: inherit;
        }
        .ask-dialog-md strong {
          font-weight: 900;
        }
        .ask-dialog-md em {
          font-style: italic;
        }
        .ask-dialog-md code {
          background: color-mix(in srgb, var(--theme-primary) 15%, transparent);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 0.9em;
          font-family: monospace;
        }
        .ask-dialog-md pre {
          display: block;
          background: color-mix(in srgb, var(--theme-primary) 8%, transparent);
          padding: 12px;
          border-radius: 8px;
          margin: 8px 0;
          overflow-x: auto;
        }
        .ask-dialog-md pre code {
          background: none;
          padding: 0;
          font-size: 14px;
        }
        .ask-cursor {
          display: inline-block;
          width: 2px;
          height: 1.1em;
          background: var(--theme-accent);
          margin-left: 2px;
          vertical-align: text-bottom;
          animation: cursorBlink 0.6s step-end infinite;
        }
        .ask-dialog-input {
          width: 100%;
          min-height: 48px;
          background: transparent;
          border: none;
          outline: none;
          color: var(--theme-text);
          font-size: 18px;
          line-height: 1.5;
          font-weight: 700;
          padding: 0 4px;
          margin-top: 0;
          letter-spacing: 0.5px;
          resize: none;
          font-family: inherit;
          box-sizing: border-box;
        }
        .ask-dialog-input::placeholder {
          color: color-mix(in srgb, var(--theme-accent) 35%, transparent);
          font-weight: 600;
        }
        .ask-dialog-continue {
          text-align: center;
          color: var(--theme-primary-dark);
          font-size: 18px;
          font-weight: 700;
          cursor: pointer;
          padding: 12px 0 4px;
          transition: all 0.2s;
          animation: hintPulse 1.5s ease-in-out infinite;
        }
        .ask-dialog-continue:hover {
          color: var(--theme-accent);
        }
        @keyframes hintPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        .q-overlay {
          position: fixed;
          inset: 0;
          z-index: 200;
          background: transparent;
          pointer-events: auto;
        }
        .q-layout {
          position: relative;
          width: 100%;
          height: 100%;
          pointer-events: auto;
        }
        .q-left {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          padding: 0 0 24px;
          pointer-events: auto;
        }
        .q-left .q-bubble {
          pointer-events: auto;
        }
        .q-bubble {
          width: 80%;
          min-height: 200px;
          padding: 18px 32px 24px;
          background: linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 20%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.95) 100%);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-radius: 16px;
          box-sizing: border-box;
          border: 1px solid var(--theme-primary);
        }
        .q-char {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px;
          margin-bottom: 0;
          background: linear-gradient(135deg, color-mix(in srgb, var(--theme-primary) 40%, transparent), color-mix(in srgb, var(--theme-primary-dark) 30%, transparent));
          border: 1px solid var(--theme-primary);
          border-radius: 10px;
          color: var(--theme-accent);
          font-size: 21px;
          font-weight: 700;
          letter-spacing: 0.5px;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          box-shadow: 0 2px 16px rgba(255,183,197,0.35);
        }
        .q-continue {
          text-align: right;
          color: var(--theme-primary-dark);
          font-size: 18px;
          font-weight: 700;
          cursor: pointer;
          padding: 12px 0 4px;
          transition: all 0.2s;
          animation: hintPulse 1.5s ease-in-out infinite;
        }
        .q-continue:hover {
          color: var(--theme-accent);
        }
        .q-text {
          color: var(--theme-text);
          font-size: 25px;
          line-height: 1.5;
          font-weight: 800;
          padding: 0 4px;
          margin-top: 0;
          letter-spacing: 0.5px;
        }
        .q-right {
          position: absolute;
          left: 60%;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: auto;
        }
        .q-options {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          max-width: 420px;
        }
        .q-opt {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 14px 20px;
          background: rgba(255,255,255,0.8);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid var(--theme-primary);
          border-radius: 12px;
          color: var(--theme-text);
          font-size: 18px;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
        }
        .q-opt:hover {
          background: color-mix(in srgb, var(--theme-primary) 25%, transparent);
          border-color: var(--theme-primary-dark);
          color: var(--theme-text-light);
          transform: translateX(4px);
        }
        .q-opt:active {
          transform: scale(0.98);
        }
        .q-opt-label {
          font-weight: 800;
          color: var(--theme-primary-dark);
          font-size: 16px;
          min-width: 28px;
        }
        .opt-text {
          flex: 1;
        }
        .history-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 300;
          background: rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        .history-modal {
          width: 88%;
          max-width: 500px;
          max-height: 70vh;
          background: linear-gradient(180deg, #fff5f7, #ffe8ef);
          border: 1px solid var(--theme-primary);
          border-radius: 20px;
          padding: 20px;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        .history-modal h3 {
          color: var(--theme-accent);
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 16px;
        }
        .history-entry {
          padding: 10px 12px;
          margin-bottom: 8px;
          background: rgba(255,255,255,0.6);
          border-radius: 10px;
          color: var(--theme-text);
          font-size: 14px;
          line-height: 1.5;
          cursor: pointer;
          transition: background 0.2s;
        }
        .history-entry:hover {
          background: color-mix(in srgb, var(--theme-primary) 30%, transparent);
        }
        .history-entry:last-child {
          margin-bottom: 0;
        }
        .rotate-prompt {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
        color: #fff;
      }
      .rotate-prompt svg {
        width: 80px;
        height: 80px;
        animation: rotateHint 2s ease-in-out infinite;
        margin-bottom: 32px;
      }
      .rotate-prompt h2 {
        font-size: 24px;
        font-weight: 700;
        margin-bottom: 12px;
      }
      .rotate-prompt p {
        font-size: 15px;
        color: rgba(255,255,255,0.6);
      }
      @keyframes rotateHint {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(90deg); }
      }
    `
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  const isNative = Capacitor.isNativePlatform()
  useEffect(() => {
    if (!isNative) {
      const check = () => {
        const isTouchDevice = window.matchMedia('(hover: none)').matches
        const isPhonePortrait = window.innerWidth < 500 && window.innerHeight > window.innerWidth && isTouchDevice
        setShowRotatePrompt(isPhonePortrait)
      }
      check()
      window.addEventListener('resize', check)
      window.addEventListener('orientationchange', check)
      return () => {
        window.removeEventListener('resize', check)
        window.removeEventListener('orientationchange', check)
      }
    } else {
      setShowRotatePrompt(false)
      ScreenOrientation.lock({ orientation: 'landscape-primary' })
      return () => {
        ScreenOrientation.unlock().catch(() => {})
      }
    }
  }, [isNative])

  useEffect(() => {
    const loadBgm = async () => {
      try {
        const res = await gameApi.listBgm()
        const list = res?.data || []
        setBgmList(list)
        if (list.length === 0) return
        const saved = localStorage.getItem('game_bgm')
        let filename: string
        if (!saved) {
          const lastRandom = localStorage.getItem('game_bgm_last_random')
          const candidates = lastRandom ? list.filter(b => b.filename !== lastRandom) : list
          const picked = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : list[Math.floor(Math.random() * list.length)]
          filename = picked.filename
          localStorage.setItem('game_bgm_last_random', filename)
        } else {
          filename = saved
        }
        setBgmSrc(gameApi.getBgmUrl(filename))
      } catch {}
    }
    loadBgm()
  }, [])

  useEffect(() => {
    localStorage.setItem('game_bgm_muted', String(bgmMuted))
    if (bgmRef.current) bgmRef.current.muted = bgmMuted
  }, [bgmMuted])

  useEffect(() => {
    localStorage.setItem('game_tts_muted', String(ttsMuted))
    ttsMutedRef.current = ttsMuted
    if (!ttsMuted) {
      ttsErrorCountRef.current = 0
      setShowTtsQuotaBanner(false)
    }
  }, [ttsMuted])

  useEffect(() => {
    autoReadRef.current = autoRead
    if (!autoRead) {
      clearAutoReadTimer()
    }
  }, [autoRead, clearAutoReadTimer])

  useEffect(() => {
    askModeRef.current = askMode
  }, [askMode])

  useEffect(() => {
    localStorage.setItem('game_tts_speed', String(ttsSpeed))
  }, [ttsSpeed])

  useEffect(() => {
    localStorage.setItem('game_tts_volume', String(ttsVolume))
  }, [ttsVolume])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--theme-primary', theme.primary)
    root.style.setProperty('--theme-primary-dark', theme.primaryDark)
    root.style.setProperty('--theme-accent', theme.accent)
    root.style.setProperty('--theme-text', theme.text)
    root.style.setProperty('--theme-text-light', theme.textLight)
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme))
  }, [theme])

  useEffect(() => {
    localStorage.setItem('game_bgm_volume', String(bgmVolume))
    if (bgmRef.current) bgmRef.current.volume = bgmVolume
  }, [bgmVolume, bgmSrc])

  const expressionMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const sec of regularSections) {
      const text = (sec.text || '').trim()
      if (text) {
        map.set(text, sec.expression || 'portrait')
      }
    }
    return map
  }, [regularSections])


  useEffect(() => {
    showQuestionRef.current = showQuestion
  }, [showQuestion])

  useEffect(() => {
    currentExprRef.current = currentExpr
  }, [currentExpr])

  useEffect(() => {
    if (!showQuestion && deferredExprRef.current) {
      const timer = setTimeout(() => {
        setCurrentExpr(deferredExprRef.current!)
        deferredExprRef.current = null
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [showQuestion])

  const playTTS = useCallback((text: string, speed?: number) => {
    if (!ttsEnabledRef.current || ttsMutedRef.current || !characterMeta?.speaker_id) return
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause()
      ttsAudioRef.current.currentTime = 0
    }
    const cleaned = (text || '').replace(/[。！？，、：；""''「」『』（）【】《》\s]/g, '').trim()
    if (!cleaned) return
    const s = speed ?? ttsSpeed
    const reqId = ++ttsRequestIdRef.current
    synthesizeTts(text, characterMeta.speaker_id, { speedRatio: s, isDefaultCharacter: !!characterMeta.is_default }).then(blob => {
      if (reqId !== ttsRequestIdRef.current) return
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.volume = ttsVolume
      ttsPendingAudiosRef.current.add(audio)
      audio.onended = () => {
        ttsPendingAudiosRef.current.delete(audio)
        URL.revokeObjectURL(url)
        if (ttsAudioRef.current === audio) ttsAudioRef.current = null
        if (autoReadRef.current) {
          clearAutoReadTimer()
          if (!showQuestionRef.current && !askModeRef.current) {
            autoReadTimerRef.current = setTimeout(() => {
              liveGameRef.current?.skipDialog()
            }, 2000)
          }
        }
      }
      audio.onerror = (e) => {
        ttsPendingAudiosRef.current.delete(audio)
        console.warn('[TTS] 音频播放出错:', e)
        URL.revokeObjectURL(url)
        if (ttsAudioRef.current === audio) ttsAudioRef.current = null
      }
      ttsAudioRef.current = audio
      audio.play().catch((err) => {
        ttsPendingAudiosRef.current.delete(audio)
        URL.revokeObjectURL(url)
        if (ttsAudioRef.current === audio) ttsAudioRef.current = null
        if (autoReadRef.current) {
          clearAutoReadTimer()
          autoReadTimerRef.current = setTimeout(() => {
            liveGameRef.current?.skipDialog()
          }, 3000)
        }
      })
    }).catch((err) => {
       if (reqId !== ttsRequestIdRef.current) return
       ttsErrorCountRef.current++
       if (ttsErrorCountRef.current >= 2) {
         setShowTtsQuotaBanner(true)
       }
       if (autoReadRef.current) {
         clearAutoReadTimer()
         autoReadTimerRef.current = setTimeout(() => {
           liveGameRef.current?.skipDialog()
         }, 3000)
       }
     })
  }, [characterMeta, ttsSpeed])

  const playTTSRef = useRef(playTTS)
  playTTSRef.current = playTTS

  const handleReady = useCallback((ctx: PlayerEventContext) => {
    liveGameRef.current = ctx.liveGame
    ctx.liveGame.game.preference.setPreference('gameSpeed', 1.2)
    ctx.liveGame.game.preference.setPreference('cps', 25)
    dialogCountRef.current = 0
    endingDialogCountRef.current = 0
    endingStartedRef.current = false
    prevCGRef.current = 0
    setIsEndingPhase(false)
    setEndingCGIndex(0)
    const expMap = expressionMap
    const endingSents = endingSentences
    const regCount = regularSections.length
    const cgTotal = endingCGList.length
    const perCG = sentencesPerCG
    ctx.liveGame.onCharacterPrompt(({ text }) => {
      const cleaned = (text || '').trim()
      console.log('[GamePlay] onCharacterPrompt 触发:', cleaned.slice(0, 30))
      const matched = regularSections.findIndex(s => (s.text || '').trim() === cleaned)
      if (matched >= 0) {
        dialogCountRef.current = matched
        if (endingStartedRef.current) {
          endingStartedRef.current = false
          endingDialogCountRef.current = 0
          prevCGRef.current = 0
          setIsEndingPhase(false)
          setEndingCGIndex(0)
        }
      }
      const idx = dialogCountRef.current
      dialogCountRef.current++
      const expr = expMap.get(cleaned)
      if (expr && expr !== currentExprRef.current) {
        if (showQuestionRef.current) {
          deferredExprRef.current = expr
        } else {
          setCurrentExpr(expr)
        }
      }
      if (idx >= regCount && endingSents.length > 0) {
        const eMatched = endingSents.findIndex(s => s === cleaned)
        if (eMatched >= 0) {
          endingDialogCountRef.current = eMatched
        }
        if (!endingStartedRef.current) {
          endingStartedRef.current = true
          setIsEndingPhase(true)
          setFadeToEnding(true)
          setTimeout(() => setFadeToEnding(false), 700)
        }
        const eIdx = endingDialogCountRef.current
        endingDialogCountRef.current++
        if (cgTotal > 1 && perCG > 0) {
          const newCG = Math.min(Math.floor(eIdx / perCG), cgTotal - 1)
          if (newCG !== prevCGRef.current) {
            prevCGRef.current = newCG
            setCgFade(true)
            setTimeout(() => {
              setEndingCGIndex(newCG)
              setTimeout(() => setCgFade(false), 350)
            }, 350)
          }
        }
      }
      playTTSRef.current(cleaned, ttsSpeed)
      if (autoReadRef.current && !showQuestionRef.current && !askModeRef.current) {
        clearAutoReadTimer()
        const ttsWillPlay = characterMeta?.speaker_id && !ttsMutedRef.current && ttsEnabledRef.current
        if (!ttsWillPlay) {
          const printTimeMs = (cleaned.length / 25) * 1000
          const delay = Math.min(Math.max(printTimeMs, 2000) + 5000, 20000)
          autoReadTimerRef.current = setTimeout(() => {
            liveGameRef.current?.skipDialog()
          }, delay)
        }
      }
      if (characterMeta?.speaker_id && characterMeta?.character_id && !ttsMutedRef.current) {
        const currentIdx = regularSections.findIndex(s => (s.text || '').trim() === cleaned)
        const lookaheadCount = 3
        for (let i = 1; i <= lookaheadCount; i++) {
          const next = regularSections[currentIdx + i]
          if (next?.text) {
            synthesizeTts(next.text, characterMeta.speaker_id, { speedRatio: ttsSpeed, isDefaultCharacter: !!characterMeta.is_default }).catch(() => {})
          }
        }
      }
    })
    ctx.liveGame.newGame()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleEnd = useCallback(() => {
    setFadeToEnd(true)
    setTimeout(() => setEnded(true), 350)
    setTimeout(() => setFadeToEnd(false), 700)
  }, [])

  const handleAsk = useCallback(() => {
    setAskInput('')
    setAskReply('')
    setAskDialogText('')
    setAskDialogDone(false)
    setAsking(false)
    setAskMode(true)
  }, [])

  const handleAskSubmit = useCallback(async () => {
    if (!askInput.trim()) return
    setAsking(true)
    setCurrentExpr(characterMeta?.expressions?.[0] ? 'expression_0' : 'portrait')
    try {
      const charDesc = characterMeta ? `角色名：${characterMeta.character_name}` : ''
      const result = await gameApi.askQuestion({
        character_name: characterMeta?.character_name || '叙述者',
        character_desc: charDesc,
        sections: regularSections,
        current_section_index: dialogCountRef.current,
        user_question: askInput,
        ending_text: endingText,
        expression_descriptions: characterMeta?.expression_descriptions,
      })
      setAskReply(result.data?.reply || '(未收到回答)')
      const askExpr = result.data?.expression || 'portrait'
      setCurrentExpr(askExpr)
    } catch {
      setAskReply('抱歉，提问时出现错误，请稍后再试。')
    }
    setAsking(false)
  }, [askInput, characterMeta, regularSections, endingText])

  useEffect(() => {
    if (!askReply) return
    setAskDialogText('')
    setAskDialogDone(false)
    let i = 0
    const interval = setInterval(() => {
      i++
      setAskDialogText(askReply.slice(0, i))
      if (i >= askReply.length) {
        clearInterval(interval)
        setAskDialogDone(true)
      }
    }, 30)
    return () => clearInterval(interval)
  }, [askReply])

  useEffect(() => {
    if (!askMode) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      e.stopPropagation()
      e.preventDefault()
      const active = document.activeElement
      if (!active || (active.tagName !== 'TEXTAREA' && active.tagName !== 'INPUT')) return
      const nativeInput = active as HTMLTextAreaElement
      const start = nativeInput.selectionStart
      const end = nativeInput.selectionEnd
      const val = nativeInput.value
      nativeInput.value = val.slice(0, start) + ' ' + val.slice(end)
      nativeInput.selectionStart = nativeInput.selectionEnd = start + 1
      nativeInput.dispatchEvent(new Event('input', { bubbles: true }))
    }
    window.addEventListener('keydown', handler, true)
    window.addEventListener('keyup', handler, true)
    document.addEventListener('keydown', handler, true)
    return () => {
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('keyup', handler, true)
      document.removeEventListener('keydown', handler, true)
    }
  }, [askMode])

  const handleAskContinue = useCallback(() => {
    if (!askDialogDone) {
      setAskDialogText(askReply)
      setAskDialogDone(true)
      return
    }
    setAskMode(false)
    setAskReply('')
    setAskDialogText('')
    setAskDialogDone(false)
  }, [askDialogDone, askReply])

  const handleQuestionSelect = useCallback((optionId: string) => {
    const q = currentQuestion
    if (!q) return
    if (optionId === q.correct_id) {
      setQuestionDialogue(q.on_correct || '回答正确！')
      setQuestionCorrect(true)
      const expr = q.correct_expression || 'portrait'
      setCurrentExpr(expr)
      setQuestionExpr(expr)
    } else {
      setQuestionDialogue(q.error_hints[optionId] || '回答错误，再想想。')
      const expr = q.error_expressions?.[optionId] || 'portrait'
      setCurrentExpr(expr)
      setQuestionExpr(expr)
    }
  }, [currentQuestion])

  const handleQuestionContinue = useCallback(() => {
    setShowQuestion(false)
    setCurrentQuestion(null)
    setQuestionCorrect(false)
    setQuestionExpr('portrait')
    showQuestionRef.current = false
    const resolve = questionResolversRef.current.shift()
    resolve?.()
  }, [])

  const handleHistory = useCallback(() => {
    const lg = liveGameRef.current
    if (!lg) return
    try {
      const hist = lg.getHistory()
      const lines = hist.map((entry: any) => {
        const name = entry.element?.character || entry.element?.name || ''
        const text = entry.element?.text || entry.element?.content || ''
        return { token: entry.token, text: `${name}：${text}` }
      }).filter((l: any) => l.text.replace(/[：:]\s*$/, '').length > 0)
      setHistoryList(lines)
    } catch {
      setHistoryList([])
    }
    setShowHistory(true)
  }, [])

  const handleUndo = useCallback(() => {
    const lg = liveGameRef.current
    if (!lg) return
    try {
      const hist = lg.getHistory()
      const sayEntries = hist.filter((h: any) => h.element?.type === 'say')
      if (sayEntries.length <= 1) return
      const target = sayEntries[sayEntries.length - 2]
      lg.undo(target.token)
    } catch {}
  }, [])

  const handleBookmark = useCallback(() => {
    const lg = liveGameRef.current
    if (!lg) return
    try {
      const hist = lg.getHistory()
      const sayEntries = hist.filter((h: any) => h.element?.type === 'say')
      if (sayEntries.length === 0) return
      const lastSay = sayEntries[sayEntries.length - 1]
      const savedDialogCount = dialogCountRef.current
      const saves = JSON.parse(localStorage.getItem('reader_bookmark_tokens') || '[]')
      saves.push({ token: lastSay.token, time: Date.now(), label: `书签${saves.length + 1}`, savedDialogCount, charName: (lastSay.element as any)?.character || '', text: (lastSay.element as any)?.text || '' })
      if (saves.length > 20) saves.shift()
      localStorage.setItem('reader_bookmark_tokens', JSON.stringify(saves))
    } catch {}
  }, [])

  const handleGoBookmark = useCallback(() => {
    const lg = liveGameRef.current
    if (!lg) return
    try {
      const saves = JSON.parse(localStorage.getItem('reader_bookmark_tokens') || '[]')
      if (saves.length === 0) return
      const bookmark = saves[saves.length - 1]
      const savedDialogCount = 'savedDialogCount' in bookmark ? bookmark.savedDialogCount : null
      const hist = lg.getHistory()
      const sayEntries = hist.filter((h: any) => h.element?.type === 'say')
      let targetToken = bookmark.token
      if (bookmark.text && bookmark.charName) {
        const match = [...sayEntries].reverse().find((h: any) =>
          h.element?.text === bookmark.text && h.element?.character === bookmark.charName
        )
        if (match) targetToken = match.token
      }
      if (sayEntries.some((h: any) => h.token === targetToken)) {
        lg.undo(targetToken)
      }
      if (savedDialogCount !== null) {
        dialogCountRef.current = savedDialogCount
      }
      endingDialogCountRef.current = 0
      endingStartedRef.current = false
      prevCGRef.current = 0
      setIsEndingPhase(false)
      setEndingCGIndex(0)
      setEnded(false)
      setFadeToEnd(false)
    } catch {}
  }, [])

  const currentExpressionImage = useMemo(() => {
    if (!characterMeta) return null
    return getExpressionImage(characterMeta, currentExpr)
  }, [characterMeta, currentExpr])

  if (!regularSections.length) {
    return (
      <div className="game-reader-wrapper flex items-center justify-center bg-gradient-to-b from-pink-100 via-white to-pink-50">
        <p className="text-pink-400 text-lg">没有可显示的内容</p>
      </div>
    )
  }

  return (
    <>
      {showTtsHint && characterMeta && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-5 pt-6 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.5 4.5 0 0 0 2.5-3.5zM14 3.23v2.06a7.5 7.5 0 0 1 0 13.42v2.06a9.5 9.5 0 0 0 0-17.54z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800">提供 TTS 语音</h3>
                  <p className="text-xs text-gray-500">此存档的角色提供了语音样本</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                <strong className="text-pink-600">{characterMeta.character_name}</strong> 有语音克隆样本。
                你可前往火山引擎克隆该音色，获取音色 ID 后设置到角色的 TTS 配置中。
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => window.open('https://console.volcengine.com/speech/new/clone', '_blank')}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-emerald-400 to-emerald-500 text-white font-medium rounded-xl hover:opacity-90 transition"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  去火山引擎克隆音色
                </button>
                <button
                  onClick={() => setShowTtsHint(false)}
                  className="w-full py-2.5 bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200 transition"
                >
                  知道了，开始阅读
                </button>
                <button
                  onClick={() => {
                    const ids: number[] = (() => { try { return JSON.parse(localStorage.getItem('tts_dismissed_ids') || '[]') } catch { return [] } })()
                    if (!ids.includes(characterMeta.character_id)) {
                      ids.push(characterMeta.character_id)
                      localStorage.setItem('tts_dismissed_ids', JSON.stringify(ids))
                    }
                    setShowTtsHint(false)
                  }}
                  className="w-full py-2 text-gray-400 text-sm hover:text-red-500 transition"
                >
                  不再提醒
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className={`game-reader-wrapper${cleanMode ? ' clean-mode' : ''}${askMode ? ' ask-mode' : ''}${showQuestion ? ' question-mode' : ''}`}>
      {showRotatePrompt && (
        <div className="rotate-prompt">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            <polyline points="16 3 21 3 21 8" />
            <line x1="21" y1="3" x2="15" y2="9" />
          </svg>
          <h2>请横屏浏览</h2>
          <p>旋转设备获得更好的阅读体验</p>
        </div>
      )}
      <div className="top-buttons">
        <button
          onClick={() => setCleanMode(v => !v)}
          className={`flex items-center justify-center w-8 h-8 rounded-full bg-black/30 backdrop-blur-md border border-white/20 text-white/80 hover:bg-black/50 hover:text-white active:scale-90 transition-all duration-200${cleanMode ? ' bg-indigo-500/30 border-indigo-400/50 text-indigo-300' : ''}`}
          title={cleanMode ? '退出清屏' : '清屏'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </button>
        <button
          onClick={() => setAutoRead(v => !v)}
          className={`flex items-center justify-center w-8 h-8 rounded-full bg-black/30 backdrop-blur-md border ${autoRead ? 'border-green-400/50 text-green-300 bg-green-500/20' : 'border-white/20 text-white/80'} hover:bg-black/50 hover:text-white active:scale-90 transition-all duration-200`}
          title={autoRead ? '关闭自动阅读' : '自动阅读'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 19l9-7-9-7v14z" />
            <path d="M2 19l9-7-9-7v14z" />
          </svg>
        </button>
        <button
          onClick={() => setTtsMuted(v => !v)}
          className={`flex items-center justify-center w-8 h-8 rounded-full bg-black/30 backdrop-blur-md border ${ttsMuted ? 'border-white/10 text-white/40' : 'border-white/20 text-white/80'} hover:bg-black/50 hover:text-white active:scale-90 transition-all duration-200`}
          title={ttsMuted ? '启用语音' : '禁用人声'}
        >
          {ttsMuted ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
        <button
          onClick={() => setBgmMuted(v => !v)}
          className={`flex items-center justify-center w-8 h-8 rounded-full bg-black/30 backdrop-blur-md border ${bgmMuted ? 'border-white/10 text-white/40' : 'border-white/20 text-white/80'} hover:bg-black/50 hover:text-white active:scale-90 transition-all duration-200`}
          title={bgmMuted ? '取消静音' : '静音'}
        >
          {bgmMuted ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531V19.94a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.395C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.531v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-black/30 backdrop-blur-md border border-white/20 text-white/80 hover:bg-black/50 hover:text-white active:scale-90 transition-all duration-200"
          title="设置"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
        <button
          onClick={() => navigate('/game')}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-black/30 backdrop-blur-md border border-white/20 text-white/80 hover:bg-black/50 hover:text-white active:scale-90 transition-all duration-200"
          title="退出阅读"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {cleanMode && <div className="clean-overlay" onClick={() => setCleanMode(false)} />}

      {voiceBanner && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 z-[200] px-5 py-2.5 rounded-xl shadow-lg border flex items-center gap-2.5 text-sm font-medium animate-[fadeIn_0.3s_ease-out]"
          style={{
            background: voiceBanner.type === 'training'
              ? 'linear-gradient(135deg, #fef3c7, #fde68a)'
              : 'linear-gradient(135deg, #fee2e2, #fecaca)',
            borderColor: voiceBanner.type === 'training' ? '#f59e0b' : '#ef4444',
            color: voiceBanner.type === 'training' ? '#92400e' : '#991b1b',
          }}
        >
          {voiceBanner.type === 'training' ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          )}
          <span>
            {voiceBanner.type === 'training'
              ? `「${voiceBanner.charName}」的声音正在复刻训练中，语音暂不可用`
              : `「${voiceBanner.charName}」的声音复刻训练失败，语音暂不可用`}
          </span>
          <button
            onClick={() => setVoiceBanner(null)}
            className="ml-2 p-1 rounded-full hover:bg-black/10 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {showTtsQuotaBanner && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 z-[200] px-5 py-2.5 rounded-xl shadow-lg border border-amber-300 flex items-center gap-2.5 text-sm font-medium animate-[fadeIn_0.3s_ease-out]"
          style={{
            background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
            color: '#92400e',
          }}
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>
            TTS 语音合成异常，请检查 API Key 和音色 ID 配置
          </span>
          <div className="flex items-center gap-2 ml-2">
            <button
              onClick={() => setShowSettings(true)}
              className="px-3 py-1 rounded-lg bg-amber-200/70 hover:bg-amber-300/70 transition-colors text-xs"
            >
              设置
            </button>
            <button
              onClick={() => window.open('/game', '_blank')}
              className="px-3 py-1 rounded-lg bg-amber-200/70 hover:bg-amber-300/70 transition-colors text-xs"
            >
              📖 教程
            </button>
            <button
              onClick={() => setShowTtsQuotaBanner(false)}
              className="p-1 rounded-full hover:bg-black/10 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
          <div className="relative w-full max-w-sm bg-white/90 border border-pink-200 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-pink-100">
              <h2 className="text-lg font-semibold text-pink-700">游戏设置</h2>
              <button onClick={() => setShowSettings(false)} className="p-1.5 text-pink-300 hover:text-pink-500 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              <div>
                <div className="flex items-center justify-between text-sm text-pink-600 mb-2">
                  <span>语音语速</span>
                  <span className="font-semibold text-pink-700">{ttsSpeed.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.5" max="2.0" step="0.1" value={ttsSpeed} onChange={e => setTtsSpeed(Number(e.target.value))} className="w-full h-1.5 appearance-none rounded-full bg-pink-200 accent-pink-400 cursor-pointer" />
                <div className="flex justify-between text-[10px] text-pink-300 mt-0.5"><span>慢 0.5x</span><span>快 2.0x</span></div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm text-pink-600 mb-2">
                  <span>语音音量</span>
                  <span className="font-semibold text-pink-700">{Math.round(ttsVolume * 100)}%</span>
                </div>
                <input type="range" min="0" max="1.0" step="0.05" value={ttsVolume} onChange={e => setTtsVolume(Number(e.target.value))} className="w-full h-1.5 appearance-none rounded-full bg-pink-200 accent-pink-400 cursor-pointer" />
                <div className="flex justify-between text-[10px] text-pink-300 mt-0.5"><span>静音</span><span>最大</span></div>
              </div>
              <div className="border-t border-pink-100 pt-4">
                <label className="block text-sm font-medium text-pink-600 mb-3">主题颜色</label>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {THEME_PRESETS.map((preset) => (
                    <button key={preset.name} onClick={() => setTheme({ ...preset })}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all ${theme.primary === preset.primary && theme.primaryDark === preset.primaryDark ? 'border-pink-400 bg-pink-50' : 'border-transparent hover:border-pink-200'}`}
                    >
                      <div className="flex gap-1">
                        <div className="w-5 h-5 rounded-full" style={{ background: preset.primary }} />
                        <div className="w-5 h-5 rounded-full" style={{ background: preset.primaryDark }} />
                      </div>
                      <span className="text-[10px] text-pink-500 font-medium">{preset.name}</span>
                    </button>
                  ))}
                </div>
                <div className="space-y-2.5">
                  {([{key:'primary',label:'主色（浅）'},{key:'primaryDark',label:'主色（深）'},{key:'accent',label:'强调色'},{key:'text',label:'文字色'},{key:'textLight',label:'文字hover色'}] as const).map(({key,label}) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-xs text-pink-500">{label}</span>
                      <div className="flex items-center gap-2">
                        <input type="color" value={(theme as any)[key]} onChange={e => setTheme((prev:any) => ({...prev, [key]: e.target.value}))} className="w-8 h-8 rounded-lg cursor-pointer border border-pink-200 p-0.5" />
                        <span className="text-[10px] text-pink-300 font-mono w-16">{(theme as any)[key]}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-pink-100 pt-4">
                <label className="block text-sm font-medium text-pink-600 mb-3">背景音乐</label>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-pink-500">音量</span>
                  <input type="range" min="0" max="1" step="0.05" value={bgmVolume} onChange={e => setBgmVolume(parseFloat(e.target.value))} className="flex-1 accent-pink-400" />
                  <span className="text-xs text-pink-400 w-8 text-right">{Math.round(bgmVolume * 100)}%</span>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {bgmList.map(b => (
                    <button key={b.filename} onClick={() => {
                      setBgmSrc(gameApi.getBgmUrl(b.filename))
                      localStorage.setItem('game_bgm', b.filename)
                    }} className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${bgmSrc === gameApi.getBgmUrl(b.filename) ? 'bg-pink-100 text-pink-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}>
                      {b.name}
                    </button>
                  ))}
                </div>
                <button onClick={() => {
                  localStorage.removeItem('game_bgm')
                  const candidates = bgmList.filter(b => gameApi.getBgmUrl(b.filename) !== bgmSrc)
                  const pool = candidates.length > 0 ? candidates : bgmList
                  const random = pool[Math.floor(Math.random() * pool.length)]
                  setBgmSrc(gameApi.getBgmUrl(random.filename))
                  localStorage.setItem('game_bgm_last_random', random.filename)
                }} className="mt-2 w-full py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition-colors">
                  随机切换
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {bgmSrc && (
        <audio ref={bgmRef} src={bgmSrc} autoPlay loop muted={bgmMuted} style={{ display: 'none' }} />
      )}

      {askMode && (
        <div className="ask-overlay-backdrop" tabIndex={-1} onClick={() => { if (!asking && !askReply) setAskMode(false) }} onKeyDown={e => { if (e.key === ' ') e.preventDefault() }}>
          {!askReply && !asking && (
            <div className="ask-input-wrapper" onClick={e => e.stopPropagation()}>
              <div className="ask-dialog-char">向 {characterMeta?.character_name || '老师'} 提问</div>
              <textarea
                className="ask-dialog-input"
                value={askInput}
                onChange={e => setAskInput(e.target.value)}
                placeholder="输入你的问题..."
                autoFocus
                disabled={asking}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (askInput.trim()) handleAskSubmit()
                    return
                  }
                  if (e.key === 'Escape') {
                    setAskMode(false)
                    return
                  }
                  e.stopPropagation()
                }}
              />
              <div className="ask-actions">
                <button className="ask-btn ask-btn-secondary" onClick={() => setAskMode(false)} disabled={asking}>取消</button>
                <button className="ask-btn ask-btn-primary" onClick={handleAskSubmit} disabled={asking || !askInput.trim()}>
                  发送
                </button>
              </div>
            </div>
          )}
          {!askReply && asking && (
            <div className="ask-input-wrapper" onClick={e => e.stopPropagation()}>
              <div className="ask-dialog-char">{characterMeta?.character_name || '老师'}</div>
              <div className="ask-loading">
                <div className="ask-loading-dot" />
                <div className="ask-loading-dot" />
                <div className="ask-loading-dot" />
              </div>
            </div>
          )}
          {askReply && !asking && (
            <div className="ask-input-wrapper" onClick={e => { e.stopPropagation(); if (askDialogDone) handleAskContinue() }}>
              <div className="ask-dialog-char">{characterMeta?.character_name || '老师'}</div>
              <div className="ask-dialog-text">
                <div className="ask-dialog-md" dangerouslySetInnerHTML={{ __html: marked.parse(askDialogText) }} />
                {!askDialogDone && <span className="ask-cursor" />}
              </div>
              {askDialogDone && (
                <div className="ask-dialog-continue" onClick={e => { e.stopPropagation(); handleAskContinue() }}>继续学习 ▸</div>
              )}
            </div>
          )}
        </div>
      )}

      {fadeToEnding && <div className="fade-overlay-in" style={{ zIndex: 60 }} />}

      {cgFade && <div className="fade-overlay-in" style={{ zIndex: 55 }} />}

      {isEndingPhase && !ended && endingCGList.length > 0 && (
        <div
          className="absolute inset-0 z-[40] bg-cover bg-center"
          style={{ backgroundImage: `url(${resolveUrl(endingCGList[endingCGIndex])})` }}
        />
      )}

      {characterMeta && currentExpressionImage && !ended && !isEndingPhase && (
        <div className="character-display">
          <img
            key={currentExpr}
            src={currentExpressionImage}
            alt={characterMeta.character_name}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
      )}

      {!ended && (
        <div className="reader-toolbar" ref={toolbarRef} style={{ bottom: toolbarBottom }}>
          <button onClick={handleAsk} title="举手提问">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 21h10" />
              <path d="M12 21a7 7 0 0 0 7-7v-4" />
              <path d="M5 10a7 7 0 0 0 7 7" />
              <path d="M5 10a3 3 0 0 0 6 0" />
              <path d="M5 10V7a3 3 0 0 1 6 0v3" />
            </svg>
            <span>提问</span>
          </button>
          <button onClick={handleUndo} title="上一句">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
            <span>上一句</span>
          </button>
          <button onClick={handleHistory} title="历史回想">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>回想</span>
          </button>
          <button onClick={handleBookmark} title="添加书签">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <span>书签</span>
          </button>
          <button onClick={handleGoBookmark} title="前往书签">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              <polyline points="9 14 12 17 15 14" />
              <line x1="12" y1="17" x2="12" y2="11" />
            </svg>
            <span>跳转</span>
          </button>
        </div>
      )}

      {fadeToEnd && !ended && <div className="fade-overlay-in" style={{ zIndex: 185 }} />}
      {fadeToEnd && ended && <div className="fade-overlay-out" style={{ zIndex: 185 }} />}

      <Player
        key="main-story"
        story={builtStory}
        width="100%"
        height="100%"
        className="game-reader-player"
        onReady={handleReady}
        onEnd={handleEnd}
      />

      {showQuestion && currentQuestion && (
        <div className="q-overlay" onClick={e => e.stopPropagation()}>
          <div className="q-layout">
            <div className="q-left">
              <div className="q-bubble" onClick={questionCorrect ? handleQuestionContinue : undefined} style={{ cursor: questionCorrect ? 'pointer' : '' }}>
                <div className="q-char">{questionCharName}</div>
                <div className="q-text">{questionDialogue}</div>
                {questionCorrect && (
                  <div className="q-continue">继续 ▸</div>
                )}
              </div>
            </div>
            <div className="q-right">
              <div className="q-options" style={{ display: questionCorrect ? 'none' : '' }}>
                {currentQuestion.options.map((opt, i) => (
                  <button key={opt.id} className="q-opt" onClick={() => handleQuestionSelect(opt.id)}>
                    <span className="q-opt-label">{String.fromCharCode(65 + i)}.</span>
                    <span className="opt-text">{opt.text}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {ended && (
        <div className="ending-cg-overlay">
          {endingCGList.length > 0 && (
            <div
              className="ending-cg-bg ending-cg-bg-fade"
              style={{ backgroundImage: `url(${resolveUrl(endingCGList[0])})` }}
            >
              <img
                src={resolveUrl(endingCGList[0])}
                alt=""
                style={{ display: 'none' }}
                onError={(e) => { (e.target as HTMLImageElement).closest('.ending-cg-bg')?.remove() }}
              />
            </div>
          )}
          <div className="ending-cg-content">
              <div className="ending-text-box">
               <div className="ending-character-name">{endingSection?.character || ''}</div>
               <div className="ending-text">{endingText}</div>
            </div>
            <button
                onClick={() => navigate('/game')}
                className="ending-back-btn"
              >
              返回
            </button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="history-modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="history-modal" onClick={e => e.stopPropagation()}>
            <h3>历史回想（点击条目可回退）</h3>
            {historyList.map((entry, i) => (
                <div key={i} className="history-entry" onClick={() => {
                  const lg = liveGameRef.current
                  if (!lg) return
                  try {
                    lg.undo(entry.token)
                    setShowHistory(false)
                  } catch {}
                }}>{entry.text}</div>
            ))}
          </div>
        </div>
      )}
    </div></>
  )
}

export default function GamePlay() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [taskState, setTaskState] = useState<TaskState>({
    status: 'creating',
    taskId: null,
    saveId: null,
    documentTitle: '',
    sections: null,
  })
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const parseMode = searchParams.get('parseMode') || 'normal'

  // 从 location state 或 localStorage 获取背景
  const [sceneUrl] = useState<string | undefined>(() => {
    const fromState = (location.state as Record<string, unknown> | null)?.sceneUrl
    if (typeof fromState === 'string') return fromState
    try {
      const session = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}')
      return session.sceneUrl || undefined
    } catch {
      return undefined
    }
  })

  const [characterId] = useState<string | undefined>(() => {
    try {
      const session = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}')
      return session.characterId || undefined
    } catch {
      return undefined
    }
  })

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  useEffect(() => {
    // 在useEffect内部判断，避免依赖项问题
    const pathParts = location.pathname.split('/')
    const isSavePath = pathParts.includes('save')
    const playMode: PlayMode = isSavePath ? 'load' : 'new'
    const targetId = pathParts[pathParts.length - 1] || ''

    console.log('[GamePlay] Path:', location.pathname)
    console.log('[GamePlay] isSavePath:', isSavePath)
    console.log('[GamePlay] playMode:', playMode)
    console.log('[GamePlay] targetId:', targetId)
    
    if (playMode === 'load') {
      console.log('[GamePlay] Loading save...')
      const saveId = parseInt(targetId, 10)
      if (isNaN(saveId)) {
        setTaskState((s) => ({ ...s, status: 'failed', errorMessage: '无效的存档ID' }))
        return
      }
      setTaskState((s) => ({ ...s, saveId }))

      gameApi.getSaveDetail(saveId).then((save) => {
        console.log('[GamePlay] Save detail:', save)
        if (save.status === 'completed' && save.sections) {
          const meta = Array.isArray(save.sections) && save.sections.length > 0 ? save.sections[0] : null
          if (meta?.portrait_url) {
            localStorage.setItem('game_home_character', JSON.stringify({
              portrait_url: meta.portrait_url,
              name: meta.character_name || '',
            }))
          }
          setTaskState({
            status: 'completed',
            taskId: null,
            saveId: save.id,
            documentTitle: save.document_title,
            sections: save.sections,
          })
        } else if (save.status === 'generating') {
          setTaskState((s) => ({
            ...s,
            status: 'generating',
            taskId: save.id,
            documentTitle: save.document_title,
          }))
          startPolling(save.id)
        } else if (save.status === 'failed') {
          setTaskState((s) => ({
            ...s,
            status: 'failed',
            documentTitle: save.document_title,
            errorMessage: save.error_message || '生成失败',
          }))
        }
      }).catch((err) => {
        console.error('[GamePlay] Error loading save:', err)
        setTaskState((s) => ({ ...s, status: 'failed', errorMessage: err instanceof Error ? err.message : '加载存档失败' }))
      })
      return
    }

    console.log('[GamePlay] Creating new task...')
    const docIdNum = parseInt(targetId, 10)
    if (isNaN(docIdNum)) {
      setTaskState((s) => ({ ...s, status: 'failed', errorMessage: '无效的文档ID' }))
      return
    }

    gameApi.createTask(docIdNum, parseMode, characterId ? Number(characterId) : undefined).then((task) => {
      setTaskState((s) => ({
        ...s,
        status: 'generating',
        taskId: task.task_id,
        saveId: task.task_id,
        documentTitle: task.document_title,
      }))

      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
        docId: targetId,
        parseMode,
        saveId: task.task_id,
        sceneUrl,
      }))
      try {
        const bgMap = JSON.parse(localStorage.getItem('game_save_bg_map') || '{}')
        if (sceneUrl) {
          bgMap[task.task_id] = sceneUrl
          localStorage.setItem('game_save_bg_map', JSON.stringify(bgMap))
        }
      } catch {}

      startPolling(task.task_id)
    }).catch((err) => {
      setTaskState((s) => ({ ...s, status: 'failed', errorMessage: err instanceof Error ? err.message : '创建任务失败' }))
    })

    return clearPolling
  }, [location, parseMode, clearPolling])

  function startPolling(taskId: number) {
    clearPolling()
    pollingRef.current = setInterval(async () => {
      try {
        const status = await gameApi.getTaskStatus(taskId)
        if (status.status === 'completed') {
          clearPolling()
          const detail = await gameApi.getSaveDetail(taskId)
          const meta = Array.isArray(detail.sections) && detail.sections.length > 0 ? detail.sections[0] : null
          if (meta?.portrait_url) {
            localStorage.setItem('game_home_character', JSON.stringify({
              portrait_url: meta.portrait_url,
              name: meta.character_name || '',
            }))
          }
          setTaskState((s) => ({
            ...s,
            status: 'completed',
            sections: detail.sections || [],
          }))
          navigate(`/game/play/save/${taskId}`, { replace: true })
        } else if (status.status === 'failed') {
          clearPolling()
          setTaskState((s) => ({
            ...s,
            status: 'failed',
            errorMessage: status.error_message || '生成失败',
          }))
        }
      } catch {
        // ignore polling errors, retry next cycle
      }
    }, POLL_INTERVAL)
  }

  const handleBack = useCallback(() => {
    clearPolling()
    navigate('/game')
  }, [clearPolling, navigate])

  if (taskState.status === 'creating' || taskState.status === 'generating') {
    return (
      <LoadingScreen
        documentTitle={taskState.documentTitle}
        taskId={taskState.taskId}
        onBack={handleBack}
      />
    )
  }

  if (taskState.status === 'failed') {
    return <ErrorScreen message={taskState.errorMessage || '未知错误'} onBack={handleBack} />
  }

  if (taskState.status === 'completed' && taskState.sections) {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-pink-100 via-white to-pink-50">
        <ErrorBoundary>
          <GameProviders>
            <ReadingPlayer docTitle={taskState.documentTitle} sections={taskState.sections} backgroundUrl={sceneUrl} />
          </GameProviders>
        </ErrorBoundary>
      </div>
    )
  }

  return <LoadingScreen documentTitle="" taskId={null} onBack={handleBack} />
}
