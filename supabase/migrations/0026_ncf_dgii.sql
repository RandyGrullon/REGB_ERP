-- ═══════════════════════════════════════════════════════════════════════
--  0026 — Comprobantes fiscales (NCF) de la DGII
--
--  En Republica Dominicana una factura sin NCF valido no existe legalmente.
--  Esta es la base de todo el cumplimiento fiscal: sin secuencias
--  autorizadas no se puede emitir, y sin NCF en la factura no se pueden
--  armar los reportes 606/607.
--
--  Lo que NO esta aqui, a proposito: la transmision del e-CF a la DGII
--  (firma con certificado, XML, endpoint, modo contingencia). Eso es el
--  modulo `e-invoice` (#25) de F6 y depende de credenciales reales y de un
--  decreto que cambia. Lo que si queda listo es el esquema que ese modulo
--  necesitara, incluido el tipo de comprobante electronico.
--
--  ASIGNAR UN NCF ES IRREVERSIBLE. Un numero consumido no se devuelve
--  aunque la factura se anule: la DGII espera ver ese comprobante
--  reportado como anulado en el 608, no desaparecido. Un hueco en la
--  secuencia es un hallazgo en una auditoria.
-- ═══════════════════════════════════════════════════════════════════════

create table public.ncf_sequences (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  company_id   uuid references public.companies(id),
  -- Cada razon social tiene sus propias autorizaciones.
  ncf_type     text not null check (ncf_type in
                 ('B01','B02','B04','B14','B15','B16','E31','E32','E33','E34')),
  -- Rango que autorizo la DGII. `next_number` avanza dentro de el.
  range_from   integer not null check (range_from > 0),
  range_to     integer not null,
  next_number  integer not null,
  -- Las autorizaciones VENCEN. Emitir con una vencida invalida la factura.
  expires_on   date not null,
  authorization_ref text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  check (range_to >= range_from),
  check (next_number >= range_from and next_number <= range_to + 1)
);

-- Una sola secuencia vigente por tipo y empresa: con dos activas nadie
-- sabria de cual sale el proximo numero.
create unique index ncf_sequences_one_active_idx
  on public.ncf_sequences (tenant_id, coalesce(company_id, tenant_id), ncf_type)
  where is_active;

create index on public.ncf_sequences (tenant_id, expires_on) where is_active;

comment on table public.ncf_sequences is
  'Rangos de NCF autorizados por la DGII. Ver packages/operations/src/dgii.ts para la logica compartida.';

-- ── La factura lleva su comprobante ──────────────────────────────────────
alter table public.customer_invoices
  add column ncf          text,
  add column ncf_type     text check (ncf_type in
                            ('B01','B02','B04','B14','B15','B16','E31','E32','E33','E34')),
  -- Se congela el RNC del comprador tal como estaba al emitir: si el
  -- cliente lo corrige despues, el 607 ya presentado no puede cambiar.
  add column buyer_tax_id text;

create unique index customer_invoices_ncf_idx
  on public.customer_invoices (tenant_id, ncf) where ncf is not null;

comment on column public.customer_invoices.ncf is
  'Comprobante fiscal completo (B0200000001). Unico por tenant: un NCF repetido es rechazo en el 607.';

-- El POS tambien factura, y tambien necesita comprobante.
alter table public.pos_sales
  add column ncf      text,
  add column ncf_type text;

create unique index pos_sales_ncf_idx
  on public.pos_sales (tenant_id, ncf) where ncf is not null;

-- ── Asignacion atomica ───────────────────────────────────────────────────
--  `for update` sobre la secuencia: dos cajeros cobrando a la vez no
--  pueden llevarse el mismo numero. Que dos facturas compartan NCF es de
--  las pocas cosas que la DGII no perdona.
create function public.assign_ncf(
  p_tenant  uuid,
  p_type    text,
  p_company uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq    public.ncf_sequences;
  v_numero integer;
  v_digitos integer;
begin
  select * into v_seq
  from public.ncf_sequences
  where tenant_id = p_tenant
    and ncf_type = p_type
    and is_active
    and (company_id = p_company or (company_id is null and p_company is null))
  for update;

  if not found then
    raise exception 'No hay secuencia activa de % para este cliente. Registra la autorizacion de la DGII.', p_type
      using errcode = 'P0002';
  end if;

  if v_seq.expires_on < current_date then
    raise exception 'La secuencia de % vencio el %. Pide una autorizacion nueva a la DGII.',
      p_type, v_seq.expires_on using errcode = 'P0003';
  end if;

  if v_seq.next_number > v_seq.range_to then
    raise exception 'Se agotaron los NCF de % (rango % - %). Pide una autorizacion nueva.',
      p_type, v_seq.range_from, v_seq.range_to using errcode = 'P0004';
  end if;

  v_numero := v_seq.next_number;

  update public.ncf_sequences
  set next_number = next_number + 1
  where id = v_seq.id;

  -- La serie E lleva 10 digitos; la B, 8. Igual que formatNcf() en
  -- packages/operations/src/dgii.ts — se replica aqui porque una funcion
  -- de Postgres no puede llamar a TypeScript.
  v_digitos := case when left(p_type, 1) = 'E' then 10 else 8 end;
  return p_type || lpad(v_numero::text, v_digitos, '0');
end;
$$;

revoke all on function public.assign_ncf(uuid, text, uuid) from public;
grant execute on function public.assign_ncf(uuid, text, uuid) to authenticated;

comment on function public.assign_ncf(uuid, text, uuid) is
  'Consume el proximo NCF de forma atomica. Irreversible: un numero usado no vuelve, ni aunque se anule la factura (va al 608).';

-- ── Reporte 607: ventas del periodo ─────────────────────────────────────
--  Formato oficial de la DGII. Se expone como vista para que el modulo
--  `e-invoice` de F6 solo tenga que serializarla, no recalcularla.
create view public.dgii_607 as
select
  i.tenant_id,
  to_char(i.issue_date, 'YYYYMM')                     as periodo,
  coalesce(i.buyer_tax_id, c.tax_id)                  as rnc_comprador,
  case when length(coalesce(i.buyer_tax_id, c.tax_id)) = 9 then '1'
       when length(coalesce(i.buyer_tax_id, c.tax_id)) = 11 then '2'
       else '3' end                                   as tipo_identificacion,
  i.ncf,
  i.ncf_type,
  to_char(i.issue_date, 'YYYYMMDD')                   as fecha_comprobante,
  i.subtotal - i.discount                             as monto_facturado,
  i.tax                                               as itbis_facturado,
  i.total,
  i.status = 'void'                                   as anulado
from public.customer_invoices i
join public.customers c on c.id = i.customer_id
where i.ncf is not null;

comment on view public.dgii_607 is
  'Ventas del periodo en el formato del 607. La consume el modulo e-invoice (F6) para generar el archivo.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.ncf_sequences enable row level security;
alter table public.ncf_sequences force row level security;

-- Las secuencias las usan facturacion (ar) y la caja (pos): sin esto, un
-- colmado con POS pero sin cuentas por cobrar no podria emitir un ticket
-- con comprobante fiscal.
create policy tenant_ar on public.ncf_sequences
  for all
  using (tenant_id = auth.tenant_id() and auth.module_active('ar'))
  with check (tenant_id = auth.tenant_id() and auth.module_active('ar'));

create policy tenant_pos on public.ncf_sequences
  for all
  using (tenant_id = auth.tenant_id() and auth.module_active('pos'))
  with check (tenant_id = auth.tenant_id() and auth.module_active('pos'));

create policy provider_impersonating on public.ncf_sequences
  for select using (auth.impersonating(tenant_id));

create trigger audit_me after insert or update or delete on public.ncf_sequences
  for each row execute function audit.record('ar');
