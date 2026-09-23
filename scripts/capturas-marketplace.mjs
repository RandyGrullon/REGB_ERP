#!/usr/bin/env node
/**
 * Capturas del marketplace — como se ve cada modulo DE VERDAD.
 *
 * ── Por que capturas y no solo mockups ────────────────────────────────
 *
 * La ficha del marketplace traia mockups en texto con una razon buena:
 * "una captura envejece con cada cambio y nadie la actualiza". Es cierto
 * si la captura se toma a mano. Pero un cliente que va a pagar quiere ver
 * la pantalla que va a usar, no un esquema en ASCII.
 *
 * La salida es que la captura NO se toma a mano: la saca este script de
 * la app corriendo, con los datos de la demo, en un solo comando. Si una
 * pantalla cambia, se vuelve a correr y ya.
 *
 * ── Que hace ──────────────────────────────────────────────────────────
 *
 * Lee el manifiesto de cada modulo, toma su primera ruta visible sin
 * parametros, la abre como Owner de `distribuidora-caribe` (tier mediano,
 * los 80 modulos encendidos y datos sembrados) y guarda dos fotos a
 * 1280x800, una por tema, porque el marketplace ensena la del tema en que
 * lo mira cada quien:
 *
 *   apps/web/public/marketplace/<id>.jpg        oscuro (el de por defecto)
 *   apps/web/public/marketplace/<id>-claro.jpg  claro
 *
 * Si la pantalla responde 4xx/5xx NO se guarda nada: el marketplace pinta
 * su placeholder en vez de ensenar una pagina de error como si fuera el
 * producto.
 *
 * Usa `playwright-core` con el Chrome o Edge ya instalado en la maquina:
 * no descarga navegadores.
 *
 *   pnpm --filter @regb/web dev           (en otra terminal)
 *   pnpm capturas:marketplace             (todos)
 *   pnpm capturas:marketplace pos ar      (solo esos)
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = join(ROOT, 'apps', 'web', 'public', 'marketplace')
const BASE = process.env.REGB_URL ?? 'http://localhost:3100'
const TENANT = process.env.REGB_TENANT ?? 'distribuidora-caribe'
const ROL = process.env.REGB_ROL ?? 'Owner'

/** El navegador instalado, en el orden en que suele estar. */
const NAVEGADORES = [
  process.env.REGB_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

/**
 * La pantalla que mejor vende el modulo, cuando no es la primera ruta.
 * Solo se anota la excepcion; el resto sale del manifiesto.
 */
const RUTA_PREFERIDA = {
  dashboard: '/',
  // Sin ruta propia en el menu: su cara visible es "Mi perfil" y Ctrl+K.
  auth: '/perfil',
  search: '/',
}

/** Lo que hay que hacer en la pantalla antes de la foto para que se vea el modulo. */
const ANTES_DE_LA_FOTO = {
  search: async (page) => {
    await page.keyboard.press('Control+K')
    await page.keyboard.type('cem', { delay: 40 })
    await page.waitForTimeout(500)
  },
}

const soloEstos = new Set(process.argv.slice(2))

const ejecutable = NAVEGADORES.find((p) => existsSync(p))
if (!ejecutable) {
  console.error('No encontre Chrome ni Edge. Indica uno con REGB_BROWSER=<ruta>.')
  process.exit(1)
}

async function manifiestos() {
  const dirs = await readdir(join(ROOT, 'modules'), { withFileTypes: true })
  const lista = []
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue
    const archivo = join(ROOT, 'modules', d.name, 'manifest.ts')
    if (!existsSync(archivo)) continue
    const m = (await import(pathToFileURL(archivo).href)).default
    if (m?.id) lista.push(m)
  }
  return lista
}

function rutaDe(m) {
  if (RUTA_PREFERIDA[m.id]) return RUTA_PREFERIDA[m.id]
  const r = (m.routes ?? []).find((x) => !x.hidden && !x.path.includes(':'))
  return r?.path ?? null
}

const conDemo = (ruta) =>
  `${BASE}${ruta}${ruta.includes('?') ? '&' : '?'}tenant=${TENANT}&rol=${encodeURIComponent(ROL)}`

await mkdir(SALIDA, { recursive: true })
const mods = (await manifiestos()).filter((m) => soloEstos.size === 0 || soloEstos.has(m.id))

// `--lang`: sin el, Chrome sin ventana pinta los campos de fecha en ingles
// (mm/dd/yyyy) aunque el contexto diga es-DO. Un cliente en RD ve dd/mm/aaaa.
const browser = await chromium.launch({
  executablePath: ejecutable,
  headless: true,
  args: ['--lang=es-DO'],
})

/**
 * Un contexto por tema. El tema lo decide la cookie `regb-tema` que lee el
 * layout (`apps/web/src/lib/tema.ts`); sin cookie sale el de por defecto.
 */
const TEMAS = [
  { tema: 'dark', sufijo: '' },
  { tema: 'light', sufijo: '-claro' },
]
const contextos = []
for (const t of TEMAS) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: t.tema,
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
  })
  await ctx.addCookies([{ name: 'regb-tema', value: t.tema, url: BASE }])
  contextos.push({ ...t, ctx })
}

const hechos = []
const saltados = []

for (const m of mods) {
  const ruta = rutaDe(m)
  if (!ruta) {
    saltados.push([m.id, 'sin ruta visible'])
    continue
  }
  let ok = true
  for (const { ctx, sufijo } of contextos) {
    if (!ok) break
    ok = await capturar(ctx, m, ruta, sufijo)
  }
  if (ok) {
    hechos.push([m.id, ruta])
    console.log(`  ✓ ${m.id.padEnd(18)} ${ruta}`)
  }
}

await browser.close()

console.log(`\n${hechos.length} modulo(s) con captura en apps/web/public/marketplace/`)
if (saltados.length > 0) {
  console.log(`${saltados.length} sin captura (el marketplace pinta su placeholder):`)
  for (const [id, por] of saltados) console.log(`  - ${id}: ${por}`)
}

/** Guarda una foto; `false` si la pantalla no sirve para ensenarla. */
async function capturar(ctx, m, ruta, sufijo) {
  const page = await ctx.newPage()
  try {
    // La primera visita compila la ruta en `next dev`: se le da tiempo.
    const res = await page.goto(conDemo(ruta), { waitUntil: 'networkidle', timeout: 180_000 })
    const status = res?.status() ?? 0
    if (status >= 400) {
      saltados.push([m.id, `HTTP ${status} en ${ruta}`])
      return false
    }
    // Lo que es de desarrollo no es del producto: el indicador de Next y
    // su overlay no salen en la foto. Y sin transiciones, para no
    // fotografiar un color a medio camino.
    await page.addStyleTag({
      content:
        'nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }' +
        '*, *::before, *::after { transition: none !important; animation: none !important; }',
    })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForTimeout(600)
    await ANTES_DE_LA_FOTO[m.id]?.(page)
    const errorVisible = await page
      .locator('text=/Unhandled Runtime Error|Build Error|Application error/i')
      .count()
    if (errorVisible > 0) {
      saltados.push([m.id, `pantalla con error en ${ruta}`])
      return false
    }
    // Solo el area de trabajo del modulo, sin menu ni cabecera: en la
    // miniatura de una tarjeta, la barra lateral se comia un quinto de la
    // foto y el modulo se veia diminuto. Se recorta a 16:10 desde arriba,
    // que es donde cada pantalla pone lo que la define.
    const main = await page.locator('main').first().boundingBox()
    const clip =
      main && main.width > 600
        ? {
            x: main.x,
            y: main.y,
            width: main.width,
            height: Math.min(main.height, Math.round(main.width / 1.6), 800 - main.y),
          }
        : undefined
    await page.screenshot({
      path: join(SALIDA, `${m.id}${sufijo}.jpg`),
      type: 'jpeg',
      quality: 76,
      ...(clip ? { clip } : {}),
    })
    return true
  } catch (e) {
    const por = String(e?.message ?? e).split(/\r?\n/)[0]
    saltados.push([m.id, por])
    console.log(`  ✗ ${m.id.padEnd(18)} ${ruta} — ${por}`)
    return false
  } finally {
    await page.close()
  }
}
