import 'server-only'

import { db } from './db'

/**
 * Consultas transversales de REGB Control: lo que ve el dueno del negocio.
 *
 * Se consulta con `db()` —dueno de las tablas, sin RLS— y eso aqui es
 * CORRECTO y deliberado: este es el unico rincon de la app que opera por
 * encima de los tenants (§7). La barrera es `requireProvider()` en cada
 * page, no la RLS.
 *
 * Regla de esta pantalla: nada se oculta. Si aparece una tabla nueva en la
 * base, tiene que aparecer sola en el panel — por eso el inventario se
 * saca del catalogo de Postgres y no de una lista escrita a mano, que es
 * justo lo que se queda viejo y esconde cosas.
 */

export interface TablaConTenant {
  tabla: string
  filas: number
}

/** Filas por tabla y por cliente. La fila es `${tabla}::${tenantId}`. */
export interface InventarioDatos {
  tablas: string[]
  porTenant: Map<string, Map<string, number>>
  totalPorTabla: Map<string, number>
  bytesPorTenant: Map<string, number>
  auditPorTenant: Map<string, number>
}

/**
 * Descubre las tablas de `public` que tienen `tenant_id`.
 *
 * Del catalogo, no de una constante: una tabla que se anada manana
 * aparece sola. Una lista escrita a mano es exactamente el mecanismo por
 * el que un dato acaba invisible en un panel que promete ensenarlo todo.
 */
async function tablasDeTenant(): Promise<string[]> {
  const sql = db()
  const filas = await sql<{ table_name: string }[]>`
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
    order by c.table_name`
  return filas.map((f) => f.table_name)
}

export async function cargarInventarioDatos(): Promise<InventarioDatos> {
  const sql = db()
  const tablas = await tablasDeTenant()

  // Un solo viaje para las 30+ tablas. Los nombres NO vienen del usuario:
  // salen de information_schema filtrado por esquema, asi que el `unsafe`
  // no abre ninguna puerta. Hacerlo con una consulta por tabla serian 30
  // idas y vueltas en la pantalla que mas datos mueve del panel.
  const union = tablas
    .map(
      (t) => `select '${t}'::text as tabla, tenant_id::text as tid, count(*)::int as filas
                 from public.${t} group by tenant_id`,
    )
    .join(' union all ')

  const conteos =
    tablas.length > 0
      ? await sql.unsafe<{ tabla: string; tid: string; filas: number }[]>(union)
      : []

  const porTenant = new Map<string, Map<string, number>>()
  const totalPorTabla = new Map<string, number>()
  for (const c of conteos) {
    const deTenant = porTenant.get(c.tid) ?? new Map<string, number>()
    deTenant.set(c.tabla, c.filas)
    porTenant.set(c.tid, deTenant)
    totalPorTabla.set(c.tabla, (totalPorTabla.get(c.tabla) ?? 0) + c.filas)
  }

  // Storage real: el dato existe en files.size_bytes aunque usage_meters
  // siga vacia. Mejor sumarlo aqui que ensenar un cero que no es cierto.
  const bytes = await sql<{ tid: string; total: string }[]>`
    select tenant_id::text as tid, coalesce(sum(size_bytes), 0)::text as total
    from public.files group by tenant_id`
  const bytesPorTenant = new Map(bytes.map((b) => [b.tid, Number(b.total)]))

  const audit = await sql<{ tid: string; n: string }[]>`
    select tenant_id::text as tid, count(*)::text as n
    from audit.log group by tenant_id`
  const auditPorTenant = new Map(audit.map((a) => [a.tid, Number(a.n)]))

  return { tablas, porTenant, totalPorTabla, bytesPorTenant, auditPorTenant }
}

// ── Bitacora global ──────────────────────────────────────────────────────

export interface FilaBitacora {
  at: string
  tenant: string | null
  tenantSlug: string | null
  modulo: string | null
  entidad: string
  entidadId: string | null
  accion: string
  usuario: string | null
  antes: unknown
  despues: unknown
}

export interface FiltrosBitacora {
  tenant?: string
  modulo?: string
  entidad?: string
  accion?: string
  desde?: string
  limite?: number
}

export async function cargarBitacoraGlobal(f: FiltrosBitacora): Promise<{
  filas: FilaBitacora[]
  total: number
  modulos: string[]
  entidades: string[]
  acciones: string[]
}> {
  const sql = db()
  const limite = Math.min(f.limite ?? 200, 1000)

  const filas = await sql<FilaBitacora[]>`
    select l.at::text, t.legal_name as tenant, t.slug as "tenantSlug",
           l.module_id as modulo, l.entity as entidad, l.entity_id::text as "entidadId",
           l.action as accion, coalesce(up.display_name, l.user_id::text) as usuario,
           l.before as antes, l.after as despues
    from audit.log l
    left join regb.tenants t on t.id = l.tenant_id
    left join public.user_profiles up
      on up.tenant_id = l.tenant_id and up.user_id = l.user_id
    where (${f.tenant ?? null}::text is null or t.slug = ${f.tenant ?? null})
      and (${f.modulo ?? null}::text is null or l.module_id = ${f.modulo ?? null})
      and (${f.entidad ?? null}::text is null or l.entity = ${f.entidad ?? null})
      and (${f.accion ?? null}::text is null or l.action = ${f.accion ?? null})
      and (${f.desde ?? null}::text is null or l.at >= (${f.desde ?? null})::timestamptz)
    order by l.at desc
    limit ${limite}`

  // El conteo va aparte del listado: sin esto no se sabe si lo que se ve
  // son todos los movimientos o solo los primeros del tope.
  const [tot] = await sql<{ n: string }[]>`
    select count(*)::text as n
    from audit.log l
    left join regb.tenants t on t.id = l.tenant_id
    where (${f.tenant ?? null}::text is null or t.slug = ${f.tenant ?? null})
      and (${f.modulo ?? null}::text is null or l.module_id = ${f.modulo ?? null})
      and (${f.entidad ?? null}::text is null or l.entity = ${f.entidad ?? null})
      and (${f.accion ?? null}::text is null or l.action = ${f.accion ?? null})
      and (${f.desde ?? null}::text is null or l.at >= (${f.desde ?? null})::timestamptz)`

  const [mods, ents, accs] = await Promise.all([
    sql<
      { v: string }[]
    >`select distinct module_id as v from audit.log where module_id is not null order by 1`,
    sql<{ v: string }[]>`select distinct entity as v from audit.log order by 1`,
    sql<{ v: string }[]>`select distinct action as v from audit.log order by 1`,
  ])

  return {
    filas,
    total: Number(tot?.n ?? 0),
    modulos: mods.map((m) => m.v),
    entidades: ents.map((e) => e.v),
    acciones: accs.map((a) => a.v),
  }
}

// ── Salud de la operacion ────────────────────────────────────────────────

export interface Salud {
  eventos: { pendientes: number; fallidos: number; muertos: number }
  ultimosErrores: {
    tenant: string | null
    topic: string
    error: string
    intentos: number
    at: string
  }[]
  respaldos: { tenant: string; slug: string; ultimo: string | null; total: number }[]
  ncfEnRiesgo: {
    tenant: string
    slug: string
    tipo: string
    restantes: number
    vence: string
    motivo: 'agotada' | 'vencida' | 'por agotarse'
  }[]
  facturasProveedor: { vencidas: number; montoVencido: number; porCobrar: number }
  impersonacionesAbiertas: { tenant: string; usuario: string; razon: string; desde: string }[]
}

export async function cargarSalud(): Promise<Salud> {
  const sql = db()

  const [ev] = await sql<{ pend: string; fall: string; muertos: string }[]>`
    select
      count(*) filter (where dead_lettered_at is null and processed_at is null)::text as pend,
      count(*) filter (where dead_lettered_at is null and processed_at is null and attempts > 0)::text as fall,
      count(*) filter (where dead_lettered_at is not null)::text as muertos
    from public.event_outbox`

  const ultimosErrores = await sql<
    { tenant: string | null; topic: string; error: string; intentos: number; at: string }[]
  >`
    select t.legal_name as tenant, e.type as topic, e.last_error as error,
           e.attempts as intentos, e.emitted_at::text as at
    from public.event_outbox e
    left join regb.tenants t on t.id = e.tenant_id
    where e.last_error is not null
    order by e.emitted_at desc
    limit 10`

  const respaldos = await sql<
    { tenant: string; slug: string; ultimo: string | null; total: number }[]
  >`
    select t.legal_name as tenant, t.slug,
           max(b.created_at)::text as ultimo,
           count(b.id)::int as total
    from regb.tenants t
    left join public.backups b on b.tenant_id = t.id
    where t.status <> 'archived'
    group by t.legal_name, t.slug
    order by max(b.created_at) asc nulls first`

  // NCF en riesgo de TODOS los clientes a la vez. Un cliente que se queda
  // sin comprobantes no puede facturar, y pedirle un rango nuevo a la DGII
  // toma dias: verlo antes de que pase es la diferencia entre una llamada
  // de cortesia y una de reclamo.
  const ncf = await sql<
    { tenant: string; slug: string; tipo: string; restantes: number; vence: string }[]
  >`
    select t.legal_name as tenant, t.slug, s.ncf_type as tipo,
           (s.range_to - s.next_number + 1) as restantes,
           s.expires_on::text as vence
    from public.ncf_sequences s
    join regb.tenants t on t.id = s.tenant_id
    where s.is_active
      and (s.next_number > s.range_to
           or s.expires_on < current_date
           or (s.range_to - s.next_number + 1) <= 50)
    order by (s.range_to - s.next_number + 1)`

  const ncfEnRiesgo = ncf.map((n) => ({
    ...n,
    restantes: Math.max(0, n.restantes),
    motivo:
      n.restantes <= 0
        ? ('agotada' as const)
        : new Date(`${n.vence}T12:00:00`) < new Date()
          ? ('vencida' as const)
          : ('por agotarse' as const),
  }))

  const [fp] = await sql<{ vencidas: string; monto: string; porcobrar: string }[]>`
    select count(*) filter (where status = 'overdue')::text as vencidas,
           coalesce(sum(total) filter (where status = 'overdue'), 0)::text as monto,
           coalesce(sum(total) filter (where status in ('sent', 'overdue')), 0)::text as porcobrar
    from regb.invoices`

  const impersonacionesAbiertas = await sql<
    { tenant: string; usuario: string; razon: string; desde: string }[]
  >`
    select t.legal_name as tenant, coalesce(p.full_name, i.provider_user::text) as usuario,
           i.reason as razon, i.started_at::text as desde
    from regb.impersonation_log i
    join regb.tenants t on t.id = i.tenant_id
    left join regb.provider_users p on p.user_id = i.provider_user
    where i.ended_at is null
    order by i.started_at`

  return {
    eventos: {
      pendientes: Number(ev?.pend ?? 0),
      fallidos: Number(ev?.fall ?? 0),
      muertos: Number(ev?.muertos ?? 0),
    },
    ultimosErrores,
    respaldos,
    ncfEnRiesgo,
    facturasProveedor: {
      vencidas: Number(fp?.vencidas ?? 0),
      montoVencido: Number(fp?.monto ?? 0),
      porCobrar: Number(fp?.porcobrar ?? 0),
    },
    impersonacionesAbiertas,
  }
}

// ── Solicitudes de activacion ────────────────────────────────────────────

export interface SolicitudActivacion {
  id: string
  tenant: string
  slug: string
  tier: string
  modulos: string[]
  mensual: number
  instalacion: number
  nota: string | null
  desde: string
}

/**
 * Lo que los clientes han pedido activar y nadie ha atendido.
 *
 * Es la unica pantalla del panel donde alguien esta diciendo "quiero
 * pagarte mas". Va arriba del todo por eso.
 */
export async function cargarSolicitudes(): Promise<SolicitudActivacion[]> {
  const sql = db()
  const filas = await sql<
    {
      id: string
      tenant: string
      slug: string
      tier: string
      modules: string[]
      quoted_monthly: string
      quoted_install: string
      note: string | null
      created_at: string
    }[]
  >`
    select r.id, t.legal_name as tenant, t.slug, t.tier,
           r.modules, r.quoted_monthly::text, r.quoted_install::text,
           r.note, r.created_at::text
    from regb.activation_requests r
    join regb.tenants t on t.id = r.tenant_id
    where r.status = 'pending'
    order by r.created_at`

  return filas.map((f) => ({
    id: f.id,
    tenant: f.tenant,
    slug: f.slug,
    tier: f.tier,
    modulos: f.modules,
    mensual: Number(f.quoted_monthly),
    instalacion: Number(f.quoted_install),
    nota: f.note,
    desde: f.created_at,
  }))
}

// ── Actividad y contexto por cliente para la lista principal ─────────────

export interface ExtrasCliente {
  ultimaActividad: string | null
  movimientosMes: number
  usuarios: number
  sucursales: number
  etapaOnboarding: string | null
  bloqueos: string | null
}

export async function cargarExtrasPorTenant(): Promise<Map<string, ExtrasCliente>> {
  const sql = db()
  const filas = await sql<
    {
      tid: string
      ultima: string | null
      mes: string
      usuarios: string
      sucursales: string
      etapa: string | null
      bloqueos: string | null
    }[]
  >`
    select t.id::text as tid,
           (select max(l.at)::text from audit.log l where l.tenant_id = t.id) as ultima,
           (select count(*)::text from audit.log l
             where l.tenant_id = t.id and l.at >= now() - interval '30 days') as mes,
           (select count(*)::text from public.memberships m
             where m.tenant_id = t.id and m.is_active) as usuarios,
           (select count(*)::text from public.branches b
             where b.tenant_id = t.id and b.is_active and b.deleted_at is null) as sucursales,
           o.stage as etapa,
           o.blockers as bloqueos
    from regb.tenants t
    left join regb.onboarding o on o.tenant_id = t.id
    where t.status <> 'archived'`

  return new Map(
    filas.map((f) => [
      f.tid,
      {
        ultimaActividad: f.ultima,
        movimientosMes: Number(f.mes),
        usuarios: Number(f.usuarios),
        sucursales: Number(f.sucursales),
        etapaOnboarding: f.etapa,
        bloqueos: f.bloqueos,
      },
    ]),
  )
}
