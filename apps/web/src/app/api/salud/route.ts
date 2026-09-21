import { NextResponse } from 'next/server'
import { evaluarAlertas, resumenAlertas } from '@regb/operations'
import { cargarSalud } from '@/lib/control-datos'

export const dynamic = 'force-dynamic'

/**
 * La salud de la operacion, para quien no tiene navegador.
 *
 * ── Por que un endpoint y no otra consulta ────────────────────────────
 *
 * Porque `cargarSalud()` ya existe y la alternativa era reescribir sus
 * consultas dentro de un script. Dos implementaciones de "como esta
 * esto" se separan —lo vimos con el contador de asientos sin empresa en
 * consolidacion, que decia cero mientras la foto ya los habia sumado— y
 * la que se desactualiza siempre es la que nadie mira.
 *
 * Aqui no hay logica: se sirve la foto y se le aplica `evaluarAlertas()`,
 * que es la misma funcion pura que puede usar la pantalla.
 *
 * ── El secreto es el MISMO del despachador ────────────────────────────
 *
 * `REGB_CRON_SECRET`, con el patron de /api/eventos/despachar: esto mira
 * los datos de TODOS los clientes, asi que no actua en nombre de nadie y
 * no encaja en el modelo de permisos.
 *
 * En produccion sin el secreto NO responde. No se deja abierto "solo
 * desde localhost": el `hostname` de la peticion lo pone el servidor, y
 * detras de un proxy sigue diciendo localhost aunque venga de internet.
 * Una comprobacion que parece proteger y no protege es peor que ninguna.
 *
 * En desarrollo se deja abierto a proposito, igual que el despachador: no
 * hay cron y hace falta poder dispararlo con un curl.
 */
export async function GET(req: Request) {
  const secreto = process.env.REGB_CRON_SECRET
  const enviado = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (secreto) {
    if (enviado !== secreto) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Falta REGB_CRON_SECRET. La salud no se expone sin el.' },
      { status: 503 },
    )
  }

  try {
    const salud = await cargarSalud()
    const alertas = evaluarAlertas(salud, new Date())
    return NextResponse.json({
      alertas,
      resumen: resumenAlertas(alertas),
      // La foto entera va tambien: quien quiera mirar el detalle no
      // tiene que pedir dos veces, y deja la puerta abierta a que otra
      // herramienta decida distinto sin tocar este endpoint.
      salud,
    })
  } catch (e) {
    // `e.message` viene VACIO en el caso que mas importa: cuando Postgres
    // no acepta la conexion, el driver lanza un error cuyo dato util esta
    // en `code` (ECONNREFUSED) y no en el mensaje. Un aviso que dice
    // error: "" hace perder el minuto de quien lo lee, que es justo lo
    // contrario de para lo que existe.
    const err = e as { message?: string; code?: string; name?: string }
    const detalle =
      [err?.message, err?.code].filter((x) => typeof x === 'string' && x !== '').join(' ') ||
      err?.name ||
      'Error inesperado'
    return NextResponse.json({ error: detalle }, { status: 500 })
  }
}
