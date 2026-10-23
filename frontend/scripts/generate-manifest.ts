import { createHash } from 'crypto'
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, '..', 'dist')
const PKG_DIR = join(__dirname, '..')
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

const packageJson = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf-8'))
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
