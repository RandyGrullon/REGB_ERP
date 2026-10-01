-- ═══════════════════════════════════════════════════════════════════════
--  0160 · Finanzas con tildes
-- ═══════════════════════════════════════════════════════════════════════
--  Dos textos de catálogo que salían sin tilde en pantallas de finanzas:
--
--  1. El dólar. `currencies` es un catálogo global (0049) y Monedas lo
--     enseña tal cual: "Dolar estadounidense" en la lista, en el título de
--     su ficha y en el selector de la calculadora.
--
--  2. Los nombres por defecto del catálogo mínimo de cuentas (0131). Son
--     los que se crean con la primera venta, cobro o compra de un cliente
--     nuevo, y los que Mapa de cuentas propone: "Inventario de mercancias"
--     y "Ventas de mercancias". Se redefine la función con la misma firma;
--     el espejo en TypeScript (PROPOSITOS_CONTABLES) cambia igual, y la
--     prueba que compara los dos sigue mirando uso, código y tipo.
--
--  No se renombran las cuentas que los clientes ya tienen: el nombre de
--  una cuenta es suyo y lo pueden haber cambiado a propósito.

update public.currencies
set name = 'Dólar estadounidense'
where code = 'USD' and name = 'Dolar estadounidense';

create or replace function public.cuentas_contables_por_defecto()
returns table (purpose text, code text, name text, type text, orden integer)
language sql
immutable
set search_path = ''
as $$
  values
    ('caja',             '1101', 'Caja general',                  'asset',      1),
    ('cxc',              '1102', 'Cuentas por cobrar clientes',   'asset',      2),
    ('banco',            '1103', 'Bancos',                        'asset',      3),
    ('inventario',       '1104', 'Inventario de mercancías',      'asset',      4),
    ('itbis_adelantado', '1105', 'ITBIS adelantado en compras',   'asset',      5),
    ('itbis_por_pagar',  '2101', 'ITBIS por pagar',               'liability',  6),
    ('cxp',              '2102', 'Cuentas por pagar proveedores', 'liability',  7),
    ('itbis_retenido',   '2103', 'ITBIS retenido por pagar',      'liability',  8),
    ('isr_retenido',     '2104', 'ISR retenido por pagar',        'liability',  9),
    ('ventas',           '4101', 'Ventas de mercancías',          'revenue',   10),
    ('costo_ventas',     '5101', 'Costo de ventas',               'expense',   11),
    ('compras',          '1104', 'Inventario de mercancías',      'asset',     12),
    ('gastos',           '6101', 'Gastos generales',              'expense',   13),
    ('ingresos_mora',    '4201', 'Recargos por mora',             'revenue',   14)
$$;

comment on function public.cuentas_contables_por_defecto() is
  'Catálogo mínimo por defecto de los asientos automáticos: uso -> código, nombre y tipo exigido. Espejo de PROPOSITOS_CONTABLES en @regb/operations. (0131, tildes en 0160)';
