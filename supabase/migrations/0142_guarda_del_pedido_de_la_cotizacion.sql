-- ═══════════════════════════════════════════════════════════════════════
--  0142 — La cotizacion solo apunta a un pedido de su propio cliente
--
--  0136 agrego `quotes.sales_order_id` ("Convertir en pedido") con su FK a
--  public.sales_orders, pero sin la guarda de cliente que 0121 exige a
--  toda FK entre tablas con tenant_id. Una FK se comprueba sin RLS: con el
--  id de un pedido ajeno, una cotizacion de A quedaba enlazada al pedido
--  de B (y la ficha de A le enseñaba su numero). La red de seguridad de
--  `supabase/tests/fk-guardas.test.ts` lo detecto.
--
--  La guarda propia de la cotizacion (impedir_referencia_ajena_cotizacion)
--  no se toca: se suma la generica de 0121 solo para la columna nueva, en
--  insert y en update.
--
--  Reversion: drop trigger no_referencia_ajena_pedido on public.quotes.
-- ═══════════════════════════════════════════════════════════════════════

create trigger no_referencia_ajena_pedido
  before insert or update of tenant_id, sales_order_id on public.quotes
  for each row execute function public.impedir_referencia_ajena('sales_order_id', 'sales_orders');
