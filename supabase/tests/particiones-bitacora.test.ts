import { afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * La bitacora nunca se queda sin particion (0120).
 *
 * `audit.log` esta particionada por mes y las particiones solo se crean
 * en migraciones. Cuando se acaban, cada escritura auditada falla y
 * revierte su transaccion: el ERP entero deja de guardar. Paso cerca: la
 * base de pruebas llegaba solo hasta diciembre de 2026.
 *
 * Esta prueba es la alarma. Se pone roja con un ano de margen, que es
 * tiempo de sobra para correr otra migracion como la 0120.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 2, onnotice: () => {} })

afterAll(async () => {
  await sql.end()
})

const particiones = () => sql<{ nombre: string; hasta: string }[]>`
  select c.relname as nombre,
         pg_get_expr(c.relpartbound, c.oid) as hasta
  from pg_inherits i
  join pg_class c on c.oid = i.inhrelid
  join pg_class p on p.oid = i.inhparent
  join pg_namespace n on n.oid = p.relnamespace
  where n.nspname = 'audit' and p.relname = 'log'`

describe('La bitacora tiene donde escribir', () => {
  it('hay particion para el mes en curso', async () => {
    const hoy = new Date()
    const nombre = `log_${hoy.getFullYear()}_${String(hoy.getMonth() + 1).padStart(2, '0')}`
    const nombres = (await particiones()).map((p) => p.nombre)
    expect(nombres).toContain(nombre)
  })

  it('y quedan al menos 12 meses por delante', async () => {
    // Si esto se pone rojo: nueva migracion como la 0120, que llama a
    // audit.ensure_partition() para los meses que falten. No subir este
    // umbral para hacerla pasar: es justo el aviso que se quiere.
    const nombres = (await particiones()).map((p) => p.nombre)
    const hoy = new Date()
    const faltan: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
      const n = `log_${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!nombres.includes(n)) faltan.push(n)
    }
    expect(faltan).toEqual([])
  })

  it('cada particion trae su propia RLS, forzada', async () => {
    // La RLS del padre no protege una consulta dirigida a la hija: sin
    // esto, select * from audit.log_2027_03 enseñaria la bitacora de
    // todos los clientes.
    const flojas = await sql<{ relname: string }[]>`
      select c.relname
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      join pg_class p on p.oid = i.inhparent
      join pg_namespace n on n.oid = p.relnamespace
      where n.nspname = 'audit' and p.relname = 'log'
        and not (c.relrowsecurity and c.relforcerowsecurity)`
    expect(flojas.map((f) => f.relname)).toEqual([])
  })
})
