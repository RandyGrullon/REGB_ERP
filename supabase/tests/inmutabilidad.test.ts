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
  it('a stock_levels authenticated no escribe, y del costo ni lee', async () => {
    const [p] = await sql<{
      ins: boolean
      upd: boolean
      del: boolean
      cantidad: boolean
      costo: boolean
    }[]>`
      select has_table_privilege('authenticated', 'public.stock_levels', 'INSERT') as ins,
             has_table_privilege('authenticated', 'public.stock_levels', 'UPDATE') as upd,
             has_table_privilege('authenticated', 'public.stock_levels', 'DELETE') as del,
             has_column_privilege('authenticated', 'public.stock_levels', 'qty_on_hand', 'SELECT') as cantidad,
             has_column_privilege('authenticated', 'public.stock_levels', 'avg_cost', 'SELECT') as costo`
    expect(p!.ins).toBe(false)
    expect(p!.upd).toBe(false)
    expect(p!.del).toBe(false)
    // La CANTIDAD si se lee: un sistema que le esconde el stock al que
    // vende no se usa.
    expect(p!.cantidad).toBe(true)
    // El COSTO no, ni para el dueño. Quien tenga el permiso lo obtiene
    // por `public.existencias()`, que lo destapa segun el rol (0109).
    expect(p!.costo).toBe(false)
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

describe('Lo fiscal no se borra (0108)', () => {
  /**
   * Anular una factura es un CAMBIO DE ESTADO, no un borrado: el numero
   * queda quemado y eso es justo lo que la DGII quiere ver. Un borrado
   * de verdad deja un hueco en la 607 sin rastro de que existio.
   *
   * El contador es el caso menos obvio y el peor: borrarlo lo reinicia,
   * el sistema reemite numeros ya usados, y reusar un NCF sale en la 607.
   */
  const FISCALES = [
    'customer_invoices',
    'customer_payments',
    'ecf_emitidos',
    'ecf_recibidos',
    'customer_invoice_counters',
    'journal_entry_counters',
  ]

  it('ninguna se puede borrar desde una sesion de usuario', async () => {
    const borrables: string[] = []
    for (const t of FISCALES) {
      const [p] = await sql<{ del: boolean }[]>`
        select has_table_privilege('authenticated', ${`public.${t}`}, 'DELETE') as del`
      if (p!.del) borrables.push(t)
    }
    expect(borrables).toEqual([])
  })

  it('pero emitir y anular siguen funcionando', async () => {
    // Si esto se cae, la revocacion se paso de lista: anular es un
    // update de estado y tiene que seguir siendo posible.
    for (const t of ['customer_invoices', 'ecf_emitidos']) {
      const [p] = await sql<{ ins: boolean; upd: boolean }[]>`
        select has_table_privilege('authenticated', ${`public.${t}`}, 'INSERT') as ins,
               has_table_privilege('authenticated', ${`public.${t}`}, 'UPDATE') as upd`
      expect(p!.ins, `${t} insert`).toBe(true)
      expect(p!.upd, `${t} update`).toBe(true)
    }
  })
})

describe('La base tambien mira el permiso, no solo el modulo (0109)', () => {
  /**
   * Antes de 0109, ninguna de las 370 politicas miraba el ROL. Medido con
   * el rol Cajero del tenant de demo: leia los costos (620.00, 411.50) y
   * la tabla de empleados. Las dos cosas que la app le esconde.
   *
   * Mientras todo pasaba por la web no se notaba -el servidor comprueba
   * el permiso-. Con el movil hablandole a PostgREST, la app deja de
   * estar en el medio.
   */
  it('los patrones de SQL coinciden con los de @regb/permissions', async () => {
    // Si divergen, la base y la app opinan distinto sobre quien puede
    // que, y el que manda es el que conteste primero. Este es el riesgo
    // real de replicar logica de TypeScript en plpgsql, el mismo que ya
    // aparecio con el costo promedio en 0019.
    const casos: [string, string[]][] = [
      [
        'inventory.cost.view',
        ['inventory.cost.view', 'inventory.cost.*', 'inventory.*', '*.view', '*'],
      ],
      ['ventas', ['ventas', '*']],
      ['ar.invoice.void', ['ar.invoice.void', 'ar.invoice.*', 'ar.*', '*.void', '*']],
    ]
    for (const [accion, esperado] of casos) {
      const [r] = await sql<{ p: string[] }[]>`select rls.patrones_de(${accion}) as p`
      expect(r!.p, accion).toEqual(esperado)
    }
  })

  it('la denegacion explicita gana sobre el comodin', async () => {
    // Es la regla que mas se malinterpreta: conceder "ventas.*" y negar
    // "ventas.descuento" deja el descuento NEGADO.
    const [r] = await sql<{ permitido: boolean }[]>`
      select (
        select case
          when exists (select 1 from unnest(rls.patrones_de('ventas.descuento')) p
                       where (${JSON.stringify({ 'ventas.*': true, 'ventas.descuento': false })}::jsonb -> p) = 'false'::jsonb)
          then false
          else exists (select 1 from unnest(rls.patrones_de('ventas.descuento')) p
                       where (${JSON.stringify({ 'ventas.*': true, 'ventas.descuento': false })}::jsonb -> p) = 'true'::jsonb)
        end
      ) as permitido`
    expect(r!.permitido).toBe(false)
  })

  it('sin rol en el token, has_perm no bloquea', async () => {
    // Decision deliberada de 0109: denegar por defecto convierte un
    // despliegue con el hook a medias en "nadie puede trabajar", y eso en
    // una caja un sabado es peor que el problema que arregla.
    const [r] = await sql<{ ok: boolean }[]>`select rls.has_perm('inventory.cost.view') as ok`
    expect(r!.ok).toBe(true)
  })

  it('las cuatro superficies sensibles piden permiso en su politica', async () => {
    const esperado = [
      ['api_keys', 'api-webhooks.view'],
      ['ecf_config', 'e-invoice.view'],
      ['employees', 'employees.view'],
      ['payroll_lines', 'payroll.view'],
    ]
    for (const [tabla, perm] of esperado) {
      const [r] = await sql<{ expr: string | null }[]>`
        select pg_get_expr(polqual, polrelid) as expr
        from pg_policy
        where polrelid = ${`public.${tabla}`}::regclass and polname = 'tenant_module'`
      expect(r?.expr ?? '', tabla).toContain(perm)
    }
  })
})

