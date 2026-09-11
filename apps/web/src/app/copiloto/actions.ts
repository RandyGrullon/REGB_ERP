'use server'

import { revalidatePath } from 'next/cache'
import { emparejarPregunta } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import { ejecutarReporte, type ResultadoReporte } from '../reportes/reportSources'
import { CATALOGO_PREGUNTAS } from './estados'

/**
 * Acciones de Copiloto IA (modulo 90, F9/S65-66).
 *
 * `preguntar()` NUNCA genera SQL ni llama a un modelo de lenguaje real
 * -emparejarPregunta() solo elige una key de un catalogo fijo, y esa
 * key dispara la MISMA `ejecutarReporte()` que ya usa `bi`-. La fuga
 * entre tenants queda eliminada por construccion: no existe ningun
 * camino de codigo que acepte una consulta arbitraria.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const money = (n: number) => n.toLocaleString('es-DO', { style: 'currency', currency: 'DOP' })

function resumir(sourceKey: string, resultado: ResultadoReporte): string {
  const { filas } = resultado

  if (sourceKey === 'sales_by_day') {
    if (filas.length === 0) return 'No hay ventas registradas en el rango consultado.'
    const total = filas.reduce((acc, f) => acc + Number(f.total ?? 0), 0)
    return `Vendiste ${money(total)} en los ultimos ${filas.length} dia(s) con ventas.`
  }
  if (sourceKey === 'top_products') {
    if (filas.length === 0) return 'No hay ventas de productos en el rango consultado.'
    const primero = filas[0]!
    return `El producto mas vendido es "${primero.name}" con ${primero.unidades} unidades (${money(Number(primero.importe))}).`
  }
  if (sourceKey === 'overdue_invoices') {
    if (filas.length === 0) return 'No tienes ninguna factura vencida ahora mismo.'
    const total = filas.reduce((acc, f) => acc + Number(f.total ?? 0), 0)
    return `Tienes ${filas.length} factura(s) vencida(s) por ${money(total)} en total.`
  }
  if (sourceKey === 'leads_by_status') {
    if (filas.length === 0) return 'Todavia no tienes ningun lead registrado.'
    return filas.map((f) => `${f.n} en "${f.status}"`).join(', ')
  }
  if (sourceKey === 'tickets_by_priority') {
    if (filas.length === 0) return 'Todavia no tienes ningun ticket registrado.'
    return filas.map((f) => `${f.n} con prioridad "${f.priority}"`).join(', ')
  }
  return 'No hay datos para esa pregunta.'
}

export async function preguntar(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ai-copilot', 'ai-copilot.view')
  if (!permiso.ok) return permiso

  const question = String(fd.get('question') ?? '').trim()
  if (!question) return { ok: false, error: 'Escribe una pregunta.' }

  const matchedKey = emparejarPregunta(question, CATALOGO_PREGUNTAS) ?? 'no_match'

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    let resumen = 'No entendi esa pregunta -prueba con algo sobre ventas, productos, facturas, leads o tickets-.'
    let datos: ResultadoReporte | null = null

    if (matchedKey !== 'no_match') {
      datos = await ejecutarReporte(tx, ctx.tenantId, matchedKey, {})
      resumen = resumir(matchedKey, datos)
    }

    await tx`
      insert into public.copilot_queries (tenant_id, user_id, question, matched_key, answer_summary, answer_data)
      values (${ctx.tenantId}, ${ctx.userId}, ${question}, ${matchedKey}, ${resumen}, ${datos ? JSON.stringify(datos) : null}::text::jsonb)`
  })

  revalidatePath('/copiloto')
  return { ok: true }
}

export async function preguntarForm(fd: FormData): Promise<void> {
  await anotarAviso(await preguntar(fd), 'preguntar')
}
