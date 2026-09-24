import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ModulePageCtx } from '@/lib/module-page'
import { alcanceDelRespaldo, nombreDeModulo } from '../../alcance'

/**
 * Descarga de un respaldo como JSON (S11). Doble candado, como todo, y un
 * tercero desde 0122: quien no ve completo un modulo que el archivo trae
 * no se lo lleva, aunque el respaldo lo haya creado otro (ver alcance.ts).
 *
 * ── Formato 2 (0122): el archivo se arma por partes ────────────────────
 *
 * El indice (`backups.payload`) va arriba, tal cual: el archivo dice en
 * sus primeras lineas que trae, cuantas filas por tabla, que queda fuera
 * y por que. Debajo, `datos`: una clave por tabla con todas sus filas.
 *
 * Las filas viven en `backup_parts` y se piden en lotes de pocos MB, en
 * orden, mientras el navegador va leyendo: un cliente grande no obliga a
 * tener su negocio entero en la memoria del servidor.
 *
 * ── Formato 1: los respaldos de antes de 0122 ──────────────────────────
 *
 * Se entregan como estaban. Solo traen seis tablas maestras; la pantalla
 * los marca como "Parcial" y el aviso ya no los cuenta como proteccion.
 */

interface Indice {
  formato: string
  version: number
  modulos: string[]
  tablas: Record<string, number>
}

interface Parte {
  tabla: string
  parte: number
  filas: number
  size_bytes: number
}

/** Cuanto se pide a la base de una vez. Bastante para no ir fila a fila, poco para la memoria. */
const LOTE_BYTES = 8 * 1024 * 1024

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const url = new URL(request.url)
  const ctx = await actionCtx({
    tenant: url.searchParams.get('tenant') ?? undefined,
    rol: url.searchParams.get('rol') ?? undefined,
  })
  if (!ctx) return new Response('Sesion no valida', { status: 401 })
  if (!exigir(ctx, 'backup', 'backup.export').ok) return new Response('No existe', { status: 404 })

  const [backup] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<{ formato: number; payload: unknown; created_at: string }[]>`
      select formato, payload, created_at::text from public.backups
      where id = ${id} and tenant_id = ${ctx.tenantId}`,
  )

  if (!backup) return new Response('No existe', { status: 404 })

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="regb-respaldo-${backup.created_at.slice(0, 10)}.json"`,
  }

  if (backup.formato !== 2) {
    await marcarSalida(ctx, id, backup.formato)
    return new Response(JSON.stringify(backup.payload, null, 2), { headers })
  }

  const indice = backup.payload as Indice
  const alcance = alcanceDelRespaldo(ctx)
  if (alcance.bloqueo) return new Response(alcance.bloqueo, { status: 403 })
  const noVe = indice.modulos.filter((m) => !alcance.modulos.includes(m))
  if (noVe.length > 0) {
    return new Response(
      `Este respaldo trae ${noVe.map(nombreDeModulo).join(', ')}, y tu rol no lo ve completo. ` +
        'Pidele el archivo a quien si lo ve.',
      { status: 403 },
    )
  }

  const partes = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<Parte[]>`
      select tabla, parte, filas, size_bytes from public.backup_parts
      where tenant_id = ${ctx.tenantId} and backup_id = ${id}
      order by tabla, parte`,
  )

  // Antes de mandar un solo byte: las partes tienen que sumar lo que dice
  // el indice. Un archivo que dice "3 facturas" y trae 2 es peor que no
  // tener archivo, porque nadie lo va a revisar hasta el dia que haga falta.
  const porTabla = new Map<string, Parte[]>()
  for (const p of partes) porTabla.set(p.tabla, [...(porTabla.get(p.tabla) ?? []), p])
  for (const [tabla, filas] of Object.entries(indice.tablas)) {
    const suma = (porTabla.get(tabla) ?? []).reduce((s, p) => s + p.filas, 0)
    if (suma !== filas) {
      return new Response(
        `El respaldo esta incompleto: ${tabla} dice ${filas} filas y trae ${suma}.`,
        {
          status: 500,
        },
      )
    }
  }

  return new Response(aFlujo(archivo(ctx, id, indice, porTabla)), { headers })
}

/**
 * Se marca que este respaldo SALIO de aqui, y se emite el evento.
 *
 * Es el unico dato que distingue un respaldo que protege de uno que no:
 * el que sigue dentro de la misma base se pierde con ella. Se marca la
 * PRIMERA vez y no se pisa despues -interesa cuando dejo de estar solo
 * aqui, no la ultima vez que alguien lo volvio a bajar-, y el evento sale
 * esa misma primera vez.
 */
async function marcarSalida(ctx: ModulePageCtx, id: string, formato: number): Promise<void> {
  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const marcado = await tx`
      update public.backups
         set downloaded_at = now(), downloaded_by = ${ctx.userId}
       where id = ${id} and tenant_id = ${ctx.tenantId} and downloaded_at is null
      returning id`
    if (marcado.length > 0) {
      await tx`select public.emit_event('backup.snapshot.downloaded',
        ${JSON.stringify({ backup_id: id, formato })}::text::jsonb, 'backup')`
    }
  })
}

/** El JSON del archivo, trozo a trozo, en el orden de las tablas del indice. */
async function* archivo(
  ctx: ModulePageCtx,
  id: string,
  indice: Indice,
  porTabla: Map<string, Parte[]>,
): AsyncGenerator<string> {
  const tablas = Object.keys(indice.tablas).sort()
  const orden = tablas.flatMap((t) => porTabla.get(t) ?? [])
  const lote = new Map<string, number>()
  let n = 0
  let bytes = 0
  for (const p of orden) {
    if (bytes > 0 && bytes + p.size_bytes > LOTE_BYTES) {
      n += 1
      bytes = 0
    }
    lote.set(clave(p), n)
    bytes += p.size_bytes
  }

  let cargado: { n: number; datos: Map<string, string> } | null = null
  const datosDe = async (p: Parte): Promise<string> => {
    const n = lote.get(clave(p))!
    if (cargado?.n !== n) {
      const delLote = orden.filter((q) => lote.get(clave(q)) === n)
      const filas = await asUser(
        ctx.userId,
        ctx.tenantId,
        (tx) => tx<{ tabla: string; parte: number; datos: string }[]>`
          select bp.tabla, bp.parte, bp.datos::text as datos
          from public.backup_parts bp
          join unnest(${delLote.map((q) => q.tabla)}::text[],
                      ${delLote.map((q) => q.parte)}::int[]) as l(tabla, parte)
            on l.tabla = bp.tabla and l.parte = bp.parte
          where bp.tenant_id = ${ctx.tenantId} and bp.backup_id = ${id}`,
      )
      cargado = { n, datos: new Map(filas.map((f) => [clave(f), f.datos])) }
    }
    const datos = cargado.datos.get(clave(p))
    if (datos === undefined) throw new Error(`Falta la parte ${p.parte} de ${p.tabla}`)
    return datos
  }

  // La cabecera es el indice tal cual, sin su llave de cierre.
  const cabecera = JSON.stringify(indice, null, 2)
  yield `${cabecera.slice(0, cabecera.lastIndexOf('}')).trimEnd()},\n  "datos": {`

  for (const [i, tabla] of tablas.entries()) {
    yield `${i === 0 ? '' : ','}\n    ${JSON.stringify(tabla)}: [`
    let primera = true
    for (const p of porTabla.get(tabla) ?? []) {
      // Cada parte es un arreglo JSON: se le quitan los corchetes para
      // que todas las partes de una tabla queden en UN arreglo.
      const cuerpo = (await datosDe(p)).trim().slice(1, -1)
      if (cuerpo.trim() === '') continue
      yield `${primera ? '' : ', '}${cuerpo}`
      primera = false
    }
    yield ']'
  }
  yield '\n  }\n}\n'

  // Solo si el navegador pidio hasta el ultimo trozo: un archivo cortado a
  // la mitad no salio de aqui.
  await marcarSalida(ctx, id, 2)
}

function clave(p: { tabla: string; parte: number }): string {
  return `${p.tabla}#${p.parte}`
}

function aFlujo(trozos: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const codificar = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async pull(control) {
      try {
        const { value, done } = await trozos.next()
        if (done) control.close()
        else control.enqueue(codificar.encode(value))
      } catch (e) {
        control.error(e)
      }
    },
    async cancel() {
      await trozos.return(undefined)
    },
  })
}
