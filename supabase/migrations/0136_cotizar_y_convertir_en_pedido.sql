-- ═══════════════════════════════════════════════════════════════════════
--  0136 — Cotizar y convertir en pedido (venta a credito de punta a punta)
--
--  ── El fallo (encontrado usando la app como vendedor de la demo) ──────
--
--  * El Vendedor tiene en su menu Cotizaciones (0006), pero con
--    `quotes.create` / `quotes.edit`, dos permisos que ningun modulo
--    declara: el manifest de `quotes` pide `quotes.view` y
--    `quotes.manage`. Resultado: 404 en /cotizaciones-venta. El unico que
--    podia cotizarle a un cliente era el dueno.
--  * Tampoco veia las listas de precio con las que se le cobra a cada
--    cliente (404 en /listas-precio), aunque el pedido que el mismo arma
--    las aplica solas.
--  * Una cotizacion aprobada no llevaba a ningun lado: el pedido se
--    volvia a teclear a mano, linea por linea, con el riesgo de cobrar
--    otro precio del que el cliente acepto. Ahora se convierte, y la
--    cotizacion guarda que pedido salio de ella para no convertirla dos
--    veces.
--
--  `quotes.approve: false` de 0006 se deja como esta: el modulo no lo
--  usa. "Aprobada" en una cotizacion de venta es "el cliente la acepto",
--  y eso lo registra el vendedor.
--
--  ── Como ─────────────────────────────────────────────────────────────
--
--  Igual que 0135 y 0138: una funcion que solo AGREGA claves que el rol no
--  tiene (`nuevo || actual`, manda lo actual), llamada por la plantilla de
--  los clientes nuevos y por esta migracion para los que ya existen. Se
--  envuelve `provision_system_roles` con nombre propio, para que el orden
--  de las envolturas no importe.
-- ═══════════════════════════════════════════════════════════════════════

-- ── De que cotizacion salio el pedido ─────────────────────────────────
alter table public.quotes
  add column if not exists sales_order_id uuid references public.sales_orders(id);

create index if not exists quotes_tenant_id_sales_order_id_idx
  on public.quotes (tenant_id, sales_order_id) where sales_order_id is not null;

comment on column public.quotes.sales_order_id is
  'Pedido de venta creado al convertir esta cotizacion aprobada (0136). Una sola vez.';

-- ── Permisos de fabrica del Vendedor ──────────────────────────────────
create or replace function regb.permisos_de_fabrica_ventas(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.roles
  set permissions = '{"quotes.view": true, "quotes.manage": true,
                      "price-lists.view": true}'::jsonb || permissions,
      visible_modules = array(select distinct unnest(visible_modules || array['quotes','price-lists']))
  where tenant_id = p_tenant and is_system and name = 'Vendedor';
end;
$$;

revoke all on function regb.permisos_de_fabrica_ventas(uuid) from public;

alter function regb.provision_system_roles(uuid) rename to provision_system_roles_antes_0136;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_antes_0136(p_tenant);
  perform regb.permisos_de_fabrica_ventas(p_tenant);
end;
$$;

-- Los clientes que ya existen.
do $$
declare
  t record;
begin
  for t in select id from regb.tenants loop
    perform regb.permisos_de_fabrica_ventas(t.id);
  end loop;
end $$;
