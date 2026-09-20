import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Impuestos (modulo 24) contra Postgres real.
 *
 * Cubre lo que solo se comprueba hablandole a la base:
 *
 *  1. Aislamiento normal entre clientes, y que B no pueda colar una fila
 *     con el tenant_id de A.
 *  2. Modulo apagado: cero filas, no un error raro.
 *  3. El trigger anti-tenant-ajeno POR TRIPLICADO (proveedor, regla de
 *     ITBIS, regla de ISR) y -esto es lo que el molde de la 0048 no
 *     cubre- tambien en UPDATE: reasignar una regla a la de otro cliente
 *     es una via que un trigger de solo insert no ve.
 *  4. Las restricciones de tabla, empezando por la que impide teclear 18
 *     donde va 0.18.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let proveedorA: string
let proveedorB: string
let tasaA: string
let reglaIsrA: string
let reglaIsrB: string

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function as<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

async function modulo(tenant: string, id: string, encendido: boolean) {
  await sql`
    update regb.tenant_modules set enabled = ${encendido}
    where tenant_id = ${tenant} and module_id = ${id}`
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`tax-a-${RUN}`}, 'Ferreteria Fiscal A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`tax-b-${RUN}`}, 'Distribuidora Fiscal B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'taxes', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.suppliers (tenant_id, name, tax_id)
    values (${tenantA}, 'Suplidora del Este', '131234567') returning id`
  const [pb] = await sql`
    insert into public.suppliers (tenant_id, name, tax_id)
    values (${tenantB}, 'Servicios Profesionales SRL', '130987654') returning id`
  proveedorA = pa!.id
  proveedorB = pb!.id

  const [ta] = await sql`
    insert into public.tax_rates (tenant_id, code, name, rate, is_default)
    values (${tenantA}, 'ITBIS-18', 'ITBIS general 18%', 0.18, true) returning id`
  tasaA = ta!.id
  await sql`
    insert into public.tax_rates (tenant_id, code, name, rate, is_default)
    values (${tenantB}, 'ITBIS-18', 'ITBIS general 18%', 0.18, true)`

  const [ra] = await sql`
    insert into public.tax_withholding_rules
      (tenant_id, code, name, tax, party_type, base, rate, dgii_isr_type)
    values (${tenantA}, 'ISR-HON', 'ISR honorarios 10%', 'isr', 'fisica', 'subtotal', 0.10, '02')
    returning id`
  const [rb] = await sql`
    insert into public.tax_withholding_rules
      (tenant_id, code, name, tax, party_type, base, rate, dgii_isr_type)
    values (${tenantB}, 'ISR-HON', 'ISR honorarios 10%', 'isr', 'fisica', 'subtotal', 0.10, '02')
    returning id`
  reglaIsrA = ra!.id
  reglaIsrB = rb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.supplier_tax_profiles where tenant_id in ${sql(ts)}`
  await sql`delete from public.tax_filings where tenant_id in ${sql(ts)}`
  await sql`delete from public.tax_withholding_rules where tenant_id in ${sql(ts)}`
  await sql`delete from public.tax_rates where tenant_id in ${sql(ts)}`
  await sql`delete from public.suppliers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia tasa normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.tax_rates`,
    )
    expect(filas.map((f) => f.id)).toEqual([tasaA])
  })

  it('B no ve las tasas de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.tax_rates where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no ve las reglas de retencion de A', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.tax_withholding_rules`,
    )
    expect(filas.map((f) => f.id)).toEqual([reglaIsrB])
  })

  it('B no puede escribir una tasa con el tenant_id de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.tax_rates (tenant_id, code, name, rate)
          values (${tenantA}, 'COLADA', 'Tasa ajena', 0.18)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('B no puede escribir una declaracion, ni suya ni con el tenant_id de A', async () => {
    // Antes esto lo frenaba la RLS y solo para el tenant ajeno. Desde que
    // el INSERT esta revocado lo frena el PRIVILEGIO, que es mas fuerte:
    // no hay fila que escribir, de nadie. Ver el describe del final.
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.tax_filings (tenant_id, form, period, due_date)
          values (${tenantA}, 'IT-1', '202609', '2026-10-20')`,
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('y por la funcion, el tenant sale del token: no se puede apuntar al ajeno', async () => {
    // La funcion no recibe tenant_id. Aunque B quisiera declararle a A,
    // lo unico que puede hacer es declararse a si mismo.
    const id = await as(userB, tenantB, async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        select public.registrar_declaracion(
          'IR-17', '202512', '2026-01-15'::date, 0, 0, 0, 0, 0, 0, 0, null, null) as id`
      return r!.id
    })
    const [f] = await sql<{ tenant_id: string }[]>`
      select tenant_id::text from public.tax_filings where id = ${id}`
    expect(f!.tenant_id).toBe(tenantB)
  })

  it('B trabaja normalmente en lo suyo: aislar no rompe lo propio', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        select public.registrar_declaracion(
          'IT-1', '202609', '2026-10-20'::date, 5000, 3000, 0, 0, 0, 2000, 0, null, null)`,
    )
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ period: string }[]>`select period from public.tax_filings where form = 'IT-1'`,
    )
    expect(filas.map((f) => f.period)).toEqual(['202609'])
  })
})

describe('El agujero de siempre, por triplicado', () => {
  it('B no puede darle perfil fiscal a un proveedor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.supplier_tax_profiles (tenant_id, supplier_id, party_type)
          values (${tenantB}, ${proveedorA}, 'fisica')`,
      ),
    ).rejects.toThrow(/proveedor no pertenece a ese cliente/)
  })

  it('B no puede asignarle a su proveedor una regla de retencion de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.supplier_tax_profiles
            (tenant_id, supplier_id, party_type, isr_rule_id)
          values (${tenantB}, ${proveedorB}, 'fisica', ${reglaIsrA})`,
      ),
    ).rejects.toThrow(/regla de retencion no pertenece a ese cliente/)
  })

  it('B asigna su propio perfil con su propia regla sin problema', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.supplier_tax_profiles
          (tenant_id, supplier_id, party_type, isr_rule_id)
        values (${tenantB}, ${proveedorB}, 'fisica', ${reglaIsrB})`,
    )
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.supplier_tax_profiles`,
    )
    expect(filas).toHaveLength(1)
  })

  it('el UPDATE tampoco cuela una regla ajena -lo que el trigger de solo insert no veria-', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          update public.supplier_tax_profiles
          set isr_rule_id = ${reglaIsrA}
          where supplier_id = ${proveedorB}`,
      ),
    ).rejects.toThrow(/regla de retencion no pertenece a ese cliente/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantA, 'taxes', true))

  it('sin el modulo, las tasas dan cero filas', async () => {
    await modulo(tenantA, 'taxes', false)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.tax_rates`,
    )
    expect(filas).toHaveLength(0)
  })

  it('sin el modulo, tampoco se puede escribir una regla', async () => {
    await modulo(tenantA, 'taxes', false)
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.tax_withholding_rules
            (tenant_id, code, name, tax, party_type, base, rate)
          values (${tenantA}, 'ITBIS-30', 'ITBIS 30%', 'itbis', 'juridica', 'itbis', 0.30)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('El IT-1 declara operaciones; el 607 declara comprobantes', () => {
  /**
   * La aritmetica de /impuestos/liquidacion depende de que estas dos
   * sumas NO se solapen: lo cobrado del IT-1 es el total del 607 MAS el
   * ITBIS de las ventas sin NCF. Si alguien cambia `dgii_607` para que
   * incluya las ventas sin comprobante, el IT-1 pasaria a contarlas dos
   * veces; esta prueba se cae primero.
   */
  let clienteA: string

  beforeAll(async () => {
    const [c] = await sql`
      insert into public.customers (tenant_id, name)
      values (${tenantA}, 'Cliente de mostrador') returning id`
    clienteA = c!.id
    await sql`
      insert into public.customer_invoices
        (tenant_id, number, customer_id, issue_date, due_date, subtotal, tax, total, ncf, ncf_type)
      values (${tenantA}, ${`F-CON-${RUN}`}, ${clienteA}, '2026-01-15', '2026-01-15',
              10000, 1800, 11800, ${`B01${RUN}`}, 'B01')`
    await sql`
      insert into public.customer_invoices
        (tenant_id, number, customer_id, issue_date, due_date, subtotal, tax, total)
      values (${tenantA}, ${`F-SIN-${RUN}`}, ${clienteA}, '2026-01-20', '2026-01-20',
              5000, 900, 5900)`
  })

  afterAll(async () => {
    await sql`delete from public.customer_invoices where tenant_id = ${tenantA}`
    await sql`delete from public.customers where id = ${clienteA}`
  })

  it('el 607 deja fuera la venta sin NCF: por eso no sirve solo como fuente del IT-1', async () => {
    const [v] = await sql<{ t: string }[]>`
      select coalesce(sum(itbis_facturado), 0)::text as t
      from public.dgii_607
      where tenant_id = ${tenantA} and periodo = '202601'`
    expect(Number(v!.t)).toBe(1800)
  })

  it('y la suma que agrega la liquidacion trae justo esa, sin repetir la del 607', async () => {
    // El POS deja vender sin NCF a proposito -un colmado que recien abre
    // vende antes de que la DGII le autorice el primer rango-, y ese
    // ITBIS se le cobro al cliente igual.
    const [q] = await sql<{ t: string }[]>`
      select coalesce(sum(t), 0)::text as t
      from (
        select coalesce(sum(i.tax), 0) as t
        from public.customer_invoices i
        where i.tenant_id = ${tenantA} and i.ncf is null and i.status <> 'void'
          and to_char(i.issue_date, 'YYYYMM') = '202601'
        union all
        select coalesce(sum(s.tax), 0)
        from public.pos_sales s
        where s.tenant_id = ${tenantA} and s.ncf is null and not s.voided
          and to_char(s.created_at, 'YYYYMM') = '202601'
      ) q`
    expect(Number(q!.t)).toBe(900)
  })
})

describe('La declaracion presentada no se reescribe ni se borra', () => {
  /**
   * Las dos peticiones que se colaban, las dos con `set local role
   * authenticated` y un claim de tenant -o sea, la sesion del movil
   * hablando por PostgREST-:
   *
   *   DELETE /rest/v1/tax_filings?form=eq.IT-1&period=eq.202601
   *   PATCH  /rest/v1/tax_filings?...  {"credit_forward": 500000}
   *
   * Ninguna pedia `taxes.filing.close`: la politica solo mira tenant y
   * modulo, asi que cualquier rol del cliente las mandaba. El PATCH es el
   * peor porque mueve dinero en silencio -el previous_credit del periodo
   * siguiente sale de ahi-, y el DELETE reabre un periodo cerrado.
   */
  let filingA: string

  beforeAll(async () => {
    const [f] = await sql`
      insert into public.tax_filings
        (tenant_id, form, period, due_date, status, itbis_charged, amount_due, filed_at)
      values (${tenantA}, 'IT-1', '202601', '2026-02-20', 'filed', 10000, 10000, now())
      returning id`
    filingA = f!.id
  })

  it('authenticated no tiene el permiso de borrar, igual que en la 0108', async () => {
    const [p] = await sql<{ del: boolean }[]>`
      select has_table_privilege('authenticated', 'public.tax_filings', 'DELETE') as del`
    expect(p!.del).toBe(false)
  })

  it('el DELETE del movil rebota: borrarla reabriria el periodo', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`delete from public.tax_filings where id = ${filingA}`),
    ).rejects.toThrow(/permission denied/)
  })

  it('reescribir el saldo a favor rebota: es lo que declara de menos al mes siguiente', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          update public.tax_filings
          set itbis_charged = 0, amount_due = 0, credit_forward = 500000
          where id = ${filingA}`,
      ),
    ).rejects.toThrow(/no se reescribe/)
  })

  it('tampoco se le cambia el periodo ni la fecha de presentacion', async () => {
    for (const cambiar of [
      sql`update public.tax_filings set period = '202602' where id = ${filingA}`,
      sql`update public.tax_filings set filed_at = now() - interval '1 year' where id = ${filingA}`,
    ]) {
      await expect(cambiar).rejects.toThrow(/no se reescribe/)
    }
  })

  it('ni siquiera el dueño de la base la reescribe: el trigger no mira el rol', async () => {
    // Las funciones `security definer` del repo corren como dueño. Si el
    // candado dependiera de la RLS, ese seria el camino de vuelta.
    await expect(
      sql`update public.tax_filings set amount_due = 1 where id = ${filingA}`,
    ).rejects.toThrow(/no se reescribe/)
  })

  it('pero marcarla pagada sigue funcionando: es un update legitimo', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        update public.tax_filings
        set status = 'paid', receipt_number = 'OV-123', notes = 'pagada por la Oficina Virtual'
        where id = ${filingA}`,
    )
    const [f] = await sql<{ status: string; receipt_number: string }[]>`
      select status, receipt_number from public.tax_filings where id = ${filingA}`
    expect(f!.status).toBe('paid')
    expect(f!.receipt_number).toBe('OV-123')
  })

  it('y una vez pagada no vuelve a presentada ni a pendiente', async () => {
    for (const estado of ['filed', 'pending']) {
      await expect(
        sql`update public.tax_filings set status = ${estado} where id = ${filingA}`,
      ).rejects.toThrow(/no vuelve atras/)
    }
  })

  it('una pendiente si se puede completar: todavia no se declaro nada', async () => {
    // El contrapeso. Si esto se cae, el candado se paso de listo y cerrar
    // una declaracion sembrada dejaria de ser posible.
    const [p] = await sql`
      insert into public.tax_filings (tenant_id, form, period, due_date)
      values (${tenantA}, 'IT-1', '202512', '2026-01-20') returning id`
    await sql`
      update public.tax_filings
      set status = 'filed', itbis_charged = 5000, amount_due = 5000, filed_at = now()
      where id = ${p!.id}`
    const [f] = await sql<{ status: string }[]>`
      select status from public.tax_filings where id = ${p!.id}`
    expect(f!.status).toBe('filed')
  })

  it('la tabla lo DICE en su comentario, para que la prueba de inmutabilidad la adopte sola', async () => {
    const [c] = await sql<{ dice: boolean }[]>`
      select obj_description('public.tax_filings'::regclass) ilike '%inmutable%' as dice`
    expect(c!.dice).toBe(true)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una tasa en puntos (18) y no en fraccion (0.18) se rechaza: ahi esta el cobro de 1800%', async () => {
    await expect(
      sql`
        insert into public.tax_rates (tenant_id, code, name, rate)
        values (${tenantB}, 'MAL', 'Dieciocho por ciento mal escrito', 18)`,
    ).rejects.toThrow(/violates check constraint|numeric field overflow/)
  })

  it('el mismo codigo de tasa no se repite para el mismo cliente', async () => {
    await expect(
      sql`
        insert into public.tax_rates (tenant_id, code, name, rate)
        values (${tenantB}, 'ITBIS-18', 'Duplicada', 0.18)`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('no puede haber dos tasas por defecto activas del mismo tipo', async () => {
    await expect(
      sql`
        insert into public.tax_rates (tenant_id, code, name, rate, is_default)
        values (${tenantB}, 'ITBIS-16', 'ITBIS reducido', 0.16, true)`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('una regla de ISR sin codigo DGII se rechaza: sin ese codigo el 606 rebota', async () => {
    await expect(
      sql`
        insert into public.tax_withholding_rules
          (tenant_id, code, name, tax, party_type, base, rate)
        values (${tenantB}, 'ISR-SIN', 'ISR sin codigo', 'isr', 'fisica', 'subtotal', 0.10)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una regla de ITBIS sobre el subtotal se rechaza: la base del ITBIS es el ITBIS', async () => {
    await expect(
      sql`
        insert into public.tax_withholding_rules
          (tenant_id, code, name, tax, party_type, base, rate)
        values (${tenantB}, 'ITBIS-MAL', 'ITBIS sobre subtotal', 'itbis', 'juridica', 'subtotal', 0.30)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('y la otra direccion tambien: un ISR sobre el ITBIS no entra', async () => {
    // El check cubria una sola direccion, asi que esta pasaba y quedaba
    // guardada. calcularRetenciones() respeta `base` sin cuestionarla, o
    // sea que esa regla calcularia el ISR sobre el ITBIS: el mismo error
    // de seis veces, al reves y hacia abajo, que es el que nadie reclama.
    await expect(
      sql`
        insert into public.tax_withholding_rules
          (tenant_id, code, name, tax, party_type, base, rate, dgii_isr_type)
        values (${tenantB}, 'ISR-MAL', 'ISR sobre el ITBIS', 'isr', 'fisica', 'itbis', 0.10, '02')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la ranura de ITBIS no acepta una regla de ISR, aunque sea del mismo cliente', async () => {
    // Las dos FK van a la misma tabla, asi que nada lo impedia. Una regla
    // de ISR alojada en la ranura de ITBIS la volveria candidata de ISR
    // dos veces y podria desplazar a la asignada de verdad.
    await expect(
      sql`
        insert into public.supplier_tax_profiles
          (tenant_id, supplier_id, party_type, itbis_rule_id)
        values (${tenantA}, ${proveedorA}, 'fisica', ${reglaIsrA})`,
    ).rejects.toThrow(/no es una regla de ITBIS/)
  })

  it('un codigo de retencion de ISR fuera del 01-09 se rechaza', async () => {
    await expect(
      sql`
        insert into public.tax_withholding_rules
          (tenant_id, code, name, tax, party_type, base, rate, dgii_isr_type)
        values (${tenantB}, 'ISR-99', 'Codigo inventado', 'isr', 'fisica', 'subtotal', 0.10, '99')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un proveedor exento con regla asignada se rechaza: es una contradiccion que cuesta dinero', async () => {
    await expect(
      sql`
        insert into public.supplier_tax_profiles
          (tenant_id, supplier_id, party_type, is_exempt, isr_rule_id)
        values (${tenantA}, ${proveedorA}, 'juridica', true, ${reglaIsrA})`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un proveedor no puede tener dos perfiles fiscales', async () => {
    await expect(
      sql`
        insert into public.supplier_tax_profiles (tenant_id, supplier_id, party_type)
        values (${tenantB}, ${proveedorB}, 'juridica')`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('un periodo que no sea YYYYMM se rechaza', async () => {
    await expect(
      sql`
        insert into public.tax_filings (tenant_id, form, period, due_date)
        values (${tenantB}, '606', '2026-09', '2026-10-15')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('no se puede deber y tener saldo a favor a la vez', async () => {
    await expect(
      sql`
        insert into public.tax_filings
          (tenant_id, form, period, due_date, amount_due, credit_forward)
        values (${tenantB}, 'IT-1', '202608', '2026-09-21', 100, 50)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una declaracion marcada como presentada sin fecha de presentacion se rechaza', async () => {
    await expect(
      sql`
        insert into public.tax_filings (tenant_id, form, period, due_date, status)
        values (${tenantB}, 'IT-1', '202607', '2026-08-20', 'filed')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo formulario y periodo no se declara dos veces', async () => {
    // Por la funcion, que es la unica puerta. La restriccion sigue siendo
    // de la tabla: la funcion no la comprueba, deja que la base hable.
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          select public.registrar_declaracion(
            'IT-1', '202609', '2026-10-20'::date, 0, 0, 0, 0, 0, 0, 0, null, null)`,
      ),
    ).rejects.toThrow(/duplicate key/)
  })
})

describe('Y el INSERT, que era la puerta que quedaba abierta', () => {
  /**
   * Cerrar el update y el delete sin cerrar el insert no protege nada:
   * deja FABRICAR.
   *
   * Esta era la peticion que se colaba, con `set local role
   * authenticated` y un claim cualquiera, sin pedir taxes.filing.close:
   *
   *   POST /rest/v1/tax_filings
   *   {"form":"IT-1","period":"202501","status":"filed",
   *    "credit_forward":500000,"filed_at":"..."}
   *
   * Y el arreglo de inmutabilidad la volvia PEOR: el trigger congelaba la
   * mentira, la fila inventada satisfacia la guarda de cadena -no hay
   * hueco que detectar-, la app ya decia "duplicada" para el periodo
   * real, y ni el dueño de la base podia corregirla.
   */
  const conRol = (userId: string, tenantId: string, roleId: string) =>
    JSON.stringify({
      sub: userId,
      app_metadata: { tenant_id: tenantId, role_id: roleId, is_provider: false },
    })

  const comoRol = <T,>(
    userId: string,
    tenantId: string,
    roleId: string,
    fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${conRol(userId, tenantId, roleId)}, true)`
      await tx.unsafe('set local role authenticated')
      return fn(tx)
    }) as Promise<T>

  let puede: string
  let noPuede: string

  beforeAll(async () => {
    // `::text::jsonb` y no `::jsonb`: con el cast simple postgres.js
    // re-serializa y la columna guarda un jsonb de tipo *string*, con lo
    // que el rol parece no tener ningun permiso y la prueba pasaria por
    // la razon equivocada.
    const rol = async (permisos: string) => {
      const [r] = await sql`
        insert into public.roles (tenant_id, name, visible_modules, permissions, scope)
        values (${tenantA}, ${`R-${permisos.length}-${Math.trunc(1)}-${crypto.randomUUID().slice(0, 6)}`},
                '{*}', ${permisos}::text::jsonb, '{}'::jsonb)
        returning id`
      return r!.id as string
    }
    puede = await rol('{"taxes.filing.close": true}')
    noPuede = await rol('{"taxes.view": true}')
  })

  afterAll(async () => {
    await sql`delete from public.tax_filings where tenant_id = ${tenantA} and period in ('202401','202402','202403')`
    await sql`delete from public.roles where id in (${puede}, ${noPuede})`
  })

  it('el privilegio de INSERT ya no lo tiene authenticated', async () => {
    const [p] = await sql<{ ins: boolean }[]>`
      select has_table_privilege('authenticated', 'public.tax_filings', 'INSERT') as ins`
    expect(p!.ins).toBe(false)
  })

  it('la declaracion fabricada con saldo a favor inventado rebota', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.tax_filings
            (tenant_id, form, period, due_date, status, itbis_charged, amount_due,
             credit_forward, filed_at)
          values (${tenantA}, 'IT-1', '202401', '2024-02-20', 'filed', 0, 0, 500000, now())`,
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('por la funcion, con el permiso, si se puede', async () => {
    const id = await comoRol(userA, tenantA, puede, async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        select public.registrar_declaracion(
          'IT-1', '202402', '2024-03-20'::date, 1000, 400, 0, 0, 0, 600, 0, 'REC-1', null
        ) as id`
      return r!.id
    })
    const [f] = await sql<{ amount_due: string; filed_by: string }[]>`
      select amount_due::text, filed_by::text from public.tax_filings where id = ${id}`
    expect(Number(f!.amount_due)).toBe(600)
    // Y QUIEN la presento sale del token, no de un parametro.
    expect(f!.filed_by).toBe(userA)
  })

  it('sin el permiso de cerrar, la funcion tampoco deja', async () => {
    // Esto es lo que la politica de RLS no miraba nunca: solo tenant y
    // modulo. Un cajero cerraba declaraciones.
    await expect(
      comoRol(
        userA,
        tenantA,
        noPuede,
        (tx) => tx`
          select public.registrar_declaracion(
            'IT-1', '202403', '2024-04-20'::date, 1000, 400, 0, 0, 0, 600, 0, null, null)`,
      ),
    ).rejects.toThrow(/permite/i)
  })

  it('y no acepta deber y tener saldo a favor a la vez', async () => {
    await expect(
      comoRol(
        userA,
        tenantA,
        puede,
        (tx) => tx`
          select public.registrar_declaracion(
            'IT-1', '202403', '2024-04-20'::date, 1000, 0, 0, 0, 0, 600, 300, null, null)`,
      ),
    ).rejects.toThrow(/saldo a favor a la vez/i)
  })
})
