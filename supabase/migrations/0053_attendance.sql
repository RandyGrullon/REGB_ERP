-- ═══════════════════════════════════════════════════════════════════════
--  0053 — Asistencia & Ponches (modulo 63, F7/S39)
--
--  "Biometrico" del catalogo (§5.6) NO se construye aqui -una huella
--  digital pide hardware que este sistema no controla, mismo criterio
--  que el "biometrico" declarado pendiente en otros modulos-. Geocerca SI
--  se resuelve de verdad: haversineDistanceMeters()/isWithinGeofence()
--  en @regb/operations comparan la posicion GPS del marcaje contra un
--  radio permitido. QR se resuelve como un metodo de marcaje mas
--  (`method = 'qr'`), no como generacion de imagen -el codigo en si es
--  cosa de la app movil, este modulo solo registra que asi se marco-.
--
--  Horas trabajadas, horas extra y minutos de tardanza son SIEMPRE
--  derivados de check_in/check_out -nunca guardados-, mismo principio
--  que el saldo de una factura o el saldo en libros de un activo fijo.
-- ═══════════════════════════════════════════════════════════════════════

create table public.attendance_geofences (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  branch_id      uuid not null references public.branches(id),
  latitude       numeric(9,6) not null check (latitude between -90 and 90),
  longitude      numeric(9,6) not null check (longitude between -180 and 180),
  radius_meters  integer not null check (radius_meters > 0),
  created_at     timestamptz not null default now(),
  unique (tenant_id, branch_id)
);

create table public.attendance_records (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  employee_id      uuid not null references public.employees(id),
  check_in         timestamptz not null,
  check_out        timestamptz,
  check_in_method  text not null default 'manual' check (check_in_method in ('manual', 'qr', 'geofence')),
  check_in_lat     numeric(9,6),
  check_in_lng     numeric(9,6),
  within_geofence  boolean,
  notes            text,
  created_at       timestamptz not null default now(),
  check (check_out is null or check_out > check_in)
);

create index on public.attendance_records (tenant_id, employee_id, check_in desc);
-- Un empleado no puede tener dos marcajes ABIERTOS -sin salida- a la vez:
-- entraria dos veces sin haber salido nunca de la primera.
create unique index attendance_un_abierto_por_empleado
  on public.attendance_records (tenant_id, employee_id)
  where check_out is null;

comment on column public.attendance_records.within_geofence is
  'Calculado UNA vez al marcar -con isWithinGeofence() de @regb/operations, no reimplementado en SQL- y guardado como hecho historico: la cerca pudo cambiar de radio despues, y el marcaje de ayer no debe releerse distinto por eso.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('attendance_geofences', 'attendance'),
      ('attendance_records',   'attendance')
    ) as t(tabla, modulo)
  loop
    execute format('alter table public.%I enable row level security', r.tabla);
    execute format('alter table public.%I force row level security', r.tabla);
    execute format(
      'create policy tenant_module on public.%I for all
         using (tenant_id = rls.tenant_id() and rls.module_active(%L))
         with check (tenant_id = rls.tenant_id() and rls.module_active(%L))',
      r.tabla, r.modulo, r.modulo);
    execute format(
      'create policy provider_impersonating on public.%I for select
         using (rls.impersonating(tenant_id))', r.tabla);
  end loop;
end $$;

-- El mismo agujero de siempre (0031/0040/accounting/ap/treasury/bank-rec/
-- fixed-assets/budgets/cost-centers/payments/employees/payroll), tapado
-- desde el primer dia: la RLS de insert solo compara el tenant_id de la
-- fila nueva, no a quien pertenecen branch_id ni employee_id.
create function public.impedir_geocerca_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.branches where id = new.branch_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa sucursal no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_geocerca_ajena before insert on public.attendance_geofences
  for each row execute function public.impedir_geocerca_ajena();

create function public.impedir_marcaje_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.employees where id = new.employee_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_marcaje_ajeno before insert on public.attendance_records
  for each row execute function public.impedir_marcaje_ajeno();

-- ── Marcar salida: la unica forma de cerrar un marcaje abierto ──────────
create function public.check_out_attendance(p_record uuid, p_check_out timestamptz default now()) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant    uuid;
  v_check_in  timestamptz;
  v_ya_cerrado boolean;
begin
  select tenant_id, check_in, check_out is not null
    into v_tenant, v_check_in, v_ya_cerrado
    from public.attendance_records where id = p_record for update;

  if not found then
    raise exception 'Ese marcaje no existe.' using errcode = 'P0002';
  end if;
  if v_tenant is distinct from rls.tenant_id() then
    raise exception 'Ese marcaje no es de esta cuenta.' using errcode = '42501';
  end if;
  if v_ya_cerrado then
    raise exception 'Ese marcaje ya tiene salida registrada.' using errcode = '55000';
  end if;
  if p_check_out <= v_check_in then
    raise exception 'La salida debe ser despues de la entrada.' using errcode = '55000';
  end if;

  update public.attendance_records set check_out = p_check_out where id = p_record;
end;
$$;

revoke all on function public.check_out_attendance(uuid, timestamptz) from public;
grant execute on function public.check_out_attendance(uuid, timestamptz) to authenticated;

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.attendance_geofences
  for each row execute function audit.record('attendance');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Sabe quien marco, a que hora y desde donde -sin depender de la memoria de nadie-',
    problem      = 'Sin un registro real de entrada y salida, la hora extra y la tardanza se discuten de memoria cada quincena, y nadie tiene con que probar nada.',
    features     = '[
      {"titulo":"Geocerca de verdad","detalle":"Cada marcaje guarda si ocurrio dentro del radio permitido de la sucursal -calculado con la posicion GPS real, no una casilla que cualquiera puede marcar-."},
      {"titulo":"Horas extra y tardanza calculadas, no discutidas","detalle":"Se derivan siempre de la hora real de entrada y salida -nunca se escriben a mano, nunca se desincronizan de lo que de verdad paso-."},
      {"titulo":"Un solo marcaje abierto a la vez","detalle":"Un empleado no puede entrar dos veces sin haber marcado salida de la primera -el sistema no se lo permite, no depende de que alguien se de cuenta-."},
      {"titulo":"Honesto sobre el biometrico","detalle":"No incluye lector de huella real -eso es hardware que este sistema no controla-. Marca por geocerca, por QR o manual."}
    ]'::jsonb,
    audience     = '{"Negocios con empleados en sucursal fija","Cualquiera que ya use employees y quiera controlar horario","Negocios con problemas reales de tardanza"}',
    faq          = '[
      {"p":"¿Tiene lector de huella digital?","r":"No -eso es hardware fisico que este sistema no controla-. El marcaje es por geocerca (posicion GPS), por codigo QR o manual."},
      {"p":"¿Que pasa si un empleado se le olvida marcar salida?","r":"El marcaje queda abierto -sin salida- hasta que alguien con permiso lo cierre. Mientras tanto, ese empleado no puede volver a marcar entrada: el sistema no permite dos marcajes abiertos a la vez."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'attendance';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'attendance'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'attendance no tiene precio en los 3 tiers';
  end if;
end $$;
