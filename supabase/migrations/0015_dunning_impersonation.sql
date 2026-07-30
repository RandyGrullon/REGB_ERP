-- ═══════════════════════════════════════════════════════════════════════
--  0015 — Dunning e impersonación (S17)
--
--  Mora (§6.6): día 5 aviso · 10 banner · 15 solo lectura · 30 suspensión
--  · 90 archivo. NINGÚN paso borra datos — el test lo verifica contando.
--
--  Impersonación (§7.4): razón obligatoria (≥10), 60 minutos (los hace
--  cumplir auth.impersonating() de 0005) y doble auditoría: el log del
--  proveedor Y la bitácora del propio tenant.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Bitácora de pasos de dunning ────────────────────────────────────────
--  Idempotente por (factura, paso): correr apply_dunning() cada hora no
--  manda cinco avisos del día 5.
create table regb.dunning_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete restrict,
  invoice_id uuid not null references regb.invoices(id) on delete restrict,
  step       text not null check (step in ('reminder','banner','readonly','suspended','archived')),
  applied_at timestamptz not null default now(),
  unique (invoice_id, step)
);

alter table regb.dunning_log enable row level security;
alter table regb.dunning_log force row level security;
create policy provider_only on regb.dunning_log
  for all using (auth.is_provider()) with check (auth.is_provider());

-- ── Aplicar dunning ─────────────────────────────────────────────────────
--  Se puede correr las veces que sea (cron horario, botón del panel):
--  cada corrida deja a cada tenant exactamente en el estado que le
--  corresponde según su factura impaga MÁS VIEJA. También recupera: si el
--  cliente pagó todo, vuelve a 'active'. 'archived' no se revierte solo.
create function regb.apply_dunning()
returns table (tenant_id uuid, old_status regb.tenant_status,
               new_status regb.tenant_status, days_overdue integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Paso 0: emitidas y vencidas pasan a 'overdue'.
  update regb.invoices i
  set status = 'overdue'
  where i.status = 'sent' and i.due_at < current_date;

  return query
  with morosos as (
    select i.tenant_id as t_id,
           (current_date - min(i.due_at))::integer as dias,
           min(i.due_at) as oldest_due
    from regb.invoices i
    where i.status = 'overdue'
    group by i.tenant_id
  ),
  objetivo as (
    select m.t_id, m.dias,
           case
             when m.dias >= 90 then 'archived'::regb.tenant_status
             when m.dias >= 30 then 'suspended'::regb.tenant_status
             when m.dias >= 15 then 'readonly'::regb.tenant_status
             when m.dias >= 10 then 'past_due'::regb.tenant_status
             else null  -- día 5-9: solo aviso, sin cambio de estado
           end as destino
    from morosos m
  ),
  degradados as (
    update regb.tenants t
    set status = o.destino, updated_at = now()
    from objetivo o
    where t.id = o.t_id
      and o.destino is not null
      and t.status <> o.destino
      and t.status <> 'archived'          -- archivado no se toca solo
      and t.status in ('trial','active','past_due','readonly','suspended')
    returning t.id, o.destino, o.dias
  ),
  recuperados as (
    update regb.tenants t
    set status = 'active', updated_at = now()
    where t.status in ('past_due','readonly','suspended')
      and not exists (
        select 1 from regb.invoices i
        where i.tenant_id = t.id and i.status in ('sent','overdue')
      )
    returning t.id
  ),
  avisos as (
    -- Registra cada paso alcanzado, una sola vez por factura.
    insert into regb.dunning_log (tenant_id, invoice_id, step)
    select i.tenant_id, i.id,
           case
             when (current_date - i.due_at) >= 90 then 'archived'
             when (current_date - i.due_at) >= 30 then 'suspended'
             when (current_date - i.due_at) >= 15 then 'readonly'
             when (current_date - i.due_at) >= 10 then 'banner'
             else 'reminder'
           end
    from regb.invoices i
    where i.status = 'overdue' and (current_date - i.due_at) >= 5
    on conflict (invoice_id, step) do nothing
    returning 1
  )
  select d.id, t.status, d.destino, d.dias
  from degradados d
  join regb.tenants t on t.id = d.id
  union all
  select r.id, 'past_due'::regb.tenant_status, 'active'::regb.tenant_status, 0
  from recuperados r;
end;
$$;

revoke all on function regb.apply_dunning() from public;

comment on function regb.apply_dunning() is
  'Idempotente. Degrada según la factura impaga más vieja y recupera al pagar. Jamás borra.';

-- ── Impersonación con doble auditoría ───────────────────────────────────
--  El caller (REGB Control) ya verificó identidad y MFA del usuario del
--  proveedor ANTES de llamar aquí; esta función exige la razón, cierra la
--  sesión anterior y deja rastro en AMBOS lados.
create function regb.start_impersonation(
  p_provider_user uuid,
  p_tenant        uuid,
  p_reason        text,
  p_ticket        text default null,
  p_write         boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if length(trim(p_reason)) < 10 then
    raise exception 'La razon es obligatoria: minimo 10 caracteres (§7.4)';
  end if;

  -- Solo una sesion abierta por usuario del proveedor: cerrar la anterior.
  update regb.impersonation_log
  set ended_at = now()
  where provider_user = p_provider_user and ended_at is null;

  insert into regb.impersonation_log (provider_user, tenant_id, reason, ticket_ref, write_mode)
  values (p_provider_user, p_tenant, p_reason, p_ticket, p_write)
  returning id into v_id;

  -- Lado del TENANT: su bitacora registra que el proveedor entro.
  perform audit.ensure_partition(current_date);
  insert into audit.log (tenant_id, user_id, module_id, entity, action, after)
  values (p_tenant, p_provider_user, 'core', 'impersonation', 'impersonate',
          jsonb_build_object('reason', p_reason, 'ticket', p_ticket, 'write_mode', p_write));

  return v_id;
end;
$$;

create function regb.end_impersonation(p_provider_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update regb.impersonation_log
  set ended_at = now()
  where provider_user = p_provider_user and ended_at is null;
$$;

revoke all on function regb.start_impersonation(uuid, uuid, text, text, boolean) from public;
revoke all on function regb.end_impersonation(uuid) from public;
