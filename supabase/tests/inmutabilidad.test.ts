import { afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Lo que el repo DECLARA inmutable, que de verdad lo sea.
 *
 * ── De donde sale esta prueba ─────────────────────────────────────────
 *
 * De encontrar dos agujeros seguidos de la misma familia: `authenticated`
 * con permiso de escribir tablas que son proyecciones o libros -0106 en
 * las lineas de conteo, 0107 en `stock_levels`-. En los dos casos la RLS
 * parecia suficiente y no lo era, porque una politica decide QUE FILAS
 * se tocan, no si se pueden tocar.
 *
 * Al barrer el resto no aparecieron mas. Pero "no aparecieron mas hoy" no
 * es una garantia: la tabla numero 106 que alguien agregue el mes que
 * viene sale con los permisos por defecto, y nadie va a volver a correr
 * esta revision a mano.
 *
 * ── Como se decide que es inmutable ───────────────────────────────────
 *
 * Por el COMENTARIO de la tabla. No es una heuristica floja: en este
 * repo el comentario es donde se escribe la intencion ("Kardex
 * inmutable", "Ledger inmutable: ni se edita ni se borra"), y una
 * promesa escrita que el motor no cumple es justo lo que hay que
 * detectar. Si alguien escribe "inmutable" en un comentario, se le toma
 * la palabra.
 *
 * ── Que cuenta como protegida ─────────────────────────────────────────
 *
 * Dos formas valen, y las dos se usan en el repo:
 *
 *   1. Sin politica de RLS para update/delete y con `force row level
 *      security`. Sin politica, la orden se deniega. Es lo que hace
 *      `inventory_movements`.
 *   2. Un trigger `before update or delete` que lanza. Es lo que hace
 *      `bank_transactions`, que si necesita la politica ALL por otras
 *      razones.
 *
 * Lo que NO vale es tener politica ALL y ningun trigger: ahi la promesa
 * del comentario es falsa.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

afterAll(async () => {
  await sql.end()
})

interface Tabla {
  tabla: string
  puede_escribir: boolean
  politica_escritura: boolean
  force_rls: boolean
  trigger_guardia: boolean
}

const declaradas = () => sql<Tabla[]>`
  select c.relname as tabla,
         (has_table_privilege('authenticated', c.oid, 'UPDATE')
          or has_table_privilege('authenticated', c.oid, 'DELETE')) as puede_escribir,
         exists (
           select 1 from pg_policy p
            where p.polrelid = c.oid and p.polcmd in ('*', 'w', 'd')
         ) as politica_escritura,
         c.relforcerowsecurity as force_rls,
         exists (
           select 1 from pg_trigger t
            where t.tgrelid = c.oid
              and not t.tgisinternal
              -- tgtype: bit 0 = BEFORE, bit 4 = UPDATE, bit 3 = DELETE
              and (t.tgtype & 2) <> 0
              and ((t.tgtype & 16) <> 0 or (t.tgtype & 8) <> 0)
         ) as trigger_guardia
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and obj_description(c.oid) ilike '%inmutable%'
  order by c.relname`

describe('Toda tabla declarada inmutable esta protegida de verdad', () => {
  it('hay tablas declaradas: si esto da cero, la prueba no vigila nada', async () => {
    expect((await declaradas()).length).toBeGreaterThan(0)
  })

  it('ninguna se queda con politica de escritura y sin trigger que la frene', async () => {
    const desprotegidas = (await declaradas())
      .filter((t) => t.puede_escribir && t.politica_escritura && !t.trigger_guardia)
      .map((t) => t.tabla)

    // Si esto se cae con una tabla nueva: o le quitas la politica de
    // update/delete -y dejas que force RLS la deniegue-, o le pones un
    // trigger `before update or delete` que lance. Las dos valen; no
    // vale confiar en que la app "no la escribe".
    expect(desprotegidas).toEqual([])
  })

  it('y las que se defienden solo con la RLS tienen force row level security', async () => {
    // Sin `force`, el DUEÑO de la tabla se salta la RLS. Es justo el rol
    // con el que corren las funciones `security definer` del repo.
    const flojas = (await declaradas())
      .filter((t) => !t.politica_escritura && !t.force_rls)
      .map((t) => t.tabla)
    expect(flojas).toEqual([])
  })
})

describe('Las proyecciones no se escriben a mano', () => {
  /**
   * `stock_levels` es el caso que costo encontrar: no dice "inmutable"
   * en su comentario -no lo es, cambia todo el dia- pero tampoco se
   * escribe a mano, porque es lo que el trigger del kardex proyecta.
   *
   * Se fija aqui por nombre, y no con una regla general, porque no hay
   * forma de deducir "esto es una proyeccion" del esquema. Lo que si se
   * puede es no dejar que vuelva a abrirse.
   */
  it('a stock_levels authenticated solo puede LEER', async () => {
    const [p] = await sql<{ ins: boolean; upd: boolean; del: boolean; sel: boolean }[]>`
      select has_table_privilege('authenticated', 'public.stock_levels', 'INSERT') as ins,
             has_table_privilege('authenticated', 'public.stock_levels', 'UPDATE') as upd,
             has_table_privilege('authenticated', 'public.stock_levels', 'DELETE') as del,
             has_table_privilege('authenticated', 'public.stock_levels', 'SELECT') as sel`
    expect(p!.ins).toBe(false)
    expect(p!.upd).toBe(false)
    expect(p!.del).toBe(false)
    expect(p!.sel).toBe(true)
  })

  it('y a la foto del sistema de un conteo, tampoco', async () => {
    for (const tabla of ['stock_count_lines', 'cycle_count_lines']) {
      const [p] = await sql<{ system_qty: boolean; counted_qty: boolean }[]>`
        select has_column_privilege('authenticated', ${`public.${tabla}`}, 'system_qty', 'UPDATE') as system_qty,
               has_column_privilege('authenticated', ${`public.${tabla}`}, 'counted_qty', 'UPDATE') as counted_qty`
      expect(p!.system_qty, `${tabla}.system_qty`).toBe(false)
      // Y lo contrario tambien importa: si esto se cae, contar dejo de
      // funcionar y el arreglo rompio el trabajo normal.
      expect(p!.counted_qty, `${tabla}.counted_qty`).toBe(true)
    }
  })
})
