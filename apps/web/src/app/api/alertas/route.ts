import { NextResponse } from 'next/server'
import { evaluarAlertas, resumenAlertas, type Alerta } from '@regb/operations'
import { cargarSalud } from '@/lib/control-datos'

export const dynamic = 'force-dynamic'

/**
 * Las alertas de la mañana, para un programador de tareas (Vercel Cron).
 *
 * `pnpm alertas` (scripts/alertas.mjs) hace esto mismo desde una maquina:
 * le pregunta a /api/salud y manda el resumen a `ALERTAS_WEBHOOK`. En
 * Vercel no hay maquina donde correr un script, y el cron de Vercel solo
 * sabe llamar una ruta: esta es esa ruta. Misma decision -`evaluarAlertas`
 * de @regb/operations-, mismo texto, mismo webhook.
 *
 * Lo que NO mira: el respaldo en disco (`DIR_RESPALDOS`). En Vercel no hay
 * disco; los respaldos de la base los hace Supabase (docs/SUPABASE.md).
 *
 * El secreto es el del despachador: `REGB_CRON_SECRET`, o `CRON_SECRET`,
 * que es el que Vercel manda solo en `Authorization: Bearer …`. En
 * produccion sin secreto NO responde (ver /api/eventos/despachar).
 */
export async function GET(req: Request) {
  const secreto = process.env.REGB_CRON_SECRET || process.env.CRON_SECRET
  const enviado = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (secreto) {
    if (enviado !== secreto) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Falta REGB_CRON_SECRET. Las alertas no se exponen sin el.' },
      { status: 503 },
    )
  }

  let alertas: Alerta[]
  try {
    alertas = evaluarAlertas(await cargarSalud(), new Date())
  } catch (e) {
    // La base no contesta: ESA es la alerta del dia.
    alertas = [
      {
        clave: 'erp:sin-base',
        severidad: 'critico',
        titulo: 'El ERP no puede leer su base de datos',
        accion: `Revisa Supabase y DATABASE_URL. ${e instanceof Error ? e.message : ''}`.trim(),
      },
    ]
  }

  const resumen = resumenAlertas(alertas)
  const webhook = process.env.ALERTAS_WEBHOOK ?? ''
  let avisado = false

  // Sin nada que atender no se manda nada: un "todo bien" diario se vuelve
  // invisible a la semana (mismo criterio que scripts/alertas.mjs).
  if (resumen && webhook) {
    const texto = [
      `REGB ERP — ${resumen}`,
      '',
      ...alertas.flatMap((a) => [
        `${a.severidad === 'critico' ? '[!]' : '[.]'} ${a.titulo}`,
        `    ${a.accion}`,
      ]),
    ].join('\n')
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `content` lo lee Discord; `text`, Slack y Mattermost.
        body: JSON.stringify({ content: texto, text: texto }),
      })
      avisado = res.ok
      if (!res.ok) console.error(`[alertas] el webhook contesto ${res.status}`)
    } catch (e) {
      console.error('[alertas] no se pudo avisar por webhook', e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ resumen, alertas, avisado })
}
