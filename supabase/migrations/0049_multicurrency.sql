-- ═══════════════════════════════════════════════════════════════════════
--  0049 — Multimoneda (modulo 26, F6/S31)
--
--  "Tasas automaticas (BCRD/API)" del catalogo (§5.2) se implementa aqui
--  como lo que de verdad se puede construir sin una integracion de red
--  real: captura MANUAL de tasas, igual que la retencion de ap (0042) o
--  el cargo por mora de ar (0040) -el sistema informa, la persona decide
--  el numero-. Automatizar contra una API del Banco Central es trabajo
--  real de integracion que se deja declarado, no prometido.
--
--  Es un modulo AUTOCONTENIDO: un catalogo de monedas y su historial de
--  tasas, mas la conversion/diferencia cambiaria como utilidad. Todavia
--  NO conecta con ar/ap/treasury para que esos modulos registren
--  transacciones en moneda extranjera -eso pide cambiar el esquema de
--  cada uno (una columna de moneda en customer_invoices, en
--  supplier_invoices, en bank_accounts), un cambio mayor que este primer
--  corte no asume-. Declarado en la ficha, no escondido.
-- ═══════════════════════════════════════════════════════════════════════

create table public.currencies (
  code       text primary key,
  name       text not null,
  symbol     text not null,
  is_active  boolean not null default true
);

comment on table public.currencies is
  'Catalogo global, no por tenant -las monedas del mundo no cambian entre clientes-. DOP es la base y siempre esta activa.';

insert into public.currencies (code, name, symbol) values
  ('DOP', 'Peso dominicano', 'RD$'),
  ('USD', 'Dolar estadounidense', 'US$'),
  ('EUR', 'Euro', '€')
on conflict (code) do nothing;

create table public.exchange_rates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  currency_code text not null references public.currencies(code),
  rate_date   date not null,
  -- Pesos dominicanos por 1 unidad de la moneda. DOP no necesita su
  -- propia tasa -siempre es 1-, se rechaza explicitamente mas abajo.
  rate        numeric(12,4) not null check (rate > 0),
  source      text not null default 'manual' check (source in ('manual')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, currency_code, rate_date),
  check (currency_code <> 'DOP')
);

create index on public.exchange_rates (tenant_id, currency_code, rate_date desc);

comment on column public.exchange_rates.source is
  'Solo "manual" existe hoy -sin integracion real a una API del BCRD-. La columna ya deja espacio para un futuro "bcrd_api" sin migrar el esquema otra vez.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS — exchange_rates es por tenant; currencies es catalogo global de
--  solo lectura para cualquier autenticado (no tiene tenant_id).
-- ═══════════════════════════════════════════════════════════════════════
alter table public.currencies enable row level security;
alter table public.currencies force row level security;
create policy lectura_publica on public.currencies for select
  using (true);

alter table public.exchange_rates enable row level security;
alter table public.exchange_rates force row level security;
create policy tenant_module on public.exchange_rates for all
  using (tenant_id = rls.tenant_id() and rls.module_active('multicurrency'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('multicurrency'));
create policy provider_impersonating on public.exchange_rates for select
  using (rls.impersonating(tenant_id));

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.exchange_rates
  for each row execute function audit.record('multicurrency');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{}',
    recommends   = '{accounting}',
    tagline      = 'Convierte y compara monedas sin perder el rastro de la tasa que usaste',
    problem      = 'Alguien cotiza en dolares, cobra en pesos, y para cuando hay que declarar la diferencia cambiaria nadie recuerda que tasa se uso ese dia -queda a memoria, o a una hoja de calculo que nadie actualiza-.',
    features     = '[
      {"titulo":"Historial de tasas, no solo la de hoy","detalle":"Cada tasa capturada queda con su fecha. Convertir un monto de hace tres meses usa la tasa de hace tres meses, no la de hoy."},
      {"titulo":"Encuentra la tasa aplicable sola","detalle":"Si no capturaste la tasa exacta de un dia especifico, usa la mas reciente conocida ANTES de esa fecha -nunca una futura-."},
      {"titulo":"Diferencia cambiaria calculada, no adivinada","detalle":"Compara el valor en pesos de un mismo monto extranjero entre dos tasas -la ganancia o perdida por el solo movimiento del tipo de cambio-."},
      {"titulo":"Honesto sobre lo que no hace","detalle":"No trae la tasa sola de una API del Banco Central -se captura a mano, igual que la retencion de cuentas por pagar-."}
    ]'::jsonb,
    audience     = '{"Negocios que cotizan o compran en dolares","Importadores","Cualquiera que necesite declarar diferencia cambiaria"}',
    faq          = '[
      {"p":"¿Trae la tasa del Banco Central automatica?","r":"Todavia no: se captura a mano. La columna que guarda el origen de la tasa ya esta preparada para un futuro origen automatico, pero hoy solo existe manual."},
      {"p":"¿Puedo facturar en dolares desde cuentas por cobrar o por pagar?","r":"Todavia no: esta primera version es un catalogo de tasas y una calculadora de conversion/diferencia, independiente. Que ar/ap/treasury registren montos en moneda extranjera es una mejora futura que cambia el esquema de esos modulos."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'multicurrency';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'multicurrency'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'multicurrency no tiene precio en los 3 tiers';
  end if;
end $$;
