import type { TransactionSql } from 'postgres'

/**
 * Resuelve el expediente de empleado de quien esta mirando, por correo.
 *
 * Este esquema no tiene un `employees.user_id` formal: se compara el
 * correo de `public.user_profiles` (el login) contra `public.employees.email`
 * (el expediente de RRHH), ambos del mismo tenant. Si no coinciden -o el
 * expediente nunca tuvo correo cargado- no hay a quien mostrar, y eso se
 * dice explicitamente en la pantalla en vez de fallar en silencio.
 */
export interface MiEmpleado {
  id: string
  code: string
  first_name: string
  last_name: string
  position: string
  department: string | null
  hire_date: string
  salary: string
  phone: string | null
  email: string | null
}

export async function resolverMiEmpleado(
  tx: TransactionSql,
  tenantId: string,
  userId: string,
): Promise<MiEmpleado | null> {
  const [row] = await tx<MiEmpleado[]>`
    select e.id, e.code, e.first_name, e.last_name, e.position, e.department,
           e.hire_date::text, e.salary::text, e.phone, e.email
    from public.employees e
    join public.user_profiles up on up.email = e.email and up.tenant_id = e.tenant_id
    where e.tenant_id = ${tenantId} and up.user_id = ${userId} and e.status = 'active'
    limit 1`
  return row ?? null
}
