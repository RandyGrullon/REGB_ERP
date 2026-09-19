-- ═══════════════════════════════════════════════════════════════════════
--  0116 — Impuestos (modulo 24, advanced)
--
--  Lo que este modulo viene a tapar es un hueco concreto, no una idea
--  general de "lo fiscal". Hoy el 0.18 esta CABLEADO como default en cinco
--  tablas (products, sales_order_lines, pos_sale_lines,
--  purchase_order_lines, quote_lines) y un producto exento o con la tasa
--  reducida del 16% se teclea a mano producto por producto; y
--  supplier_invoices ya tiene retention_amount, isr_retained e
--  isr_retention_type pero NADIE calcula el numero que va dentro -la ficha
--  de `ap` lo dice sin rodeos en su "Lo que NO hace"-. Aqui se nombran las
--  tasas una vez y se escriben las reglas de retencion que faltaban.
--
--  Lo que NO entra, y es deliberado: los formatos 606, 607 y 608. Ya
--  existen completos -las vistas public.dgii_606/607/608, la descarga en
--  /api/dgii/[reporte] y la pantalla /cobrar/dgii-, construidos dentro de
--  `ap` y `ar`. El comentario del manifiesto de `accounting` que los
--  atribuye a `taxes` quedo viejo. Duplicar esas vistas aqui seria crear
--  una segunda verdad sobre lo que se le declara a la DGII, que es la peor
--  clase de duplicado que existe: el calendario ENLAZA a esa pantalla.
--
--  La liquidacion IT-1 guarda una FOTO, no un calculo vivo. Si mañana se
--  corrige una factura de enero, la declaracion de enero no cambia: es lo
--  que se entrego, y la diferencia se arregla con una rectificativa. Por
--  eso tax_filings tiene columnas de monto propias y no una vista.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Catalogo de tasas ───────────────────────────────────────────────────
-- `rate` va en FRACCION y en numeric(5,4) a proposito: es la MISMA
-- convencion que la 0021 dejo fijada en products.tax_rate y
-- sales_order_lines.tax_rate despues de corregir el lio de 18 vs 0.18.
-- Tener dos convenciones de tasa conviviendo en el mismo esquema es,
-- literalmente, como se cobra un 1800% de ITBIS.
create table public.tax_rates (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  code           text not null,
  name           text not null,
  kind           text not null default 'itbis' check (kind in ('itbis', 'isc', 'propina')),
  rate           numeric(5,4) not null check (rate >= 0 and rate <= 1),
  is_default     boolean not null default false,
  is_active      boolean not null default true,
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  unique (tenant_id, code)
);

-- Una sola tasa por defecto y por tipo de impuesto. El indice es PARCIAL
-- -solo sobre las activas y marcadas- porque desactivar la tasa vieja del
-- 16 y marcar la nueva es una operacion normal el dia que la ley se mueve;
-- una restriccion sobre toda la tabla la impediria.
create unique index tax_rates_default_idx on public.tax_rates (tenant_id, kind)
  where is_default and is_active;

create index on public.tax_rates (tenant_id, is_active);

-- ── Reglas de retencion ─────────────────────────────────────────────────
-- La distincion que de verdad importa y que da nombre a la columna `base`:
-- la retencion de ITBIS es un porcentaje del ITBIS FACTURADO, la de ISR es
-- un porcentaje del SUBTOTAL pagado. Aplicar una sobre la base de la otra
-- hace que la retencion salga unas seis veces mal, y con un numero que
-- parece razonable -que es lo peligroso-.
create table public.tax_withholding_rules (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  code           text not null,
  name           text not null,
  tax            text not null check (tax in ('itbis', 'isr')),
  party_type     text not null check (party_type in ('fisica', 'juridica', 'ambas')),
  base           text not null check (base in ('itbis', 'subtotal')),
  rate           numeric(5,4) not null check (rate >= 0 and rate <= 1),
  -- Codigo 01-09 de TIPOS_RETENCION_ISR_606 (packages/operations/src/
  -- dgii-envio.ts). Son ESOS nueve y no una lista nueva: el 606 valida
  -- contra ellos.
  dgii_isr_type  text check (dgii_isr_type in ('01','02','03','04','05','06','07','08','09')),
  is_active      boolean not null default true,
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  unique (tenant_id, code),
  -- Sin el codigo DGII la factura no puede llenar
  -- supplier_invoices.isr_retention_type y el 606 entero rebota. El check
  -- no es cosmetico: evita escribir una regla que nunca se va a poder usar.
  check (tax <> 'isr' or dgii_isr_type is not null),
  -- Una retencion de ITBIS sobre el subtotal no existe en la norma; si se
  -- deja pasar, el numero sale ~6 veces mas alto.
  check (tax <> 'itbis' or base = 'itbis')
);

create index on public.tax_withholding_rules (tenant_id, tax, is_active);

-- ── Perfil fiscal del proveedor ─────────────────────────────────────────
-- Va en tabla aparte y NO como columnas de public.suppliers porque
-- suppliers vive bajo la RLS del modulo `suppliers`: meterle columnas de
-- taxes ataria un modulo a otro y romperia el aislamiento por modulo que
-- sostiene el marketplace entero -apagar taxes dejaria columnas muertas
-- dentro de una tabla de otro dueño-.
create table public.supplier_tax_profiles (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id) on delete cascade,
  party_type    text not null check (party_type in ('fisica', 'juridica')),
  itbis_rule_id uuid references public.tax_withholding_rules(id),
  isr_rule_id   uuid references public.tax_withholding_rules(id),
  is_exempt     boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, supplier_id),
  -- Un proveedor de zona franca marcado exento PERO con regla asignada es
  -- una contradiccion que se descubre cuando ya se le retuvo dinero que no
  -- tocaba. Mejor que no se pueda guardar.
  check (not is_exempt or (itbis_rule_id is null and isr_rule_id is null))
);

create index on public.supplier_tax_profiles (tenant_id, party_type);

-- ── Declaraciones cerradas ──────────────────────────────────────────────
-- La FOTO de lo declarado. Los montos son columnas y no una vista a
-- proposito: una vista recalcularia contra las facturas de hoy, y lo que
-- se le entrego a la DGII en enero no cambia porque en marzo se corrija
-- una factura de enero.
create table public.tax_filings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  form            text not null check (form in ('IT-1', '606', '607', '608', 'IR-17')),
  -- '[0-9]' y no '\d' por la leccion que ya pago el TXT de envio en
  -- api/dgii/[reporte]/route.ts: dentro de una plantilla de JavaScript la
  -- barra invertida se pierde antes de llegar a Postgres y el patron viaja
  -- como la letra D. Sin barra invertida no hay nada que perder, y las
  -- pruebas de BD escriben este SQL dentro de plantillas.
  period          text not null check (period ~ '^[0-9]{6}$'),
  due_date        date not null,
  status          text not null default 'pending' check (status in ('pending', 'filed', 'paid')),
  itbis_charged   numeric(12,2) not null default 0 check (itbis_charged >= 0),
  itbis_paid      numeric(12,2) not null default 0 check (itbis_paid >= 0),
  itbis_withheld  numeric(12,2) not null default 0 check (itbis_withheld >= 0),
  -- El ITBIS que ESTE contribuyente le retuvo a SUS proveedores.
  --
  -- Columna aparte de `itbis_withheld` porque van en direcciones
  -- contrarias: lo que otros me retienen a mi es un adelanto -resta-, lo
  -- que yo retengo es plata de la DGII que tengo guardada -suma-.
  -- Llamarlas parecido y sumarlas juntas es como se declara de menos.
  itbis_retained  numeric(12,2) not null default 0 check (itbis_retained >= 0),
  previous_credit numeric(12,2) not null default 0 check (previous_credit >= 0),
  amount_due      numeric(12,2) not null default 0 check (amount_due >= 0),
  credit_forward  numeric(12,2) not null default 0 check (credit_forward >= 0),
  receipt_number  text,
  filed_at        timestamptz,
  filed_by        uuid,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (tenant_id, form, period),
  -- Declarada sin fecha de declaracion es una fila a la que no se le puede
  -- creer nada.
  check (status = 'pending' or filed_at is not null),
  -- La declaracion imposible: deber y tener saldo a favor a la vez. La
  -- base solo lo VERIFICA; quien lo decide es liquidarItbis() en
  -- @regb/operations, porque arrastrar el exceso en vez de declarar
  -- negativo es una decision de negocio, no una formula.
  check (amount_due = 0 or credit_forward = 0)
);

create index on public.tax_filings (tenant_id, period desc);

comment on column public.tax_filings.itbis_withheld is
  'ITBIS que los clientes me retuvieron a MI. Se escribe a mano: ese dato no existe en ninguna tabla del repo -las facturas de venta no tienen campo de retencion recibida- y no se valida contra nada.';

comment on column public.tax_filings.filed_by is
  'Quien cerro la declaracion. uuid suelto sin FK, igual que created_by en cost_center_allocations: el usuario puede irse del sistema y la declaracion no puede desaparecer con el.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('tax_rates',             'taxes'),
      ('tax_withholding_rules', 'taxes'),
      ('supplier_tax_profiles', 'taxes'),
      ('tax_filings',           'taxes')
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

-- El agujero de siempre (0031/0040/0048 y compañia), aqui por TRIPLICADO:
-- la RLS de insert solo compara el tenant_id de la fila NUEVA, no a quien
-- pertenecen supplier_id, itbis_rule_id ni isr_rule_id.
--
-- Desviacion consciente del molde de la 0048: alli el trigger es solo
-- `before insert`, y es suficiente porque nadie reasigna el centro de una
-- asignacion ya escrita. Aqui SI: cambiar itbis_rule_id por el de otro
-- cliente es una via de escape que un trigger de insert no ve. Por eso
-- corre tambien en update.
create function public.impedir_perfil_fiscal_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.suppliers where id = new.supplier_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese proveedor no pertenece a ese cliente.' using errcode = '42501';
  end if;

  if new.itbis_rule_id is not null then
    select tenant_id into v_tenant from public.tax_withholding_rules where id = new.itbis_rule_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Esa regla de retencion no pertenece a ese cliente.' using errcode = '42501';
    end if;
  end if;

  if new.isr_rule_id is not null then
    select tenant_id into v_tenant from public.tax_withholding_rules where id = new.isr_rule_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Esa regla de retencion no pertenece a ese cliente.' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger no_perfil_fiscal_ajeno before insert or update on public.supplier_tax_profiles
  for each row execute function public.impedir_perfil_fiscal_ajeno();

-- ── Bitacora ────────────────────────────────────────────────────────────
-- Las cuatro tablas, no solo la maestra como en 0048: cambiar una tasa o
-- una regla cambia lo que se le declara a la DGII, y "¿quien bajo la
-- retencion de ISR al 2%?" es exactamente la pregunta que se hace despues,
-- cuando ya se pago de menos.
create trigger audit_me after insert or update or delete on public.tax_rates
  for each row execute function audit.record('taxes');
create trigger audit_me after insert or update or delete on public.tax_withholding_rules
  for each row execute function audit.record('taxes');
create trigger audit_me after insert or update or delete on public.supplier_tax_profiles
  for each row execute function audit.record('taxes');
create trigger audit_me after insert or update or delete on public.tax_filings
  for each row execute function audit.record('taxes');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    -- La descripcion vieja prometia los formatos 606/607/608 desde aqui.
    -- Se corrige en vez de construirlos dos veces: ya funcionan en
    -- /cobrar/dgii y este modulo enlaza alli.
    description  = 'Tasas de ITBIS configurables, reglas de retencion por proveedor, liquidacion IT-1 y calendario fiscal.',
    requires     = '{}',
    recommends   = '{ap,ar,accounting}',
    tagline      = 'Deja de teclear el 18% y de adivinar cuanto se le retiene a cada proveedor',
    problem      = 'El ITBIS esta escrito a mano producto por producto, la retencion del proveedor la calcula alguien en una hoja aparte -y sobre la base equivocada la mitad de las veces-, y el dia 20 nadie recuerda cuanto saldo a favor quedo del mes pasado.',
    features     = '[
      {"titulo":"Las tasas dejan de estar cableadas","detalle":"ITBIS general, reducido y exento se nombran una vez en un catalogo y se cambian sin tocar el sistema el dia que la ley se mueva."},
      {"titulo":"Calculadora de retencion, antes de pagar","detalle":"Escribes el subtotal y el ITBIS de la factura y sale cuanto retener de ITBIS, cuanto de ISR, con que codigo de la DGII y cuanto le queda neto al proveedor. Se ve el numero antes de aceptarlo."},
      {"titulo":"Sobre la base correcta, siempre","detalle":"El ITBIS se retiene sobre el ITBIS facturado y el ISR sobre el subtotal. Aplicar una sobre la base de la otra hace que la retencion salga unas seis veces mal, y la tabla no lo deja configurar al reves."},
      {"titulo":"Liquidacion IT-1 con el saldo a favor arrastrado","detalle":"ITBIS cobrado menos ITBIS adelantado menos lo que te retuvieron menos el saldo del mes pasado. Si da negativo nunca se declara en negativo: se arrastra."},
      {"titulo":"La declaracion cerrada es una foto","detalle":"Al cerrar se guardan los numeros que se entregaron. Si despues se corrige una factura del periodo, lo declarado sigue siendo lo declarado -eso se arregla con una rectificativa, no reescribiendo el pasado-."},
      {"titulo":"Calendario con los vencimientos del periodo","detalle":"IR-17 el 10, informativos el 15, IT-1 el 20, corriendo al lunes lo que cae fin de semana, cada uno con su estado real."}
    ]'::jsonb,
    audience     = '{"Contribuyentes ordinarios de ITBIS con declaracion mensual","Negocios que le compran a personas fisicas y tienen que retener","Contadores que hoy llevan la retencion en una hoja de calculo aparte"}',
    faq          = '[
      {"p":"¿Genera los formatos 606, 607 y 608?","r":"No, porque ya existen: se generan desde Reportes DGII, en Por cobrar. El calendario de este modulo te lleva alli. Construirlos otra vez seria tener dos verdades sobre lo mismo."},
      {"p":"¿Escribe la retencion en la factura del proveedor?","r":"No. Calcula el numero y te lo enseña; escribirlo en la factura sigue siendo cosa de Cuentas por pagar, que es de otro dueño. Conectarlos es el paso siguiente y esta declarado."},
      {"p":"¿Las tasas del 18% y del 16% vienen verificadas?","r":"Vienen como punto de partida editable segun se entiende la norma hoy, no como dato del sistema. Revisalas con tu contador antes de tu primera declaracion: por eso son una tabla y no un numero cableado."},
      {"p":"¿Y los feriados?","r":"El vencimiento solo corre de sabado o domingo al lunes. Los feriados que se trasladan por ley no se conocen aqui: mejor un vencimiento un dia antes de tiempo que uno inventado."},
      {"p":"¿Sirve si no tengo activo Cuentas por pagar o por cobrar?","r":"Las tasas, las reglas y el calendario si. La liquidacion IT-1 no puede sumar lo que no ve, y en vez de sumar cero en silencio te lo dice en pantalla: declarar de menos por un modulo apagado es una multa."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'taxes';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'taxes'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'taxes no tiene precio en los 3 tiers';
  end if;
end $$;
