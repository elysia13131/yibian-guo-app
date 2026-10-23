/**
 * 构建前自动同步版本号：
 * - versionCode: +1（存储在 .versioncode）
 * - versionName: package.json 的 version patch +1（如 0.1.2 → 0.1.3）
 * - 同步到 android/app/build.gradle
 *
 * 用法: 
 *   npx tsx scripts/sync-version.ts              → 递增 + 更新 build.gradle
 *   npx tsx scripts/sync-version.ts --copy-manifest → 生成 dist/manifest.json (不递增)
 */
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const VERSION_CODE_FILE = path.join(ROOT, '.versioncode')
const MIN_VERSION_FILE = path.join(ROOT, '.minversioncode')
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle')
const PACKAGE_JSON = path.join(ROOT, 'package.json')
const DIST_DIR = path.join(ROOT, 'dist')

function readVersionCode(): number {
  if (fs.existsSync(VERSION_CODE_FILE)) {
    return parseInt(fs.readFileSync(VERSION_CODE_FILE, 'utf-8').trim(), 10) || 1
  }
  return 1
}

function readMinVersionCode(): number {
  // minVersionCode: 最低版本号，低于此值的客户端需下载 APK 而非热更新
  // 默认为当前 versionCode，原生代码变更时需手动更新
  if (fs.existsSync(MIN_VERSION_FILE)) {
    return parseInt(fs.readFileSync(MIN_VERSION_FILE, 'utf-8').trim(), 10) || 0
  }
  return readVersionCode()
}

function readVersionName(): string {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'))
  return pkg.version || '0.1.0'
}

function bumpAll(): { versionCode: number; versionName: string } {
  // versionCode +1
  const newCode = readVersionCode() + 1
  fs.writeFileSync(VERSION_CODE_FILE, String(newCode), 'utf-8')

  // package.json version patch +1
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'))
  const parts = (pkg.version || '0.1.0').split('.').map(Number)
  parts[2] = (parts[2] || 0) + 1
  const newVersion = parts.join('.')
  pkg.version = newVersion
  fs.writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')

  console.log(`[sync-version] package.json → ${newVersion}`)
  return { versionCode: newCode, versionName: newVersion }
}

function updateBuildGradle(versionCode: number, versionName: string) {
  let gradleContent = fs.readFileSync(BUILD_GRADLE, 'utf-8')
  gradleContent = gradleContent.replace(
    /versionCode\s+\d+/,
    `versionCode ${versionCode}`
  )
  gradleContent = gradleContent.replace(
    /versionName\s+"[^"]*"/,
    `versionName "${versionName}"`
  )
  fs.writeFileSync(BUILD_GRADLE, gradleContent, 'utf-8')
  console.log(`[sync-version] build.gradle → versionCode=${versionCode}, versionName=${versionName}`)
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function generateManifest(versionCode: number, versionName: string) {
  if (!fs.existsSync(DIST_DIR)) {
    console.log('[sync-version] dist/ directory not found, skipping manifest generation')
    return
  }

  const files: Record<string, { sha256: string; size: number }> = {}
  function walkDir(dir: string, base: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      const relPath = path.relative(base, fullPath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        walkDir(fullPath, base)
      } else {
        files[relPath] = {
          sha256: sha256File(fullPath),
          size: fs.statSync(fullPath).size,
        }
      }
    }
  }
  walkDir(DIST_DIR, DIST_DIR)

  const manifest = { version: versionName, versionCode, minVersionCode: readMinVersionCode(), files }
  const outPath = path.join(DIST_DIR, 'manifest.json')
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`[sync-version] manifest.json → ${Object.keys(files).length} files, version=${versionName}, versionCode=${versionCode}`)
}

function main() {
  const copyOnly = process.argv.includes('--copy-manifest')
  const setMinVersion = process.argv.includes('--set-min-version')

  if (setMinVersion) {
    const versionCode = readVersionCode()
    fs.writeFileSync(MIN_VERSION_FILE, String(versionCode), 'utf-8')
    console.log(`[sync-version] .minversioncode → ${versionCode} (set as min version for hot update)`)
    return
  }

  if (copyOnly) {
    const versionCode = readVersionCode()
    const versionName = readVersionName()
    generateManifest(versionCode, versionName)
    return
  }

  // Increment mode: bump versionCode + package.json version + update build.gradle
  const { versionCode, versionName } = bumpAll()
  updateBuildGradle(versionCode, versionName)
}

export default main

// direct execution
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectRun) {
  main()
}
