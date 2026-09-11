-- ═══════════════════════════════════════════════════════════════════════
--  0101 — Facturacion electronica (e-CF): lo que se emite y lo que entra
--
--  La ley 32-23 obliga a un negocio pequeño desde el 15 de noviembre de
--  2026. Esta migracion NO emite nada todavia: pone el registro que
--  hace falta para poder emitir, y sobre todo el enrutado de lo que
--  ENTRA, que es la mitad que casi nadie ve venir.
--
--  ── El problema multi-tenant ──────────────────────────────────────────
--  Al postular, cada contribuyente declara TRES URL suyas y la DGII le
--  pega a ellas. Nosotros servimos muchos RNC desde el mismo despliegue,
--  asi que hay que saber de QUIEN es un comprobante que llega.
--
--  Lo que NO se hace: leer el RNC del comprador que viene dentro del XML
--  y usarlo para elegir el tenant. Eso es el patron que la puerta F0
--  prohibe -"tenant_id nunca se lee de body"- y aqui seria peor que en
--  una pantalla: quien sepa el RNC de un cliente podria escribirle
--  facturas en su cuenta.
--
--  Lo que si: cada tenant tiene un token opaco de 128 bits y declara
--  URLs que lo llevan dentro. El token identifica Y autentica, igual que
--  el enlace del portal del cliente (0084). Despues, defensa en
--  profundidad: el RNC del documento tiene que coincidir con el del
--  tenant al que apunta el token.
--
--  ⚠️ Nada de esto se ha probado contra el ambiente de la DGII todavia.
-- ═══════════════════════════════════════════════════════════════════════

create table public.ecf_config (
  tenant_id       uuid primary key references regb.tenants(id) on delete cascade,
  -- Ambiente contra el que habla ESTE tenant. Se guarda por tenant y no
  -- global a proposito: mientras uno se certifica en 'certecf', otro ya
  -- factura de verdad en 'ecf'.
  ambiente        text not null default 'testecf'
                    check (ambiente in ('testecf', 'certecf', 'ecf')),
  -- El token que va en las URL declaradas a la DGII.
  -- 32 hex = 128 bits, los mismos que trae un uuid v4. Se arma asi y no
  -- con `gen_random_bytes` porque eso exige la extension pgcrypto y
  -- `gen_random_uuid` es nativa desde Postgres 13: una dependencia menos
  -- que instalar en el Supabase de cada cliente.
  endpoint_token  text not null unique
                    default replace(gen_random_uuid()::text, '-', '')
                    check (endpoint_token ~ '^[a-f0-9]{32,}$'),
  -- Si el contribuyente ya paso la certificacion de la DGII.
  certificado     boolean not null default false,
  certificado_en  date,
  -- Contingencia activa (Art. 40 Decreto 587-24). Nulo = operando normal.
  contingencia    text check (contingencia in ('sin-conexion', 'sin-sistema')),
  contingencia_desde timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Una contingencia sin fecha de inicio no se puede vencer ni auditar.
  check (contingencia is null or contingencia_desde is not null)
);

comment on column public.ecf_config.endpoint_token is
  'Token de las URL publicas declaradas a la DGII. Es lo unico que separa los comprobantes de un cliente de los de otro en una ruta sin sesion: tratarlo como una credencial.';

-- ── Lo que emitimos ─────────────────────────────────────────────────────
create table public.ecf_emitidos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  encf          text not null check (encf ~ '^E(3[1234]|4[134567])[0-9]{10}$'),
  -- De donde salio: una factura a credito o un ticket de caja.
  origen        text not null check (origen in ('factura', 'caja')),
  origen_id     uuid,
  rnc_comprador text,
  monto_total   numeric(12,2) not null check (monto_total >= 0),
  -- Por donde se mando. El corte de RD$250,000 decide esto, no el usuario.
  ruta          text not null check (ruta in ('ecf-completo', 'rfce-resumen')),
  -- El acuse de la DGII es asincrono: primero llega el trackId, el
  -- estado se consulta despues.
  track_id      text,
  estado        smallint check (estado between 0 and 4),
  -- Si la secuencia se quemo. OJO: la DGII lo manda con la polaridad al
  -- reves de lo que sugiere el nombre -true = NO se puede reutilizar-.
  secuencia_utilizada boolean,
  codigo_seguridad    text,
  -- Emitido sin conexion: hay 72 horas para remitirlo.
  en_contingencia boolean not null default false,
  emitido_en    timestamptz not null default now(),
  remitido_en   timestamptz,
  xml           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, encf)
);

create index on public.ecf_emitidos (tenant_id, estado);
create index on public.ecf_emitidos (tenant_id, track_id);
-- Los que se emitieron sin conexion y siguen sin remitir: es la cola que
-- alguien tiene que vigilar antes de que se venzan las 72 horas.
create index ecf_pendientes_de_remitir on public.ecf_emitidos (tenant_id, emitido_en)
  where en_contingencia and remitido_en is null;

-- ── Lo que nos llega ────────────────────────────────────────────────────
--  Un e-CF que otro nos emitio. Es un hecho historico: llego como llego
--  y no se reescribe. Lo unico que se mueve despues es la aprobacion
--  comercial, que es informacion NUEVA -aceptar o rechazar la compra-,
--  no una correccion de lo que llego.
create table public.ecf_recibidos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  encf          text not null,
  rnc_emisor    text not null,
  monto_total   numeric(12,2),
  -- El acuse que devolvimos. 0 = recibido, 1 = NO recibido (al reves de
  -- lo que sugiere leerlo como booleano).
  acuse_estado  smallint not null check (acuse_estado in (0, 1)),
  acuse_motivo  smallint check (acuse_motivo between 1 and 4),
  -- Aprobacion comercial: es del negocio, no del formato. Nulo = aun no
  -- se decidio.
  aprobacion    text check (aprobacion in ('aceptado', 'rechazado')),
  aprobado_en   timestamptz,
  xml           text,
  recibido_en   timestamptz not null default now(),
  unique (tenant_id, rnc_emisor, encf)
);

create index on public.ecf_recibidos (tenant_id, recibido_en desc);

-- Un acuse con motivo solo tiene sentido si dijimos que NO se recibio, y
-- al reves: decir "no recibido" sin motivo deja al emisor sin saber que
-- corregir.
alter table public.ecf_recibidos
  add constraint motivo_solo_si_no_recibido
  check ((acuse_estado = 1) = (acuse_motivo is not null));

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.ecf_config enable row level security;
alter table public.ecf_config force row level security;
alter table public.ecf_emitidos enable row level security;
alter table public.ecf_emitidos force row level security;
alter table public.ecf_recibidos enable row level security;
alter table public.ecf_recibidos force row level security;

create policy tenant_module on public.ecf_config for all
  using (tenant_id = rls.tenant_id() and rls.module_active('e-invoice'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('e-invoice'));
create policy provider_impersonating on public.ecf_config for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.ecf_emitidos for all
  using (tenant_id = rls.tenant_id() and rls.module_active('e-invoice'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('e-invoice'));
create policy provider_impersonating on public.ecf_emitidos for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.ecf_recibidos for all
  using (tenant_id = rls.tenant_id() and rls.module_active('e-invoice'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('e-invoice'));
create policy provider_impersonating on public.ecf_recibidos for select
  using (rls.impersonating(tenant_id));

-- ── Resolver el token SIN sesion ────────────────────────────────────────
--  La ruta que la DGII invoca no tiene sesion ni JWT: no hay
--  `rls.tenant_id()` que valga. Esta funcion es la UNICA puerta para
--  traducir token → tenant, y es `security definer` justo por eso.
--
--  Devuelve solo lo minimo para enrutar -tenant, RNC y ambiente-: nada
--  del negocio del cliente sale por aqui.
create function public.ecf_tenant_por_token(p_token text)
returns table (tenant_id uuid, rnc text, ambiente text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.tenant_id,
         regexp_replace(coalesce(co.tax_id, ''), '[^0-9]', '', 'g'),
         c.ambiente
  from public.ecf_config c
  left join public.companies co
    on co.tenant_id = c.tenant_id and co.is_default and co.deleted_at is null
  where c.endpoint_token = p_token
    -- Un token de 6 letras no abre nada aunque exista una fila con el.
    and length(p_token) >= 32;
$$;

revoke all on function public.ecf_tenant_por_token(text) from public;
grant execute on function public.ecf_tenant_por_token(text) to authenticated, anon;

comment on function public.ecf_tenant_por_token(text) is
  'Traduce el token de la URL publica a un tenant. Unica via para enrutar un e-CF entrante: el RNC que trae el XML NO decide de quien es.';

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.ecf_config
  for each row execute function audit.record('e-invoice');
create trigger audit_me after insert or update on public.ecf_emitidos
  for each row execute function audit.record('e-invoice');
create trigger audit_me after insert on public.ecf_recibidos
  for each row execute function audit.record('e-invoice');
