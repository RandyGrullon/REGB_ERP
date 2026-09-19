#!/usr/bin/env node
/**
 * Sonda de rutas — que cada pantalla del ERP ABRA.
 *
 * ── De donde sale esto ────────────────────────────────────────────────
 *
 * De abrir el ERP para enseñarlo y encontrar que la pantalla de INICIO
 * no cargaba. Ninguna. `permission denied for table stock_levels`: un
 * widget leia una columna que 0109 le habia quitado a `authenticated`, y
 * la consulta reventaba entera.
 *
 * El mismo fallo estaba en otros dos sitios. Y en el marketplace, pedir
 * modulos no confirmaba nada.
 *
 * Ninguno de los tres lo agarro ninguna de las 978 pruebas de base ni de
 * las 899 de operaciones. No es que estuvieran mal escritas: es que
 * NINGUNA prueba abria una pagina. Se probaba la base por debajo y la
 * logica pura por un lado, y entre las dos quedaba justo el sitio donde
 * el usuario vive.
 *
 * Esa familia de fallo va a volver. Cada vez que una migracion revoque un
 * permiso -0106, 0109, 0115 ya lo hicieron- alguna consulta de alguna
 * pantalla se queda leyendo lo que ya no puede. La revocacion es
 * correcta; lo que falta es que alguien avise.
 *
 * ── Que hace ──────────────────────────────────────────────────────────
 *
 * Pide cada ruta del registry, con varios roles, y falla si alguna
 * devuelve 500. Nada mas. No mira el contenido ni si la pantalla es util:
 * mira que ABRA, que es justo lo que no miraba nadie.
 *
 * Varios ROLES y no solo Owner, porque el Owner ve el camino ancho: los
 * `if` de permiso que se rompen son los del que ve menos. Y un 403 o un
 * 404 NO es un fallo aqui -es el sistema funcionando-: solo el 500 lo es.
 *
 * ── Las rutas con parametro, con un id que NO existe ──────────────────
 *
 * `/pedidos/:id` no se puede pedir sin un pedido. Sembrar uno de cada
 * cosa para 41 rutas es otra sonda y otro dia.
 *
 * Pero hay una pregunta que SI se puede hacer sin sembrar nada, y es la
 * que mas se rompe: **¿que hace la pantalla cuando la fila no existe?**
 * Un uuid con forma valida que no apunta a nada. Lo correcto es 404 —el
 * sistema diciendo "eso no esta"—. Un 500 ahi significa que la pagina
 * asume que la consulta devolvio algo y lee un campo de `undefined`.
 *
 * Pasa mas de lo que parece: un enlace viejo, un registro borrado, un
 * id pegado a mano. Y como el que lo encuentra es un usuario, no un
 * test, se descubre tarde.
 *
 * Lo que esto NO prueba es que la pantalla funcione con datos DE VERDAD.
 * Se dice al final, contado, para que nadie lea "todo verde" como "todo
 * probado".
 *
 * Tampoco prueba POST: que un boton haga lo que dice sigue sin cubrirse
 * -y ese fue el cuarto fallo de ese dia-.
 *
 *   pnpm --filter @regb/web dev     (en otra terminal)
 *   node scripts/sonda-rutas.mjs
 *
 * Variables: BASE (por defecto http://localhost:3100), TENANT, ROLES.
 */
import { readdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const MODULES_DIR = join(ROOT, 'modules')
const BASE = process.env.BASE ?? 'http://localhost:3100'
const TENANT = process.env.TENANT ?? 'colmado-esperanza'

/**
 * Owner ve casi todo; los otros dos ven poco y por caminos distintos.
 * Cajero es el que menos ve de todos, que es donde se rompen los `if`.
 */
const ROLES = (process.env.ROLES ?? 'Owner,Gerente de Sucursal,Cajero').split(',')

/** Rutas que no salen de ningun manifest pero abre todo el mundo. */
const FIJAS = ['/', '/marketplace', '/roles', '/notificaciones', '/tutorial']

const manifests = []
for (const e of await readdir(MODULES_DIR, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('_')) continue
  const file = join(MODULES_DIR, e.name, 'manifest.ts')
  try {
    await access(file)
  } catch {
    continue
  }
  try {
    const mod = await import(pathToFileURL(resolve(file)).href)
    if (mod.default?.id) manifests.push(mod.default)
  } catch {
    // Un manifest que no carga ya lo reporta `audit:manifests`. Aqui se
    // salta en vez de tumbar la sonda: son dos puertas distintas y no se
    // tapan la una a la otra.
  }
}

/**
 * Un uuid con forma valida que no apunta a nada, y un codigo que tampoco.
 *
 * Fijos y no aleatorios a proposito: la sonda tiene que dar el mismo
 * resultado dos veces seguidas. Un id distinto en cada corrida convierte
 * un fallo en algo que "a veces sale".
 */
const ID_FANTASMA = '00000000-0000-4000-8000-000000000000'
const CODIGO_FANTASMA = 'XTS'

const estaticas = new Set(FIJAS)
const fantasmas = []
for (const m of manifests) {
  for (const r of m.routes ?? []) {
    if (r.path.includes(':')) {
      // `:code` es un codigo de moneda, no un uuid. Meterle un uuid daria
      // un 404 por el motivo equivocado y la prueba no probaria nada.
      const relleno = r.path.includes(':code') ? CODIGO_FANTASMA : ID_FANTASMA
      fantasmas.push(r.path.replace(/:[A-Za-z]+/g, relleno))
      continue
    }
    estaticas.add(r.path)
  }
}

const rutas = [...estaticas].sort()
fantasmas.sort()

// Las de detalle se piden solo con Owner: lo que se persigue ahi es que
// la pagina aguante una fila que no existe, y eso no depende del rol. Con
// los tres roles serian 123 peticiones mas para probar lo mismo.
const total = rutas.length * ROLES.length + fantasmas.length
console.log(
  `sonda:rutas  ${rutas.length} rutas × ${ROLES.length} roles + ${fantasmas.length} de detalle = ${total} peticiones`,
)
console.log(`             contra ${BASE} como "${TENANT}"\n`)

// Un servidor apagado es el error mas probable de todos. Se dice antes de
// soltar 400 peticiones que van a fallar todas por lo mismo.
try {
  // GET y no HEAD: Next no responde HEAD en todas las rutas, y un 405
  // aqui se leeria como "servidor caido" cuando esta perfectamente vivo.
  await fetch(BASE)
} catch {
  console.error(`sonda:rutas  no hay nadie escuchando en ${BASE}.`)
  console.error(`             levantalo con: pnpm --filter @regb/web dev`)
  process.exit(2)
}

const rotas = []

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Pide una ruta y anota si revienta. 403 y 404 NO revientan: son un no.
 *
 * ── Por que reintenta cuando no hay conexion ──────────────────────────
 *
 * Porque `next dev` SE REINICIA SOLO: cuando la memoria del proceso sube
 * mucho avisa ("approaching the used memory threshold, restarting") y se
 * levanta de nuevo en ~10 s. En una corrida de 380 peticiones eso pasa, y
 * la primera version de esta sonda conto las 22 rutas de ese hueco como
 * 22 pantallas rotas.
 *
 * Una sonda que grita cuando no pasa nada deja de leerse a la tercera
 * vez. Peor: la siguiente que grite de verdad tampoco se va a leer.
 *
 * Solo se reintenta el fallo de CONEXION (no hubo respuesta). Un 500 es
 * una respuesta —el servidor esta vivo y la pantalla se rompio— y ese no
 * se reintenta nunca: seria tapar justo lo que se busca.
 */
async function pedir(path, rol, reintentos = 3) {
  const url = `${BASE}${path}?tenant=${encodeURIComponent(TENANT)}&rol=${encodeURIComponent(rol)}`

  for (let intento = 1; ; intento += 1) {
    let estado
    let cuerpo = ''
    try {
      const res = await fetch(url, { redirect: 'follow' })
      estado = res.status
      if (estado >= 500) cuerpo = await res.text()
    } catch (err) {
      estado = 0
      cuerpo = err.message
    }

    if (estado === 0 && intento <= reintentos) {
      // Espera creciente: al reinicio de next dev le toman ~10 s.
      process.stdout.write('r')
      await dormir(intento * 5000)
      continue
    }

    if (estado >= 500 || estado === 0) {
      rotas.push({ rol, path, estado, motivo: motivoDe(cuerpo) })
      process.stdout.write('x')
    } else {
      process.stdout.write('.')
    }
    return
  }
}

for (const rol of ROLES) {
  for (const path of rutas) await pedir(path, rol)
  process.stdout.write('\n')
}

// Las de detalle, con una fila que no existe.
for (const path of fantasmas) await pedir(path, ROLES[0])
process.stdout.write('\n')

/** El mensaje de Postgres o de Next, sin el HTML de alrededor. */
function motivoDe(html) {
  if (!html) return ''
  const pg = html.match(/(permission denied[^"<\\]{0,80}|relation "[^"]+" does not exist|column "[^"]+" does not exist)/i)
  if (pg) return pg[1]
  const next = html.match(/<title>([^<]{0,120})<\/title>/i)
  return next ? next[1] : html.slice(0, 120).replace(/\s+/g, ' ')
}

const NOTA_COBERTURA =
  `             ${fantasmas.length} rutas de detalle se probaron con una fila que NO existe.\n` +
  `             Que abran con datos DE VERDAD sigue sin probarse.`

console.log('')
if (rotas.length === 0) {
  console.log(`sonda:rutas  OK — las ${rutas.length} rutas abren con los ${ROLES.length} roles.`)
  console.log(NOTA_COBERTURA)
  process.exit(0)
}

// Se separan porque son dos problemas distintos: una pantalla rota se
// arregla en el codigo; "no hubo respuesta" tres veces seguidas suele ser
// el servidor caido y no hay nada que arreglar en la pagina.
const revientan = rotas.filter((r) => r.estado >= 500)
const sinRespuesta = rotas.filter((r) => r.estado === 0)

if (revientan.length > 0) {
  console.error(`sonda:rutas  ${revientan.length} pantalla(s) revientan:\n`)
  for (const r of revientan) {
    console.error(`  ${String(r.estado).padEnd(3)} ${r.path}`)
    console.error(`      rol: ${r.rol}`)
    if (r.motivo) console.error(`      ${r.motivo}`)
  }
}

if (sinRespuesta.length > 0) {
  console.error(`\nsonda:rutas  ${sinRespuesta.length} sin respuesta tras reintentar:\n`)
  for (const r of sinRespuesta) console.error(`      ${r.path}  (${r.rol})`)
  console.error(`\n      Esto no suele ser la pantalla: mira si el servidor sigue vivo.`)
}
console.error(`\n${NOTA_COBERTURA}`)
process.exit(1)
