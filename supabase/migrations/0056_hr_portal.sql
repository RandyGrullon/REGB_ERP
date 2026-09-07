-- ═══════════════════════════════════════════════════════════════════════
--  0056 — Portal del Empleado (modulo 70, F7/S40)
--
--  El portal es sobre todo una VENTANA de autoservicio sobre datos que ya
--  existen: el volante sigue siendo la fila de `payroll_lines` que
--  `payroll` calculo y dejo inmutable, el saldo de vacaciones sigue siendo
--  `saldoVacaciones()` de `time-off`. La unica tabla nueva es la de
--  anuncios -lo demas se lee de tablas de otros modulos, filtrado siempre
--  al empleado que corresponde a quien mira, RLS incluida-.
--
--  "Quien mira" se resuelve por CORREO: `public.user_profiles.email` del
--  usuario que inicio sesion contra `public.employees.email` del mismo
--  tenant. Este esquema no tiene un `employees.user_id` formal -si el
--  correo del expediente no coincide con el de la cuenta, el portal no
--  encuentra a quien mira y lo dice explicitamente, no falla en silencio-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.hr_announcements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  title         text not null,
  body          text not null,
  published_by  uuid,
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index on public.hr_announcements (tenant_id, published_at desc);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.hr_announcements enable row level security;
alter table public.hr_announcements force row level security;

create policy tenant_module on public.hr_announcements for all
  using (tenant_id = rls.tenant_id() and rls.module_active('hr-portal'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('hr-portal'));

create policy provider_impersonating on public.hr_announcements for select
  using (rls.impersonating(tenant_id));

-- `hr_announcements` no referencia ninguna otra tabla de tenant -no hay
-- employee_id ni branch_id-, asi que no hace falta el trigger de
-- referencia cruzada del patron 0031: la RLS de tenant_id le basta.

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.hr_announcements
  for each row execute function audit.record('hr-portal');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Tu volante, tu saldo de vacaciones y los anuncios de la empresa, sin llamar a RRHH',
    problem      = 'Sin un portal, cada empleado le pregunta a RRHH su propio saldo de vacaciones o pide su volante por WhatsApp -y RRHH contesta la misma pregunta cien veces-.',
    features     = '[
      {"titulo":"Tu expediente, no el de todos","detalle":"Se resuelve por tu correo -si no coincide con el del expediente, el portal lo dice claro en vez de mostrar datos de otra persona-."},
      {"titulo":"Tus volantes de siempre","detalle":"Los mismos numeros ya calculados y fijados por payroll -el portal no recalcula nada, solo los muestra-."},
      {"titulo":"Tu saldo de vacaciones real","detalle":"El mismo calculo del Codigo de Trabajo Art. 177 que usa time-off -y puedes pedir tus propios dias desde aqui-."},
      {"titulo":"Anuncios de la empresa","detalle":"Lo que RRHH publica, todos lo ven -sin cadenas de correo-."}
    ]'::jsonb,
    audience     = '{"Cualquiera que ya use employees y quiera dejar de contestar las mismas preguntas","Negocios con mas de un empleado que pide su volante seguido"}',
    faq          = '[
      {"p":"¿Cualquiera puede ver el expediente de otro empleado?","r":"No: el portal solo muestra el expediente cuyo correo coincide con el de tu cuenta. Si no hay coincidencia, no muestra nada -ni el de otra persona ni un error confuso-."},
      {"p":"¿Recalcula el volante o el saldo de vacaciones?","r":"No: muestra los mismos numeros ya calculados por payroll y time-off. El portal es una ventana, no un motor de calculo aparte."}
    ]'::jsonb,
    setup_minutes = 5
where id = 'hr-portal';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'hr-portal'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'hr-portal no tiene precio en los 3 tiers';
  end if;
end $$;
