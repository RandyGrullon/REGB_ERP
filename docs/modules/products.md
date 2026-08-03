# `products` — Catálogo

**Qué resuelve:** qué vendes, a qué precio y con qué impuesto. Todo lo demás
del ERP comercial cuelga de aquí: sin catálogo no hay existencias, ni pedido,
ni ticket, ni factura.

**Categoría:** `core` · **Precio:** incluido (0 en los tres tiers) — es la base
sobre la que se venden los demás, cobrarlo aparte sería cobrar por poder
empezar.

---

## Esquema

Migración [`0018_products_catalog.sql`](../../supabase/migrations/0018_products_catalog.sql).

`public.products` ya existía como stub de 12 columnas desde 0016 (lo leen
`importar` y la búsqueda global), así que se **amplió**, no se recreó:

| Columna añadida | Por qué |
|---|---|
| `barcode` | Lo dispara el lector de la caja. Único parcial por tenant cuando no es nulo |
| `tax_rate numeric(5,4)` | **Fracción** (0.18), no porcentaje — ver la trampa abajo |
| `track_stock` | Un servicio se vende pero no se cuenta |
| `reorder_point` | Umbral del semáforo de existencias |
| `image_file_id` | Apunta a `public.files` |
| `category_id` | FK a la tabla nueva |

`public.product_categories` — un solo nivel de jerarquía. El árbol profundo no
le aporta nada al primer cliente y complica cada consulta que lo cruce.

Se **conserva** la columna vieja `category text` como caché de display: la leen
`importar` y la búsqueda global, y romperlas para ganar normalización pura no
valía la pena.

RLS módulo-gated (`auth.module_active('products')`) + `provider_impersonating`
+ `audit.record('products')`, idéntica a las 7 tablas de 0016.

## La trampa que costó dinero

`products.tax_rate` guarda **fracción** (0.18). Cuando se creó
`sales_order_lines.tax_rate` como **porcentaje** (18), un pedido de RD$5,375
mostró **RD$9.68 de ITBIS en vez de RD$967.50**.

No es un error de redondeo: es un factor de 100 escondido en una columna que
se ve igual en ambos formatos. Se unificó todo a fracción en
[`0021_tax_rate_fraccion.sql`](../../supabase/migrations/0021_tax_rate_fraccion.sql),
con `check (tax_rate >= 0 and tax_rate <= 1)` para que la base rechace un
porcentaje disfrazado.

**Si añades una tabla con impuesto: fracción, y pon el check.**

## Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/products` | `products.view` | Lista con búsqueda, filtro por categoría y badge de bajo stock |
| `/products/categories` | `products.categories.manage` | Alta y orden de categorías |
| `/products/:id` | `products.view` | Detalle y edición |

`products.price.edit` se comprueba **aparte** de `products.edit`: el Vendedor
ve el producto y lo corrige, pero no toca el precio. `products.price.view` en
falso (Almacenista) oculta el precio **en el servidor**, no con CSS.

Un producto **nunca se borra**, se desactiva: borrarlo rompería toda venta
vieja que lo mencione.

## Manifiesto

- **Permisos:** `view`, `create`, `edit`, `delete`, `price.view`, `price.edit`,
  `categories.manage`, `export`
- **Widgets:** `top-products`, `catalog-completeness`
- **Emite:** `products.item.created`, `products.price.changed`
- **Escucha:** nada
- **`mobileScope`:** `view`, `scan`

`top-products` necesita histórico de ventas agregadas: hoy muestra un aviso
honesto en vez de un número inventado. Se llena cuando exista el módulo de
reportes.

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ⚠️ RLS probada en `supabase/tests/products.test.ts` (13 casos: aislamiento, módulo apagado). Sin `down` — deuda común |
| 3 | Lógica pura con cobertura | ⚠️ El catálogo casi no tiene lógica pura: son CRUD y RLS. Lo que sí la tiene (totales, impuestos) vive en `documents.ts` con 21 tests |
| 4 | UI web responsive | ✅ 375 / 768 / 1440 |
| 5 | UI móvil | 🔜 F5 — `mobileScope` ya declarado |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | ✅ `f4.catalogo`, 6 pasos |
| 8 | Datos demo | ✅ catálogo dominicano en `seed/demo.sql` |
| 9 | ≥2 widgets | ✅ |
| 10 | Eventos documentados | ✅ |
| 11 | Precio en 3 tiers | ✅ 0/0/0, deliberado |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ⚠️ sin auditar con axe |

## Lo que NO hace, y por qué

- **Variantes** (talla, color) y **kits**: fuera de F4 por decisión de alcance.
  Las tablas de abajo apuntan a `product_id` directo. Si un piloto vende ropa,
  entra como migración aditiva sin romper nada.
- **Listas de precio por cliente**: es del motor de precios, no del catálogo.
- **Costos por lote (FIFO)**: exige capas de lotes — eso es `lots-serials` en
  F8. Aquí el costeo es promedio ponderado.
