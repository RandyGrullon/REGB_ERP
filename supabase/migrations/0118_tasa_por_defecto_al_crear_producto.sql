-- ═══════════════════════════════════════════════════════════════════════
--  0118 — La tasa de ITBIS por defecto del cliente llega al producto nuevo
--
--  La 0116 dejo public.tax_rates como catalogo que nadie leia: un cliente
--  que marcaba ITBIS-16 por defecto seguia creando productos al 18% sin un
--  solo aviso, porque products.tax_rate se llenaba con un 0.18 escrito en
--  la accion de la pantalla y con el default de columna en la importacion.
--
--  Donde se engancha, y por que ahi: al CREAR el producto. Todas las lineas
--  (pos_sale_lines, sales_order_lines, purchase_order_lines, quote_lines)
--  ya copian products.tax_rate en el momento de vender o comprar, asi que
--  basta con que el producto nazca con la tasa correcta para que el resto
--  la herede sin tocar una sola columna que leen otros modulos. Cambiar la
--  semantica de tax_rate -por ejemplo, que fuera una referencia viva a
--  tax_rates- obligaria a revisar cada consulta que la lee, y haria que
--  cambiar la tasa del catalogo reescribiera en silencio el precio de lo
--  ya cotizado.
--
--  Por eso tampoco se toca el `default 0.18` de las columnas: un default
--  que lee una tabla con RLS se evalua con la sesion de quien inserte, y
--  los seeds y las pruebas que insertan como dueño de la base sin token
--  pasarian a depender de eso. La funcion se llama explicitamente desde
--  los dos caminos que crean productos: la pantalla y la importacion CSV.
--
--  Lo que NO hace, a proposito: no reescribe los productos que ya existen.
--  Cambiar la tasa por defecto afecta a los productos que se creen desde
--  ese momento; recatalogar el inventario viejo es una decision del
--  cliente, no un efecto secundario de marcar una casilla.
--
--  Reversion: drop function public.tasa_itbis_por_defecto() y volver a
--  aplicar el bloque de catalogo de la 0116. No hay archivo _down aparte
--  porque supabase/scripts/migrate.mjs aplica TODO .sql de la carpeta en
--  orden: un 0118_down.sql se ejecutaria justo despues de esta.
-- ═══════════════════════════════════════════════════════════════════════

-- security invoker, no definer: la lectura pasa por la RLS de tax_rates,
-- que ya exige tenant y modulo. Aun asi el filtro por rls.tenant_id() y
-- rls.module_active() va escrito en la consulta: el dueño de la base se
-- salta la RLS, y sin ese filtro una llamada sin token devolveria la tasa
-- de un cliente cualquiera en vez del respaldo.
--
-- effective_from <= current_date: una tasa marcada por defecto con vigencia
-- futura todavia no aplica. Mientras tanto se usa el respaldo 0.18, que es
-- lo mismo que pasaba antes de esta migracion; inventar la tasa "anterior"
-- seria adivinar cual de las inactivas era.
create function public.tasa_itbis_por_defecto()
returns numeric(5,4)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select tr.rate
       from public.tax_rates tr
      where tr.tenant_id = rls.tenant_id()
        and rls.module_active('taxes')
        and tr.kind = 'itbis'
        and tr.is_default
        and tr.is_active
        and tr.effective_from <= current_date
      limit 1),
    0.18
  )::numeric(5,4)
$$;

comment on function public.tasa_itbis_por_defecto() is
  'Tasa de ITBIS (fraccion) con la que nace un producto nuevo: la tasa por defecto activa y vigente de public.tax_rates si el modulo taxes esta activo, y 0.18 si no. No reescribe productos existentes.';

revoke all on function public.tasa_itbis_por_defecto() from public;
grant execute on function public.tasa_itbis_por_defecto() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  El catalogo dice ahora lo que SI hace, y solo eso.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set description = 'Catalogo de tasas de ITBIS con la tasa por defecto de los productos nuevos, reglas de retencion por proveedor, liquidacion IT-1 y calendario fiscal.',
    features    = jsonb_set(
      features, '{0}',
      '{"titulo":"Tu tasa de ITBIS por defecto, en los productos nuevos","detalle":"Nombras el ITBIS general, reducido y exento UNA vez, con la fecha desde la que aplican, y marcas uno por defecto. Cada producto que crees o importes desde entonces nace con esa tasa, y la caja, los pedidos, las cotizaciones y las ordenes de compra la toman del producto. Los productos que ya tenias conservan la suya: cambiarla es decision tuya, producto por producto."}'::jsonb
    ),
    faq         = (
      select jsonb_agg(
               case
                 when f->>'p' like '%la caja empieza a facturar%' then
                   '{"p":"¿Si cambio la tasa por defecto, la caja empieza a facturar con ella?","r":"Para los productos que crees o importes desde ese momento, si: nacen con la tasa nueva y cada venta la toma del producto. Los productos que ya existian conservan la tasa que tenian, y lo que ya se vendio o cotizo no se toca. Si la tasa por defecto tiene una fecha de vigencia futura, hasta ese dia los productos nuevos siguen naciendo al 18%."}'::jsonb
                 else f
               end
               order by ord)
        from jsonb_array_elements(faq) with ordinality as x(f, ord)
    )
where id = 'taxes';

do $$
begin
  if not exists (
    select 1 from regb.module_catalog
    where id = 'taxes'
      and features->0->>'titulo' like 'Tu tasa de ITBIS por defecto%'
      and faq::text like '%conservan la tasa que tenian%'
  ) then
    raise exception 'el texto del catalogo de taxes no se reescribio';
  end if;
end $$;
