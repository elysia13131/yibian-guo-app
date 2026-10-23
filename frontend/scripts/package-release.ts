import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'
import JSZip from 'jszip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, '..', 'dist')
const OUTPUT = join(__dirname, '..', 'www.zip')

function addDirToZip(zip: JSZip, dir: string, baseDir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, baseDir)
    } else if (entry.isFile()) {
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/')
      const content = readFileSync(fullPath)
      zip.file(relPath, content)
    }
  }
}

const zip = new JSZip()
addDirToZip(zip, DIST_DIR, DIST_DIR)

zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then((buffer) => {
  writeFileSync(OUTPUT, buffer)
  const sizeKb = (buffer.length / 1024).toFixed(1)
  const fileCount = Object.keys(zip.files).filter(f => !zip.files[f].dir).length
  console.log(`Release package created: ${OUTPUT}`)
  console.log(`Files: ${fileCount}, Size: ${sizeKb} KB`)
})
