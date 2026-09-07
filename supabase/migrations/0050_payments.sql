-- ═══════════════════════════════════════════════════════════════════════
--  0050 — Pasarelas de cobro (modulo 27, F6/S34)
--
--  El catalogo (§5.2) nombra pasarelas reales: Stripe, Azul, CardNet,
--  PayPal. Integrarlas de verdad pide credenciales de comercio reales y
--  la revision de seguridad que eso exige -este sistema NUNCA construye
--  un formulario que capture datos de tarjeta sin esa base-. Este primer
--  corte es honesto: genera el link de cobro y lleva su estado, pero
--  confirmar que se pago es una accion MANUAL, igual que un cobro de ar
--  (0023) o un pago de ap (0042) -el dinero se recibe por el canal real
--  que sea (transferencia, tarjeta fisica, efectivo), y aqui solo se
--  registra que ya llego-.
--
--  `gateway` guarda CUAL pasarela se pretende usar el dia que la
--  integracion real exista, sin migrar el esquema otra vez -mismo patron
--  que `exchange_rates.source` en multicurrency (0049)-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.payment_links (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  customer_id  uuid references public.customers(id),
  amount       numeric(12,2) not null check (amount > 0),
  description  text not null,
  status       text not null default 'pending'
                 check (status in ('pending', 'paid', 'expired', 'canceled')),
  -- Cual pasarela se pretende usar -hoy ninguna esta integrada de verdad,
  -- todas se resuelven a confirmacion manual-.
  gateway      text not null default 'manual'
                 check (gateway in ('manual', 'stripe', 'azul', 'cardnet', 'paypal')),
  expires_at   date,
  paid_at      timestamptz,
  paid_amount  numeric(12,2),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  check (status <> 'paid' or (paid_at is not null and paid_amount is not null)),
  check (status = 'paid' or (paid_at is null and paid_amount is null))
);

create index on public.payment_links (tenant_id, status);
create index on public.payment_links (tenant_id, customer_id);

comment on column public.payment_links.gateway is
  'Cual pasarela se PRETENDE usar. Ninguna esta conectada de verdad hoy: confirmar el pago es siempre una accion manual. Existe para no migrar el esquema el dia que una integracion real exista.';

create table public.recurring_charges (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  customer_id      uuid not null references public.customers(id),
  amount           numeric(12,2) not null check (amount > 0),
  description      text not null,
  frequency        text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  next_charge_date date not null,
  is_active        boolean not null default true,
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create index on public.recurring_charges (tenant_id, is_active, next_charge_date);

-- ── Confirmar un pago: la unica forma de marcar 'paid' ───────────────────
create function public.mark_payment_link_paid(
  p_link uuid, p_amount numeric, p_paid_at timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
begin
  select tenant_id, status into v_tenant, v_status
    from public.payment_links where id = p_link for update;

  if not found then
    raise exception 'Ese link de cobro no existe.' using errcode = 'P0002';
  end if;
  if v_tenant is distinct from rls.tenant_id() then
    raise exception 'Ese link no es de este cliente.' using errcode = '42501';
  end if;
  if v_status = 'paid' then
    raise exception 'Ese link ya esta marcado como pagado.' using errcode = '55000';
  end if;
  if v_status = 'canceled' then
    raise exception 'Un link cancelado no se puede marcar como pagado.' using errcode = '55000';
  end if;
  if p_amount <= 0 then
    raise exception 'El monto debe ser mayor que cero.' using errcode = '55000';
  end if;

  update public.payment_links
  set status = 'paid', paid_at = p_paid_at, paid_amount = p_amount
  where id = p_link;
end;
$$;

revoke all on function public.mark_payment_link_paid(uuid, numeric, timestamptz) from public;
grant execute on function public.mark_payment_link_paid(uuid, numeric, timestamptz) to authenticated;

-- ── Generar los cobros recurrentes vencidos ──────────────────────────────
--  Idempotente por diseño: avanza next_charge_date DESPUES de generar el
--  link, asi que correrla dos veces el mismo dia no genera un segundo link
--  para el mismo periodo -la fecha ya quedo en el futuro tras la primera
--  corrida-.
create function public.run_recurring_charges(p_tenant uuid, p_asof date default current_date) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  r   record;
  v_siguiente date;
begin
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes generar cobros de otro cliente.' using errcode = '42501';
  end if;
  if not rls.module_active('payments') then
    raise exception 'El modulo de pasarelas de cobro no esta activo.' using errcode = '42501';
  end if;

  for r in
    select id, customer_id, amount, description, frequency, next_charge_date
    from public.recurring_charges
    where tenant_id = p_tenant and is_active and next_charge_date <= p_asof
  loop
    insert into public.payment_links (tenant_id, customer_id, amount, description, expires_at)
    values (p_tenant, r.customer_id, r.amount, r.description, r.next_charge_date + 15);

    v_siguiente := case r.frequency
      when 'weekly'  then r.next_charge_date + interval '7 days'
      when 'monthly' then r.next_charge_date + interval '1 month'
      else                r.next_charge_date + interval '1 year'
    end;

    update public.recurring_charges set next_charge_date = v_siguiente where id = r.id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.run_recurring_charges(uuid, date) from public;
grant execute on function public.run_recurring_charges(uuid, date) to authenticated;

comment on function public.run_recurring_charges(uuid, date) is
  'Genera un link de cobro por cada cobro recurrente vencido y avanza su proxima fecha. No cobra nada de verdad -solo crea el link pendiente, igual que el resto del modulo-.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('payment_links',     'payments'),
      ('recurring_charges', 'payments')
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
-- fixed-assets/budgets/cost-centers), tapado desde el primer dia: la RLS
-- de insert solo compara el tenant_id de la fila nueva, no a quien
-- pertenece customer_id. Una sola funcion sirve para las dos tablas -las
-- dos tienen customer_id + tenant_id-, aunque en payment_links es
-- opcional (un link puede no tener cliente asociado).
create function public.impedir_cliente_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.customer_id is null then
    return new;
  end if;
  select tenant_id into v_tenant from public.customers where id = new.customer_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese cliente no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_cliente_ajeno before insert or update on public.payment_links
  for each row execute function public.impedir_cliente_ajeno();
create trigger no_cliente_ajeno before insert or update on public.recurring_charges
  for each row execute function public.impedir_cliente_ajeno();

-- ── Un link pagado o cancelado queda historico ───────────────────────────
create function public.impedir_editar_link_terminal() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('paid', 'canceled') then
    raise exception 'Un link pagado o cancelado no se edita: es historico.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_link_terminal before update or delete on public.payment_links
  for each row execute function public.impedir_editar_link_terminal();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.payment_links
  for each row execute function audit.record('payments');
create trigger audit_me after insert or update or delete on public.recurring_charges
  for each row execute function audit.record('payments');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{}',
    recommends   = '{ar}',
    tagline      = 'Genera el link de cobro y no pierdas el rastro de quien ya pago',
    problem      = 'Pedir un pago por WhatsApp o por telefono es facil; llevar la cuenta de a quien se le pidio, cuanto, y si ya pago o no, es lo que se pierde -y con los cobros recurrentes, es peor: alguien tiene que acordarse cada mes-.',
    features     = '[
      {"titulo":"Link de cobro con vencimiento","detalle":"Genera un link con su monto, su descripcion y su fecha de vencimiento, listo para compartir por el canal que sea."},
      {"titulo":"Confirmar el pago es manual, y esta bien que lo sea","detalle":"Sin una pasarela real conectada, marcar un link como pagado es una decision humana -el dinero se recibio por el canal real que fue, esto solo lleva el registro-."},
      {"titulo":"Cobro recurrente que se genera solo","detalle":"Configura un cobro semanal, mensual o anual una sola vez, y el sistema genera el siguiente link cuando toca -sin que nadie tenga que acordarse-."},
      {"titulo":"Honesto sobre lo que falta","detalle":"El campo de pasarela ya esta listo para Stripe, Azul, CardNet o PayPal el dia que haya credenciales reales y una revision de seguridad -hoy, los cuatro se resuelven a confirmacion manual-."}
    ]'::jsonb,
    audience     = '{"Negocios que cobran por servicios recurrentes","Freelancers y consultorias","Cualquiera que cobre por WhatsApp o telefono y quiera llevar la cuenta"}',
    faq          = '[
      {"p":"¿Realmente cobra la tarjeta del cliente?","r":"No. No hay ninguna pasarela de pago conectada de verdad -eso pide credenciales de comercio reales y una revision de seguridad que este modulo no incluye todavia-. El pago se confirma a mano cuando el dinero de verdad llega."},
      {"p":"¿Que pasa si un cobro recurrente se genera con la app apagada varios dias?","r":"Al volver a correr, genera el link atrasado y calcula la siguiente fecha a partir de CUANDO DEBIO cobrar, no de hoy -para no perder el ritmo del calendario original-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'payments';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'payments'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'payments no tiene precio en los 3 tiers';
  end if;
end $$;
