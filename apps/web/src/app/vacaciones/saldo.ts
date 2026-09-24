import 'server-only'

import type { TransactionSql } from 'postgres'
import { saldoVacaciones, validarDiasDeVacaciones } from '@regb/operations'

/** Un "no" con su motivo, para enseñarlo tal cual en la pantalla. */
export class ErrorVacaciones extends Error {}

/**
 * Lo que se revisa antes de guardar o aprobar unas vacaciones (0138). Lo
 * usan RRHH en /vacaciones, el empleado en /portal y quien aprueba: el
 * mismo criterio en las tres puertas.
 *
 *  · Dos ausencias del mismo empleado no se cruzan: si se cruzan, esos
 *    dias se descontarian dos veces.
 *  · Unas vacaciones caben en el saldo. El saldo se mide a la fecha de
 *    inicio (si es futura): quien cumple un año antes de irse, ya tiene
 *    esos dias. Al PEDIR, lo pendiente cuenta como reservado; al APROBAR,
 *    solo lo aprobado.
 *
 * Devuelve el mensaje para la pantalla, o null si todo cuadra.
 */
export async function revisarVacaciones(
  tx: TransactionSql,
  tenantId: string,
  solicitud: {
    employeeId: string
    tipo: string
    inicio: string
    fin: string
    dias: number
    /** Al aprobar: la propia solicitud no se cuenta contra si misma. */
    excluirId?: string
    /** true al pedir (lo pendiente reserva dias); false al aprobar. */
    contarPendientes: boolean
    /**
     * Fecha de ingreso, si ya se tiene. El portal la pasa: el rol Empleado
     * no lee la tabla de empleados (RLS): su expediente sale de mi_expediente().
     */
    ingreso?: string
  },
): Promise<string | null> {
  const excluir = solicitud.excluirId ?? '00000000-0000-0000-0000-000000000000'

  const [cruce] = await tx<{ desde: string; hasta: string; status: string }[]>`
    select start_date::text as desde, end_date::text as hasta, status
    from public.time_off_requests
    where tenant_id = ${tenantId} and employee_id = ${solicitud.employeeId}
      and id <> ${excluir}
      and status in ('pending', 'approved')
      and daterange(start_date, end_date, '[]')
          && daterange(${solicitud.inicio}::date, ${solicitud.fin}::date, '[]')
    order by start_date
    limit 1`
  if (cruce) {
    const estado = cruce.status === 'approved' ? 'aprobada' : 'pendiente'
    const dia = (f: string) =>
      new Date(`${f}T12:00:00Z`).toLocaleDateString('es-DO', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })
    return `Ya hay una ausencia ${estado} del ${dia(cruce.desde)} al ${dia(cruce.hasta)} que se cruza con esas fechas.`
  }

  if (solicitud.tipo !== 'vacation') return null

  let ingreso = solicitud.ingreso
  if (!ingreso) {
    const [emp] = await tx<{ hire_date: string }[]>`
      select hire_date::text from public.employees
      where id = ${solicitud.employeeId} and tenant_id = ${tenantId}`
    if (!emp) return 'Ese empleado no existe.'
    ingreso = emp.hire_date
  }

  const estados = solicitud.contarPendientes ? ['approved', 'pending'] : ['approved']
  const [t] = await tx<{ dias: string }[]>`
    select coalesce(sum(business_days), 0)::text as dias
    from public.time_off_requests
    where tenant_id = ${tenantId} and employee_id = ${solicitud.employeeId}
      and id <> ${excluir}
      and leave_type = 'vacation' and status = any(${estados}::text[])`

  const hoy = new Date()
  const inicio = new Date(`${solicitud.inicio}T00:00:00`)
  const corte = inicio > hoy ? inicio : hoy
  const saldo = saldoVacaciones(
    new Date(`${ingreso.slice(0, 10)}T00:00:00`),
    corte,
    Number(t?.dias ?? 0),
  )
  return validarDiasDeVacaciones(saldo, solicitud.dias)
}
