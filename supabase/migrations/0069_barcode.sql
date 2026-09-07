-- ═══════════════════════════════════════════════════════════════════════
--  0069 — Codigos de barra & RFID (modulo 52, F8/S48)
--
--  `products.barcode` ya existe desde el catalogo original, con su
--  indice unico parcial (`products_barcode_idx`, 0016). Este modulo no
--  agrega una columna nueva: agrega la GENERACION real (EAN-13 con
--  digito verificador calculado, no un numero al azar -
--  digitoVerificadorEan13()/generarEan13() en @regb/operations-), las
--  ETIQUETAS para imprimir (patronBarrasEan13() dibuja el codigo de
--  barras entero en SVG, sin libreria externa), y el ESCANEO -camara
--  del celular via BarcodeDetector cuando el navegador lo soporta, con
--  entrada manual como respaldo, que es ademas exactamente como
--  trabaja un lector de codigo de barras fisico tipo "keyboard wedge"-.
--
--  Sin RFID: el nombre del catalogo lo menciona, pero no hay hardware
--  de lectura RFID que integrar aqui. Optico solamente, declarado
--  explicitamente.
--
--  `barcode_scans` es la unica tabla nueva: una bitacora de cada
--  escaneo -que producto, que codigo, quien, cuando-, para trazabilidad.
-- ═══════════════════════════════════════════════════════════════════════

create table public.barcode_scans (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  scanned_code  text not null,
  scanned_by    uuid,
  scanned_at    timestamptz not null default now()
);

create index on public.barcode_scans (tenant_id, product_id);
create index on public.barcode_scans (tenant_id, scanned_at desc);

alter table public.barcode_scans enable row level security;
alter table public.barcode_scans force row level security;

create policy tenant_module on public.barcode_scans for all
  using (tenant_id = rls.tenant_id() and rls.module_active('barcode'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('barcode'));
create policy provider_impersonating on public.barcode_scans for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenece product_id.
create function public.impedir_escaneo_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_escaneo_ajeno before insert or update on public.barcode_scans
  for each row execute function public.impedir_escaneo_ajeno();

-- Un escaneo es un hecho historico -paso en un momento dado-, igual
-- que audit.log: inmutable desde el primer insert, sin condicion.
create function public.impedir_editar_escaneo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un escaneo ya registrado no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_escaneo
  before update or delete on public.barcode_scans
  for each row execute function public.impedir_editar_escaneo();

create trigger audit_me after insert on public.barcode_scans
  for each row execute function audit.record('barcode');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'EAN-13 real con digito verificador calculado -no un numero al azar-, escaneo con la camara del celular',
    problem      = 'Sin esto, asignar codigos de barra es escribir numeros a mano -o inventarlos-, y el lector fisico no tiene con que hacer match si el producto nunca tuvo un codigo real.',
    features     = '[
      {"titulo":"EAN-13 de verdad, no un numero al azar","detalle":"El digito verificador se calcula con el algoritmo oficial de GS1 -impares por 1, pares por 3, resto de 10-, igual que cualquier codigo de barras real de fabrica."},
      {"titulo":"Etiquetas listas para imprimir","detalle":"El codigo de barras se dibuja completo -barras reales, no una imagen generica- a partir del EAN-13, sin depender de ningun servicio externo."},
      {"titulo":"Escaneo con la camara, o con el lector de siempre","detalle":"La camara del celular escanea cuando el navegador lo soporta; si no, la casilla de entrada manual funciona identico a un lector fisico tipo pistola."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio con productos fisicos que hoy no tienen codigo de barras real","Quien ya tiene lectores de codigo de barras y quiere que el catalogo por fin tenga con que hacer match"}',
    faq          = '[
      {"p":"¿Tambien lee RFID?","r":"No todavia -el nombre del modulo lo menciona, pero no hay hardware de lectura RFID integrado. Es optico, con camara o lector de codigo de barras-."},
      {"p":"¿Que pasa si el navegador no soporta escaneo con camara?","r":"La misma pantalla acepta entrada manual -escribiendo el codigo o usando un lector fisico tipo pistola, que funciona exactamente igual-."}
    ]'::jsonb,
    setup_minutes = 5
where id = 'barcode';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'barcode'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'barcode no tiene precio en los 3 tiers';
  end if;
end $$;
