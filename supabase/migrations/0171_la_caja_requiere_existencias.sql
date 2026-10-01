-- ═══════════════════════════════════════════════════════════════════════
--  0171 — El punto de venta requiere Existencias
--
--  Un cliente dado de alta solo con «Punto de venta» no podía vender: cada
--  turno de caja descuenta la mercancía de un almacén, y los almacenes
--  viven en `inventory` (su RLS pide `module_active('inventory')`). Como
--  `pos` solo RECOMENDABA inventario, el alta (0133) y el marketplace lo
--  dejaban fuera, y la caja respondía «La caja necesita un almacén» el
--  primer día.
--
--  Una recomendación que, si no se sigue, deja el módulo inservible es un
--  requisito. Se pasa `inventory` de `recommends` a `requires` en el
--  catálogo; el manifest de `pos` dice lo mismo. Así el cierre de
--  dependencias del alta (`regb.alta_de_cliente`) y del marketplace lo
--  activa solo, y el precio que se enseña ya lo incluye.
--
--  Solo cambia el catálogo: los clientes que ya tienen caja no se tocan
--  (ninguno de los que existen está sin Existencias; el que lo apague
--  sigue viendo el aviso de la caja, que explica qué hacer).
-- ═══════════════════════════════════════════════════════════════════════

update regb.module_catalog
set requires   = array(select distinct r from unnest(requires || array['inventory']) as r order by r),
    recommends = array_remove(recommends, 'inventory')
where id = 'pos'
  and not ('inventory' = any (requires));
