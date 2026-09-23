import type { TransactionSql } from 'postgres'

/**
 * Quien mira el portal, y sus volantes.
 *
 * Hasta 0132 esto emparejaba el correo de la cuenta (`user_profiles`) con
 * el del expediente (`employees.email`), sin unicidad: dos expedientes con
 * el mismo correo, y la demo le enseñaba a Maria Rosario el salario y el
 * volante de Rafael Encarnacion.
 *
 * Ahora no hay consulta a tablas desde aqui: se le pregunta a la base por
 * el TOKEN (`mi_expediente()`, `mis_volantes()`), que resuelve por el
 * vinculo explicito `employees.user_id` que asigna RRHH. Sin vinculo no
 * hay expediente, y la pantalla lo dice. Nunca se adivina por correo.
 */
export interface MiEmpleado {
  id: string
  code: string
  first_name: string
  last_name: string
  position: string
  department: string | null
  hire_date: string
  phone: string | null
  email: string | null
  status: string
}

export interface MiVolante {
  period_id: string
  period_start: string
  period_end: string
  pay_date: string
  paid_days: string | null
  gross_salary: string
  reimbursements: string
  tss_deduction: string
  income_tax: string
  other_deductions: string
  net_salary: string
}

/** El expediente vinculado a la cuenta de la sesion, o null. */
export async function resolverMiEmpleado(tx: TransactionSql): Promise<MiEmpleado | null> {
  const [row] = await tx<MiEmpleado[]>`
    select id, code, first_name, last_name, "position", department,
           hire_date::text, phone, email, status
    from public.mi_expediente()`
  return row ?? null
}

/** Los volantes ya procesados de la cuenta de la sesion. Nunca los de otro. */
export async function misVolantes(tx: TransactionSql, limite = 12): Promise<MiVolante[]> {
  return tx<MiVolante[]>`
    select period_id, period_start::text, period_end::text, pay_date::text, paid_days::text,
           gross_salary::text, reimbursements::text, tss_deduction::text, income_tax::text,
           other_deductions::text, net_salary::text
    from public.mis_volantes(${limite})`
}
