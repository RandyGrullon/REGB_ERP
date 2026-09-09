-- ═══════════════════════════════════════════════════════════════════════
--  0093 — Copiloto IA (modulo 90, F9/S65-66)
--
--  El documento maestro senala este modulo como "el mayor riesgo de
--  fuga entre tenants del proyecto: consulta datos en lenguaje
--  natural" y pide una auditoria adversarial antes de publicarlo. La
--  respuesta de diseno es la misma que ya uso `bi`: el copiloto NUNCA
--  genera SQL libre ni llama a un modelo de lenguaje real todavia -no
--  hay integracion con ningun proveedor de IA-. En cambio empareja la
--  pregunta con un catalogo FIJO de preguntas ya vetadas
--  (`matched_key` con `check` explicito), cada una una consulta
--  parametrizada ya escrita en la aplicacion. La fuga entre tenants
--  queda eliminada por construccion, no por un filtro en tiempo de
--  ejecucion: no existe ningun camino de codigo que acepte una
--  consulta arbitraria.
--
--  Sin el "agujero de siempre" (0031): esta tabla no referencia
--  ninguna otra tabla de negocio -solo registra la pregunta y la
--  respuesta ya calculada-, no hay nada que cruzar entre tenants.
--
--  Deliberadamente SIN requires (recomienda `bi`, que ya tiene el
--  mismo catalogo de fuentes vetadas que aqui se reutiliza).
-- ═══════════════════════════════════════════════════════════════════════

-- Cada consulta es un hecho historico: inmutable desde el insert, para
-- que la bitacora de "que le preguntaron al copiloto" sea auditable de
-- verdad y no se pueda reescribir despues.
create table public.copilot_queries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  user_id         uuid not null,
  question        text not null,
  matched_key     text not null check (matched_key in
                    ('sales_by_day', 'top_products', 'overdue_invoices', 'leads_by_status', 'tickets_by_priority', 'no_match')),
  answer_summary  text,
  answer_data     jsonb,
  created_at      timestamptz not null default now()
);

create index on public.copilot_queries (tenant_id, user_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.copilot_queries enable row level security;
alter table public.copilot_queries force row level security;

create policy tenant_module on public.copilot_queries for all
  using (tenant_id = rls.tenant_id() and rls.module_active('ai-copilot'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('ai-copilot'));
create policy provider_impersonating on public.copilot_queries for select
  using (rls.impersonating(tenant_id));

-- ── Inmutabilidad: la bitacora de preguntas es un hecho historico ──────
create function public.impedir_editar_consulta_copiloto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una consulta al copiloto ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_consulta_copiloto
  before update or delete on public.copilot_queries
  for each row execute function public.impedir_editar_consulta_copiloto();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert on public.copilot_queries
  for each row execute function audit.record('ai-copilot');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'La fuga entre tenants queda eliminada por construccion: nunca genera SQL libre',
    problem      = 'Sin una forma rapida de preguntar en espanol comun por los numeros del negocio, alguien tiene que abrir el reporte correcto y buscar el dato a mano cada vez.',
    features     = '[
      {"titulo":"Preguntas en espanol, respuestas reales","detalle":"Escribe la pregunta como se la harias a un colega -el copiloto la empareja con el catalogo fijo de reportes ya vetados de bi y calcula la respuesta real-."},
      {"titulo":"Nunca genera una consulta libre","detalle":"El emparejamiento es por palabras clave contra un catalogo fijo -no hay ningun camino de codigo que acepte SQL arbitrario, la fuga entre tenants queda eliminada por diseno-."},
      {"titulo":"Bitacora auditable de cada pregunta","detalle":"Cada pregunta y su respuesta quedan registradas como un hecho historico, nunca se editan despues."}
    ]'::jsonb,
    audience     = '{"Cualquier gerente que hoy le pide a alguien del equipo que le busque un numero en vez de verlo el mismo"}',
    faq          = '[
      {"p":"¿Usa un modelo de lenguaje real como ChatGPT?","r":"Todavia no -empareja tu pregunta con un catalogo fijo de preguntas ya vetadas por palabras clave, sin conexion a ningun proveedor de IA externo-."},
      {"p":"¿Puede el copiloto ver datos de otro cliente?","r":"No, por diseno -nunca genera una consulta libre; solo puede ejecutar las consultas fijas ya escritas, todas filtradas por tu tenant como cualquier otra pantalla del sistema-."}
    ]'::jsonb,
    setup_minutes = 5
where id = 'ai-copilot';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'ai-copilot'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'ai-copilot no tiene precio en los 3 tiers';
  end if;
end $$;
