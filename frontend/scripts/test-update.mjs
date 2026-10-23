import { createHash } from 'crypto'
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, '..', 'dist')
const LOCAL_MANIFEST_PATH = join(DIST_DIR, 'manifest.json')

function walkDirFlat(dir, baseDir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkDirFlat(fullPath, baseDir))
    } else if (entry.isFile()) {
      files.push(join(baseDir, entry.name).replace(/\\/g, '/'))
    }
  }
  return files
}

const GITHUB_OWNER = 'elysia13131'
const GITHUB_REPO = 'yibian-guo-frontend'

async function main() {
  console.log('=== 增量更新检测测试 ===\n')

  // 1. 获取 GitHub latest release
  console.log('1. 获取 GitHub latest release...')
  const releaseResp = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    { headers: { Accept: 'application/vnd.github.v3+json' } }
  )
  if (!releaseResp.ok) {
    console.error(`   ❌ GitHub API 失败: ${releaseResp.status} ${releaseResp.statusText}`)
    process.exit(1)
  }
  const release = await releaseResp.json()
  const latestVersion = release.tag_name.replace(/^v/, '')
  console.log(`   ✅ 最新 release: ${release.tag_name} (version: ${latestVersion})`)

  // 2. 检查 release assets
  console.log('\n2. 检查 release assets...')
  const manifestAsset = release.assets.find(a => a.name === 'manifest.json')
  const zipAsset = release.assets.find(a => a.name === 'www.zip')
  if (!manifestAsset) { console.error('   ❌ 未找到 manifest.json'); process.exit(1) }
  if (!zipAsset) { console.error('   ❌ 未找到 www.zip'); process.exit(1) }
  console.log(`   ✅ manifest.json: ${manifestAsset.browser_download_url}`)
  console.log(`   ✅ www.zip: ${zipAsset.browser_download_url}`)

  // 3. 下载远程 manifest.json
  console.log('\n3. 下载远程 manifest.json...')
  const remoteManifestResp = await fetch(manifestAsset.browser_download_url)
  const remoteManifest = await remoteManifestResp.json()
  console.log(`   ✅ 远程 version: ${remoteManifest.version} (code: ${remoteManifest.versionCode})`)
  console.log(`   ✅ 远程文件数: ${Object.keys(remoteManifest.files).length}`)

  // 4. 读取本地 manifest.json
  console.log('\n4. 读取本地 manifest.json...')
  if (!existsSync(LOCAL_MANIFEST_PATH)) {
    console.error(`   ❌ 本地 manifest 不存在: ${LOCAL_MANIFEST_PATH}`)
    console.error('   请先运行 npm run build:manifest')
    process.exit(1)
  }
  const localManifestStr = readFileSync(LOCAL_MANIFEST_PATH, 'utf-8')
  const localManifest = JSON.parse(localManifestStr)
  console.log(`   ✅ 本地 version: ${localManifest.version} (code: ${localManifest.versionCode})`)
  console.log(`   ✅ 本地文件数: ${Object.keys(localManifest.files).length}`)

  // 5. 模拟 Native getFileHash: 对 dist/ 中的文件计算 SHA256
  console.log('\n5. 模拟文件 hash 对比...')

  // 先列出远程 manifest 文件的目录结构
  const remoteDirs = new Set()
  for (const filePath of Object.keys(remoteManifest.files)) {
    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '/'
    remoteDirs.add(dir)
  }
  console.log(`   远程 manifest 文件所在目录: ${[...remoteDirs].sort().join(', ')}`)

  // 列出本地 dist/ 实际文件目录结构
  const localFiles = walkDirFlat(DIST_DIR, DIST_DIR)
  const localDirs = new Set()
  for (const filePath of localFiles) {
    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '/'
    localDirs.add(dir)
  }
  console.log(`   本地 dist/ 文件所在目录: ${[...localDirs].sort().join(', ')}`)

  let changedFiles = 0
  let totalSize = 0
  let matchedFiles = 0
  let missingFiles = 0
  const diffFiles = []

  for (const [filePath, fileInfo] of Object.entries(remoteManifest.files)) {
    const localPath = join(DIST_DIR, filePath)
    if (existsSync(localPath)) {
      const content = readFileSync(localPath)
      const sha256 = createHash('sha256').update(content).digest('hex')
      if (sha256 !== fileInfo.sha256) {
        changedFiles++
        totalSize += fileInfo.size
        diffFiles.push({ file: filePath, remoteHash: fileInfo.sha256, localHash: sha256, size: fileInfo.size })
      } else {
        matchedFiles++
      }
    } else {
      missingFiles++
      changedFiles++
      totalSize += fileInfo.size
      diffFiles.push({ file: filePath, remoteHash: fileInfo.sha256, localHash: '(missing)', size: fileInfo.size })
    }
  }

  console.log(`   ✅ 文件 hash 一致: ${matchedFiles}`)
  if (missingFiles > 0) console.log(`   ⚠️  本地缺失: ${missingFiles}`)
  if (changedFiles > 0) {
    console.log(`   🔄 文件有变化: ${changedFiles} (总大小: ${(totalSize / 1024 / 1024).toFixed(1)} MB)`)
    console.log('\n   变更文件列表:')
    for (const d of diffFiles.slice(0, 10)) {
      console.log(`      ${d.file} (${d.localHash === '(missing)' ? '缺失' : `本地:${d.localHash.slice(0, 8)} ≠ 远程:${d.remoteHash.slice(0, 8)}`})`)
    }
    if (diffFiles.length > 10) console.log(`      ... 还有 ${diffFiles.length - 10} 个文件`)
  } else {
    console.log(`   ✅ 所有文件 hash 一致，无更新`)
  }

  // 6. 版本对比
  console.log('\n6. 版本对比:')
  const localVersion = localManifest.version
  const remoteVersion = remoteManifest.version
  console.log(`   本地版本: ${localVersion}`)
  console.log(`   远程版本: ${remoteVersion}`)

  // 7. 判断逻辑（当前代码逻辑）
  console.log('\n7. 更新判断结果:')
  const hasUpdateByVersion = remoteVersion !== localVersion
  const hasUpdateByFiles = changedFiles > 0
  const hasUpdate = hasUpdateByFiles
  console.log(`   按文件变化判断: ${hasUpdateByFiles ? '✅ 有更新' : '❌ 无更新'}`)
  console.log(`   按版本号判断: ${hasUpdateByVersion ? '✅ 有更新' : '❌ 无更新'}`)
  console.log(`   当前代码逻辑 (changedFiles > 0): ${hasUpdate ? '✅ 检测到更新' : '❌ 未检测到更新'}`)

  // 8. 模拟旧逻辑
  const oldLogic = changedFiles > 0 && remoteVersion !== localVersion
  console.log(`   旧逻辑 (changedFiles > 0 && version不同): ${oldLogic ? '✅ 检测到更新' : '❌ 未检测到更新'}`)

  // 9. 测试 initAssets 后的情况（模拟手机首次安装）
  console.log('\n8. 模拟首次安装场景（本地版本 = remote版本）:')
  const simulatedLocalVersion = remoteVersion  // 假设 init() 从内置 manifest 读到了版本
  const hasUpdateAfterInit = changedFiles > 0
  console.log(`   假设 currentVersion = "${simulatedLocalVersion}"`)
  console.log(`   changedFiles > 0 → ${hasUpdateAfterInit ? '✅ 检测到更新' : '❌ 未检测到更新'}`)
  if (changedFiles === 0) {
    console.log('\n   📌 结论：首次安装时所有文件 hash 一致，不会有更新提示。这是正确的行为。')
    console.log('   下次修改代码后重新构建上传 www.zip，hash 就会变化，届时会检测到更新。')
  } else {
    console.log('\n   📌 结论：远程文件有变化，应该能检测到更新。')
  }

  console.log('\n=== 测试完成 ===')
}

main().catch(err => {
  console.error('测试出错:', err)
  process.exit(1)
})
