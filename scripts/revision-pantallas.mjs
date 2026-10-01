#!/usr/bin/env node
/**
 * Revisión de pantallas — que cada pantalla abra, se vea bien y no salga
 * vacía ni con basura.
 *
 * `sonda-rutas.mjs` pregunta una sola cosa: ¿revienta? Esto pregunta lo que
 * nota un cliente: si la pantalla abre con datos DE VERDAD (las de detalle
 * se abren con un enlace real sacado de su lista, no con un id inventado),
 * si sale vacía, si enseña `undefined`, `NaN`, un uuid, un nombre interno
 * en inglés o una palabra sin tilde, si se desborda en el teléfono, si
 * falla alguna imagen y si la consola se queja. Y deja una foto de cada
 * una, en oscuro, en claro y a 375 px, para mirarlas.
 *
 * Las rutas salen de los `page.tsx` de `apps/web/src/app`, no de los
 * manifiestos: así entran también REGB Control, el perfil y el login.
 *
 *   node scripts/revision-pantallas.mjs [opciones]
 *     --tenant <slug>        por defecto distribuidora-caribe
 *     --rol <nombre>         por defecto Owner
 *     --solo /a,/b           solo las rutas que empiezan así
 *     --variantes oscuro,claro,movil
 *     --salida <carpeta>     por defecto ./revision-pantallas
 *     --sin-fotos            solo el informe
 *   Variables: BASE (http://localhost:3100), REGB_BROWSER.
 *
 * Salida: <salida>/informe.json, <salida>/informe.md y las fotos.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP = join(ROOT, 'apps', 'web', 'src', 'app')
const BASE = process.env.BASE ?? 'http://localhost:3100'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const TENANT = opcion('tenant', 'distribuidora-caribe')
const ROL = opcion('rol', 'Owner')
// Sin barra inicial a propósito: Git Bash convierte `/pedidos` en una ruta
// de Windows antes de que llegue aquí.
const SOLO = (opcion('solo', '') || '')
  .split(',')
  .filter(Boolean)
  .map((p) => (p.startsWith('/') ? p : `/${p}`))
const VARIANTES = opcion('variantes', 'oscuro,claro,movil').split(',')
const SALIDA = opcion('salida', join(process.cwd(), 'revision-pantallas'))
const FOTOS = !args.includes('--sin-fotos')
const PARALELO = Number(opcion('paralelo', '3'))

const NAVEGADORES = [
  process.env.REGB_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

/** Rutas que no se revisan: no son pantallas de la app o necesitan un token. */
const FUERA = [/^\/auth\//, /^\/api\//]

// ── Rutas desde el sistema de archivos ──────────────────────────────────
async function paginas(dir, base = '') {
  const lista = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      // (grupo) no suma a la ruta; _privado no es ruta.
      if (e.name.startsWith('_')) continue
      const seg = /^\(.*\)$/.test(e.name) ? '' : `/${e.name}`
      lista.push(...(await paginas(join(dir, e.name), base + seg)))
    } else if (e.name === 'page.tsx') {
      lista.push(base || '/')
    }
  }
  return lista
}

const todas = (await paginas(APP))
  .filter((r) => !FUERA.some((x) => x.test(r)))
  .filter((r) => SOLO.length === 0 || SOLO.some((p) => r === p || r.startsWith(p)))
  .sort()
const estaticas = todas.filter((r) => !r.includes('['))
const dinamicas = todas.filter((r) => r.includes('['))

/** `/pedidos/[id]` → expresión que reconoce `/pedidos/<algo>` en un enlace. */
const patron = (r) =>
  new RegExp('^' + r.replace(/\[[^\]]+\]/g, '[^/?#]+').replace(/\//g, '\\/') + '$')

const conDemo = (ruta) => {
  if (ruta.startsWith('/login')) return `${BASE}${ruta}`
  const u = new URL(ruta, BASE)
  u.searchParams.set('tenant', TENANT)
  u.searchParams.set('rol', ROL)
  return u.toString()
}

// ── Lo que se busca en cada pantalla ────────────────────────────────────
// Corre DENTRO del navegador: nada de closures.
function inspeccionar() {
  // Los íconos son ligaduras de texto (`chevron_right`) marcadas
  // aria-hidden: se quitan antes de leer, o todo sale como "nombre interno".
  // Corre DESPUÉS de la foto, así que tocar el DOM ya no importa.
  for (const el of document.querySelectorAll('[aria-hidden="true"], .material-symbols-rounded, .material-symbols-outlined')) {
    el.remove()
  }
  const main = document.querySelector('main') ?? document.body
  const texto = main.innerText ?? ''
  const hallazgos = []
  const añadir = (tipo, detalle) => hallazgos.push({ tipo, detalle })

  const basura = texto.match(
    /\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]|Invalid Date|\bInfinity\b/g,
  )
  if (basura) añadir('basura', [...new Set(basura)].join(', '))

  const error = /Esta pantalla tuvo un problema|Application error|Unhandled Runtime Error/.test(
    document.body.innerText,
  )
  if (error) añadir('error', 'la pantalla de error está a la vista')
  if (/No encontramos esta pantalla/.test(document.body.innerText)) añadir('404', 'no encontrada')

  const uuid = texto.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/)
  if (uuid) añadir('uuid', uuid[0])

  // Nombres internos: snake_case o ids de módulo a la vista (no en correos ni rutas).
  const internos = (texto.match(/(?<![\w@./-])[a-z]+(?:_[a-z0-9]+)+(?![\w@.])/g) ?? []).filter(
    (w) => !/^(https?|www)/.test(w),
  )
  if (internos.length) añadir('interno', [...new Set(internos)].slice(0, 8).join(', '))

  const ingles = texto.match(
    /\b(Loading|Submit|Cancel|Save|Delete|Edit|Search|No data|Not found|Settings|Sign in|Log in|Previous|Next page|Untitled|Unknown|Pending|Active|Inactive|Draft|Approved|Rejected|Paid|Overdue|open|closed|draft|pending|approved|rejected|posted|confirmed|cancelled|completed|in_progress)\b/g,
  )
  if (ingles) añadir('inglés', [...new Set(ingles)].slice(0, 8).join(', '))

  const sinTilde = texto.match(
    /\b(Catalogo|catalogo|Nomina|nomina|codigo|Codigo|numero|Numero|telefono|Telefono|direccion|Direccion|dias|aqui|Aqui|tambien|despues|informacion|Informacion|configuracion|Configuracion|modulo|modulos|Modulo|pagina|Pagina|credito|Credito|articulo|categoria|Categoria|sesion|Sesion|facturacion|Facturacion|razon|Razon|periodo|Periodo|operacion|Operacion|transaccion|descripcion|Descripcion|ultimo|ultima|Ultimo|Ultima|todavia|Todavia|electronica|Electronica|linea|lineas|Linea|Lineas|busqueda|Busqueda|aprobacion|Aprobacion|recepcion|Recepcion|devolucion|Devolucion|dueno|Dueno|ano|anos|mas de|Mas de)\b/g,
  )
  if (sinTilde) añadir('tildes', [...new Set(sinTilde)].slice(0, 10).join(', '))

  if (/§\s*\d/.test(texto)) añadir('interno', 'referencia § del documento maestro')

  const vacios = document.querySelectorAll('[data-estado="vacio"]').length
  if (vacios) añadir('vacía', `${vacios} estado(s) vacío(s)`)
  if (texto.trim().length < 80) añadir('vacía', `casi sin texto (${texto.trim().length} caracteres)`)

  const rotas = [...document.images].filter((i) => i.complete && i.naturalWidth === 0)
  if (rotas.length) añadir('imagen', rotas.map((i) => i.getAttribute('src')).slice(0, 3).join(', '))

  const enlaces = [...document.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href'))
    .filter((h) => h && h.startsWith('/'))

  return {
    titulo: document.title,
    h1: document.querySelector('h1')?.textContent?.trim() ?? '',
    caracteres: texto.trim().length,
    hallazgos,
    enlaces: [...new Set(enlaces)],
  }
}

// ── Navegador ───────────────────────────────────────────────────────────
const ejecutable = NAVEGADORES.find((p) => existsSync(p))
if (!ejecutable) {
  console.error('No encontré Chrome ni Edge. Indica uno con REGB_BROWSER=<ruta>.')
  process.exit(1)
}
try {
  await fetch(BASE)
} catch {
  console.error(`No hay nadie escuchando en ${BASE}.`)
  process.exit(2)
}

const browser = await chromium.launch({
  executablePath: ejecutable,
  headless: true,
  args: ['--lang=es-DO'],
})

const DEF = {
  oscuro: { tema: 'dark', viewport: { width: 1280, height: 800 } },
  claro: { tema: 'light', viewport: { width: 1280, height: 800 } },
  movil: { tema: 'dark', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
}
const contextos = {}
for (const v of VARIANTES) {
  const d = DEF[v]
  const ctx = await browser.newContext({
    viewport: d.viewport,
    isMobile: d.isMobile ?? false,
    hasTouch: d.hasTouch ?? false,
    deviceScaleFactor: 1,
    colorScheme: d.tema,
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
  })
  await ctx.addCookies([{ name: 'regb-tema', value: d.tema, url: BASE }])
  contextos[v] = ctx
}

const slug = (r) => (r === '/' ? 'inicio' : r.slice(1).replace(/[\/\[\]]/g, '_'))
const resultados = []

async function revisar(ruta, url, variante) {
  const page = await contextos[variante].newPage()
  const consola = []
  page.on('console', (m) => {
    if (m.type() === 'error') consola.push(m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => consola.push(`pageerror: ${e.message.slice(0, 200)}`))
  const t0 = Date.now()
  let estado = 0
  let datos = { titulo: '', h1: '', caracteres: 0, hallazgos: [], enlaces: [] }
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 })
    estado = res?.status() ?? 0
    await page.waitForTimeout(300)
    // Lo que depende del diseño se mide ANTES de la foto y de tocar el DOM.
    const desborde = await page.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth + 1
        ? `${document.documentElement.scrollWidth}px en ${window.innerWidth}px`
        : null,
    )
    if (FOTOS) {
      const dir = join(SALIDA, TENANT, ROL, variante)
      await mkdir(dir, { recursive: true })
      await page.screenshot({
        path: join(dir, `${slug(ruta)}.jpg`),
        fullPage: true,
        type: 'jpeg',
        quality: 60,
      })
    }
    datos = await page.evaluate(inspeccionar)
    if (desborde) datos.hallazgos.push({ tipo: 'desborde', detalle: desborde })
  } catch (e) {
    datos.hallazgos.push({ tipo: 'error', detalle: `no abrió: ${e.message.split('\n')[0]}` })
  }
  const ruido = consola.filter(
    (c) => !/preloaded using link preload|Download the React DevTools|Fast Refresh/.test(c),
  )
  if (ruido.length) datos.hallazgos.push({ tipo: 'consola', detalle: ruido.slice(0, 3).join(' | ') })
  if (estado >= 500) datos.hallazgos.push({ tipo: 'error', detalle: `HTTP ${estado}` })
  await page.close()
  const r = {
    ruta,
    url: url.replace(BASE, ''),
    variante,
    estado,
    ms: Date.now() - t0,
    titulo: datos.titulo,
    h1: datos.h1,
    caracteres: datos.caracteres,
    hallazgos: datos.hallazgos,
    foto: FOTOS ? relative(SALIDA, join(SALIDA, TENANT, ROL, variante, `${slug(ruta)}.jpg`)) : null,
  }
  resultados.push(r)
  process.stdout.write(r.hallazgos.some((h) => ['error', 'basura'].includes(h.tipo)) ? 'x' : r.hallazgos.length ? '!' : '.')
  return datos.enlaces
}

async function enParalelo(tareas) {
  let i = 0
  const trabajadores = Array.from({ length: PARALELO }, async () => {
    while (i < tareas.length) {
      const t = tareas[i++]
      await t()
    }
  })
  await Promise.all(trabajadores)
}

console.log(
  `revisión: ${estaticas.length} estáticas + ${dinamicas.length} de detalle × ${VARIANTES.length} variantes · ${TENANT} / ${ROL} · ${BASE}`,
)

// 1) Estáticas: en la primera variante se recogen los enlaces reales.
const enlaces = new Set()
await enParalelo(
  estaticas.map((ruta) => async () => {
    const hallados = await revisar(ruta, conDemo(ruta), VARIANTES[0])
    for (const h of hallados) enlaces.add(h.split('?')[0].split('#')[0])
  }),
)
process.stdout.write('\n')

// 2) De detalle: con un enlace real encontrado en las estáticas.
const detalle = []
const sinEjemplo = []
// Una ruta estática hermana también casa con el patrón (`/pedidos/clientes`
// con `/pedidos/[id]`): nunca sirve de ejemplo, o el detalle no se prueba.
const esEstatica = new Set(estaticas)
for (const ruta of dinamicas) {
  const re = patron(ruta)
  const ejemplo = [...enlaces].find((h) => re.test(h) && !esEstatica.has(h))
  if (ejemplo) detalle.push({ ruta, ejemplo })
  else sinEjemplo.push(ruta)
}
await enParalelo(
  detalle.map(({ ruta, ejemplo }) => async () => {
    await revisar(ruta, conDemo(ejemplo), VARIANTES[0])
  }),
)
process.stdout.write('\n')

// 3) Las demás variantes, sobre todo lo que abrió.
for (const v of VARIANTES.slice(1)) {
  await enParalelo([
    ...estaticas.map((ruta) => async () => revisar(ruta, conDemo(ruta), v)),
    ...detalle.map(({ ruta, ejemplo }) => async () => revisar(ruta, conDemo(ejemplo), v)),
  ])
  process.stdout.write('\n')
}
await browser.close()

// ── Informe ─────────────────────────────────────────────────────────────
resultados.sort((a, b) => a.ruta.localeCompare(b.ruta) || a.variante.localeCompare(b.variante))
await mkdir(SALIDA, { recursive: true })
await writeFile(
  join(SALIDA, 'informe.json'),
  JSON.stringify({ base: BASE, tenant: TENANT, rol: ROL, sinEjemplo, resultados }, null, 2),
)

const porTipo = {}
for (const r of resultados) for (const h of r.hallazgos) porTipo[h.tipo] = (porTipo[h.tipo] ?? 0) + 1
const lineas = [
  `# Revisión de pantallas — ${TENANT} / ${ROL}`,
  '',
  `${resultados.length} vistas (${estaticas.length} estáticas y ${detalle.length} de detalle, en ${VARIANTES.join(', ')}).`,
  '',
  '| Tipo | Hallazgos |',
  '|---|---:|',
  ...Object.entries(porTipo)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `| ${t} | ${n} |`),
  '',
]
if (sinEjemplo.length) {
  lineas.push(`**Sin enlace de ejemplo (no se pudieron abrir con datos reales):** ${sinEjemplo.join(', ')}`, '')
}
lineas.push('| Ruta | Variante | HTTP | Hallazgos | Foto |', '|---|---|---:|---|---|')
for (const r of resultados.filter((x) => x.hallazgos.length)) {
  const h = r.hallazgos.map((x) => `**${x.tipo}**: ${x.detalle}`.replace(/\|/g, '/')).join('<br>')
  lineas.push(`| \`${r.ruta}\` | ${r.variante} | ${r.estado} | ${h} | ${r.foto ?? ''} |`)
}
await writeFile(join(SALIDA, 'informe.md'), lineas.join('\n'))

console.log(`\nInforme: ${join(SALIDA, 'informe.md')}`)
for (const [t, n] of Object.entries(porTipo).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(10)} ${n}`)
if (sinEjemplo.length) console.log(`  sin ejemplo: ${sinEjemplo.length} rutas de detalle`)
