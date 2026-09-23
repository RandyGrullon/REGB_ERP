'use server'

import { revalidatePath } from 'next/cache'
import {
  detectarDelimitador,
  parseCsv,
  validateProducts,
  validateStock,
  type ImportError,
} from '@regb/core'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'
import { anotarAviso } from '@/lib/aviso'

/**
 * Importacion de productos desde CSV (S12) con DESHACER.
 *
 * Cada lote deja su id en los productos que creo, asi que deshacer es
 * exacto: borra lo que ESE lote inserto y no toca nada mas. El lote queda
 * marcado como deshecho — la bitacora del import tampoco se borra.
 *
 * Cada fila del archivo cae en UNO de tres montones, y el lote guarda los
 * tres: nueva (`inserted`), ya existia y no se toco (entradas
 * `kind: 'skipped'` en `errors`) o rechazada (`rejected`, con su motivo
 * en `errors`). total_rows = nuevas + ya existentes + rechazadas.
 */

type Resultado = { ok: true; texto: string } | { ok: false; error: string }

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios)

/** "Importamos 2 productos nuevos. 1 ya existia y lo dejamos como estaba. ..." */
function resumen(nuevos: number, yaExistian: number, rechazadas: number): string {
  const partes = [
    nuevos > 0
      ? `Importamos ${nuevos} ${plural(nuevos, 'producto nuevo', 'productos nuevos')}.`
      : 'No entro ningun producto nuevo.',
  ]
  if (yaExistian > 0) {
    partes.push(
      `${yaExistian} ${plural(yaExistian, 'ya existia y lo dejamos como estaba', 'ya existian y los dejamos como estaban')}.`,
    )
  }
  if (rechazadas > 0) {
    partes.push(
      `${rechazadas} ${plural(rechazadas, 'fila rechazada', 'filas rechazadas')}: mira el detalle abajo.`,
    )
  }
  return partes.join(' ')
}

/**
 * Importa el CSV y dice CUANTAS filas entraron nuevas, cuantas ya
 * existian y cuantas se rechazaron. Antes contaba como "entraron" las
 * que el `on conflict do nothing` descartaba: un archivo de 200 productos
 * que ya estaban decia "Entraron: 200" sin haber entrado ninguno.
 */
async function importar(formData: FormData): Promise<Resultado> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'imports', 'imports.create')
  if (!permiso.ok) return permiso
  // Importar productos exige poder crear productos: el permiso del modulo
  // destino manda, no solo el de importar.
  const pProd = exigir(ctx, 'products', 'products.create')
  if (!pProd.ok) return pProd

  const file = formData.get('archivo')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Elige un archivo CSV primero.' }
  }

  const text = await file.text()
  // Un solo separador por archivo, leido del encabezado; y el mismo dato
  // decide como leer "1,234" si ninguna celda prueba el formato.
  const delimitador = detectarDelimitador(text)
  const rows = parseCsv(text, delimitador)
  const headers = rows[0] ?? []
  const datos = rows.slice(1)
  const { valid, errors, rejectedRows } = validateProducts(datos, headers, { delimitador })

  const conteo = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    // El lote nace primero porque los productos llevan su id; los numeros
    // se escriben al final, cuando la base ya dijo cuales entraron.
    const [batch] = await tx<{ id: string }[]>`
      insert into public.import_batches
        (tenant_id, target, file_name, total_rows, inserted, rejected, errors, created_by)
      values (${ctx.tenantId}, 'products', ${file.name}, ${datos.length},
              0, ${rejectedRows}, '[]'::jsonb, ${ctx.userId})
      returning id`
    if (!batch) throw new Error('No se pudo registrar la importacion.')

    let nuevos = 0
    const yaExistian: ImportError[] = []
    // Rechazos que solo la base puede ver: un codigo de barras que ya
    // tiene OTRO producto. Cuentan como rechazadas, igual que las de la
    // lectura.
    const rechazadasEnBase: ImportError[] = []
    for (const p of valid) {
      if (p.barcode !== null) {
        const [dueno] = await tx<{ sku: string }[]>`
          select sku from public.products
          where tenant_id = ${ctx.tenantId} and barcode = ${p.barcode}`
        // Si el dueño del codigo es este mismo SKU, la fila cae en "ya
        // existia" mas abajo. Si es otro, el indice unico de barcode
        // tumbaria la importacion ENTERA: se rechaza aqui, en su fila.
        if (dueno && dueno.sku !== p.sku) {
          const [mismoSku] = await tx`
            select 1 from public.products where tenant_id = ${ctx.tenantId} and sku = ${p.sku}`
          if (!mismoSku) {
            rechazadasEnBase.push({
              row: p.line,
              column: 'barcode',
              message: `El codigo de barras "${p.barcode}" ya lo tiene el producto ${dueno.sku}: un codigo de barras identifica un solo producto.`,
            })
            continue
          }
        }
      }
      // `on conflict do nothing`: si el sku ya existe, no se pisa un
      // producto vivo con datos de un archivo. `returning` dice si entro:
      // sin fila de vuelta, ya existia, y se anota con su linea.
      // La tasa: la de la fila (18%, 16%, 0 o exento) y, si no dice nada,
      // la por defecto del cliente en Impuestos (0118) -no el 0.18 fijo del
      // default de columna-.
      const entro = await tx`
        insert into public.products
          (tenant_id, sku, name, category, unit, price, cost, barcode, tax_rate, import_batch_id)
        values (${ctx.tenantId}, ${p.sku}, ${p.name}, ${p.category},
                ${p.unit}, ${p.price}, ${p.cost}, ${p.barcode},
                coalesce(${p.taxRate}::numeric, public.tasa_itbis_por_defecto()),
                ${batch.id})
        on conflict (tenant_id, sku) do nothing
        returning id`
      if (entro.length > 0) nuevos++
      else
        yaExistian.push({
          row: p.line,
          column: 'sku',
          message: `El codigo "${p.sku}" ya existia: lo dejamos como estaba.`,
          kind: 'skipped',
        })
    }

    // El cast va por text a proposito. Con ::jsonb directo, Postgres
    // infiere que el parametro ES jsonb, postgres.js le aplica
    // JSON.stringify otra vez y la columna acaba guardando un jsonb de
    // tipo string: al leerlo, errors.map explota. Fijado en
    // supabase/tests/jsonb-params.test.ts.
    const rechazadas = rejectedRows + rechazadasEnBase.length
    await tx`
      update public.import_batches
      set inserted = ${nuevos},
          rejected = ${rechazadas},
          errors = ${JSON.stringify([...errors, ...rechazadasEnBase, ...yaExistian])}::text::jsonb
      where id = ${batch.id}`

    const payload = {
      batchId: batch.id,
      target: 'products',
      fileName: file.name,
      totalRows: datos.length,
      inserted: nuevos,
      skipped: yaExistian.length,
      rejected: rechazadas,
    }
    await tx`
      select public.emit_event('imports.batch.completed',
        ${JSON.stringify(payload)}::text::jsonb, 'imports')`

    return { nuevos, yaExistian: yaExistian.length, rechazadas }
  })

  revalidatePath('/importar')
  revalidatePath('/products')

  const texto = resumen(conteo.nuevos, conteo.yaExistian, conteo.rechazadas)
  // Un archivo donde no entro NADA nuevo no es un exito aunque el proceso
  // corriera: se dice como error para que nadie cierre la pantalla
  // creyendo que subio su catalogo.
  return conteo.nuevos === 0 ? { ok: false, error: texto } : { ok: true, texto }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function deshacer(formData: FormData): Promise<Resultado> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const pImp = exigir(ctx, 'imports', 'imports.edit')
  if (!pImp.ok) return pImp
  const pDel = exigir(ctx, 'products', 'products.delete')
  if (!pDel.ok) return pDel

  const batchId = String(formData.get('batchId') ?? '')
  if (!batchId) return { ok: false, error: 'Falta la importacion.' }
  if (!UUID.test(batchId)) return { ok: false, error: 'Esa importacion no existe.' }

  let r:
    | { estado: 'no-existe' }
    | { estado: 'ya-deshecha' }
    | { estado: 'otro-tipo' }
    | { estado: 'ok'; borrados: number }
  try {
    r = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      // Primero se RECLAMA el lote: dos clics seguidos no deshacen dos
      // veces ni emiten dos eventos. Si luego el borrado falla, la
      // transaccion entera vuelve atras y el lote sigue sin deshacer.
      // Solo lotes de PRODUCTOS: uno de existencias no creo productos, y
      // marcarlo deshecho aqui dejaria sus movimientos vivos sin deshacer.
      const [lote] = await tx<{ id: string }[]>`
        update public.import_batches set undone_at = now()
        where id = ${batchId} and tenant_id = ${ctx.tenantId} and target = 'products'
          and undone_at is null
        returning id`
      if (!lote) {
        const [existe] = await tx<{ target: string }[]>`
          select target from public.import_batches
          where id = ${batchId} and tenant_id = ${ctx.tenantId}`
        if (!existe) return { estado: 'no-existe' } as const
        return existe.target === 'products'
          ? ({ estado: 'ya-deshecha' } as const)
          : ({ estado: 'otro-tipo' } as const)
      }
      // Exacto: solo lo que ESTE lote creo. Un SKU que ya existia no se
      // inserto, conserva su import_batch_id (o ninguno) y no cae aqui.
      const borrados = await tx`
        delete from public.products
        where tenant_id = ${ctx.tenantId} and import_batch_id = ${batchId}
        returning id`
      await tx`
        select public.emit_event('imports.batch.undone',
          ${JSON.stringify({ batchId, deleted: borrados.length })}::text::jsonb, 'imports')`
      return { estado: 'ok', borrados: borrados.length } as const
    })
  } catch (e) {
    // Todas las FK hacia products son sin cascada: un producto que ya
    // esta en una venta, un conteo o un escaneo no se puede borrar. Se
    // niega el lote ENTERO -deshacer es todo o nada- y se dice por que,
    // en vez de un error de servidor.
    if ((e as { code?: string }).code === '23503') {
      return {
        ok: false,
        error:
          'No se puede deshacer: algunos productos de esta importacion ya se usaron (ventas, inventario, compras...). Desactivalos desde Productos en vez de borrarlos.',
      }
    }
    throw e
  }

  if (r.estado === 'no-existe') return { ok: false, error: 'Esa importacion no existe.' }
  if (r.estado === 'ya-deshecha') return { ok: false, error: 'Esa importacion ya estaba deshecha.' }
  if (r.estado === 'otro-tipo') {
    return {
      ok: false,
      error: 'Esa importacion es de existencias: se deshace con su propio boton.',
    }
  }

  revalidatePath('/importar')
  revalidatePath('/products')
  return {
    ok: true,
    texto: `Deshicimos la importacion: borramos ${r.borrados} ${plural(r.borrados, 'producto', 'productos')}.`,
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Existencias iniciales
//
//  codigo + almacen + cantidad + costo -> un `adjustment_in` CON costo por
//  fila, que es lo que alimenta el costo promedio (trigger de 0019). La
//  misma disciplina que el CSV de productos: cada fila en un solo monton
//  -cargada, ya tenia existencia (no se pisa) o rechazada con su motivo-,
//  y deshacer exacto. Exacto aqui es el movimiento CONTRARIO: el kardex es
//  append-only y no se borra (docs/modules/inventory.md).
//
//  "Ya tenia existencia" es la regla que hace exacto el deshacer: solo se
//  carga donde el producto esta en cero en ese almacen, asi que revertir
//  lo deja en cero otra vez -y a cero el valor no depende del promedio-.
// ═══════════════════════════════════════════════════════════════════════

function resumenExistencias(cargadas: number, yaTenian: number, rechazadas: number): string {
  const partes = [
    cargadas > 0
      ? `Cargamos ${cargadas} ${plural(cargadas, 'existencia inicial', 'existencias iniciales')}.`
      : 'No cargamos ninguna existencia.',
  ]
  if (yaTenian > 0) {
    partes.push(
      `${yaTenian} ${plural(yaTenian, 'ya tenia existencia en ese almacen y la dejamos como estaba', 'ya tenian existencia en su almacen y las dejamos como estaban')}.`,
    )
  }
  if (rechazadas > 0) {
    partes.push(
      `${rechazadas} ${plural(rechazadas, 'fila rechazada', 'filas rechazadas')}: mira el detalle abajo.`,
    )
  }
  return partes.join(' ')
}

const sinAcentos = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

async function importarStock(formData: FormData): Promise<Resultado> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'imports', 'imports.create')
  if (!permiso.ok) return permiso
  // El permiso del DESTINO manda: cargar existencias es ajustar inventario.
  const pInv = exigir(ctx, 'inventory', 'inventory.adjust')
  if (!pInv.ok) return pInv

  const file = formData.get('archivo')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Elige un archivo CSV primero.' }
  }

  const text = await file.text()
  const delimitador = detectarDelimitador(text)
  const rows = parseCsv(text, delimitador)
  const headers = rows[0] ?? []
  const datos = rows.slice(1)
  const { valid, errors, rejectedRows } = validateStock(datos, headers, { delimitador })

  const r = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const almacenes = await tx<
      { id: string; name: string; code: string | null; is_default: boolean }[]
    >`
      select id, name, code, is_default from public.warehouses
      where tenant_id = ${ctx.tenantId} and is_active
      order by is_default desc, name`
    if (almacenes.length === 0) return { sinAlmacen: true } as const
    const predeterminado =
      almacenes.find((w) => w.is_default) ?? (almacenes.length === 1 ? almacenes[0]! : null)

    const [batch] = await tx<{ id: string }[]>`
      insert into public.import_batches
        (tenant_id, target, file_name, total_rows, inserted, rejected, errors, created_by)
      values (${ctx.tenantId}, 'stock', ${file.name}, ${datos.length},
              0, ${rejectedRows}, '[]'::jsonb, ${ctx.userId})
      returning id`
    if (!batch) throw new Error('No se pudo registrar la importacion.')

    let cargadas = 0
    const yaTenian: ImportError[] = []
    const rechazadasEnBase: ImportError[] = []
    const rechazar = (row: number, column: string, message: string) =>
      rechazadasEnBase.push({ row, column, message })
    /** producto|almacen -> linea que ya lo cargo en este archivo. */
    const cargadoEn = new Map<string, number>()

    for (const f of valid) {
      // ── Almacen: por codigo o nombre; vacio = el predeterminado ──────
      let almacen = predeterminado
      if (f.warehouse !== null) {
        const k = sinAcentos(f.warehouse)
        almacen =
          almacenes.find(
            (w) => (w.code !== null && sinAcentos(w.code) === k) || sinAcentos(w.name) === k,
          ) ?? null
        if (!almacen) {
          rechazar(
            f.line,
            'warehouse',
            `El almacen "${f.warehouse}" no existe o esta inactivo. Usa el nombre o el codigo de uno de estos: ${almacenes.map((w) => w.code ?? w.name).join(', ')}.`,
          )
          continue
        }
      } else if (!almacen) {
        rechazar(
          f.line,
          'warehouse',
          `Falta el almacen: hay ${almacenes.length} y ninguno es el predeterminado. Escribe su nombre o su codigo.`,
        )
        continue
      }

      // ── Producto: por SKU y, si no, por codigo de barras ─────────────
      const [p] = await tx<
        { id: string; sku: string; cost: string | null; tracks_stock: boolean }[]
      >`
        select id, sku, cost::text, tracks_stock from public.products
        where tenant_id = ${ctx.tenantId} and (sku = ${f.sku} or barcode = ${f.sku})
        order by (sku = ${f.sku}) desc
        limit 1`
      if (!p) {
        rechazar(
          f.line,
          'sku',
          `El codigo "${f.sku}" no existe en el catalogo: importalo primero en Productos.`,
        )
        continue
      }
      // El trigger de 0100 tumbaria la importacion ENTERA: se dice aqui.
      if (!p.tracks_stock) {
        rechazar(
          f.line,
          'sku',
          `${p.sku} no lleva control de existencias (es un servicio o se vende sin inventario).`,
        )
        continue
      }
      const clave = `${p.id}|${almacen.id}`
      const previa = cargadoEn.get(clave)
      if (previa !== undefined) {
        rechazar(
          f.line,
          'warehouse',
          `${p.sku} ya se carga en ${almacen.name} en la linea ${previa}: una sola linea por producto y almacen.`,
        )
        continue
      }

      // ── Costo: el de la fila o el del catalogo; sin costo, no ────────
      const costo = f.unitCost ?? (p.cost !== null ? Number(p.cost) : null)
      if (costo === null) {
        rechazar(
          f.line,
          'unitCost',
          `Falta el costo unitario y ${p.sku} no tiene costo en el catalogo: sin costo la valorizacion nace mal.`,
        )
        continue
      }
      // Mismo candado que el ajuste manual: el max_amount del rol.
      const monto = exigir(ctx, 'inventory', 'inventory.adjust', f.qty * costo)
      if (!monto.ok) {
        rechazar(f.line, 'qty', `${monto.error} Esta linea vale ${(f.qty * costo).toFixed(2)}.`)
        continue
      }

      // ── Ya tenia existencia en ese almacen: no se pisa ───────────────
      const [nivel] = await tx<{ qty: string }[]>`
        select qty_on_hand::text as qty from public.stock_levels
        where tenant_id = ${ctx.tenantId} and warehouse_id = ${almacen.id} and product_id = ${p.id}`
      if (nivel && Number(nivel.qty) !== 0) {
        yaTenian.push({
          row: f.line,
          column: 'sku',
          message: `${p.sku} ya tiene ${Number(nivel.qty)} en ${almacen.name}: la dejamos como estaba. Si hay que corregirla, usa un ajuste.`,
          kind: 'skipped',
        })
        continue
      }

      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost,
           reason, notes, reference_type, reference_id, created_by)
        values
          (${ctx.tenantId}, ${almacen.id}, ${p.id}, 'adjustment_in', ${f.qty}, ${costo},
           'Existencia inicial', ${file.name}, 'import_batch', ${batch.id}, ${ctx.userId})`
      cargadoEn.set(clave, f.line)
      cargadas++
    }

    const rechazadas = rejectedRows + rechazadasEnBase.length
    await tx`
      update public.import_batches
      set inserted = ${cargadas},
          rejected = ${rechazadas},
          errors = ${JSON.stringify([...errors, ...rechazadasEnBase, ...yaTenian])}::text::jsonb
      where id = ${batch.id}`

    const payload = {
      batchId: batch.id,
      target: 'stock',
      fileName: file.name,
      totalRows: datos.length,
      inserted: cargadas,
      skipped: yaTenian.length,
      rejected: rechazadas,
    }
    await tx`
      select public.emit_event('imports.batch.completed',
        ${JSON.stringify(payload)}::text::jsonb, 'imports')`

    return { sinAlmacen: false, cargadas, yaTenian: yaTenian.length, rechazadas } as const
  })

  if (r.sinAlmacen) {
    return {
      ok: false,
      error:
        'Todavia no hay ningun almacen activo. Crea uno en Existencias > Almacenes y vuelve a subir el archivo.',
    }
  }

  revalidatePath('/importar')
  revalidatePath('/inventory')
  revalidatePath('/inventory/movements')

  const texto = resumenExistencias(r.cargadas, r.yaTenian, r.rechazadas)
  return r.cargadas === 0 ? { ok: false, error: texto } : { ok: true, texto }
}

/** Lanzada dentro de la transaccion para revertir el reclamo del lote. */
class ExistenciasYaMovidas extends Error {}

async function deshacerStock(formData: FormData): Promise<Resultado> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const pImp = exigir(ctx, 'imports', 'imports.edit')
  if (!pImp.ok) return pImp
  const pInv = exigir(ctx, 'inventory', 'inventory.adjust')
  if (!pInv.ok) return pInv

  const batchId = String(formData.get('batchId') ?? '')
  if (!batchId) return { ok: false, error: 'Falta la importacion.' }
  if (!UUID.test(batchId)) return { ok: false, error: 'Esa importacion no existe.' }

  let r: { estado: 'no-existe' } | { estado: 'ya-deshecha' } | { estado: 'ok'; revertidas: number }
  try {
    r = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [lote] = await tx<{ id: string; created_at: Date }[]>`
        update public.import_batches set undone_at = now()
        where id = ${batchId} and tenant_id = ${ctx.tenantId} and target = 'stock'
          and undone_at is null
        returning id, created_at`
      if (!lote) {
        const [existe] = await tx`
          select 1 from public.import_batches
          where id = ${batchId} and tenant_id = ${ctx.tenantId} and target = 'stock'`
        return existe ? ({ estado: 'ya-deshecha' } as const) : ({ estado: 'no-existe' } as const)
      }

      // Si algo movio esas existencias DESPUES de cargarlas (una venta, un
      // ajuste, un traslado), revertir la carga ya no las deja en cero: se
      // niega el lote entero, como el deshacer de productos usados.
      const [movido] = await tx`
        select 1 from public.inventory_movements m
        where m.tenant_id = ${ctx.tenantId}
          and (m.warehouse_id, m.product_id) in (
            select warehouse_id, product_id from public.inventory_movements
            where tenant_id = ${ctx.tenantId} and reference_type = 'import_batch'
              and reference_id = ${batchId})
          -- "is distinct from" y no "not (... = ...)": una venta trae
          -- reference_type NULL, y con "=" el NOT daba NULL y la venta
          -- no contaba como movimiento posterior.
          and (m.reference_type is distinct from 'import_batch'
               or m.reference_id is distinct from ${batchId}::uuid)
          and m.created_at >= ${lote.created_at}
        limit 1`
      if (movido) throw new ExistenciasYaMovidas()

      const movs = await tx<{ warehouse_id: string; product_id: string; qty: string }[]>`
        select warehouse_id, product_id, qty::text from public.inventory_movements
        where tenant_id = ${ctx.tenantId} and reference_type = 'import_batch'
          and reference_id = ${batchId}`
      for (const m of movs) {
        await tx`
          insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty,
             reason, reference_type, reference_id, created_by)
          values
            (${ctx.tenantId}, ${m.warehouse_id}, ${m.product_id}, 'adjustment_out', ${-Number(m.qty)},
             'Deshacer existencia inicial', 'import_batch_undo', ${batchId}, ${ctx.userId})`
      }
      await tx`
        select public.emit_event('imports.batch.undone',
          ${JSON.stringify({ batchId, target: 'stock', reversed: movs.length })}::text::jsonb,
          'imports')`
      return { estado: 'ok', revertidas: movs.length } as const
    })
  } catch (e) {
    if (e instanceof ExistenciasYaMovidas) {
      return {
        ok: false,
        error:
          'No se puede deshacer: algunas de estas existencias ya se movieron despues de cargarlas (ventas, ajustes, traslados...). Corrigelas con un ajuste en Existencias.',
      }
    }
    throw e
  }

  if (r.estado === 'no-existe') return { ok: false, error: 'Esa importacion no existe.' }
  if (r.estado === 'ya-deshecha') return { ok: false, error: 'Esa importacion ya estaba deshecha.' }

  revalidatePath('/importar')
  revalidatePath('/inventory')
  revalidatePath('/inventory/movements')
  return {
    ok: true,
    texto: `Deshicimos la carga: ${r.revertidas} ${plural(r.revertidas, 'existencia volvio', 'existencias volvieron')} a cero con su movimiento contrario. El kardex conserva los dos.`,
  }
}

// ── Envoltorios para <form action> ──────────────────────────────────────
// El texto de exito lleva los numeros: "Listo" a secas escondia que la
// mitad del archivo ya existia.
async function avisar(r: Resultado, accion: string): Promise<void> {
  const base: ActionResult = r.ok ? { ok: true } : r
  await anotarAviso(base, accion, r.ok ? r.texto : undefined)
}
export async function importarProductos(fd: FormData): Promise<void> {
  await avisar(await importar(fd), 'importarProductos')
}
export async function deshacerImportacion(fd: FormData): Promise<void> {
  await avisar(await deshacer(fd), 'deshacerImportacion')
}
export async function importarExistencias(fd: FormData): Promise<void> {
  await avisar(await importarStock(fd), 'importarExistencias')
}
export async function deshacerExistencias(fd: FormData): Promise<void> {
  await avisar(await deshacerStock(fd), 'deshacerExistencias')
}
