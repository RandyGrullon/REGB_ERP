-- ═══════════════════════════════════════════════════════════════════════
--  0092 — Chat interno (modulo 92, F9/S65-66)
--
--  Un mensaje es un hecho historico: inmutable desde el insert, igual
--  que un mensaje de ticket o una actividad de lead. Las menciones no
--  se parsean de texto libre -no hay un @handle unico en
--  `user_profiles`-: se eligen de una lista real de usuarios del
--  tenant al componer el mensaje, guardadas como `mentioned_user_ids`.
--
--  Deliberadamente SIN requires: un canal de chat es util aunque el
--  negocio no tenga ningun otro modulo activo.
-- ═══════════════════════════════════════════════════════════════════════

create table public.chat_channels (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  name        text not null,
  scope_type  text not null default 'general' check (scope_type in ('module', 'project', 'branch', 'general')),
  scope_label text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

-- Cada mensaje es un hecho historico: inmutable desde el insert, igual
-- que un mensaje de ticket. Un hilo es un mensaje que apunta a otro.
create table public.chat_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  channel_id          uuid not null references public.chat_channels(id) on delete cascade,
  parent_message_id   uuid references public.chat_messages(id),
  author_id           uuid not null,
  body                text not null,
  mentioned_user_ids  uuid[] not null default '{}',
  created_at          timestamptz not null default now()
);

create index on public.chat_messages (tenant_id, channel_id, created_at);
create index on public.chat_messages (tenant_id, parent_message_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.chat_channels enable row level security;
alter table public.chat_channels force row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_messages force row level security;

create policy tenant_module on public.chat_channels for all
  using (tenant_id = rls.tenant_id() and rls.module_active('chat'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('chat'));
create policy provider_impersonating on public.chat_channels for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.chat_messages for all
  using (tenant_id = rls.tenant_id() and rls.module_active('chat'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('chat'));
create policy provider_impersonating on public.chat_messages for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_canal_ajeno_mensaje() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_canal uuid;
  v_tenant_padre uuid;
begin
  select tenant_id into v_tenant_canal from public.chat_channels where id = new.channel_id;
  if v_tenant_canal is distinct from new.tenant_id then
    raise exception 'Ese canal no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  if new.parent_message_id is not null then
    select tenant_id into v_tenant_padre from public.chat_messages where id = new.parent_message_id;
    if v_tenant_padre is distinct from new.tenant_id then
      raise exception 'Ese mensaje no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_canal_ajeno_mensaje
  before insert on public.chat_messages
  for each row execute function public.impedir_canal_ajeno_mensaje();

-- ── Inmutabilidad: un mensaje es un hecho historico ─────────────────────
create function public.impedir_editar_mensaje_chat() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un mensaje ya enviado no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_mensaje_chat
  before update or delete on public.chat_messages
  for each row execute function public.impedir_editar_mensaje_chat();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert on public.chat_channels
  for each row execute function audit.record('chat');
create trigger audit_me after insert on public.chat_messages
  for each row execute function audit.record('chat');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Un mensaje enviado es un hecho historico -nunca se edita ni se borra despues-',
    problem      = 'Sin un canal propio, la conversacion del equipo vive dispersa entre WhatsApp personal y correos sueltos, sin quedar ligada al modulo o proyecto del que habla.',
    features     = '[
      {"titulo":"Canales por modulo, proyecto o sucursal","detalle":"Cada canal tiene su ambito -no es un chat generico, queda ligado a de que parte del negocio se habla-."},
      {"titulo":"Hilos de verdad","detalle":"Responder dentro de un mensaje crea un hilo -la conversacion no se pierde entre mensajes sueltos-."},
      {"titulo":"Menciones reales, no texto adivinado","detalle":"Mencionar a alguien lo elige de la lista real de usuarios del tenant -nunca se adivina un @usuario de un texto suelto-."}
    ]'::jsonb,
    audience     = '{"Cualquier equipo que hoy coordina por WhatsApp personal sin que quede registro ligado al trabajo"}',
    faq          = '[
      {"p":"¿Se puede editar o borrar un mensaje enviado?","r":"No -un mensaje enviado es un hecho historico, igual que un mensaje de ticket-."},
      {"p":"¿Las menciones se detectan escribiendo @nombre?","r":"No -se eligen de una lista real de usuarios del tenant al componer el mensaje, para nunca depender de adivinar un nombre escrito a mano-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'chat';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'chat'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'chat no tiene precio en los 3 tiers';
  end if;
end $$;
