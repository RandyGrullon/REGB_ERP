import 'server-only'

import type postgres from 'postgres'
import type { AccountType, TrialBalanceRow } from '@regb/operations'

/**
 * Consultas de lectura de contabilidad que usan mas de una pantalla (o
 * una pantalla y su prueba). Viven fuera de `page.tsx` porque Next.js
 * solo admite un juego cerrado de exportaciones en un archivo de pagina.
 */

export interface FilaBalanza extends TrialBalanceRow {
  isActive: boolean
}

/**
 * Totales por cuenta para la balanza de comprobacion: SOLO lineas de
 * asientos contabilizados.
 *
 * La version anterior (en la pagina) filtraba `e.status = 'posted'`
 * dentro de un LEFT JOIN a journal_entries: un left join no descarta la
 * linea cuando el asiento es borrador, solo deja `e` en null, y la suma
 * de `l.debit` la contaba igual. Agregar una linea a un borrador hacia
 * que la balanza dijera "no cuadra" mientras el mayor no la mostraba.
 * Ahora son joins normales: la linea entra solo si su asiento esta
 * contabilizado.
 *
 * Tampoco filtra `a.is_active`: desactivar una cuenta no borra su saldo,
 * y sacarla de la balanza la descuadraba por el monto de esa cuenta.
 */
export async function filasBalanza(
  tx: postgres.TransactionSql,
  tenantId: string,
): Promise<FilaBalanza[]> {
  const filas = await tx<
    {
      accountId: string
      accountCode: string
      accountName: string
      type: string
      is_active: boolean
      total_debit: string
      total_credit: string
    }[]
  >`
    select a.id as "accountId", a.code as "accountCode", a.name as "accountName", a.type,
           a.is_active,
           sum(l.debit)::text as total_debit,
           sum(l.credit)::text as total_credit
    from public.accounts a
    join public.journal_entry_lines l on l.account_id = a.id and l.tenant_id = a.tenant_id
    join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
    where a.tenant_id = ${tenantId}
    group by a.id, a.code, a.name, a.type, a.is_active
    order by a.code`

  return filas.map((f) => ({
    accountId: f.accountId,
    accountCode: f.accountCode,
    accountName: f.accountName,
    type: f.type as AccountType,
    isActive: f.is_active,
    totalDebit: Number(f.total_debit),
    totalCredit: Number(f.total_credit),
  }))
}
