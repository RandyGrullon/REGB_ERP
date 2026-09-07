-- ═══════════════════════════════════════════════════════════════════════
--  0060 — Capacitacion / LMS (modulo 67, F7/S42)
--
--  Si una nota aprueba un curso -contra el minimo de ese curso, no un
--  70% fijo para todos- y si un certificado sigue vigente se calculan
--  siempre con aproboEvaluacion()/certificadoVigente() (@regb/operations),
--  nunca se guardan como una bandera aparte.
-- ═══════════════════════════════════════════════════════════════════════

create table public.training_courses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  title           text not null,
  description     text,
  duration_hours  numeric(6,1),
  passing_score   integer not null default 70 check (passing_score between 0 and 100),
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.training_courses (tenant_id, status);

create table public.training_enrollments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  course_id     uuid not null references public.training_courses(id),
  employee_id   uuid not null references public.employees(id),
  status        text not null default 'enrolled'
                  check (status in ('enrolled', 'completed', 'failed')),
  score         integer check (score between 0 and 100),
  enrolled_at   timestamptz not null default now(),
  completed_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (tenant_id, course_id, employee_id)
);

create index on public.training_enrollments (tenant_id, employee_id);
create index on public.training_enrollments (tenant_id, course_id);

-- Un certificado es un hecho fijo desde que se emite -mismo criterio
-- que un pago de prestamo-.
create table public.training_certificates (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  enrollment_id   uuid not null references public.training_enrollments(id) unique,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz
);

create table public.training_competencies (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  name         text not null,
  description  text,
  created_at   timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.training_employee_competencies (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  employee_id    uuid not null references public.employees(id),
  competency_id  uuid not null references public.training_competencies(id),
  level          integer not null check (level between 1 and 5),
  assessed_at    timestamptz not null default now(),
  unique (tenant_id, employee_id, competency_id)
);

create index on public.training_employee_competencies (tenant_id, employee_id);
create index on public.training_employee_competencies (tenant_id, competency_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('training_courses',               'training'),
      ('training_enrollments',           'training'),
      ('training_certificates',          'training'),
      ('training_competencies',          'training'),
      ('training_employee_competencies', 'training')
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

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_inscripcion_curso_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_curso    uuid;
  v_tenant_empleado uuid;
begin
  select tenant_id into v_tenant_curso from public.training_courses where id = new.course_id;
  if v_tenant_curso is distinct from new.tenant_id then
    raise exception 'Ese curso no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_empleado from public.employees where id = new.employee_id;
  if v_tenant_empleado is distinct from new.tenant_id then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_inscripcion_ajena before insert on public.training_enrollments
  for each row execute function public.impedir_inscripcion_curso_ajena();

create function public.impedir_certificado_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.training_enrollments where id = new.enrollment_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa inscripcion no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_certificado_ajeno before insert on public.training_certificates
  for each row execute function public.impedir_certificado_ajeno();

create function public.impedir_competencia_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_empleado   uuid;
  v_tenant_competencia uuid;
begin
  select tenant_id into v_tenant_empleado from public.employees where id = new.employee_id;
  if v_tenant_empleado is distinct from new.tenant_id then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_competencia from public.training_competencies where id = new.competency_id;
  if v_tenant_competencia is distinct from new.tenant_id then
    raise exception 'Esa competencia no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_competencia_ajena before insert on public.training_employee_competencies
  for each row execute function public.impedir_competencia_ajena();

-- ── Una inscripcion resuelta (completed/failed) es inmutable ─────────────
create function public.impedir_editar_inscripcion_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('completed', 'failed') then
    raise exception 'Esa inscripcion ya quedo resuelta y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_inscripcion_resuelta
  before update or delete on public.training_enrollments
  for each row execute function public.impedir_editar_inscripcion_resuelta();

-- ── Un certificado emitido es inmutable -sin excepcion, como un pago- ────
create function public.impedir_editar_certificado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un certificado ya emitido no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_certificado
  before update or delete on public.training_certificates
  for each row execute function public.impedir_editar_certificado();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.training_courses
  for each row execute function audit.record('training');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Cursos, certificados y una matriz de competencias que se puede consultar de verdad',
    problem      = 'Sin un registro real, nadie sabe quien esta certificado en que, ni si ese certificado ya vencio.',
    features     = '[
      {"titulo":"Aprobacion contra el minimo del curso","detalle":"Cada curso define su propio minimo para aprobar -no un 70% fijo para todos-, calculado siempre contra la nota real."},
      {"titulo":"Certificados con vigencia real","detalle":"Si un certificado tiene fecha de vencimiento, se calcula si sigue vigente contra hoy -nunca una bandera que alguien olvida actualizar-."},
      {"titulo":"Matriz de competencias consultable","detalle":"Nivel de cada empleado en cada competencia, con el promedio del equipo calculado al vuelo."},
      {"titulo":"Un certificado emitido es un hecho fijo","detalle":"Igual que un pago de prestamo: una vez emitido, no se edita ni se borra."}
    ]'::jsonb,
    audience     = '{"Negocios que ya usan employees y necesitan llevar certificaciones al dia","Cualquiera con requisitos de capacitacion recurrente"}',
    faq          = '[
      {"p":"¿Genera el contenido del curso?","r":"No -es un sistema de registro (LMS de seguimiento), no una plataforma de contenido-. Se registra el curso, quien se inscribio, su nota y su certificado."},
      {"p":"¿Que pasa cuando vence un certificado?","r":"Se calcula como vencido al consultarlo -contra la fecha de hoy-, pero el certificado mismo no se borra ni se edita: sigue siendo un hecho historico de que se emitio."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'training';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'training'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'training no tiene precio en los 3 tiers';
  end if;
end $$;
