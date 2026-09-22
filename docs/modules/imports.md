# `imports` — Importar

**Que resuelve:** traer el catalogo de productos desde un CSV sin teclearlo,
con el motivo de cada fila rechazada y un **deshacer** que borra
exactamente lo que ese archivo creo.

**Categoria:** `core` (§5.1 #14) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** `products` ·
**Plataformas:** web ✔️ desktop ✔️ movil ✖️

---

## El permiso del destino manda

Importar productos exige `imports.create` **y** `products.create`; deshacer
exige `imports.edit` **y** `products.delete`. Si no, un rol sin permiso de
crear productos los crearia de a 3,000 por la puerta de importar. Por eso el
manifiesto declara `requires: ['products']`: la dependencia es dato, y
`audit:registry` solo tolera referencias a lo declarado.

## Deshacer es exacto porque cada producto sabe de que lote vino

Cada importacion crea una fila en `public.import_batches`
([`0016_core_platform.sql`](../../supabase/migrations/0016_core_platform.sql))
y cada producto que inserta lleva `import_batch_id`. Deshacer borra
`where import_batch_id = <lote>` y nada mas, y marca el lote con
`undone_at`: el historial de la importacion no se borra.

## Un SKU que ya existe no se pisa

El insert usa `on conflict (tenant_id, sku) do nothing`: un archivo no
sobrescribe un producto vivo. Ver en "Lo que NO hace" lo que eso deja
sin decir.

## Lectura tolerante

`parseCsv()` y `validateProducts()`
([`packages/core/src/csv.ts`](../../packages/core/src/csv.ts)):

| Acepta | Ejemplo |
|---|---|
| Coma o punto y coma como separador | `sku;nombre` (lo que exporta Excel en espanol) |
| Comillas, comas dentro de comillas, comillas escapadas, CRLF | `"Arroz, selecto"` |
| Encabezados en varios idiomas, con o sin acentos | `Código`, `Descripción`, `PVP` |
| Simbolo de moneda | `RD$ 215.00` |
| Miles en ingles o en europeo | `1,234.56` y `1.234,56` |

Obligatorias: codigo (`sku`/`codigo`/`referencia`) y nombre. Sin precio se
asume 0. Un codigo repetido **dentro del mismo archivo** se rechaza con su
linea.

El `errors` del lote se guarda con `${JSON.stringify(errors)}::text::jsonb`
y no con `::jsonb` directo: con el cast directo postgres.js serializa dos
veces y la columna guarda un string. Fijado en
`supabase/tests/jsonb-params.test.ts`.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/importar` | `imports.view` | Subir CSV, columnas reconocidas, historial de 25 lotes con deshacer y detalle de rechazos |

```
┌─ Catalogo > Importar ─────────────────────────────────────────────┐
│ Importar productos                                                │
│ ┌Importaciones┐ ┌Filas cargadas┐ ┌Rechazadas┐                     │
│ │      3      │ │     412      │ │    7     │                     │
│ └─────────────┘ └──────────────┘ └──────────┘                     │
│ ┌ Subir archivo CSV ────────────────────────────────────────────┐ │
│ │ [Elegir archivo…]                              [Importar]     │ │
│ │ sku — sku · codigo · código · code · referencia [obligatoria] │ │
│ │ name — name · nombre · descripcion · producto   [obligatoria] │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ Archivo              Cuando        Quien  Filas Entraron Fallaron │
│ ferreteria-sept.csv  18 sept 10:05 Maria    215     211       4   │
│                                                      [Deshacer]   │
│ > 4 filas rechazadas en ferreteria-sept.csv                       │
│   Linea 17 · price — "gratis" no es un numero.                    │
└───────────────────────────────────────────────────────────────────┘
```

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `imports.view` | Abre `/importar` |
| `imports.create` | Importar (junto con `products.create`) |
| `imports.edit` | Deshacer (junto con `products.delete`) |
| `imports.delete`, `imports.export` | Declarados; ninguna accion los usa |

## Eventos

| Evento | Estado |
|---|---|
| `imports.batch.completed` | Declarado; **ningun codigo lo emite** |
| `imports.batch.undone` | Declarado; **ningun codigo lo emite** |

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega. El catalogo (0009) no declara el `requires: products` que si declara el manifiesto |
| 2 | Migraciones + RLS probadas | ⚠️ solo la red de `isolation.test.ts` y la trampa del jsonb (`jsonb-params.test.ts`). **Sin prueba** de importar ni de deshacer contra la base |
| 3 | Logica pura con cobertura | ⚠️ `csv.test.ts` — 15 pruebas. No cubre los dos casos de "Lo que NO hace" que pierden datos |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ➖ no aplica: `platforms.mobile = false` |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ⚠️ `f13.importar` tiene 5 pasos; `core.bienvenida` (modulo `tour`) le dedica uno mas |
| 8 | Datos demo | ❌ la siembra no crea lotes |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ⚠️ documentado aqui que los eventos declarados no se emiten |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/importar` en la sonda de F4: la subida de CSV fue uno de los 5 controles sin nombre corregidos; tercera pasada sin fallos |

## Lo que NO hace

- **Contar bien cuando un SKU ya existia.** `inserted` se guarda como
  `valid.length`, pero las filas que chocan con un SKU existente se descartan
  en silencio por el `on conflict do nothing`. Un archivo de 200 productos que
  ya estaban dice "Entraron: 200" y no entro ninguno. El comentario del codigo
  dice "se reporta y sigue"; no se reporta.
- **Leer `1,234` como mil doscientos treinta y cuatro.** Con una sola coma y
  sin punto, `parseNumero()` asume formato europeo y lo lee como `1.234`; la
  columna `numeric(12,2)` lo guarda como RD$1.23. En RD la coma es separador
  de miles, asi que un precio de "1,234" exportado sin decimales entra mil
  veces mas barato, sin error.
- **Rechazar un costo negativo en la validacion.** El precio negativo se
  rechaza por fila; el costo no. La fila pasa la validacion y la base la
  rechaza con su `check (cost >= 0)`, lo que revierte **la importacion
  entera** con un error de servidor en vez de un rechazo de fila.
- **Vista previa antes de cargar.** La pantalla dice "validamos antes de
  guardar", y el tour dice "te avisa ANTES de cargar". Lo que pasa de verdad:
  en un mismo clic se validan las filas, las buenas se insertan y las malas
  se reportan. No hay paso de confirmacion.
- **Clientes, saldos iniciales, XLSX, plantilla descargable.** El tour
  `f13.importar` habla de los tres primeros y de "baja la plantilla"; §5.1 y
  el catalogo prometen XLSX y mapeo visual. Hoy solo hay CSV de productos, y
  el mapeo es automatico por nombre de columna.
- **Deshacer un lote cuyos productos ya se usaron.** No esta probado que
  pasa si un producto importado ya aparece en una venta o en el kardex; el
  `delete` depende de como este declarada cada FK hacia `products`.
