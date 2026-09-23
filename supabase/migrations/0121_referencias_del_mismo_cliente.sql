-- ═══════════════════════════════════════════════════════════════════════
--  0121 — El agujero de siempre, cerrado en todo el esquema
--
--  ── El hallazgo ───────────────────────────────────────────────────────
--
--  Una clave foranea se comprueba SIN pasar por la RLS, y la RLS de
--  escritura solo compara el tenant_id de la fila NUEVA. Un usuario de A
--  podia guardar una fila con su propio tenant_id -que pasa la RLS-
--  apuntando a una fila de B. Desde `ap` (0042) cada modulo nuevo trae su
--  trigger impedir_*_ajeno; las fichas de `users` y `branches` avisaron
--  que el core nunca lo tuvo.
--
--  Reproducido como `authenticated` antes de escribir esto
--  (supabase/tests/fk-guardas.test.ts, en rojo sin esta migracion):
--
--   · memberships.role_id: A se asigna el rol de B, por INSERT y por
--     UPDATE de SU propia membresia. No es cosmetico: el hook (0008) mete
--     ese role_id en el JWT, y rls.has_perm() (0109) devuelve TRUE cuando
--     el rol del token no es del tenant. Un rol ajeno en la membresia
--     apagaba de un golpe los permisos que la base si mira (costos,
--     expedientes, nomina, llaves de API, e-CF). Y bootstrap() lee el rol
--     por id sin filtrar tenant: la app le aplicaba los permisos de B.
--   · branches.company_id: una sucursal de A colgando de la empresa de B.
--   · De paso, la FK servia de oraculo: un id inventado daba 23503 y uno
--     real de otro cliente se aceptaba. Ahora los dos reciben el mismo
--     42501.
--
--  ── El barrido ────────────────────────────────────────────────────────
--
--  pg_constraint da 218 FK de public entre dos tablas con tenant_id (todas
--  simples, contra `id`, ninguna diferible). Comparadas con los triggers
--  existentes -y con una sonda viva que intenta colar la referencia por
--  INSERT y por UPDATE-:
--
--   · 88 ya tenian guarda en insert Y update. No se tocan.
--   · 45 no tenian ninguna: memberships.role_id, branches.company_id y 43
--     mas, casi todas de los modulos anteriores a la regla (0014-0038:
--     pos, pedidos, compras, inventario, cxc). Cuatro tenian un trigger que
--     miraba OTRAS columnas de la fila (goods_receipt_lines.receipt_id,
--     mrp_suggestions.production_order_id, channel_product_links.
--     channel_id, payroll_lines.period_id); dos tenian un trigger que lee
--     products.tracks_stock pero no compara el tenant
--     (inventory_movements.product_id, stock_levels.product_id).
--   · 85 tenian la guarda SOLO en `before insert`. El UPDATE de la misma
--     columna la esquivaba: la sonda lo confirmo en attendance_geofences,
--     channel_product_links, price_list_entries y quote_lines, y en el
--     resto solo lo frena, por ahora, la regla de inmutabilidad de turno.
--     Que una fila no se pueda editar HOY no es una guarda de cliente.
--
--  ── Triggers y no FK compuesta (tenant_id, id) ────────────────────────
--
--  La FK compuesta es la forma declarativa y se considero. Aqui pierde:
--
--   1. Exige `unique (tenant_id, id)` en ~50 tablas referidas -products,
--      customers, warehouses entre ellas-: un indice mas en cada una,
--      solo para esto.
--   2. Hay que BORRAR y recrear las 130 FK. Dejar la simple (con su
--      `on delete cascade/set null`) junto a la compuesta hace que el
--      orden de los triggers RI decida si un borrado en cascada pasa.
--   3. Validar 130 FK recorre tablas enteras en el despliegue, con
--      bloqueo, en una base de ~500 clientes.
--   4. El error seria un 23503 generico. Las 100+ guardas del repo
--      responden 42501 "no pertenece a ese cliente", y las pantallas y las
--      pruebas ya cuentan con eso.
--   5. No cubre memberships.branch_ids/company_ids, que son arreglos,
--      viajan en el JWT y no tenian ni FK.
--
--  Con trigger el costo es una busqueda por clave primaria por referencia
--  y por fila escrita: lo mismo que ya hace la FK. Medido en esta base,
--  5000 lineas de pedido (dos referencias cada una): ~250 ms sin guarda,
--  ~350 ms con una funcion escrita a mano, ~450-650 ms con la generica de
--  abajo. Unos 20-40 microsegundos por referencia: un milisegundo en una
--  venta de 20 lineas, un par de segundos en una importacion de 50.000.
--
--  ── Una funcion generica, a proposito ─────────────────────────────────
--
--  La leccion de 0041/0117 ("una funcion por tabla") era por `new.<col>`:
--  en una funcion compartida revienta cuando las filas no tienen la misma
--  forma. Aqui la columna se lee con to_jsonb(new) ->> col, como hace
--  audit.record() desde 0004, y el par (columna, tabla) viaja como
--  argumento del trigger, como el module_id de la bitacora. Asi:
--
--   · 93 triggers no son 93 copias del mismo cuerpo, cada una con su
--     oportunidad de equivocarse de columna;
--   · lo que protege cada trigger queda en el catalogo (pg_trigger.tgargs)
--     y la red de fk-guardas.test.ts lo lee: la proxima tabla que se
--     olvide la guarda pone la prueba en rojo.
--
--  memberships y branches llevan funcion propia: son las dos que aparecen
--  en pantallas (/usuarios, /sucursales) y merecen un mensaje en idioma
--  de negocio, y memberships ademas revisa sus dos arreglos.
--
--  ── Lo que NO hace ────────────────────────────────────────────────────
--
--   · No revisa las filas que ya existen: una migracion que falla por un
--     dato viejo deja a TODOS los clientes sin desplegar. Lo mira la
--     prueba ("ninguna fila de la base apunta hoy a otro cliente") y la
--     ficha de users trae la consulta para correrla en produccion.
--   · El UPDATE solo re-comprueba la columna que CAMBIO (o si cambia el
--     tenant_id): editar el nombre de una fila no paga busquedas, y una
--     fila vieja rara no se vuelve imposible de editar por otra columna.
--   · No cubre columnas uuid sin FK (approved_by, user_id y similares):
--     no son esta familia.
--
--  Reversion: drop function public.impedir_referencia_ajena() cascade;
--  drop function public.impedir_rol_ajeno() cascade; drop function
--  public.impedir_empresa_ajena_sucursal() cascade; drop trigger audit_me
--  on public.roles. No hay _down aparte: migrate.mjs aplica todo .sql de
--  la carpeta en orden.
-- ═══════════════════════════════════════════════════════════════════════

-- ── La guarda generica ──────────────────────────────────────────────────
--  Uso: execute function public.impedir_referencia_ajena('col', 'tabla'
--       [, 'col2', 'tabla2' ...]). Cada par es una FK de la fila hacia
--       public.<tabla>.id.
--
--  SECURITY DEFINER por lo mismo que todos los impedir_*_ajeno: la fila
--  ajena es invisible bajo la RLS de quien escribe, y ademas un modulo
--  apagado le esconde sus PROPIAS filas; un select con sus permisos no
--  distinguiria "es de otro" de "no la veo". Solo lee el tenant_id de una
--  fila por id; no escribe nada con los privilegios prestados.
--
--  El valor va con %L y no como parametro: la tabla referida casi siempre
--  tiene id uuid, pero event_outbox lo tiene bigint, y un literal sin tipo
--  toma el de la columna y conserva el indice. La tabla sale de la
--  definicion del trigger (DDL), no de la fila, y va con %I.
create function public.impedir_referencia_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nueva  jsonb := to_jsonb(new);
  v_vieja  jsonb;
  v_col    text;
  v_tabla  text;
  v_valor  text;
  v_tenant uuid;
  i        integer;
begin
  if tg_nargs = 0 or tg_nargs % 2 <> 0 then
    raise exception 'impedir_referencia_ajena() en % espera pares (columna, tabla) y recibio % argumentos',
      tg_table_name, tg_nargs;
  end if;

  if tg_op = 'UPDATE' then
    v_vieja := to_jsonb(old);
  end if;

  for i in 0 .. tg_nargs - 1 by 2 loop
    v_col   := tg_argv[i];
    v_tabla := tg_argv[i + 1];
    v_valor := v_nueva ->> v_col;

    -- Una referencia nula no apunta a nadie. Si la columna no admite
    -- nulos, ya lo dice su NOT NULL.
    continue when v_valor is null;

    -- En un update solo se mira lo que cambio. La referencia de antes ya
    -- paso por aqui al insertarse -o es anterior a 0121, y eso lo vigila
    -- la prueba, no cada edicion ajena a esa columna-.
    continue when tg_op = 'UPDATE'
      and v_valor is not distinct from v_vieja ->> v_col
      and v_nueva ->> 'tenant_id' is not distinct from v_vieja ->> 'tenant_id';

    execute format('select tenant_id from public.%I where id = %L', v_tabla, v_valor)
      into v_tenant;

    -- Inexistente y ajeno reciben el mismo mensaje: distinguirlos le diria
    -- a quien prueba ids que filas existen en otro cliente.
    if v_tenant is distinct from (v_nueva ->> 'tenant_id')::uuid then
      raise exception '%.% apunta a un registro de % que no pertenece a ese cliente.',
        tg_table_name, v_col, v_tabla using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.impedir_referencia_ajena() is
  'Guarda de cliente generica (0121): cada par de argumentos (columna, tabla) es una FK hacia public.<tabla>.id que tiene que ser del mismo tenant_id que la fila. En update solo re-comprueba lo que cambio. 42501 tanto para ajeno como para inexistente.';

-- ═══════════════════════════════════════════════════════════════════════
--  Las dos del core, con mensaje para la pantalla
-- ═══════════════════════════════════════════════════════════════════════

-- ── memberships: el rol, y las sucursales y empresas del token ────────
--  branch_ids y company_ids no son FK -son arreglos- pero salen en el JWT
--  como `branches` y `companies` (0008): son alcance, y un alcance que
--  nombra sucursales de otro cliente no deberia poder existir. Un id que
--  no existe se rechaza igual que uno ajeno, por la misma razon que en la
--  funcion generica.
create function public.impedir_rol_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant    uuid;
  v_mismo     boolean := tg_op = 'UPDATE' and new.tenant_id is not distinct from old.tenant_id;
begin
  if not (v_mismo and new.role_id is not distinct from old.role_id) then
    select tenant_id into v_tenant from public.roles where id = new.role_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Ese rol no pertenece a ese cliente.' using errcode = '42501';
    end if;
  end if;

  if not (v_mismo and new.branch_ids is not distinct from old.branch_ids)
     and exists (select 1 from unnest(new.branch_ids) as b(id)
                 where not exists (select 1 from public.branches s
                                   where s.id = b.id and s.tenant_id = new.tenant_id)) then
    raise exception 'Alguna de esas sucursales no pertenece a ese cliente.' using errcode = '42501';
  end if;

  if not (v_mismo and new.company_ids is not distinct from old.company_ids)
     and exists (select 1 from unnest(new.company_ids) as c(id)
                 where not exists (select 1 from public.companies e
                                   where e.id = c.id and e.tenant_id = new.tenant_id)) then
    raise exception 'Alguna de esas empresas no pertenece a ese cliente.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- `update of`: activar, desactivar o marcar la membresia como aceptada no
-- toca estas columnas y no paga las busquedas.
create trigger no_rol_ajeno
  before insert or update of tenant_id, role_id, branch_ids, company_ids on public.memberships
  for each row execute function public.impedir_rol_ajeno();

-- ── branches: la empresa ────────────────────────────────────────────────
--  Mismo texto que impedir_asiento_de_empresa_ajena() (0117), para que la
--  regla se lea igual desde contabilidad y desde sucursales.
create function public.impedir_empresa_ajena_sucursal() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if tg_op = 'UPDATE'
     and new.company_id is not distinct from old.company_id
     and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;

  select tenant_id into v_tenant from public.companies where id = new.company_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa empresa no pertenece a ese cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_empresa_ajena
  before insert or update of tenant_id, company_id on public.branches
  for each row execute function public.impedir_empresa_ajena_sucursal();

-- ═══════════════════════════════════════════════════════════════════════
--  Las 43 FK que no tenian guarda: insert y update
--
--  El nombre ordena el disparo: los triggers de una tabla y momento van en
--  orden alfabetico, y `no_referencia_a_otro_cliente` cae despues de todos
--  los `no_editar_*`. Quien intenta editar una fila inmutable recibe el
--  mensaje que de verdad explica lo que pasa -mismo criterio que 0117-.
--  (Solo dos guardas propias de otras columnas, en goods_receipt_lines y
--  mrp_suggestions, disparan despues; da igual el orden: cada una mira lo
--  suyo.)
-- ═══════════════════════════════════════════════════════════════════════
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, parent_id on public.accounts
  for each row execute function public.impedir_referencia_ajena('parent_id', 'accounts');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, bank_account_id on public.bank_statement_lines
  for each row execute function public.impedir_referencia_ajena('bank_account_id', 'bank_accounts');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, channel_id on public.channel_product_links
  for each row execute function public.impedir_referencia_ajena('channel_id', 'sales_channels');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, customer_id on public.customer_invoices
  for each row execute function public.impedir_referencia_ajena('customer_id', 'customers');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, invoice_id on public.customer_payments
  for each row execute function public.impedir_referencia_ajena('invoice_id', 'customer_invoices');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, receipt_id on public.goods_receipt_lines
  for each row execute function public.impedir_referencia_ajena('receipt_id', 'goods_receipts');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, product_id on public.inspection_plans
  for each row execute function public.impedir_referencia_ajena('product_id', 'products');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, lot_id, product_id, warehouse_id on public.inventory_movements
  for each row execute function public.impedir_referencia_ajena('lot_id', 'product_lots', 'product_id', 'products', 'warehouse_id', 'warehouses');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, campaign_id on public.leads
  for each row execute function public.impedir_referencia_ajena('campaign_id', 'campaigns');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, production_order_id on public.mrp_suggestions
  for each row execute function public.impedir_referencia_ajena('production_order_id', 'production_orders');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, company_id on public.ncf_sequences
  for each row execute function public.impedir_referencia_ajena('company_id', 'companies');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, period_id on public.payroll_lines
  for each row execute function public.impedir_referencia_ajena('period_id', 'payroll_periods');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, sale_id on public.pos_payments
  for each row execute function public.impedir_referencia_ajena('sale_id', 'pos_sales');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, product_id, sale_id on public.pos_sale_lines
  for each row execute function public.impedir_referencia_ajena('product_id', 'products', 'sale_id', 'pos_sales');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, customer_id, shift_id on public.pos_sales
  for each row execute function public.impedir_referencia_ajena('customer_id', 'customers', 'shift_id', 'pos_shifts');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, warehouse_id on public.pos_shifts
  for each row execute function public.impedir_referencia_ajena('warehouse_id', 'warehouses');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, parent_id on public.product_categories
  for each row execute function public.impedir_referencia_ajena('parent_id', 'product_categories');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, category_id, image_file_id on public.products
  for each row execute function public.impedir_referencia_ajena('category_id', 'product_categories', 'image_file_id', 'files');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, order_id, product_id on public.purchase_order_lines
  for each row execute function public.impedir_referencia_ajena('order_id', 'purchase_orders', 'product_id', 'products');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, supplier_id, warehouse_id on public.purchase_orders
  for each row execute function public.impedir_referencia_ajena('supplier_id', 'suppliers', 'warehouse_id', 'warehouses');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, order_id, product_id on public.sales_order_lines
  for each row execute function public.impedir_referencia_ajena('order_id', 'sales_orders', 'product_id', 'products');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, customer_id, warehouse_id on public.sales_orders
  for each row execute function public.impedir_referencia_ajena('customer_id', 'customers', 'warehouse_id', 'warehouses');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, customer_id on public.service_orders
  for each row execute function public.impedir_referencia_ajena('customer_id', 'customers');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, count_id, product_id on public.stock_count_lines
  for each row execute function public.impedir_referencia_ajena('count_id', 'stock_counts', 'product_id', 'products');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, warehouse_id on public.stock_counts
  for each row execute function public.impedir_referencia_ajena('warehouse_id', 'warehouses');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, product_id, warehouse_id on public.stock_levels
  for each row execute function public.impedir_referencia_ajena('product_id', 'products', 'warehouse_id', 'warehouses');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, product_id, transfer_id on public.stock_transfer_lines
  for each row execute function public.impedir_referencia_ajena('product_id', 'products', 'transfer_id', 'stock_transfers');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, from_warehouse_id, to_warehouse_id on public.stock_transfers
  for each row execute function public.impedir_referencia_ajena('from_warehouse_id', 'warehouses', 'to_warehouse_id', 'warehouses');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, supplier_id on public.supplier_invoices
  for each row execute function public.impedir_referencia_ajena('supplier_id', 'suppliers');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, branch_id on public.warehouses
  for each row execute function public.impedir_referencia_ajena('branch_id', 'branches');

-- ═══════════════════════════════════════════════════════════════════════
--  Las 85 FK que solo tenian guarda al insertar: ahora tambien al editar
--
--  Solo `before update of <columna>`: el insert ya lo cubre la guarda del
--  modulo, con su mensaje, y no tiene sentido pagar la busqueda dos veces.
-- ═══════════════════════════════════════════════════════════════════════
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, branch_id on public.attendance_geofences
  for each row execute function public.impedir_referencia_ajena('branch_id', 'branches');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.attendance_records
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, event_id, rule_id on public.automation_runs
  for each row execute function public.impedir_referencia_ajena('event_id', 'event_outbox', 'rule_id', 'automation_rules');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, bank_account_id on public.bank_statement_imports
  for each row execute function public.impedir_referencia_ajena('bank_account_id', 'bank_accounts');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, bank_account_id on public.bank_transactions
  for each row execute function public.impedir_referencia_ajena('bank_account_id', 'bank_accounts');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, from_account_id, to_account_id on public.bank_transfers
  for each row execute function public.impedir_referencia_ajena('from_account_id', 'bank_accounts', 'to_account_id', 'bank_accounts');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.benefit_enrollments
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, loan_id, payroll_period_id on public.benefit_loan_payments
  for each row execute function public.impedir_referencia_ajena('loan_id', 'benefit_loans', 'payroll_period_id', 'payroll_periods');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.benefit_loans
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, campaign_id, lead_id on public.campaign_recipients
  for each row execute function public.impedir_referencia_ajena('campaign_id', 'campaigns', 'lead_id', 'leads');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, order_id, product_id on public.channel_order_lines
  for each row execute function public.impedir_referencia_ajena('order_id', 'channel_orders', 'product_id', 'products');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, channel_id on public.channel_orders
  for each row execute function public.impedir_referencia_ajena('channel_id', 'sales_channels');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, product_id on public.channel_product_links
  for each row execute function public.impedir_referencia_ajena('product_id', 'products');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, channel_id, parent_message_id on public.chat_messages
  for each row execute function public.impedir_referencia_ajena('channel_id', 'chat_channels', 'parent_message_id', 'chat_messages');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, plan_id, sales_order_id on public.commission_entries
  for each row execute function public.impedir_referencia_ajena('plan_id', 'commission_plans', 'sales_order_id', 'sales_orders');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, cost_center_id on public.cost_center_allocations
  for each row execute function public.impedir_referencia_ajena('cost_center_id', 'cost_centers');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, dashboard_id, report_id on public.dashboard_items
  for each row execute function public.impedir_referencia_ajena('dashboard_id', 'dashboards', 'report_id', 'report_definitions');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.employee_contracts
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, asset_id on public.fixed_asset_depreciations
  for each row execute function public.impedir_referencia_ajena('asset_id', 'fixed_assets');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, asset_id on public.fixed_asset_revaluations
  for each row execute function public.impedir_referencia_ajena('asset_id', 'fixed_assets');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, inspection_id on public.inspection_results
  for each row execute function public.impedir_referencia_ajena('inspection_id', 'inspections');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, plan_id, product_id on public.inspections
  for each row execute function public.impedir_referencia_ajena('plan_id', 'inspection_plans', 'product_id', 'products');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, invoice_id on public.invoice_late_fees
  for each row execute function public.impedir_referencia_ajena('invoice_id', 'customer_invoices');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, lead_id on public.lead_activities
  for each row execute function public.impedir_referencia_ajena('lead_id', 'leads');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, referred_customer_id, referrer_customer_id on public.loyalty_referrals
  for each row execute function public.impedir_referencia_ajena('referred_customer_id', 'customers', 'referrer_customer_id', 'customers');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, customer_id on public.loyalty_transactions
  for each row execute function public.impedir_referencia_ajena('customer_id', 'customers');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, target_product_id on public.mrp_runs
  for each row execute function public.impedir_referencia_ajena('target_product_id', 'products');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.payroll_lines
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.performance_improvement_plans
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, objective_id on public.performance_key_results
  for each row execute function public.impedir_referencia_ajena('objective_id', 'performance_objectives');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.performance_objectives
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.performance_one_on_ones
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.performance_reviews
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, invite_id on public.portal_access_log
  for each row execute function public.impedir_referencia_ajena('invite_id', 'portal_invites');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, customer_id on public.portal_invites
  for each row execute function public.impedir_referencia_ajena('customer_id', 'customers');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, price_list_id, product_id on public.price_list_entries
  for each row execute function public.impedir_referencia_ajena('price_list_id', 'price_lists', 'product_id', 'products');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, project_id on public.project_budgets
  for each row execute function public.impedir_referencia_ajena('project_id', 'projects');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, budget_id, project_id on public.project_costs
  for each row execute function public.impedir_referencia_ajena('budget_id', 'project_budgets', 'project_id', 'projects');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, project_id on public.project_milestones
  for each row execute function public.impedir_referencia_ajena('project_id', 'projects');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, project_id on public.project_tasks
  for each row execute function public.impedir_referencia_ajena('project_id', 'projects');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, product_id, quote_id on public.quote_lines
  for each row execute function public.impedir_referencia_ajena('product_id', 'products', 'quote_id', 'quotes');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, candidate_id, position_id on public.recruiting_applications
  for each row execute function public.impedir_referencia_ajena('candidate_id', 'recruiting_candidates', 'position_id', 'recruiting_positions');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, application_id on public.recruiting_interviews
  for each row execute function public.impedir_referencia_ajena('application_id', 'recruiting_applications');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, task_id on public.resource_allocations
  for each row execute function public.impedir_referencia_ajena('task_id', 'project_tasks');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, rfq_id, supplier_id on public.rfq_invitations
  for each row execute function public.impedir_referencia_ajena('rfq_id', 'rfqs', 'supplier_id', 'suppliers');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, rfq_id, supplier_id on public.rfq_quotes
  for each row execute function public.impedir_referencia_ajena('rfq_id', 'rfqs', 'supplier_id', 'suppliers');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, report_id on public.scheduled_exports
  for each row execute function public.impedir_referencia_ajena('report_id', 'report_definitions');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, order_id on public.service_checklist_items
  for each row execute function public.impedir_referencia_ajena('order_id', 'service_orders');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, order_id, product_id on public.service_parts
  for each row execute function public.impedir_referencia_ajena('order_id', 'service_orders', 'product_id', 'products');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, request_id on public.signature_events
  for each row execute function public.impedir_referencia_ajena('request_id', 'signature_requests');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, supplier_id on public.supplier_bank_accounts
  for each row execute function public.impedir_referencia_ajena('supplier_id', 'suppliers');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, supplier_id on public.supplier_documents
  for each row execute function public.impedir_referencia_ajena('supplier_id', 'suppliers');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, supplier_id on public.supplier_evaluations
  for each row execute function public.impedir_referencia_ajena('supplier_id', 'suppliers');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, invoice_id on public.supplier_payments
  for each row execute function public.impedir_referencia_ajena('invoice_id', 'supplier_invoices');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, depends_on_task_id, task_id on public.task_dependencies
  for each row execute function public.impedir_referencia_ajena('depends_on_task_id', 'project_tasks', 'task_id', 'project_tasks');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, ticket_id on public.ticket_messages
  for each row execute function public.impedir_referencia_ajena('ticket_id', 'tickets');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, task_id on public.time_entries
  for each row execute function public.impedir_referencia_ajena('task_id', 'project_tasks');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, employee_id on public.time_off_requests
  for each row execute function public.impedir_referencia_ajena('employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, enrollment_id on public.training_certificates
  for each row execute function public.impedir_referencia_ajena('enrollment_id', 'training_enrollments');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, competency_id, employee_id on public.training_employee_competencies
  for each row execute function public.impedir_referencia_ajena('competency_id', 'training_competencies', 'employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, course_id, employee_id on public.training_enrollments
  for each row execute function public.impedir_referencia_ajena('course_id', 'training_courses', 'employee_id', 'employees');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, endpoint_id, event_id on public.webhook_deliveries
  for each row execute function public.impedir_referencia_ajena('endpoint_id', 'webhook_endpoints', 'event_id', 'event_outbox');
create trigger no_referencia_a_otro_cliente_al_editar
  before update of tenant_id, product_id, work_order_id on public.work_order_parts
  for each row execute function public.impedir_referencia_ajena('product_id', 'products', 'work_order_id', 'work_orders');

-- ═══════════════════════════════════════════════════════════════════════
--  Bitacora de roles
--
--  public.roles no tenia audit_me: si alguien le daba a un cajero permiso
--  de descuento, no quedaba escrito, aunque el tour core.permisos promete
--  que "todo queda en la bitacora". 'rbac' porque de ahi son los permisos
--  que gobiernan /roles (rbac.role.edit). No hay columnas secretas que
--  tapar: permissions y scope son justo lo que se quiere ver cambiar.
-- ═══════════════════════════════════════════════════════════════════════
create trigger audit_me after insert or update or delete on public.roles
  for each row execute function audit.record('rbac');
