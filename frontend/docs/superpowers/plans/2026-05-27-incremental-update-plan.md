# 增量更新系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**目标：** 实现基于 GitHub Releases 的 Web 资源增量更新系统，只下载哈希不同的文件

**架构：**
- 构建阶段：`generate-manifest.ts` 生成文件哈希清单
- 原生层：`AppUpdatePlugin.java` 管理文件存储、WebView 请求拦截
- 前端层：`UpdateManager.ts` 检测/对比/下载更新，`UpdatePrompt.tsx` UI 组件

**技术栈：** TypeScript, Vite, Capacitor v6, Android (Java), GitHub API, SHA-256

---

### Task 1: 构建脚本 — generate-manifest.ts

**文件：**
- Create: `scripts/generate-manifest.ts`

- [ ] **Step 1: 创建 generate-manifest.ts**

```typescript
import { createHash } from 'crypto'
import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const DIST_DIR = join(__dirname, '..', 'dist')
const OUTPUT = join(DIST_DIR, 'manifest.json')

interface ManifestFile {
  sha256: string
  size: number
}

interface Manifest {
  version: string
  versionCode: number
  files: Record<string, ManifestFile>
}

function walkDir(dir: string, baseDir: string): Record<string, ManifestFile> {
  const files: Record<string, ManifestFile> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      Object.assign(files, walkDir(fullPath, baseDir))
    } else if (entry.isFile()) {
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/')
      const content = readFileSync(fullPath)
      const sha256 = createHash('sha256').update(content).digest('hex')
      files[relPath] = { sha256, size: content.length }
    }
  }
  return files
}

const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
const version = packageJson.version || '0.1.0'
const versionCode = parseInt(version.replace(/\./g, '').padEnd(3, '0'), 10)

const manifest: Manifest = {
  version,
  versionCode,
  files: walkDir(DIST_DIR, DIST_DIR),
}

writeFileSync(OUTPUT, JSON.stringify(manifest, null, 2))
console.log(`Manifest generated: ${OUTPUT}`)
console.log(`Version: ${version} (code: ${versionCode})`)
console.log(`Files: ${Object.keys(manifest.files).length}`)
```

- [ ] **Step 2: 更新 package.json 的 build 脚本**

在 `package.json` 的 `scripts` 中添加：

```json
"build:manifest": "tsx scripts/generate-manifest.ts",
"build:full": "npm run build && npm run build:manifest"
```

> 注意：需要安装 `tsx` 作为 dev 依赖：`npm install -D tsx`

- [ ] **Step 3: 测试构建**

```bash
cd frontend
npm run build
npm run build:manifest
```

验证 `dist/manifest.json` 生成，内容包含所有文件的 sha256 和 size。

---

### Task 2: Android 原生插件 — AppUpdatePlugin.java

**文件：**
- Create: `android/app/src/main/java/com/learning/platform/AppUpdatePlugin.java`

- [ ] **Step 1: 创建 AppUpdatePlugin.java**

```java
package com.learning.platform;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String PREFS_NAME = "app_update_prefs";
    private static final String KEY_VERSION = "current_version";
    private static final String ASSET_PREFIX = "/assets/public/";
    private static final String PUBLIC_DIR = "public";

    @Override
    public void load() {
        super.load();
        initAssets();
        setupWebViewIntercept();
    }

    private void initAssets() {
        Context context = getContext();
        File publicDir = new File(context.getFilesDir(), PUBLIC_DIR);
        if (publicDir.exists() && publicDir.list().length > 0) {
            return;
        }

        try {
            copyAssets(context, "public", publicDir.getAbsolutePath());
        } catch (IOException e) {
            android.util.Log.e("AppUpdate", "Failed to copy assets", e);
        }
    }

    private void copyAssets(Context context, String assetPath, String outputDir) throws IOException {
        String[] list = context.getAssets().list(assetPath);
        if (list == null || list.length == 0) {
            return;
        }

        File outDir = new File(outputDir);
        if (!outDir.exists()) {
            outDir.mkdirs();
        }

        for (String name : list) {
            String fullAssetPath = assetPath + "/" + name;
            String fullOutputPath = outputDir + "/" + name;

            try {
                String[] subList = context.getAssets().list(fullAssetPath);
                if (subList != null && subList.length > 0) {
                    copyAssets(context, fullAssetPath, fullOutputPath);
                } else {
                    try (InputStream is = context.getAssets().open(fullAssetPath);
                         FileOutputStream os = new FileOutputStream(fullOutputPath)) {
                        byte[] buf = new byte[8192];
                        int len;
                        while ((len = is.read(buf)) != -1) {
                            os.write(buf, 0, len);
                        }
                    }
                }
            } catch (IOException e) {
                android.util.Log.w("AppUpdate", "Failed to copy: " + fullAssetPath, e);
            }
        }
    }

    private void setupWebViewIntercept() {
        Bridge bridge = getBridge();
        if (bridge == null) return;

        WebView webView = bridge.getWebView();
        if (webView == null) return;

        final WebViewClient originalClient = webView.getWebViewClient();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.contains(ASSET_PREFIX)) {
                    String relativePath = url.substring(url.indexOf(ASSET_PREFIX) + ASSET_PREFIX.length());
                    File updatedFile = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + relativePath);
                    if (updatedFile.exists() && updatedFile.isFile()) {
                        try {
                            String mimeType = getMimeType(relativePath);
                            return new WebResourceResponse(mimeType, null, new FileInputStream(updatedFile));
                        } catch (IOException e) {
                            android.util.Log.w("AppUpdate", "Failed to read: " + updatedFile, e);
                        }
                    }
                }
                if (originalClient != null) {
                    return originalClient.shouldInterceptRequest(view, request);
                }
                return null;
            }
        });
    }

    private String getMimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    @PluginMethod
    public void getCurrentVersion(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String version = prefs.getString(KEY_VERSION, "0.0.0");
        JSObject ret = new JSObject();
        ret.put("version", version);
        call.resolve(ret);
    }

    @PluginMethod
    public void setCurrentVersion(PluginCall call) {
        String version = call.getString("version");
        if (version == null) {
            call.reject("version is required");
            return;
        }
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_VERSION, version).apply();
        call.resolve();
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String path = call.getString("path");
        String base64Content = call.getString("content");

        if (path == null || base64Content == null) {
            call.reject("path and content are required");
            return;
        }

        try {
            File file = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + path);
            file.getParentFile().mkdirs();

            byte[] data = android.util.Base64.decode(base64Content, android.util.Base64.DEFAULT);
            try (FileOutputStream os = new FileOutputStream(file)) {
                os.write(data);
            }

            call.resolve();
        } catch (IOException e) {
            call.reject("Failed to write file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path is required");
            return;
        }

        File file = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + path);
        if (file.exists() && file.delete()) {
            call.resolve();
        } else {
            call.reject("Failed to delete file");
        }
    }

    @PluginMethod
    public void getFileHash(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path is required");
            return;
        }

        File file = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + path);
        if (!file.exists()) {
            JSObject ret = new JSObject();
            ret.put("exists", false);
            call.resolve(ret);
            return;
        }

        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
            try (FileInputStream fis = new FileInputStream(file)) {
                byte[] buf = new byte[8192];
                int len;
                while ((len = fis.read(buf)) != -1) {
                    digest.update(buf, 0, len);
                }
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest()) {
                hex.append(String.format("%02x", b));
            }
            JSObject ret = new JSObject();
            ret.put("exists", true);
            ret.put("sha256", hex.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to compute hash: " + e.getMessage());
        }
    }
}
```

- [ ] **Step 2: 注册插件到 MainActivity.java**

修改 `MainActivity.java` 添加 `registerPlugin(AppUpdatePlugin.class);`

```java
package com.learning.platform;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(LlamaPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
    }
}
```

- [ ] **Step 3: 验证 Java 编译**

```bash
cd frontend/android
./gradlew.bat compileDebugJavaWithJavac
```

---

### Task 3: 前端更新管理器 — UpdateManager.ts

**文件：**
- Create: `src/services/UpdateManager.ts`

- [ ] **Step 1: 创建 UpdateManager.ts**

```typescript
import { Capacitor } from '@capacitor/core'

const GITHUB_OWNER = 'your-org'
const GITHUB_REPO = 'your-repo'

export interface ManifestFile {
  sha256: string
  size: number
}

export interface UpdateManifest {
  version: string
  versionCode: number
  files: Record<string, ManifestFile>
}

export interface UpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  currentVersion: string
  changedFiles: number
  totalSize: number
  manifest: UpdateManifest | null
}

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'completed' | 'error'

export interface DownloadProgress {
  percent: number
  loadedBytes: number
  totalBytes: number
  currentFile: string
}

type ProgressCallback = (progress: DownloadProgress) => void
type StateCallback = (state: UpdateState) => void

class UpdateManager {
  private state: UpdateState = 'idle'
  private stateListeners: StateCallback[] = []
  private currentVersion = '0.0.0'
  private abortController: AbortController | null = null

  private get isNative(): boolean {
    try {
      return Capacitor.isNativePlatform()
    } catch {
      return false
    }
  }

  onStateChange(cb: StateCallback): () => void {
    this.stateListeners.push(cb)
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== cb)
    }
  }

  private setState(state: UpdateState): void {
    this.state = state
    this.stateListeners.forEach(l => l(state))
  }

  getState(): UpdateState {
    return this.state
  }

  async init(): Promise<void> {
    if (!this.isNative) return
    try {
      const { AppUpdate } = await import('../plugins/AppUpdate')
      const result = await AppUpdate.getCurrentVersion()
      this.currentVersion = result.version || '0.0.0'
    } catch {
      this.currentVersion = '0.0.0'
    }
  }

  async checkForUpdate(): Promise<UpdateInfo> {
    if (!this.isNative) {
      return { hasUpdate: false, latestVersion: '', currentVersion: this.currentVersion, changedFiles: 0, totalSize: 0, manifest: null }
    }

    this.setState('checking')

    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github.v3+json' } }
      )

      if (!response.ok) {
        this.setState('idle')
        return { hasUpdate: false, latestVersion: '', currentVersion: this.currentVersion, changedFiles: 0, totalSize: 0, manifest: null }
      }

      const release = await response.json()
      const latestVersion = release.tag_name.replace(/^v/, '')
      const manifestAsset = release.assets.find((a: any) => a.name === 'manifest.json')

      if (!manifestAsset) {
        this.setState('idle')
        return { hasUpdate: false, latestVersion, currentVersion: this.currentVersion, changedFiles: 0, totalSize: 0, manifest: null }
      }

      const manifestResp = await fetch(manifestAsset.browser_download_url)
      const remoteManifest: UpdateManifest = await manifestResp.json()

      const { AppUpdate } = await import('../plugins/AppUpdate')

      let changedFiles = 0
      let totalSize = 0

      for (const [filePath, fileInfo] of Object.entries(remoteManifest.files)) {
        try {
          const result = await AppUpdate.getFileHash({ path: filePath })
          if (!result.exists || result.sha256 !== fileInfo.sha256) {
            changedFiles++
            totalSize += fileInfo.size
          }
        } catch {
          changedFiles++
          totalSize += fileInfo.size
        }
      }

      const hasUpdate = changedFiles > 0 && latestVersion !== this.currentVersion

      if (hasUpdate) {
        this.setState('available')
      } else {
        this.setState('idle')
      }

      return {
        hasUpdate,
        latestVersion,
        currentVersion: this.currentVersion,
        changedFiles,
        totalSize,
        manifest: remoteManifest,
      }
    } catch (err) {
      this.setState('idle')
      return { hasUpdate: false, latestVersion: '', currentVersion: this.currentVersion, changedFiles: 0, totalSize: 0, manifest: null }
    }
  }

  async downloadUpdate(
    manifest: UpdateManifest,
    onProgress: ProgressCallback,
  ): Promise<void> {
    if (!this.isNative) return

    this.setState('downloading')
    this.abortController = new AbortController()

    const { AppUpdate } = await import('../plugins/AppUpdate')
    const GITHUB_RAW = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/v${manifest.version}/dist`

    let loadedBytes = 0
    const totalBytes = Object.values(manifest.files).reduce((s, f) => s + f.size, 0)

    try {
      for (const [filePath, fileInfo] of Object.entries(manifest.files)) {
        if (this.abortController.signal.aborted) {
          throw new Error('更新已取消')
        }

        const result = await AppUpdate.getFileHash({ path: filePath })
        if (result.exists && result.sha256 === fileInfo.sha256) {
          loadedBytes += fileInfo.size
          continue
        }

        onProgress({
          percent: totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0,
          loadedBytes,
          totalBytes,
          currentFile: filePath,
        })

        const response = await fetch(`${GITHUB_RAW}/${filePath}`, {
          signal: this.abortController.signal,
        })

        if (!response.ok) {
          throw new Error(`下载失败: ${filePath} (HTTP ${response.status})`)
        }

        const blob = await response.blob()
        const base64 = await blobToBase64(blob)

        await AppUpdate.writeFile({ path: filePath, content: base64 })

        loadedBytes += fileInfo.size

        onProgress({
          percent: Math.round((loadedBytes / totalBytes) * 100),
          loadedBytes,
          totalBytes,
          currentFile: filePath,
        })
      }

      await AppUpdate.setCurrentVersion({ version: manifest.version })
      this.currentVersion = manifest.version
      this.setState('completed')
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this.setState('idle')
      } else {
        this.setState('error')
      }
      throw err
    }
  }

  cancelDownload(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export const updateManager = new UpdateManager()
```

---

### Task 4: 前端 Capacitor 插件定义 — AppUpdate.ts

**文件：**
- Create: `src/plugins/AppUpdate.ts`

- [ ] **Step 1: 创建 AppUpdate.ts**

```typescript
import { registerPlugin } from '@capacitor/core'

export interface AppUpdatePluginDefinitions {
  getCurrentVersion(): Promise<{ version: string }>
  setCurrentVersion(options: { version: string }): Promise<void>
  writeFile(options: { path: string; content: string }): Promise<void>
  deleteFile(options: { path: string }): Promise<void>
  getFileHash(options: { path: string }): Promise<{ exists: boolean; sha256?: string }>
}

export const AppUpdate = registerPlugin<AppUpdatePluginDefinitions>('AppUpdate')
```

---

### Task 5: 前端 UI 组件 — UpdatePrompt.tsx

**文件：**
- Create: `src/components/UpdatePrompt.tsx`

- [ ] **Step 1: 创建 UpdatePrompt.tsx**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { updateManager, type UpdateInfo, type DownloadProgress, type UpdateState } from '../services/UpdateManager'

export default function UpdatePrompt() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [state, setState] = useState<UpdateState>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsub = updateManager.onStateChange(setState)
    updateManager.init().then(() => {
      updateManager.checkForUpdate().then(setUpdateInfo)
    })
    return unsub
  }, [])

  const handleUpdate = useCallback(async () => {
    if (!updateInfo?.manifest) return
    setError(null)
    try {
      await updateManager.downloadUpdate(updateInfo.manifest, setProgress)
    } catch (err: any) {
      setError(err.message || '更新失败')
    }
  }, [updateInfo])

  const handleCancel = useCallback(() => {
    updateManager.cancelDownload()
    setUpdateInfo(null)
  }, [])

  if (state === 'completed') {
    return (
      <div className="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg z-50">
        <p className="font-medium">更新完成</p>
        <p className="text-sm">请重启应用以生效</p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="fixed bottom-4 right-4 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg z-50">
        <p className="font-medium">更新失败</p>
        <p className="text-sm">{error || '请稍后重试'}</p>
        <button
          onClick={() => setUpdateInfo(null)}
          className="mt-2 text-sm underline"
        >
          关闭
        </button>
      </div>
    )
  }

  if (state === 'downloading' && progress) {
    return (
      <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 rounded-lg shadow-lg z-50 min-w-[300px]">
        <p className="font-medium text-gray-900 dark:text-white">正在下载更新...</p>
        <div className="mt-2 w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">{progress.percent}%</p>
        <p className="text-xs text-gray-400 mt-1 truncate">{progress.currentFile}</p>
        <button
          onClick={handleCancel}
          className="mt-2 text-xs text-red-500 underline"
        >
          取消
        </button>
      </div>
    )
  }

  if (updateInfo?.hasUpdate && state === 'available') {
    return (
      <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 rounded-lg shadow-lg z-50 min-w-[300px]">
        <p className="font-medium text-gray-900 dark:text-white">
          发现新版本 v{updateInfo.latestVersion}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          {updateInfo.changedFiles} 个文件更新（
          {(updateInfo.totalSize / 1024 / 1024).toFixed(1)} MB）
        </p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={handleUpdate}
            className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
          >
            立即更新
          </button>
          <button
            onClick={() => setUpdateInfo(null)}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-600 text-sm rounded hover:bg-gray-300"
          >
            稍后
          </button>
        </div>
      </div>
    )
  }

  return null
}
```

---

### Task 6: 注册到 App 入口

**文件：**
- Modify: `src/App.tsx` 或类似入口文件

- [ ] **Step 1: 在 App 入口添加 UpdatePrompt**

在 App 的根组件中添加 `<UpdatePrompt />`，通常放在布局的最外层。

---


