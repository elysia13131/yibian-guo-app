import { useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { authApi, gameApi, characterApi } from '../../api'
import { cacheApiKey } from '../../services/TtsService'
import { useAuth } from '../../contexts/AuthContext'
import TtsTutorial from './TtsTutorial'

const LOCAL_STORAGE_KEY = 'game_last_session'
const THEME_STORAGE_KEY = 'game_theme_colors'
const HOME_CHAR_KEY = 'game_home_character'

const THEME_PRESETS = [
  { name: '樱花粉', primary: '#FFB7C5', primaryDark: '#FF8FA3', accent: '#c44a6a', text: '#4a2030', textLight: '#a83555' },
  { name: '薰衣草', primary: '#C9B1FF', primaryDark: '#A78BFA', accent: '#7C3AED', text: '#3B1F6E', textLight: '#5B21B6' },
  { name: '天空蓝', primary: '#BAE6FD', primaryDark: '#7DD3FC', accent: '#0284C7', text: '#0C4A6E', textLight: '#0369A1' },
  { name: '薄荷绿', primary: '#A7F3D0', primaryDark: '#6EE7B7', accent: '#059669', text: '#064E3B', textLight: '#047857' },
]

function getTimePeriod(): { bg: string; label: string } {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return { bg: '/home-bg/清晨.png', label: '清晨' }
  if (h >= 12 && h < 17) return { bg: '/home-bg/中午.png', label: '中午' }
  if (h >= 17 && h < 19) return { bg: '/home-bg/黄昏.png', label: '黄昏' }
  return { bg: '/home-bg/夜晚.png', label: '夜晚' }
}

function loadTheme() {
  try { return JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || '{}') } catch { return {} }
}

const DEFAULT_THEME = { primary: '#FFB7C5', primaryDark: '#FF8FA3', accent: '#c44a6a', text: '#4a2030', textLight: '#a83555' }
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

function resolveUrl(url: string): string {
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE}${url}`
}

export default function GameHome() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [hasHistory, setHasHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const [playerTitle, setPlayerTitle] = useState('同学')
  const [userApiKey, setUserApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [bgLoaded, setBgLoaded] = useState(false)
  const { bg: bgUrl, label: timeLabel } = getTimePeriod()
  const [theme, setTheme] = useState(() => ({ ...DEFAULT_THEME, ...loadTheme() }))
  const [characterPortrait, setCharacterPortrait] = useState<string | null>(null)
  const [characterName, setCharacterName] = useState('')
  const [portraitScale, setPortraitScale] = useState(() => {
    try { return Number(localStorage.getItem('game_home_portrait_scale')) || 100 } catch { return 100 }
  })
  const [portraitOffsetX, setPortraitOffsetX] = useState(() => {
    try { return Number(localStorage.getItem('game_home_portrait_offset_x')) || 0 } catch { return 0 }
  })
  const [portraitOffsetY, setPortraitOffsetY] = useState(() => {
    try { return Number(localStorage.getItem('game_home_portrait_offset_y')) || 0 } catch { return 0 }
  })
  const [showEditPortrait, setShowEditPortrait] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const offsetStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const [bgmList, setBgmList] = useState<{ filename: string; name: string }[]>([])
  const [selectedBgm, setSelectedBgm] = useState(() => localStorage.getItem('game_bgm') || '')
  const [bgmVolume, setBgmVolume] = useState(() => {
    const v = localStorage.getItem('game_bgm_volume')
    return v ? parseFloat(v) : 0.5
  })
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const [bgmMuted, setBgmMuted] = useState(() => localStorage.getItem('game_bgm_muted') === 'true')
  const [scale, setScale] = useState(1)
  const [isMobilePortrait, setIsMobilePortrait] = useState(false)

  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      @keyframes sakuraFall {
        0% { transform: translateY(0) rotate(0deg); opacity: 0; }
        10% { opacity: 0.8; }
        90% { opacity: 0.6; }
        100% { transform: translateY(100vh) rotate(360deg); opacity: 0; }
      }
    `
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  useEffect(() => {
    const lastSession = localStorage.getItem(LOCAL_STORAGE_KEY)
    setHasHistory(!!lastSession)
  }, [])

  useEffect(() => {
    const img = new Image()
    img.onload = () => setBgLoaded(true)
    img.src = bgUrl
  }, [bgUrl])

  useEffect(() => {
    const loadCharacter = async () => {
      try {
        const saved = localStorage.getItem(HOME_CHAR_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed.portrait_url) {
            setCharacterPortrait(resolveUrl(parsed.portrait_url))
            setCharacterName(parsed.name || '')
            return
          }
        }
        const session = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}')
        if (session.saveId) {
          const detail = await gameApi.getSaveDetail(session.saveId)
          const meta = Array.isArray(detail.sections) && detail.sections.length > 0
            ? detail.sections[0]
            : null
          if (meta?.portrait_url) {
            setCharacterPortrait(resolveUrl(meta.portrait_url))
            setCharacterName(meta.character_name || '')
            return
          }
        }
        const res = await characterApi.list('default')
        if (res.characters?.length > 0) {
          const c = res.characters[0]
          if (c.portrait_url) {
            setCharacterPortrait(resolveUrl(c.portrait_url))
            setCharacterName(c.name)
            localStorage.setItem(HOME_CHAR_KEY, JSON.stringify({ portrait_url: c.portrait_url, name: c.name }))
          }
        }
      } catch {}
    }
    loadCharacter()
  }, [])

  useEffect(() => {
    gameApi.listBgm().then(res => {
      if (res?.data) {
        setBgmList(res.data)
        const saved = localStorage.getItem('game_bgm')
        if (!saved && res.data.length > 0) {
          const lastRandom = localStorage.getItem('game_bgm_last_random')
          const candidates = lastRandom ? res.data.filter(b => b.filename !== lastRandom) : res.data
          const picked = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : res.data[Math.floor(Math.random() * res.data.length)]
          setSelectedBgm(picked.filename)
        }
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    localStorage.setItem('game_bgm_volume', String(bgmVolume))
    if (bgmRef.current) bgmRef.current.volume = bgmVolume
  }, [bgmVolume])

  useEffect(() => {
    localStorage.setItem('game_bgm_muted', String(bgmMuted))
    if (bgmRef.current) bgmRef.current.muted = bgmMuted
  }, [bgmMuted])

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const scaleX = w / 1440
      const scaleY = h / 900
      const s = Math.min(scaleX, scaleY)
      setScale(Math.max(0.4, Math.min(1.3, s)))
      setIsMobilePortrait(w < 768 && h > w)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const onFocus = () => {
      const saved = localStorage.getItem(HOME_CHAR_KEY)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed.portrait_url) {
            setCharacterPortrait(resolveUrl(parsed.portrait_url))
            setCharacterName(parsed.name || '')
          }
        } catch {}
      }
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onFocus)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('game_home_portrait_scale', String(portraitScale))
  }, [portraitScale])

  useEffect(() => {
    localStorage.setItem('game_home_portrait_offset_x', String(portraitOffsetX))
  }, [portraitOffsetX])

  useEffect(() => {
    localStorage.setItem('game_home_portrait_offset_y', String(portraitOffsetY))
  }, [portraitOffsetY])

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
    if (!user?.deepseek_api_key) {
      window.dispatchEvent(new CustomEvent('api-key-missing', { detail: { missingKeys: ['deepseek'] } }))
    }
  }, [user])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!showEditPortrait) return
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    offsetStartRef.current = { x: portraitOffsetX, y: portraitOffsetY }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!showEditPortrait) return
    e.preventDefault()
    const touch = e.touches[0]
    setIsDragging(true)
    dragStartRef.current = { x: touch.clientX, y: touch.clientY }
    offsetStartRef.current = { x: portraitOffsetX, y: portraitOffsetY }
  }

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      setPortraitOffsetX(offsetStartRef.current.x + (e.clientX - dragStartRef.current.x))
      setPortraitOffsetY(offsetStartRef.current.y + (e.clientY - dragStartRef.current.y))
    }
    const handleMouseUp = () => setIsDragging(false)
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      setPortraitOffsetX(offsetStartRef.current.x + (touch.clientX - dragStartRef.current.x))
      setPortraitOffsetY(offsetStartRef.current.y + (touch.clientY - dragStartRef.current.y))
    }
    const handleTouchEnd = () => setIsDragging(false)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isDragging])

  const handleContinue = () => {
    const lastSession = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (lastSession) {
      try {
        const parsed = JSON.parse(lastSession)
        const { saveId } = parsed
        if (saveId) {
          navigate(`/game/play/save/${saveId}`)
          return
        }
      } catch (e) {
        console.error('[GameHome] Parse error:', e)
      }
    }
    navigate('/game/select')
  }

  const openSettings = async () => {
    setShowSettings(true)
    try {
      const user = await authApi.getCurrentUser()
      setPlayerTitle(user.player_title || '同学')
      setUserApiKey(user.tts_api_key || '')
    } catch (err) {
      console.error('获取用户信息失败', err)
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await authApi.updateSettings({ player_title: playerTitle.trim() || '同学', tts_api_key: userApiKey.trim() })
      if (userApiKey.trim()) cacheApiKey(userApiKey.trim())
      setShowSettings(false)
    } catch (err) {
      console.error('保存设置失败', err)
      alert('保存设置失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-gradient-to-b from-pink-200 via-pink-100 to-pink-50">
      <img
        src={bgUrl}
        alt=""
        className={`fixed inset-0 w-full h-full object-cover transition-opacity duration-1000 ${bgLoaded ? 'opacity-100' : 'opacity-0'}`}
      />
      <div className="fixed inset-0 bg-gradient-to-b from-white/20 via-transparent to-white/40 pointer-events-none" />

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-3 h-3 rounded-full opacity-0 animate-[sakuraFall_8s_linear_infinite]"
            style={{
              background: 'radial-gradient(circle, #FFB7C5, #FF8FA3)',
              left: `${Math.random() * 100}%`,
              top: `-${Math.random() * 20}%`,
              animationDelay: `${Math.random() * 10}s`,
              animationDuration: `${8 + Math.random() * 6}s`,
              transform: `scale(${0.6 + Math.random() * 0.8})`,
            }}
          />
        ))}
      </div>

      {!isMobilePortrait && characterPortrait && (
        <div className="fixed right-[5%] bottom-0 h-[80%] pointer-events-none" style={{ zIndex: 5 }}>
          <img
            src={characterPortrait}
            alt={characterName}
            className={`h-full w-auto object-contain ${showEditPortrait ? 'cursor-grab active:cursor-grabbing pointer-events-auto' : ''}`}
            style={{
              transform: `translate(${portraitOffsetX}px, ${portraitOffsetY}px) scale(${portraitScale / 100})`,
              transformOrigin: 'bottom center',
            }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          />
          {showEditPortrait && (
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-pink-500 text-white text-[10px] whitespace-nowrap pointer-events-auto">
              拖动调整位置
            </div>
          )}
        </div>
      )}

      {isMobilePortrait && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
          <svg className="w-20 h-20 text-white/80 mb-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0110.5 3h6a2.25 2.25 0 012.25 2.25v13.5A2.25 2.25 0 0116.5 21h-6a2.25 2.25 0 01-2.25-2.25V15m-3 0l3-3m0 0l3 3m-3-3v12" />
          </svg>
          <p className="text-white/90 text-lg font-medium">横屏体验更佳</p>
          <p className="text-white/50 text-sm mt-2">请将设备旋转至横向</p>
        </div>
      )}

      <button
        onClick={() => setShowEditPortrait(v => !v)}
        className={`fixed bottom-6 right-6 z-20 p-3 rounded-full border transition-all duration-200 shadow-md ${
          showEditPortrait
            ? 'bg-pink-100 text-pink-500 border-pink-300 hover:bg-pink-50'
            : 'bg-white/70 text-pink-400 border-pink-200 hover:bg-white hover:text-pink-500'
        } active:scale-[0.95]`}
        title="编辑立绘"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
      </button>

      {showEditPortrait && (
        <div className="fixed bottom-24 right-6 z-20 bg-white/90 backdrop-blur-md border border-pink-200 rounded-xl p-4 shadow-lg min-w-[220px]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-pink-600 font-medium">编辑立绘</span>
            <button
              onClick={() => {
                setPortraitScale(100)
                setPortraitOffsetX(0)
                setPortraitOffsetY(0)
              }}
              className="text-[10px] text-pink-400 hover:text-pink-600 px-2 py-0.5 rounded border border-pink-200 hover:bg-pink-50 transition-colors"
            >
              重置
            </button>
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-pink-500">大小</span>
              <span className="text-[10px] text-pink-400 font-mono">{portraitScale}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="200"
              value={portraitScale}
              onChange={e => setPortraitScale(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ accentColor: '#FF8FA3' }}
            />
          </div>

          <div className="text-[10px] text-pink-300 text-center mt-2">
            也可直接拖动立绘调整位置
          </div>
        </div>
      )}

      <button
        onClick={() => setBgmMuted(v => !v)}
        className={`absolute top-4 right-4 p-2.5 rounded-xl bg-white/60 border ${bgmMuted ? 'text-gray-400 border-gray-200' : 'text-pink-400 border-pink-200'} hover:bg-white hover:text-pink-500 active:scale-[0.98] transition-all duration-200 backdrop-blur-md z-10 shadow-sm`}
        style={{ right: '76px' }}
        title={bgmMuted ? '取消静音' : '静音'}
      >
        {bgmMuted ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531V19.94a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.395C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.531v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        )}
      </button>
      <button
        onClick={openSettings}
        className="absolute top-4 right-4 p-2.5 rounded-xl bg-white/60 text-pink-400 border border-pink-200 hover:bg-white hover:text-pink-500 active:scale-[0.98] transition-all duration-200 backdrop-blur-md z-10 shadow-sm"
        title="设置"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      <div className={`relative h-full flex flex-col ${isMobilePortrait ? 'items-center justify-center' : 'items-start justify-center'} px-12`}>
        <div className="flex justify-start mb-4" style={{ marginLeft: `${-10 * scale}px` }}>
          <img
            src="/home-bg/logo.png"
            alt="叙述之叶"
            className="drop-shadow-lg"
            style={{ width: `${350 * scale}px`, height: 'auto' }}
          />
        </div>
        <div className="w-full" style={{ maxWidth: `${220 * scale}px` }}>

          <button onClick={() => navigate('/game/select')} className="w-full transition-transform duration-200 hover:scale-105 active:scale-[0.97]">
            <img src="/home-bg/开始阅读.png" alt="开始新的阅读" className="w-full h-auto drop-shadow-lg" />
          </button>

          {hasHistory && (
            <button onClick={handleContinue} className="w-full transition-transform duration-200 hover:scale-105 active:scale-[0.97]">
              <img src="/home-bg/继续阅读.png" alt="继续阅读" className="w-full h-auto drop-shadow-lg" />
            </button>
          )}

          <button onClick={() => navigate('/game/character/manage')} className="w-full transition-transform duration-200 hover:scale-105 active:scale-[0.97]">
            <img src="/home-bg/搭档.png" alt="搭档" className="w-full h-auto drop-shadow-lg" />
          </button>

          <button onClick={() => navigate('/game/saves')} className="w-full transition-transform duration-200 hover:scale-105 active:scale-[0.97]">
            <img src="/home-bg/我的存档.png" alt="我的存档" className="w-full h-auto drop-shadow-lg" />
          </button>

          <button
            onClick={() => navigate('/')}
            className="w-full py-2 rounded-xl text-white/70 text-xs hover:text-white active:scale-[0.98] transition-all duration-200 drop-shadow"
          >
            返回主页
          </button>
        </div>

        <div className="absolute bottom-8 text-center">
          <p className="text-xs text-white/40 drop-shadow">
            Powered by NarraLeaf · {timeLabel}
          </p>
        </div>
      </div>

      {selectedBgm && (
        <audio ref={bgmRef} src={gameApi.getBgmUrl(selectedBgm)} autoPlay loop muted={bgmMuted} style={{ display: 'none' }} />
      )}
      <TtsTutorial open={showTutorial} onClose={() => setShowTutorial(false)} />
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
          <div className="relative w-full max-w-sm bg-white/90 border border-pink-200 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-pink-100">
              <h2 className="text-lg font-semibold text-pink-700">游戏设置</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1.5 text-pink-300 hover:text-pink-500 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-pink-600 mb-2">角色对我的称呼</label>
                <input
                  type="text"
                  value={playerTitle}
                  onChange={(e) => setPlayerTitle(e.target.value)}
                  placeholder="同学"
                  className="w-full px-4 py-3 rounded-xl bg-pink-50/80 border border-pink-200 text-pink-700 placeholder-pink-300 focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-300 transition-all"
                />
                <p className="mt-1.5 text-xs text-pink-400">所有角色在游戏中统一以此称呼你，留空默认为"同学"</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-pink-600 mb-2">
                  火山引擎 TTS Key（语音合成）
                  <span className="text-pink-300 font-normal ml-1">（可选）</span>
                </label>
                <input
                  type="text"
                  value={userApiKey}
                  onChange={(e) => setUserApiKey(e.target.value)}
                  placeholder="36b762e5-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full px-4 py-3 rounded-xl bg-pink-50/80 border border-pink-200 text-pink-700 placeholder-pink-300 focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-300 transition-all"
                />
                <p className="mt-1.5 text-xs text-pink-400">
                   填写后角色的 TTS 语音合成将使用你的 API Key。
                   <br />
                   <a
                      href="javascript:void(0)"
                      onClick={(e) => { e.preventDefault(); window.open('https://console.volcengine.com/speech/new/setting/apikeys', '_blank') }}
                      className="text-pink-500 underline hover:text-pink-700"
                    >🔗 前往获取 API Key</a>
                   ｜
                   <button type="button" onClick={() => setShowTutorial(true)} className="text-pink-500 underline hover:text-pink-700">
                     📖 查看详细教程
                   </button>
                 </p>
              </div>

              <div className="border-t border-pink-100 pt-4">
                <label className="block text-sm font-medium text-pink-600 mb-3">主题颜色</label>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {THEME_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => setTheme({ ...preset })}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all ${
                        theme.primary === preset.primary && theme.primaryDark === preset.primaryDark
                          ? 'border-pink-400 bg-pink-50'
                          : 'border-transparent hover:border-pink-200'
                      }`}
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
                  {([
                    { key: 'primary', label: '主色（浅）' },
                    { key: 'primaryDark', label: '主色（深）' },
                    { key: 'accent', label: '强调色' },
                    { key: 'text', label: '文字色' },
                    { key: 'textLight', label: '文字hover色' },
                  ] as const).map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-xs text-pink-500">{label}</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={(theme as any)[key]}
                          onChange={(e) => setTheme((prev: any) => ({ ...prev, [key]: e.target.value }))}
                          className="w-8 h-8 rounded-lg cursor-pointer border border-pink-200 p-0.5"
                        />
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
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={bgmVolume}
                    onChange={e => setBgmVolume(parseFloat(e.target.value))}
                    className="flex-1 accent-pink-400"
                  />
                  <span className="text-xs text-pink-400 w-8 text-right">{Math.round(bgmVolume * 100)}%</span>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {bgmList.map(b => (
                    <button
                      key={b.filename}
                      onClick={() => {
                        setSelectedBgm(b.filename)
                        localStorage.setItem('game_bgm', b.filename)
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                        selectedBgm === b.filename
                          ? 'bg-pink-100 text-pink-700 font-medium'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    localStorage.removeItem('game_bgm')
                    const candidates = bgmList.filter(b => b.filename !== selectedBgm)
                    const pool = candidates.length > 0 ? candidates : bgmList
                    const random = pool[Math.floor(Math.random() * pool.length)]
                    setSelectedBgm(random.filename)
                    localStorage.setItem('game_bgm_last_random', random.filename)
                  }}
                  className="mt-2 w-full py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  随机切换（每次进入页面随机）
                </button>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-pink-100">
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-400 to-pink-500 text-white font-semibold shadow-lg shadow-pink-300/30 hover:from-pink-300 hover:to-pink-400 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
