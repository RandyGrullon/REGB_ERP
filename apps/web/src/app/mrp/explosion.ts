import 'server-only'
import type postgres from 'postgres'
import type { NodoExplosionMrp } from '@regb/operations'

/**
 * El árbol de necesidades de un producto con receta: cada componente con
 * su propia receta activa se expande (igual que el costeo multinivel de
 * Lista de materiales); el que no tiene receta es una hoja que se compra.
 *
 * Vive aparte de `actions.ts` porque lo usan la acción de correr la
 * planificación y la pantalla de detalle (para mostrar cuánto hace falta
 * en total), y un archivo 'use server' solo puede exportar acciones.
 */
export async function resolverNodoMrp(
  tx: postgres.TransactionSql,
  tenantId: string,
  productId: string,
  cantidadNecesaria: number,
  profundidad: number,
  /**
   * Solo para mostrar: si el producto planificado tiene la receta en
   * borrador (se planificó antes de activarla), usarla igual en la raíz.
   * Correr la planificación exige receta activa.
   */
  borradorEnRaiz = false,
): Promise<NodoExplosionMrp> {
  if (profundidad >= 10) return { productId, cantidadNecesaria, esComprado: true }

  const [bom] = await tx<{ id: string; output_qty: string }[]>`
    select id, output_qty::text from public.bill_of_materials
    where tenant_id = ${tenantId} and product_id = ${productId}
      and (status = 'active' or (${borradorEnRaiz && profundidad === 0} and status = 'draft'))
    order by (status = 'active') desc, version desc
    limit 1`
  if (!bom) return { productId, cantidadNecesaria, esComprado: true }

  const lineas = await tx<{ component_product_id: string; quantity_per_unit: string }[]>`
    select component_product_id, quantity_per_unit::text from public.bom_lines
    where bom_id = ${bom.id} and tenant_id = ${tenantId} and is_substitute_for is null`
  if (lineas.length === 0) return { productId, cantidadNecesaria, esComprado: true }

  const subComponentes = await Promise.all(
    lineas.map((l) =>
      resolverNodoMrp(
        tx,
        tenantId,
        l.component_product_id,
        (Number(l.quantity_per_unit) / Number(bom.output_qty)) * cantidadNecesaria,
        profundidad + 1,
      ),
    ),
  )
  return { productId, cantidadNecesaria, esComprado: false, subComponentes }
}
