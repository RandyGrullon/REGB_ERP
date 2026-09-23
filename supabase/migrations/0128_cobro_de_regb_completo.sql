-- ═══════════════════════════════════════════════════════════════════════
--  0128 — REGB cobra lo que su formula dice, y la mora muerde de verdad
--
--  defi-v1 §2.1 y el analisis de flujo (hallazgo 9) encontraron que la
--  factura automatica de REGB Control cobraba de menos y que la mora no
--  tenia dientes. Esta migracion es la parte de BASE; la de la app esta en
--  `lib/control.ts`, `lib/invoicing.ts` y `lib/module-page.ts`, y la del
--  motor en `@regb/billing` y `@regb/module-registry`.
--
--    1. La prueba de un modulo vence.
--    2. La instalacion de un modulo pagado se factura, una vez.
--    3. La factura vence con plazo, no el primer dia de su periodo.
--    4. Pagar reactiva al cliente sin esperar al siguiente dunning.
--    5. "Solo lectura" impide escribir tambien por PostgREST.
--
--  Lo de usuarios, sucursales, empresas, storage e ITBIS no necesita base:
--  los datos ya existen (membresias, sucursales, empresas, archivos y el
--  pais del cliente); faltaba leerlos al cotizar.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  1. La prueba de un modulo vence
--
--  Ni `rls.module_active()` ni el registry miraban `trial_ends_at`, y
--  nada la vencia: el `inventory` en prueba del colmado seguia
--  funcionando gratis despues de su fecha, con "quedan 0 d" en el menu.
--  Y el aviso de REGB Control al activar -"al terminar dejan de verse"-
--  era falso.
--
--  Vencida, el modulo deja de estar activo para la RLS (sus filas dejan
--  de verse, NO se borran) y para el registry (sale del menu). El motor
--  ya no lo cotiza. Vuelve el dia que se pasa a `active` -y entonces se
--  cobra-.
-- ═══════════════════════════════════════════════════════════════════════

-- Una prueba sin fecha no vence nunca, que es el agujero de antes. Las
-- que ya existen sin fecha reciben los 14 dias de siempre desde que se
-- activaron; las nuevas, desde hoy.
update regb.tenant_modules
set trial_ends_at = (activated_at::date + 14)
where status = 'trial' and trial_ends_at is null;

create function regb.prueba_con_fecha() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'trial' and new.trial_ends_at is null then
    new.trial_ends_at := current_date + 14;
  end if;
  return new;
end;
$$;

create trigger prueba_con_fecha
  before insert or update of status, trial_ends_at on regb.tenant_modules
  for each row execute function regb.prueba_con_fecha();

-- La prueba vale su ultimo dia entero: `>= current_date`. Mismo criterio
-- que `isLive()` del registry (hasta las 24:00 UTC).
create or replace function rls.module_active(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from regb.tenant_modules tm
    where tm.tenant_id = rls.tenant_id()
      and tm.module_id = p_module
      and tm.enabled
      and (tm.status = 'active'
           or (tm.status = 'trial' and tm.trial_ends_at >= current_date))
  )
$$;

comment on function rls.module_active(text) is
  'True si el tenant tiene el modulo activo y encendido, o en una prueba que no ha vencido (0128). Toda politica RLS de negocio debe invocarla.';

-- El menu del movil (0105) con el mismo criterio.
create or replace function public.mis_modulos()
returns table (module_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.module_id
  from regb.tenant_modules tm
  where tm.tenant_id = rls.tenant_id()
    and tm.enabled
    and (tm.status = 'active'
         or (tm.status = 'trial' and tm.trial_ends_at >= current_date))
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  2. La instalacion de un modulo pagado se factura, una vez
--
--  La cotizacion de REGB Control calculaba la instalacion y nada la
--  facturaba. Ahora pasar un modulo de pago a `active` deja un cargo
--  PENDIENTE aqui; la siguiente factura del mes le pone precio con el
--  motor (lo incluido en el tier va a US$0, los mas caros primero), lo
--  cobra con ITBIS y sin descuento de ciclo, y lo marca con su factura.
--
--  "Una vez" lo garantiza la clave (tenant, modulo): apagar y volver a
--  activar no instala de nuevo.
--
--  El precio NO se fija al activar sino al facturar: depende de que otros
--  modulos esten activos ese mes (los incluidos del tier), y fijarlo antes
--  cobraria de mas a quien activa tres modulos seguidos.
-- ═══════════════════════════════════════════════════════════════════════
--  Estados de una fila:
--    pendiente  -> amount nulo, sin factura
--    facturada  -> amount fijado por el motor, con su factura y fecha
--    anterior   -> amount 0, sin factura, con nota (ver el relleno abajo)
--
--  La factura se referencia con (tenant, factura): un cargo no puede
--  colgar de la factura de otro cliente. Mismo patron que las lecturas de
--  avisos (0125) y las partes de respaldo (0122).
alter table regb.invoices
  add constraint invoices_tenant_id_id_key unique (tenant_id, id);

create table regb.module_installation_charges (
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  module_id    text not null references regb.module_catalog(id),
  -- Nulo mientras esta pendiente; el motor lo fija al facturar.
  amount       numeric(12,2) check (amount >= 0),
  invoice_id   uuid,
  activated_at timestamptz not null default now(),
  charged_at   timestamptz,
  note         text,
  primary key (tenant_id, module_id),
  -- `restrict`: una factura es un registro fiscal y no se borra (0002).
  constraint module_installation_charges_factura_del_mismo_tenant
    foreign key (tenant_id, invoice_id)
    references regb.invoices (tenant_id, id) on delete restrict,
  -- Factura y fecha van juntas, y una facturada tiene monto.
  check ((invoice_id is null) = (charged_at is null)),
  check (invoice_id is null or amount is not null)
);

create index module_installation_charges_pendientes_idx
  on regb.module_installation_charges (tenant_id)
  where amount is null;

comment on table regb.module_installation_charges is
  'Instalacion de cada modulo pagado, una vez por cliente (0128). Pendiente hasta que una factura mensual la cobra.';

alter table regb.module_installation_charges enable row level security;
alter table regb.module_installation_charges force row level security;

create policy provider_only on regb.module_installation_charges
  for all using (rls.is_provider()) with check (rls.is_provider());

-- Como sus facturas (0005): el cliente ve lo suyo, no lo toca. El grant
-- hace falta porque los de 0005 solo cubrieron las tablas de entonces;
-- sin el, leer daria "permission denied" en vez de sus filas.
create policy tenant_reads_own on regb.module_installation_charges
  for select using (tenant_id = rls.tenant_id());

grant select on regb.module_installation_charges to authenticated;

-- Lo que YA estaba activo se instalo cuando se vendio: esos contratos
-- tienen su instalacion en `subscriptions.install_price`, y cobrarla ahora
-- seria facturarla dos veces. Se registra como hecha: monto 0, sin
-- factura y con nota. Tener monto es lo que la saca de "pendiente".
insert into regb.module_installation_charges (tenant_id, module_id, amount, activated_at, note)
select tm.tenant_id, tm.module_id, 0, tm.activated_at,
       'Activo antes de 0128: su instalacion entro en el contrato. No se factura otra vez.'
from regb.tenant_modules tm
join regb.module_catalog mc on mc.id = tm.module_id
where tm.status = 'active' and mc.category <> 'core'
on conflict do nothing;

create function regb.instalacion_pendiente() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and exists (select 1 from regb.module_catalog mc
                 where mc.id = new.module_id and mc.category <> 'core') then
    insert into regb.module_installation_charges (tenant_id, module_id)
    values (new.tenant_id, new.module_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger instalacion_pendiente
  after insert or update of status on regb.tenant_modules
  for each row
  when (new.status = 'active')
  execute function regb.instalacion_pendiente();

-- ═══════════════════════════════════════════════════════════════════════
--  3. La factura vence con plazo
--
--  `due_at = period_start`: generada el 23, nacia con 22 dias de mora y
--  el primer dunning pasaba al cliente a solo lectura sin un recordatorio.
--  Desde aqui la app pone 15 dias desde la emision o el inicio del
--  periodo, lo mas tarde (`invoiceDueDate` en @regb/billing).
--
--  Las facturas ya emitidas y aun sin procesar se corrigen igual. Las que
--  el dunning ya marco `overdue` no: moverlas dejaria al cliente degradado
--  con una factura "al dia" y ningun camino automatico de vuelta. Esas se
--  revisan a mano.
-- ═══════════════════════════════════════════════════════════════════════
update regb.invoices
set due_at = greatest(period_start, created_at::date) + 15
where status = 'sent' and due_at <= period_start;

-- ═══════════════════════════════════════════════════════════════════════
--  4. Pagar reactiva al cliente
--
--  `record_payment` marcaba la factura pagada y el cliente seguia en
--  solo lectura hasta que alguien corriera el dunning otra vez. Ahora, si
--  con este pago ya no le queda nada pendiente, vuelve a `active` en la
--  misma transaccion. Mismo criterio que `apply_dunning` (0015): sin
--  facturas `sent` ni `overdue`. `archived` no se revierte solo.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function regb.record_payment(
  p_invoice_id  uuid,
  p_external_id text,
  p_provider    text default 'manual'
) returns regb.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice regb.invoices;
  v_next_attempt smallint;
begin
  -- Lock de la factura: dos webhooks simultaneos se serializan aqui.
  select * into v_invoice from regb.invoices
  where id = p_invoice_id for update;

  if not found then
    raise exception 'Factura % no existe', p_invoice_id;
  end if;

  -- ¿Este cobro externo ya se aplico? Entonces no hay nada que hacer.
  if exists (select 1 from regb.payment_attempts where external_id = p_external_id) then
    return v_invoice;
  end if;

  if v_invoice.status = 'paid' then
    return v_invoice;
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_next_attempt
  from regb.payment_attempts where invoice_id = p_invoice_id;

  insert into regb.payment_attempts
    (invoice_id, attempt_no, provider, idempotency_key, status, external_id,
     scheduled_for, attempted_at)
  values
    (p_invoice_id, v_next_attempt, p_provider,
     'pay_' || p_external_id, 'succeeded', p_external_id,
     current_date, now());

  update regb.invoices
  set status = 'paid', paid_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  update regb.tenants t
  set status = 'active', updated_at = now()
  where t.id = v_invoice.tenant_id
    and t.status in ('past_due', 'readonly', 'suspended')
    and not exists (
      select 1 from regb.invoices i
      where i.tenant_id = t.id and i.status in ('sent', 'overdue'));

  return v_invoice;
end;
$$;

revoke all on function regb.record_payment(uuid, text, text) from public;

-- ═══════════════════════════════════════════════════════════════════════
--  5. "Solo lectura" impide escribir
--
--  El estado `readonly` (dia 15 de mora) era un cartel: ni `checkAccess`
--  ni la RLS lo miraban. En la app web lo cierra `exigir()`, que niega
--  toda accion que no sea ver o exportar (lib/module-page.ts).
--
--  Por PostgREST -la app movil- no pasa `exigir()`. Esta funcion pone la
--  TRANSACCION en solo lectura cuando el cliente esta en `readonly`,
--  `suspended` o `archived`: Postgres rechaza cualquier escritura, incluida
--  la de una funcion security definer, y las lecturas siguen. No hace
--  falta tocar las ~370 politicas.
--
--  Se engancha como `db_pre_request` de PostgREST, que la corre antes de
--  cada peticion. En un Postgres sin PostgREST (CI, Docker local) el rol
--  `authenticator` no existe y el enganche se salta; la funcion queda
--  igual, probada por su cuenta.
--
--  Pagar no pasa por aqui: lo registra el proveedor (o el webhook de la
--  pasarela) con su propio acceso, y al pagar el cliente vuelve a
--  `active` (seccion 4).
-- ═══════════════════════════════════════════════════════════════════════
create function rls.aplicar_estado_de_cuenta() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not rls.is_provider()
     and exists (select 1 from regb.tenants t
                 where t.id = rls.tenant_id()
                   and t.status in ('readonly', 'suspended', 'archived')) then
    perform set_config('transaction_read_only', 'on', true);
  end if;
end;
$$;

comment on function rls.aplicar_estado_de_cuenta() is
  'Pone la transaccion en solo lectura si el cliente del JWT esta en mora de solo lectura o peor (0128). db_pre_request de PostgREST.';

revoke all on function rls.aplicar_estado_de_cuenta() from public;
grant execute on function rls.aplicar_estado_de_cuenta() to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''rls.aplicar_estado_de_cuenta''';
    perform pg_notify('pgrst', 'reload config');
  end if;
exception when insufficient_privilege then
  raise notice 'Sin permiso para configurar PostgREST: engancha rls.aplicar_estado_de_cuenta como db_pre_request a mano.';
end $$;
