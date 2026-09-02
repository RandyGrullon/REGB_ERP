-- ═══════════════════════════════════════════════════════════════════════
--  0018 — Catalogo de productos (F4 · S18)
--
--  `public.products` ya existia desde 0016 como tabla minima para que el
--  importador de CSV tuviera destino. Aqui se la asciende a catalogo de
--  verdad: codigo de barras, impuesto por producto, punto de reorden e
--  imagen.
--
--  Se AMPLIA, no se recrea: la leen el importador (0016) y el indice de
--  busqueda global. Recrearla obligaria a tocar ambos sin ganar nada.
--
--  Catalogo PLANO por decision de alcance: sin variantes ni kits en F4. Un
--  colmado y una ferreteria no los usan, y meterlos obliga a que inventario,
--  pedidos y POS manejen producto+variante en cada pantalla. Si un piloto
--  vende ropa, se anaden despues como migracion aditiva.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Categorias ─────────────────────────────────────────────────────────
--  Un solo nivel de jerarquia. Un arbol profundo no le sirve a nadie que
--  este saliendo de Excel.
create table public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  parent_id  uuid references public.product_categories(id) on delete set null,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, parent_id, name)
);

create index on public.product_categories (tenant_id, name);

-- ── Ampliacion del catalogo ────────────────────────────────────────────
alter table public.products
  add column barcode        text,
  add column tax_rate       numeric(5,4) not null default 0.18
                              check (tax_rate >= 0 and tax_rate <= 1),
  add column track_stock    boolean not null default true,
  add column reorder_point  numeric(14,3) check (reorder_point >= 0),
  add column image_file_id  uuid references public.files(id) on delete set null,
  add column category_id    uuid references public.product_categories(id) on delete set null;

-- Dos productos distintos no pueden compartir codigo de barras: el lector
-- del POS quedaria sin saber cual cobrar. Parcial porque la mayoria no tiene.
create unique index products_barcode_idx
  on public.products (tenant_id, barcode)
  where barcode is not null;

create index products_category_idx on public.products (tenant_id, category_id);

comment on column public.products.category is
  'Nombre de la categoria, desnormalizado para listados e importacion CSV. La relacion real es category_id.';
comment on column public.products.tax_rate is
  'ITBIS del producto. 0 para exentos (varios articulos de la canasta basica).';
comment on column public.products.track_stock is
  'False para servicios: se venden pero no se cuentan.';

-- La columna `category` de texto que ya existia se conserva y se rellena la
-- relacion a partir de ella, para no perder lo que trajo el importador.
do $$
declare r record;
begin
  for r in
    select distinct tenant_id, category
    from public.products
    where category is not null and btrim(category) <> ''
  loop
    insert into public.product_categories (tenant_id, name)
    values (r.tenant_id, r.category)
    on conflict (tenant_id, parent_id, name) do nothing;
  end loop;

  update public.products p
  set category_id = c.id
  from public.product_categories c
  where c.tenant_id = p.tenant_id
    and c.name = p.category
    and p.category_id is null;
end $$;

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.product_categories enable row level security;
alter table public.product_categories force row level security;

create policy tenant_module on public.product_categories
  for all
  using (tenant_id = rls.tenant_id() and rls.module_active('products'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('products'));

create policy provider_impersonating on public.product_categories
  for select
  using (rls.impersonating(tenant_id));

-- ── Bitacora ───────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.product_categories
  for each row execute function audit.record('products');
