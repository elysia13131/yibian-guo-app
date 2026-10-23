import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'motion/react'
import {
  Download, Trash2, X, CheckCircle2, AlertCircle,
  Loader2, HardDrive, Cpu, Zap, ExternalLink,
} from 'lucide-react'
import { modelManager, type DownloadProgress, type DownloadState } from '../ai/ModelManager'

interface ModelItemProps {
  modelId: string
}

function ModelItem({ modelId }: ModelItemProps) {
  const [state, setState] = useState<DownloadState>('idle')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState('')
  const [storage, setStorage] = useState('')
  const mountedRef = useRef(true)

  const model = modelManager.getAvailableModels().find(m => m.id === modelId)

  useEffect(() => {
    if (!model) return
    ;(async () => {
      const downloaded = await modelManager.isDownloaded(modelId)
      if (!mountedRef.current) return
      if (downloaded) {
        setState('done')
      } else if (modelManager.isDownloading(modelId)) {
        setState('downloading')
        const p = modelManager.getCurrentProgress(modelId)
        if (p) setProgress(p)
      }
      const s = await modelManager.getTotalStorage()
      if (mountedRef.current) setStorage(s)
    })()
  }, [model, modelId])

  useEffect(() => {
    if (state !== 'downloading') return
    const timer = setInterval(() => {
      const p = modelManager.getCurrentProgress(modelId)
      if (p) setProgress(p)
    }, 500)
    return () => clearInterval(timer)
  }, [state, modelId])

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  const handleDownload = useCallback(async () => {
    if (!model) return
    if (modelManager.isDownloading(modelId)) {
      const p = modelManager.getCurrentProgress(modelId)
      if (p) setProgress(p)
      setState('downloading')
      return
    }
    setState('downloading')
    setError('')
    try {
      await modelManager.downloadModel(modelId, (p: DownloadProgress) => {
        if (mountedRef.current) setProgress(p)
      })
      if (!mountedRef.current) return
      setState('done')
      setProgress(null)
      const s = await modelManager.getTotalStorage()
      setStorage(s)
    } catch (err: any) {
      if (!mountedRef.current) return
      if (err?.message === '下载已取消') {
        setState('idle')
      } else {
        setState('error')
        setError(err?.message || '下载失败')
      }
      setProgress(null)
    }
  }, [model, modelId])

  const handleCancel = useCallback(() => {
    modelManager.cancelDownload(modelId)
    setState('idle')
    setProgress(null)
  }, [modelId])

  const handleDelete = useCallback(async () => {
    await modelManager.deleteModel(modelId)
    setState('idle')
    setProgress(null)
    const s = await modelManager.getTotalStorage()
    setStorage(s)
  }, [modelId])

  if (!model) return null

  const progressPercent = progress
    ? Math.min(Math.round(progress.percent), 100)
    : 0

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/80 backdrop-blur-sm border border-stone-200/60 rounded-xl shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center shadow-md shadow-violet-500/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-stone-800">{model.name}</h3>
              {state === 'done' && (
                <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200/40">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  已就绪
                </span>
              )}
              {state === 'error' && (
                <span className="flex items-center gap-0.5 text-[10px] text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-full border border-rose-200/40">
                  <AlertCircle className="w-2.5 h-2.5" />
                  错误
                </span>
              )}
            </div>
            <p className="text-[11px] text-stone-400 mt-0.5 leading-relaxed">{model.description}</p>
          </div>
        </div>

        {/* Meta Info */}
        <div className="flex flex-wrap gap-3 mt-3">
          <span className="flex items-center gap-1 text-[10px] text-stone-400 bg-stone-50 px-2 py-0.5 rounded-full border border-stone-200/30">
            <HardDrive className="w-2.5 h-2.5" />
            {model.size}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-stone-400 bg-stone-50 px-2 py-0.5 rounded-full border border-stone-200/30">
            <Cpu className="w-2.5 h-2.5" />
            WebGPU + {model.backend}
          </span>
          {state === 'done' && storage !== '0MB' && (
            <span className="flex items-center gap-1 text-[10px] text-stone-400 bg-stone-50 px-2 py-0.5 rounded-full border border-stone-200/30">
              <HardDrive className="w-2.5 h-2.5" />
              占用 {storage}
            </span>
          )}
        </div>

        {/* Progress Bar */}
        {state === 'downloading' && progress && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-stone-500 truncate max-w-[60%]">{progress.filename}</span>
              <span className="text-stone-400 font-mono">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden border border-stone-200/30">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-violet-400 to-purple-500 rounded-full"
              />
            </div>
          </div>
        )}

        {/* Error */}
        {state === 'error' && error && (
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-rose-600 bg-rose-50 px-2.5 py-1.5 rounded-lg border border-rose-200/30">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 bg-stone-50/50 border-t border-stone-200/30">
        {state === 'idle' && (
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
              bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.97] transition-all
              shadow-sm shadow-violet-500/20"
          >
            <Download className="w-3 h-3" />
            下载模型
          </button>
        )}

        {state === 'downloading' && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
              bg-stone-200 text-stone-600 hover:bg-stone-300 active:scale-[0.97] transition-all"
          >
            <X className="w-3 h-3" />
            取消下载
          </button>
        )}

        {state === 'done' && (
          <>
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 mr-2">
              <CheckCircle2 className="w-3 h-3" />
              模型已准备就绪
            </span>
            <div className="flex-1" />
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium
                text-rose-500 hover:text-rose-700 hover:bg-rose-50 active:scale-[0.97] transition-all"
            >
              <Trash2 className="w-3 h-3" />
              删除
            </button>
          </>
        )}

        {state === 'error' && (
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
              bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.97] transition-all
              shadow-sm shadow-violet-500/20"
          >
            <Loader2 className="w-3 h-3" />
            重试
          </button>
        )}
      </div>
    </motion.div>
  )
}

export default function ModelDownloader() {
  const models = modelManager.getAvailableModels()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-stone-800">端侧模型管理</h3>
          <p className="text-[11px] text-stone-400 mt-0.5">
            下载和管理本地推理模型，用于普通模式和图片识别
          </p>
        </div>
      </div>

      {models.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-stone-400">
          <Zap className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-xs">暂无可用模型</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {models.map(m => (
            <ModelItem key={m.id} modelId={m.id} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-stone-400 bg-stone-50/50 px-3 py-2 rounded-lg border border-stone-200/30">
        <ExternalLink className="w-3 h-3 flex-shrink-0" />
        <span>GGUF 模型来自 ModelScope 开放社区，下载后可在端侧离线使用</span>
      </div>
    </div>
  )
}
