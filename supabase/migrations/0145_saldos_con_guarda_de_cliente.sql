-- ═══════════════════════════════════════════════════════════════════════
--  0145 — Las funciones de saldo miran de quien es lo que suman
--
--  ── El defecto (probado con tokens reales contra Supabase) ────────────
--
--  18 funciones de `public` son SECURITY DEFINER -corren como dueño, sin
--  RLS- y reciben un id: `invoice_balance(factura)`,
--  `bank_account_balance(cuenta)`, `pos_expected_cash(turno)`,
--  `mark_overdue_invoices(cliente)`… Ninguna miraba de que cliente era ese
--  id, y `anon` y `authenticated` podian ejecutarlas.
--
--  En `regb_test` eso no se nota: no hay PostgREST. En Supabase, cada una
--  es un endpoint `/rest/v1/rpc/<nombre>`. Con la llave publica -sin
--  iniciar sesion- o con el token de un usuario del cliente A, y el id de
--  algo del cliente B, devolvian el saldo de B; `mark_overdue_invoices` y
--  `mark_overdue_supplier_invoices` ademas ESCRIBIAN en las facturas de B.
--  Los ids son uuid aleatorios -no se adivinan-, pero un id se filtra (una
--  URL compartida, un CSV, un soporte) y la regla del proyecto es que un
--  cliente no ve nada de otro por NINGUNA via, no "por ninguna via facil".
--
--  ── El arreglo ────────────────────────────────────────────────────────
--
--  `rls.puede_operar_en(tenant)`: quien llama puede tocar ese cliente si
--   · llama como `anon`/`authenticated` (PostgREST, o la web dentro de
--     `asUser`) y el cliente es el de su token, o el proveedor lo esta
--     impersonando;
--   · o NO llama como `anon`/`authenticated`: el servidor como dueño (el
--     despachador de eventos, `mark_overdue_invoices` desde /cobrar, las
--     pruebas, pg_cron). Ahi no hay un usuario que aislar.
--
--  El rol se lee de `current_setting('role')`, que dentro de una funcion
--  SECURITY DEFINER sigue diciendo con que rol entro la llamada (el dueño
--  cambia `current_user`, no ese valor).
--
--  Cada funcion conserva su cuerpo y su resultado para el cliente correcto;
--  para otro cliente responde como si el id no existiera (0 o null, lo que
--  ya respondia para un id inexistente): ni siquiera confirma que exista.
--  Y `anon` deja de poder ejecutarlas: nada sin sesion las necesita.
-- ═══════════════════════════════════════════════════════════════════════

create function rls.puede_operar_en(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(current_setting('role', true), ''), 'none') not in ('anon', 'authenticated')
      or (p_tenant is not null and p_tenant = rls.tenant_id())
      or (p_tenant is not null and rls.impersonating(p_tenant))
$$;

comment on function rls.puede_operar_en(uuid) is
  'True si quien llama puede leer o tocar datos de ese cliente: su propio tenant (JWT), el proveedor impersonandolo, o el servidor como dueño (sin rol anon/authenticated). Guarda de las funciones SECURITY DEFINER que reciben un id (0145).';

grant execute on function rls.puede_operar_en(uuid) to anon, authenticated;

-- ── Cuentas por cobrar y por pagar ─────────────────────────────────────
create or replace function public.invoice_balance(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select i.total
    + coalesce((
        select sum(f.amount) from public.invoice_late_fees f where f.invoice_id = i.id
      ), 0)
    - coalesce((
        select sum(p.amount) from public.customer_payments p
        where p.invoice_id = i.id and p.reversed_at is null
      ), 0)
    - coalesce((
        select sum(n.total) from public.customer_credit_notes n where n.invoice_id = i.id
      ), 0)
  from public.customer_invoices i
  where i.id = p_invoice
    and rls.puede_operar_en(i.tenant_id)
$$;

create or replace function public.ap_invoice_balance(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select i.total - i.retention_amount - coalesce((
    select sum(p.amount) from public.supplier_payments p where p.invoice_id = i.id
  ), 0)
  from public.supplier_invoices i
  where i.id = p_invoice
    and rls.puede_operar_en(i.tenant_id)
$$;

create or replace function public.mark_overdue_invoices(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not rls.puede_operar_en(p_tenant) then
    return 0;
  end if;
  update public.customer_invoices i
  set status = 'overdue'
  where i.tenant_id = p_tenant
    and i.status in ('open','partially_paid')
    and i.due_date < current_date
    and public.invoice_balance(i.id) > 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.mark_overdue_supplier_invoices(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not rls.puede_operar_en(p_tenant) then
    return 0;
  end if;
  update public.supplier_invoices i
  set status = 'overdue'
  where i.tenant_id = p_tenant
    and i.status in ('open','partially_paid')
    and i.due_date < current_date
    and public.ap_invoice_balance(i.id) > 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── Bancos y caja ──────────────────────────────────────────────────────
create or replace function public.bank_account_balance(p_account uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.bank_accounts a
      where a.id = p_account and rls.puede_operar_en(a.tenant_id)
    ) then 0
    else
      coalesce((select opening_balance from public.bank_accounts where id = p_account), 0)
      + coalesce((
          select sum(amount) from public.bank_transactions
          where bank_account_id = p_account and type in ('deposit', 'transfer_in')
        ), 0)
      - coalesce((
          select sum(amount) from public.bank_transactions
          where bank_account_id = p_account and type in ('withdrawal', 'transfer_out')
        ), 0)
  end
$$;

create or replace function public.pos_expected_cash(p_shift uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.opening_float, 0) + coalesce((
    select sum(p.amount)
    from public.pos_payments p
    join public.pos_sales sa on sa.id = p.sale_id
    where sa.shift_id = p_shift and not sa.voided and p.method = 'cash'
  ), 0)
  from public.pos_shifts s
  where s.id = p_shift
    and rls.puede_operar_en(s.tenant_id)
$$;

-- ── Activos fijos ──────────────────────────────────────────────────────
create or replace function public.fixed_asset_current_basis(p_asset uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.fixed_assets a
      where a.id = p_asset and rls.puede_operar_en(a.tenant_id)
    ) then null
    else coalesce(
      (select new_value from public.fixed_asset_revaluations
        where asset_id = p_asset order by revaluation_date desc, created_at desc limit 1),
      (select acquisition_cost from public.fixed_assets where id = p_asset)
    )
  end
$$;

create or replace function public.fixed_asset_accumulated_depreciation(p_asset uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.fixed_assets a
      where a.id = p_asset and rls.puede_operar_en(a.tenant_id)
    ) then 0
    else (select coalesce(sum(amount), 0) from public.fixed_asset_depreciations where asset_id = p_asset)
  end
$$;

-- fixed_asset_book_value() suma las dos de arriba: queda cubierta por ellas.

create or replace function public.fixed_asset_monthly_depreciation(p_asset uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metodo      text;
  v_rescate     numeric;
  v_vida        integer;
  v_base        numeric;
  v_valor_libros numeric;
  v_depreciable numeric;
  v_monto       numeric;
begin
  select depreciation_method, salvage_value, useful_life_months
    into v_metodo, v_rescate, v_vida
    from public.fixed_assets
    where id = p_asset and rls.puede_operar_en(tenant_id);
  if not found then
    return 0;
  end if;

  v_base := public.fixed_asset_current_basis(p_asset);
  v_valor_libros := v_base - public.fixed_asset_accumulated_depreciation(p_asset);
  v_depreciable := greatest(v_valor_libros - v_rescate, 0);
  if v_depreciable <= 0 then
    return 0;
  end if;

  if v_metodo = 'straight_line' then
    v_monto := (v_base - v_rescate) / v_vida;
  else
    v_monto := v_valor_libros * (2.0 / v_vida);
  end if;

  return round(least(v_monto, v_depreciable), 2);
end;
$$;

-- ── Fidelizacion ───────────────────────────────────────────────────────
create or replace function public.loyalty_balance(p_customer uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points), 0)::integer
  from public.loyalty_transactions
  where customer_id = p_customer
    and rls.puede_operar_en(tenant_id);
$$;

create or replace function public.loyalty_lifetime_points(p_customer uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points), 0)::integer
  from public.loyalty_transactions
  where customer_id = p_customer and points > 0
    and rls.puede_operar_en(tenant_id);
$$;

-- ── Proyectos, recursos y servicio de campo ────────────────────────────
create or replace function public.project_budget_total(p_project uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.project_budgets
  where project_id = p_project and rls.puede_operar_en(tenant_id);
$$;

create or replace function public.project_cost_total(p_project uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.project_costs
  where project_id = p_project and rls.puede_operar_en(tenant_id);
$$;

create or replace function public.project_wip(p_project uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount) filter (where not billed), 0) from public.project_costs
  where project_id = p_project and rls.puede_operar_en(tenant_id);
$$;

create or replace function public.resource_allocated_hours(p_tenant uuid, p_user uuid, p_week date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(hours), 0)
  from public.resource_allocations
  where tenant_id = p_tenant and user_id = p_user and week_start = p_week
    and rls.puede_operar_en(p_tenant);
$$;

create or replace function public.service_order_parts_cost(p_tenant uuid, p_order uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(qty * unit_cost), 0)
  from public.service_parts
  where tenant_id = p_tenant and order_id = p_order
    and rls.puede_operar_en(p_tenant);
$$;

-- ── Sin sesion, ninguna ────────────────────────────────────────────────
--  `ecf_tenant_por_token` la usa /api/ecf desde el servidor como dueño: no
--  la necesita nadie por PostgREST, y entregaba RNC y cliente a quien
--  tuviera un token.
revoke execute on function public.invoice_balance(uuid) from public, anon;
revoke execute on function public.ap_invoice_balance(uuid) from public, anon;
revoke execute on function public.mark_overdue_invoices(uuid) from public, anon;
revoke execute on function public.mark_overdue_supplier_invoices(uuid) from public, anon;
revoke execute on function public.bank_account_balance(uuid) from public, anon;
revoke execute on function public.pos_expected_cash(uuid) from public, anon;
revoke execute on function public.fixed_asset_current_basis(uuid) from public, anon;
revoke execute on function public.fixed_asset_accumulated_depreciation(uuid) from public, anon;
revoke execute on function public.fixed_asset_book_value(uuid) from public, anon;
revoke execute on function public.fixed_asset_monthly_depreciation(uuid) from public, anon;
revoke execute on function public.loyalty_balance(uuid) from public, anon;
revoke execute on function public.loyalty_lifetime_points(uuid) from public, anon;
revoke execute on function public.project_budget_total(uuid) from public, anon;
revoke execute on function public.project_cost_total(uuid) from public, anon;
revoke execute on function public.project_wip(uuid) from public, anon;
revoke execute on function public.resource_allocated_hours(uuid, uuid, date) from public, anon;
revoke execute on function public.service_order_parts_cost(uuid, uuid) from public, anon;
revoke execute on function public.ecf_tenant_por_token(text) from public, anon, authenticated;

grant execute on function public.invoice_balance(uuid) to authenticated;
grant execute on function public.ap_invoice_balance(uuid) to authenticated;
grant execute on function public.mark_overdue_invoices(uuid) to authenticated;
grant execute on function public.mark_overdue_supplier_invoices(uuid) to authenticated;
grant execute on function public.bank_account_balance(uuid) to authenticated;
grant execute on function public.pos_expected_cash(uuid) to authenticated;
grant execute on function public.fixed_asset_current_basis(uuid) to authenticated;
grant execute on function public.fixed_asset_accumulated_depreciation(uuid) to authenticated;
grant execute on function public.fixed_asset_book_value(uuid) to authenticated;
grant execute on function public.fixed_asset_monthly_depreciation(uuid) to authenticated;
grant execute on function public.loyalty_balance(uuid) to authenticated;
grant execute on function public.loyalty_lifetime_points(uuid) to authenticated;
grant execute on function public.project_budget_total(uuid) to authenticated;
grant execute on function public.project_cost_total(uuid) to authenticated;
grant execute on function public.project_wip(uuid) to authenticated;
grant execute on function public.resource_allocated_hours(uuid, uuid, date) to authenticated;
grant execute on function public.service_order_parts_cost(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  Vuelta atras (down): recrear cada funcion con el cuerpo de su migracion
--  original (sin la linea de `rls.puede_operar_en`), `grant execute ... to
--  public` en cada una y `drop function rls.puede_operar_en(uuid)`.
-- ═══════════════════════════════════════════════════════════════════════
