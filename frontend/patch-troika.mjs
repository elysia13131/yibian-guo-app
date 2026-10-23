import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function patchFile(p) {
  const fp = join(__dirname, p)
  if (!existsSync(fp)) { console.log(`SKIP: ${p}`); return }
  let c = readFileSync(fp, 'utf-8')
  const before = c
  c = c.replace(/PlaneBufferGeometry/g, 'PlaneGeometry')
  c = c.replace(/CylinderBufferGeometry/g, 'CylinderGeometry')
  c = c.replace(/SphereBufferGeometry/g, 'SphereGeometry')
  c = c.replace(/BoxBufferGeometry/g, 'BoxGeometry')
  c = c.replace(/RingBufferGeometry/g, 'RingGeometry')
  if (c !== before) { writeFileSync(fp, c); console.log(`PATCHED: ${p}`) }
  else { console.log(`OK: ${p}`) }
}

// Patch troika files in both locations
const files = [
  'node_modules/troika-three-text/dist/troika-three-text.esm.js',
  'node_modules/troika-three-utils/dist/troika-three-utils.esm.js',
  'node_modules/@react-three/drei/node_modules/troika-three-text/dist/troika-three-text.esm.js',
  'node_modules/@react-three/drei/node_modules/troika-three-utils/dist/troika-three-utils.esm.js',
]
files.forEach(patchFile)
console.log('DONE')
