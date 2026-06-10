/**
 * Generate Aura's app identity from src/assets/aura-logo.png.
 *
 * The source artwork is a glowing blue wave on an opaque gray gradient.
 * Step 1 keys out the background per-pixel: alpha is driven by how blue a
 * pixel is (b above the r/g average) or how much brighter it is than the
 * background plateau — keeping both the saturated glow and the white-hot
 * core. Step 2 composites the keyed mark onto the deep navy-indigo aurora
 * backdrop and emits build/icon.png, icon.ico, icon.icns.
 *
 * One-off tool: requires `npm i --no-save sharp png2icons` to run.
 */
import sharp from 'sharp'
import png2icons from 'png2icons'
import { writeFileSync } from 'fs'

const SRC = 'src/assets/aura-logo.png'
const TRANSPARENT_OUT = 'src/assets/aura-logo-transparent.png'

// ── Step 1: key out the gray background ────────────────────────────────────
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height } = info

for (let i = 0; i < data.length; i += 4) {
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // How much the pixel leans blue vs the gray background (r≈g≈b there).
  const blueness = b - (r + g) / 2
  // Background luminance tops out ~170; the wave core runs 200+.
  const aBlue = (blueness - 10) * 3.2
  const aCore = (lum - 185) * 4
  const alpha = Math.max(0, Math.min(255, Math.max(aBlue, aCore)))
  data[i + 3] = alpha
}

const keyed = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
writeFileSync(TRANSPARENT_OUT, keyed)
console.log('wrote', TRANSPARENT_OUT)

// ── Step 2: icon backdrop + composite ──────────────────────────────────────
const SIZE = 1024
const backdrop = Buffer.from(`
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="base" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="#141833"/>
      <stop offset="55%" stop-color="#0b0d1a"/>
      <stop offset="100%" stop-color="#060710"/>
    </radialGradient>
    <radialGradient id="aura1" cx="30%" cy="25%" r="45%">
      <stop offset="0%" stop-color="#4d7cfe" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#4d7cfe" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="aura2" cx="75%" cy="75%" r="50%">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="round"><rect width="${SIZE}" height="${SIZE}" rx="200" ry="200"/></clipPath>
  </defs>
  <g clip-path="url(#round)">
    <rect width="${SIZE}" height="${SIZE}" fill="url(#base)"/>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#aura1)"/>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#aura2)"/>
  </g>
</svg>`)

const mark = await sharp(keyed).resize(Math.round(SIZE * 0.92), Math.round(SIZE * 0.92)).toBuffer()
const iconPng = await sharp(backdrop)
  .composite([{ input: mark, gravity: 'center' }])
  .png()
  .toBuffer()

writeFileSync('build/icon.png', iconPng)
console.log('wrote build/icon.png')

const ico = png2icons.createICO(iconPng, png2icons.BICUBIC, 0, true)
if (ico) { writeFileSync('build/icon.ico', ico); console.log('wrote build/icon.ico') }
const icns = png2icons.createICNS(iconPng, png2icons.BICUBIC, 0)
if (icns) { writeFileSync('build/icon.icns', icns); console.log('wrote build/icon.icns') }
