-- ═══════════════════════════════════════════════════════════════════════
--  0031 · Los tres numeradores eludian la RLS
-- ═══════════════════════════════════════════════════════════════════════
--
--  Mismo fallo que tenia `assign_ncf` antes de la 0030, en tres funciones
--  mas: son `security definer` —lo necesitan, escriben en tablas con RLS—
--  y reciben el tenant COMO PARAMETRO sin comprobarlo contra quien llama.
--
--  Dos consecuencias, las dos reales:
--
--  1. Cualquier usuario autenticado podia adelantarle el contador a otro
--     cliente. No lee sus datos, pero le mete huecos en la numeracion de
--     pedidos, tickets o facturas — y un salto en la numeracion de
--     comprobantes es justo lo que una fiscalizacion pregunta.
--
--  2. Con el modulo APAGADO seguian entregando numeros. Un tenant que
--     desactiva pedidos quema numeracion que no puede usar, y al
--     reactivarlo la serie arranca con huecos que nadie sabe explicar.
--
--  El gate de modulo se comprueba aqui y no en la RLS de la tabla porque
--  `security definer` la esquiva por definicion: si la funcion no lo
--  comprueba, no lo comprueba nadie.
--
--  Se deja `p_tenant` como parametro en vez de leerlo de los claims para
--  no cambiar la firma que ya llaman las acciones, y porque el error
--  explicito ("no puedes numerar de otro cliente") es mas util al depurar
--  que un numero silenciosamente equivocado.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.next_sales_order_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes numerar pedidos de otro cliente.' using errcode = '42501';
  end if;
  if not rls.module_active('sales-orders') then
    raise exception 'El modulo de pedidos no esta activo: no se entregan numeros.'
      using errcode = '42501';
  end if;

  insert into public.sales_order_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('PV-%s-%s', v_year, lpad(v_n::text, 5, '0'));
end;
$$;

create or replace function public.next_pos_sale_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes numerar tickets de otro cliente.' using errcode = '42501';
  end if;
  if not rls.module_active('pos') then
    raise exception 'El modulo de caja no esta activo: no se entregan numeros.'
      using errcode = '42501';
  end if;

  insert into public.pos_sale_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('TK-%s-%s', v_year, lpad(v_n::text, 6, '0'));
end;
$$;

create or replace function public.next_customer_invoice_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes numerar facturas de otro cliente.' using errcode = '42501';
  end if;
  if not rls.module_active('ar') then
    raise exception 'El modulo de cuentas por cobrar no esta activo: no se entregan numeros.'
      using errcode = '42501';
  end if;

  insert into public.customer_invoice_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('FA-%s-%s', v_year, lpad(v_n::text, 5, '0'));
end;
$$;

comment on function public.next_sales_order_number(uuid) is
  'Proximo numero de pedido. Solo del cliente que llama y solo con el modulo activo: un contador que avanza con el modulo apagado deja huecos que luego nadie sabe explicar.';
comment on function public.next_pos_sale_number(uuid) is
  'Proximo numero de ticket. Solo del cliente que llama y solo con el modulo activo.';
comment on function public.next_customer_invoice_number(uuid) is
  'Proximo numero de factura. Solo del cliente que llama y solo con el modulo activo.';
