#!/usr/bin/env node
/**
 * Pipeline reproduzível do ícone: build/icon-src/icon.svg ->
 *   build/icon.png (1024, alpha real) + resources/icon.png (512) + build/icon.icns
 *
 * IMPORTANTE: NÃO usar qlmanage para SVG->PNG — ele renderiza sobre fundo
 * branco (e o sips ainda reporta hasAlpha:yes, enganando a verificação).
 * sharp (libvips/librsvg) preserva a transparência. Sempre validar o pixel
 * do canto (alpha 0) antes de aceitar o resultado.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const SVG = 'build/icon-src/icon.svg'

async function assertTransparentCorner(pngPath) {
  const { data, info } = await sharp(pngPath).raw().toBuffer({ resolveWithObject: true })
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3]
  const corners = [
    alphaAt(2, 2),
    alphaAt(info.width - 3, 2),
    alphaAt(2, info.height - 3),
    alphaAt(info.width - 3, info.height - 3)
  ]
  if (info.channels < 4 || corners.some((a) => a !== 0)) {
    throw new Error(`${pngPath}: cantos NÃO são transparentes (alpha=${corners.join(',')})`)
  }
  console.log(`${pngPath}: cantos transparentes ok`)
}

await sharp(SVG, { density: 300 }).resize(1024, 1024).png().toFile('build/icon.png')
await assertTransparentCorner('build/icon.png')

await sharp(SVG, { density: 300 }).resize(512, 512).png().toFile('resources/icon.png')
await assertTransparentCorner('resources/icon.png')

const iconset = mkdtempSync(join(tmpdir(), 'jiraiya-iconset-')) + '.iconset'
execSync(`mkdir -p ${iconset}`)
for (const size of [16, 32, 128, 256, 512]) {
  await sharp(SVG, { density: 300 }).resize(size, size).png().toFile(`${iconset}/icon_${size}x${size}.png`)
  await sharp(SVG, { density: 300 })
    .resize(size * 2, size * 2)
    .png()
    .toFile(`${iconset}/icon_${size}x${size}@2x.png`)
}
execSync(`iconutil -c icns ${iconset} -o build/icon.icns`)
rmSync(iconset, { recursive: true, force: true })
console.log('build/icon.icns ok')
