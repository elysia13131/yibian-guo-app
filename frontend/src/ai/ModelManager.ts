export interface ModelInfo {
  id: string
  name: string
  description: string
  files: ModelFile[]
  size: string
  backend: 'transformers.js' | 'mock' | 'wllama'
  pipeline: 'image-to-text' | 'zero-shot-image-classification'
}

export interface ModelFile {
  filename: string
  url: string
  mirrorUrls?: string[]
  sizeBytes: number
}

export interface DownloadProgress {
  filename: string
  loaded: number
  total: number
  percent: number
}

export type DownloadState = 'idle' | 'downloading' | 'done' | 'error'

const MODELSCOPE_BASE = 'https://www.modelscope.cn/models/OpenBMB/MiniCPM-V-4.6-gguf/resolve/master'

const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: 'MiniCPM-V-4.6',
    name: 'MiniCPM-V 4.6 (GGUF)',
    description: '面壁智能端侧多模态模型，1.3B 参数，GGUF Q4_K_M 量化，支持图片理解与描述',
    files: [
      {
        filename: 'model.gguf',
        url: `${MODELSCOPE_BASE}/MiniCPM-V-4_6-Q4_K_M.gguf`,
        mirrorUrls: [],
        sizeBytes: 529 * 1024 * 1024,
      },
      {
        filename: 'mmproj.gguf',
        url: `${MODELSCOPE_BASE}/mmproj-model-f16.gguf`,
        mirrorUrls: [],
        sizeBytes: 1110 * 1024 * 1024,
      },
    ],
    size: '~1.6GB',
    backend: 'wllama',
    pipeline: 'image-to-text',
  },
]

const DB_NAME = 'minicpm-models'
const DB_VERSION = 1
const STORE_NAME = 'files'
const MARKER_STORE = 'markers'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(MARKER_STORE)) {
        db.createObjectStore(MARKER_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(storeName: string, key: string, value: Blob | string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function idbGet(storeName: string, key: string): Promise<Blob | string | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(key)
    req.onsuccess = () => { db.close(); resolve(req.result) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function idbClearStore(storeName: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).clear()
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function idbGetAllKeys(storeName: string): Promise<string[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAllKeys()
    req.onsuccess = () => { db.close(); resolve(req.result as string[]) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}


async function isCapacitorAvailable(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}


async function getCapacitorDir(): Promise<string> {
  const { Directory } = await import('@capacitor/filesystem')
  return Directory.Documents as unknown as string
}

const MODELS_DIR = 'minicpm-models'


export class ModelManager {
  private downloadedModelsCache = new Map<string, boolean>()
  private downloadAbort = new Map<string, AbortController>()
  private currentProgress = new Map<string, DownloadProgress>()

  getAvailableModels(): ModelInfo[] {
    return MODEL_REGISTRY
  }

  isDownloading(modelId: string): boolean {
    return this.downloadAbort.has(modelId)
  }

  getCurrentProgress(modelId: string): DownloadProgress | null {
    return this.currentProgress.get(modelId) || null
  }

  async isDownloaded(modelId: string): Promise<boolean> {
    if (this.downloadedModelsCache.has(modelId)) {
      return this.downloadedModelsCache.get(modelId)!
    }
    try {
      if (await isCapacitorAvailable()) {
        const { Filesystem } = await import('@capacitor/filesystem')
        const dir = MODELS_DIR
        await Filesystem.stat({ path: `${dir}/${modelId}/.downloaded`, directory: await getCapacitorDir() as any })
        this.downloadedModelsCache.set(modelId, true)
        return true
      }
    } catch {}
    try {
      const marker = await idbGet(MARKER_STORE, modelId)
      const exists = marker === 'done'
      this.downloadedModelsCache.set(modelId, exists)
      return exists
    } catch {
      this.downloadedModelsCache.set(modelId, false)
      return false
    }
  }

  async downloadModel(modelId: string, onProgress?: (p: DownloadProgress) => void): Promise<void> {
    const model = MODEL_REGISTRY.find(m => m.id === modelId)
    if (!model) throw new Error(`未知模型: ${modelId}`)
    if (await this.isDownloaded(modelId)) return
    if (this.isDownloading(modelId)) {
      onProgress?.(this.getCurrentProgress(modelId)!)
      return
    }

    const abort = new AbortController()
    this.downloadAbort.set(modelId, abort)

    if (await isCapacitorAvailable()) {
      return this.downloadViaCapacitor(model, abort, onProgress)
    } else {
      return this.downloadViaIndexedDB(model, abort, onProgress)
    }
  }

  private async downloadViaCapacitor(
    model: ModelInfo, abort: AbortController,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<void> {
    const { Filesystem } = await import('@capacitor/filesystem')
    const dir = MODELS_DIR
    const modelDir = `${dir}/${model.id}`
    await Filesystem.mkdir({ path: modelDir, directory: await getCapacitorDir() as any, recursive: true })

    const fileProgressCb = (p: DownloadProgress) => {
        this.currentProgress.set(model.id, p)
        onProgress?.(p)
      }

      try {
        for (const file of model.files) {
          if (abort.signal.aborted) throw new Error('下载已取消')
          fileProgressCb({ filename: file.filename, loaded: 0, total: file.sizeBytes || 1, percent: 0 })

        const urlsToTry = [file.url]
        let response: Response | null = null
        let lastError: unknown = null
        for (const url of urlsToTry) {
          if (abort.signal.aborted) throw new Error('下载已取消')
          try {
            const timeoutCtrl = new AbortController()
            const timeoutId = setTimeout(() => timeoutCtrl.abort(), 60000)
            const onAbort = () => { timeoutCtrl.abort(); clearTimeout(timeoutId) }
            abort.signal.addEventListener('abort', onAbort, { once: true })
            const res = await fetch(url, { signal: timeoutCtrl.signal })
            clearTimeout(timeoutId)
            abort.signal.removeEventListener('abort', onAbort)
            if (res.ok) { response = res; break }
            lastError = new Error(`HTTP ${res.status}`)
          } catch (err) {
            lastError = err
            console.warn(`下载失败 ${url}:`, err)
          }
        }
        if (!response) throw new Error(`下载 ${file.filename} 失败: ${lastError}`)

        const reader = response.body!.getReader()
        const chunks: Uint8Array[] = []
        let loaded = 0
        const total = Number(response.headers.get('content-length') || file.sizeBytes || 0)

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            loaded += value.length
            fileProgressCb({ filename: file.filename, loaded, total: total || loaded, percent: total ? Math.round((loaded / total) * 100) : 0 })
          }
        }

        const blob = new Blob(chunks as BlobPart[])
        const base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onloadend = () => resolve((r.result as string).split(',')[1])
          r.onerror = reject
          r.readAsDataURL(blob)
        })

        await Filesystem.writeFile({ path: `${modelDir}/${file.filename}`, data: base64, directory: await getCapacitorDir() as any })
      }

      await Filesystem.writeFile({
        path: `${modelDir}/.downloaded`,
        data: btoa(JSON.stringify({ modelId: model.id, downloadedAt: new Date().toISOString() })),
        directory: await getCapacitorDir() as any,
      })
      this.downloadedModelsCache.set(model.id, true)
    } catch (err) {
      this.downloadedModelsCache.set(model.id, false)
      throw err
    } finally {
      this.downloadAbort.delete(model.id)
      this.currentProgress.delete(model.id)
    }
  }

  private async downloadViaIndexedDB(
    model: ModelInfo, abort: AbortController,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<void> {
    const fileProgressCb = (p: DownloadProgress) => {
      this.currentProgress.set(model.id, p)
      onProgress?.(p)
    }

    try {
      await idbDelete(MARKER_STORE, model.id)

      for (const file of model.files) {
        if (abort.signal.aborted) throw new Error('下载已取消')
        fileProgressCb({ filename: file.filename, loaded: 0, total: file.sizeBytes || 1, percent: 0 })

        const urlsToTry = [file.url]
        let response: Response | null = null
        let lastError: unknown = null
        for (const url of urlsToTry) {
          if (abort.signal.aborted) throw new Error('下载已取消')
          try {
            const timeoutCtrl = new AbortController()
            const timeoutId = setTimeout(() => timeoutCtrl.abort(), 60000)
            const onAbort = () => { timeoutCtrl.abort(); clearTimeout(timeoutId) }
            abort.signal.addEventListener('abort', onAbort, { once: true })
            const res = await fetch(url, { signal: timeoutCtrl.signal })
            clearTimeout(timeoutId)
            abort.signal.removeEventListener('abort', onAbort)
            if (res.ok) { response = res; break }
            lastError = new Error(`HTTP ${res.status}`)
          } catch (err) {
            lastError = err
            console.warn(`下载失败 ${url}:`, err)
          }
        }
        if (!response) throw new Error(`下载 ${file.filename} 失败: ${lastError}`)

        const reader = response.body!.getReader()
        const chunks: Uint8Array[] = []
        let loaded = 0
        const total = Number(response.headers.get('content-length') || file.sizeBytes || 0)

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            loaded += value.length
            fileProgressCb({ filename: file.filename, loaded, total: total || loaded, percent: total ? Math.round((loaded / total) * 100) : 0 })
          }
        }

        const blob = new Blob(chunks as BlobPart[])
        const key = `${model.id}/${file.filename}`
        await idbPut(STORE_NAME, key, blob)
        fileProgressCb({ filename: file.filename, loaded, total: total || loaded, percent: 100 })
      }

      await idbPut(MARKER_STORE, model.id, 'done')
      this.downloadedModelsCache.set(model.id, true)
    } catch (err) {
      this.downloadedModelsCache.set(model.id, false)
      throw err
    } finally {
      this.downloadAbort.delete(model.id)
      this.currentProgress.delete(model.id)
    }
  }

  async getModelBlob(modelId: string, filename: string): Promise<Blob | undefined> {
    const key = `${modelId}/${filename}`
    const blob = await idbGet(STORE_NAME, key)
    return blob instanceof Blob ? blob : undefined
  }

  async getModelBlobs(modelId: string): Promise<Blob[]> {
    const model = MODEL_REGISTRY.find(m => m.id === modelId)
    if (!model) return []
    const blobs: Blob[] = []
    for (const file of model.files) {
      const blob = await this.getModelBlob(modelId, file.filename)
      if (blob) blobs.push(blob)
    }
    return blobs
  }

  cancelDownload(modelId: string): void {
    this.downloadAbort.get(modelId)?.abort()
    this.downloadAbort.delete(modelId)
  }

  async deleteModel(modelId: string): Promise<void> {
    try {
      if (await isCapacitorAvailable()) {
        const { Filesystem } = await import('@capacitor/filesystem')
        const dir = MODELS_DIR
        await Filesystem.rmdir({ path: `${dir}/${modelId}`, directory: await getCapacitorDir() as any, recursive: true })
      }
    } catch {}
    try {
      const keys = await idbGetAllKeys(STORE_NAME)
      for (const key of keys) {
        if (key.startsWith(`${modelId}/`)) {
          await idbDelete(STORE_NAME, key)
        }
      }
      await idbDelete(MARKER_STORE, modelId)
    } catch {}
    this.downloadedModelsCache.set(modelId, false)
  }

  async getModelDir(): Promise<string> {
    return MODELS_DIR
  }

  async getTotalStorage(): Promise<string> {
    try {
      if (await isCapacitorAvailable()) {
        const { Filesystem } = await import('@capacitor/filesystem')
        const dir = MODELS_DIR
        const result = await Filesystem.stat({ path: dir, directory: await getCapacitorDir() as any })
        return `${(result.size / 1024 / 1024).toFixed(1)}MB`
      }
    } catch {}
    try {
      let totalBytes = 0
      const keys = await idbGetAllKeys(STORE_NAME)
      for (const key of keys) {
        if (key.includes('/')) {
          const blob = await idbGet(STORE_NAME, key)
          if (blob instanceof Blob) totalBytes += blob.size
        }
      }
      return `${(totalBytes / 1024 / 1024).toFixed(1)}MB`
    } catch {
      return '0MB'
    }
  }
}

export const modelManager = new ModelManager()
