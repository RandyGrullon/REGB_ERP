#!/usr/bin/env node
/**
 * Avisa de lo que hay que atender hoy. La mitad que falta del blindaje.
 *
 * ── El problema que resuelve ──────────────────────────────────────────
 *
 * `/control/salud` mide lo correcto y lo pinta bien, pero hay que
 * ACORDARSE de abrirlo. El dia que de verdad importa —un cliente sin NCF
 * a las 8 a.m., un respaldo que lleva tres semanas sin correr— es justo
 * el dia en que nadie lo abrio.
 *
 * Esto se programa una vez y habla solo.
 *
 * ── Por que le pregunta al ERP en vez de a la base ────────────────────
 *
 * Para no tener dos versiones de "como esta esto". Las consultas viven
 * en `cargarSalud()` y la decision en `evaluarAlertas()`; aqui no hay ni
 * una ni otra.
 *
 * Y tiene un efecto util: si el ERP no contesta, eso YA es la alerta mas
 * importante del dia. Un cliente no puede facturar con el sistema caido,
 * asi que ese caso sale como critico en vez de como un error del script.
 *
 * ── Como avisa ───────────────────────────────────────────────────────
 *
 * 1. Lo imprime, ordenado por urgencia.
 * 2. Sale con codigo 1 si hay algo critico. Cualquier programador de
 *    tareas sabe leer eso.
 * 3. Si existe `ALERTAS_WEBHOOK`, manda el resumen ahi. Sirve tal cual
 *    para Discord, Slack o Telegram via webhook: es un POST con
 *    `{content, text}`, los dos campos que esperan unos y otros. Sin esa
 *    variable no se manda nada y no falla: hoy funciona sin credenciales
 *    de nadie, y el dia que haya un canal es una linea en el .env.
 *
 *   pnpm alertas
 *   BASE=https://erp.cliente.do REGB_CRON_SECRET=... pnpm alertas
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
// La decision vive en @regb/operations, con sus pruebas. Aqui solo se
// averigua el dato del disco y se le pregunta.
import { evaluarRespaldoLocal } from '../packages/operations/dist/alertas.js'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3100'
const DIR_RESPALDOS = process.env.DIR_RESPALDOS ?? 'respaldos'
const SECRETO = process.env.REGB_CRON_SECRET ?? ''
const WEBHOOK = process.env.ALERTAS_WEBHOOK ?? ''

const ICONO = { critico: '[!]', aviso: '[.]' }

/**
 * La fecha del respaldo mas reciente en disco, o null si no hay ninguno.
 *
 * Se mira el ARCHIVO y no una fila de la base a proposito: el respaldo
 * de desastre es `pnpm db:respaldar`, un pg_dump. La tabla
 * `public.backups` guarda otra cosa -las exportaciones que cada cliente
 * se hace desde la app- y confundirlas fue el error de la primera
 * version: dio "4 criticas, ningun cliente tiene respaldo" con los
 * respaldos hechos y en disco.
 *
 * Y se usa la fecha de MODIFICACION del archivo, no la de su nombre: un
 * nombre se puede escribir a mano, una fecha de archivo no.
 */
async function ultimoRespaldo() {
  let nombres
  try {
    nombres = await readdir(DIR_RESPALDOS)
  } catch {
    // La carpeta no existe: es lo mismo que no tener ningun respaldo.
    return null
  }
  const dumps = nombres.filter((n) => n.endsWith('.dump') || n.endsWith('.sql'))
  if (dumps.length === 0) return null
  const fechas = await Promise.all(
    dumps.map(async (n) => {
      try {
        return (await stat(join(DIR_RESPALDOS, n))).mtime
      } catch {
        return null
      }
    }),
  )
  const vivas = fechas.filter((f) => f !== null)
  if (vivas.length === 0) return null
  return new Date(Math.max(...vivas.map((f) => f.getTime())))
}

/** Lo que se imprime y lo que se manda, misma forma. */
function comoTexto(alertas, resumen) {
  const lineas = [`REGB ERP — ${resumen}`, '']
  for (const a of alertas) {
    lineas.push(`${ICONO[a.severidad] ?? '[?]'} ${a.titulo}`)
    lineas.push(`    ${a.accion}`)
  }
  return lineas.join('\n')
}

async function avisarPorWebhook(texto) {
  if (WEBHOOK === '') return
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `content` lo lee Discord, `text` lo leen Slack y Mattermost. Ir
      // con los dos evita tener que saber cual es el canal.
      body: JSON.stringify({ content: texto, text: texto }),
    })
    if (!res.ok) console.error(`alertas  el webhook contesto ${res.status}`)
  } catch (e) {
    // Que falle el aviso no puede tapar la alerta: ya se imprimio arriba.
    console.error(`alertas  no se pudo avisar por webhook: ${e.message}`)
  }
}

let datos
try {
  const res = await fetch(`${BASE}/api/salud`, {
    headers: SECRETO === '' ? {} : { authorization: `Bearer ${SECRETO}` },
  })
  if (!res.ok) {
    const cuerpo = await res.text()
    throw new Error(`${res.status} ${cuerpo.slice(0, 200)}`)
  }
  datos = await res.json()
} catch (e) {
  // El ERP caido no es un fallo de esta herramienta: es LA alerta.
  const texto =
    `REGB ERP — 1 critica\n\n` +
    `${ICONO.critico} El ERP no contesta en ${BASE}\n` +
    `    ${e.message}\n` +
    `    Nadie puede facturar mientras esto siga asi.`
  console.error(texto)
  await avisarPorWebhook(texto)
  process.exit(1)
}

const alertas = datos.alertas ?? []

// El respaldo se comprueba AQUI y no en el endpoint: el archivo vive en
// la maquina que corre esto, y el ERP podria estar en otra.
const respaldo = evaluarRespaldoLocal(await ultimoRespaldo(), new Date())
if (respaldo !== null) alertas.unshift(respaldo)

if (alertas.length === 0) {
  // Sin ruido cuando no hay nada: un "todo bien" diario se vuelve
  // invisible a la semana, y entonces tampoco se ve el dia que cambia.
  console.log('alertas  OK — nada que atender.')
  process.exit(0)
}

// El resumen se recalcula: el del endpoint no sabe del respaldo local.
const criticas = alertas.filter((a) => a.severidad === 'critico').length
const avisos = alertas.length - criticas
const partes = []
if (criticas > 0) partes.push(criticas === 1 ? '1 critica' : `${criticas} criticas`)
if (avisos > 0) partes.push(avisos === 1 ? '1 aviso' : `${avisos} avisos`)
const texto = comoTexto(alertas, partes.join(' y '))
console.log(texto)
await avisarPorWebhook(texto)

// Solo lo critico tumba el codigo de salida. Un aviso que hace fallar la
// tarea programada todos los dias se acaba desactivando, y con el se van
// tambien los criticos.
process.exit(alertas.some((a) => a.severidad === 'critico') ? 1 : 0)
