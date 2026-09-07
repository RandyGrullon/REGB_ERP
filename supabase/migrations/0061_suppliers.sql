-- ═══════════════════════════════════════════════════════════════════════
--  0061 — Proveedores (modulo 42, F8/S43)
--
--  BUG REAL ENCONTRADO ANTES DE ESCRIBIR UNA SOLA TABLA NUEVA: la RLS de
--  `public.suppliers` (0038) solo revisaba `rls.module_active('purchase-orders')`
--  -exactamente lo que su propio comentario original anticipaba ("vive
--  aqui... hasta que exista ap o suppliers")-. Pero `ap` (0042) ya
--  referencia `suppliers` desde `supplier_invoices.supplier_id`, y el
--  catalogo de `ap` no requiere `purchase-orders` (`requires: {}`). Un
--  tenant con SOLO `ap` activo -un caso perfectamente valido segun el
--  propio catalogo- podia ver sus facturas de proveedor pero el nombre
--  del proveedor le llegaba `null`: la fila de `suppliers` quedaba
--  invisible bajo RLS. Verificado reproduciendolo contra Docker local
--  antes de tocar nada. Se corrige ampliando la politica -nunca
--  reduciendo el acceso ya existente- para que `purchase-orders`, `ap` o
--  `suppliers` desbloqueen la ficha basica del proveedor; las tablas
--  nuevas de este modulo (documentos, cuentas bancarias, evaluaciones)
--  quedan exclusivas de `suppliers`.
--
--  Si algun documento del proveedor esta vencido se deriva SIEMPRE
--  -tieneDocumentoVencido()/certificadoVigente() en @regb/operations-,
--  nunca se guarda como una bandera aparte.
-- ═══════════════════════════════════════════════════════════════════════

alter policy tenant_module on public.suppliers
  using (
    tenant_id = rls.tenant_id()
    and (rls.module_active('purchase-orders') or rls.module_active('ap') or rls.module_active('suppliers'))
  )
  with check (
    tenant_id = rls.tenant_id()
    and (rls.module_active('purchase-orders') or rls.module_active('ap') or rls.module_active('suppliers'))
  );

comment on policy tenant_module on public.suppliers is
  'Ampliada en 0061: purchase-orders (dueño original, 0038), ap (0042) o suppliers (0061, ficha/evaluacion/documentos) desbloquean la ficha basica. Un tenant con solo ap activo dejo de perder el nombre del proveedor en su factura -bug real encontrado antes de construir este modulo-.';

-- ── Homologacion: un estado, no un flujo de aprobacion aparte ────────────
alter table public.suppliers
  add column qualification_status text not null default 'pending'
    check (qualification_status in ('pending', 'qualified', 'disqualified'));

create table public.supplier_documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id),
  doc_type     text not null check (doc_type in
                 ('rnc_certificate', 'insurance', 'tax_compliance', 'contract', 'other')),
  doc_number   text,
  issued_at    date,
  expires_at   date,
  notes        text,
  created_at   timestamptz not null default now()
);

create index on public.supplier_documents (tenant_id, supplier_id);

create table public.supplier_bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  supplier_id    uuid not null references public.suppliers(id),
  bank_name      text not null,
  account_number text not null,
  account_type   text not null default 'checking' check (account_type in ('checking', 'savings')),
  currency       text not null default 'DOP',
  created_at     timestamptz not null default now()
);

create index on public.supplier_bank_accounts (tenant_id, supplier_id);

-- Una evaluacion es un hecho fijo una vez registrada -mismo criterio
-- que una evaluacion de desempeno o un certificado de capacitacion-.
create table public.supplier_evaluations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id),
  score         integer not null check (score between 1 and 5),
  comments      text,
  evaluated_by  text,
  evaluated_at  timestamptz not null default now()
);

create index on public.supplier_evaluations (tenant_id, supplier_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS de las tres tablas nuevas -exclusivas del modulo suppliers, a
--  diferencia de la ficha basica que ahora comparten tres modulos-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('supplier_documents',      'suppliers'),
      ('supplier_bank_accounts',  'suppliers'),
      ('supplier_evaluations',    'suppliers')
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

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenece supplier_id.
create function public.impedir_referencia_ajena_proveedor() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.suppliers where id = new.supplier_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese proveedor no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_documento_ajeno before insert on public.supplier_documents
  for each row execute function public.impedir_referencia_ajena_proveedor();
create trigger no_cuenta_bancaria_ajena before insert on public.supplier_bank_accounts
  for each row execute function public.impedir_referencia_ajena_proveedor();
create trigger no_evaluacion_ajena before insert on public.supplier_evaluations
  for each row execute function public.impedir_referencia_ajena_proveedor();

-- ── Una evaluacion registrada es inmutable -sin excepcion, como un pago- ─
create function public.impedir_editar_evaluacion_proveedor() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una evaluacion ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_evaluacion_proveedor
  before update or delete on public.supplier_evaluations
  for each row execute function public.impedir_editar_evaluacion_proveedor();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.supplier_documents
  for each row execute function audit.record('suppliers');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Ficha, documentos con vigencia calculada, cuentas bancarias y evaluacion de proveedores',
    problem      = 'Sin un registro real, nadie sabe si el RNC de un proveedor ya vencio, ni si ese proveedor esta homologado para comprarle.',
    features     = '[
      {"titulo":"Documentos con vigencia calculada","detalle":"Certificado RNC, seguro, cumplimiento fiscal -cada uno con su fecha de vencimiento, comparada siempre contra hoy, nunca una bandera que alguien olvida actualizar-."},
      {"titulo":"Homologacion como estado, no como tramite perdido","detalle":"Pendiente, homologado o descalificado -un estado visible en la ficha, no una conversacion de WhatsApp que nadie encuentra despues-."},
      {"titulo":"Evaluacion que no se puede reescribir despues","detalle":"Cada evaluacion registrada queda fija -igual que un certificado o un pago de prestamo-, con su propio historial en vez de un numero que cualquiera edita."},
      {"titulo":"El mismo proveedor en toda la empresa","detalle":"La misma ficha que ya usan ordenes de compra y cuentas por pagar -sin duplicar el registro, sin otro RNC capturado dos veces-."}
    ]'::jsonb,
    audience     = '{"Negocios que ya usan purchase-orders o ap y necesitan documentos y evaluacion reales","Cualquiera con proveedores recurrentes que requieren homologacion"}',
    faq          = '[
      {"p":"¿Necesito el modulo de ordenes de compra para usar proveedores?","r":"No: la ficha basica del proveedor ya la comparten purchase-orders, ap y suppliers -cualquiera de los tres la desbloquea-. Documentos, cuentas bancarias y evaluacion son exclusivos de este modulo."},
      {"p":"¿Se puede corregir una evaluacion despues de registrarla?","r":"No, igual que un certificado o un pago de prestamo: una evaluacion registrada es un hecho fijo. Una correccion se hace con una evaluacion nueva."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'suppliers';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'suppliers'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'suppliers no tiene precio en los 3 tiers';
  end if;
end $$;
