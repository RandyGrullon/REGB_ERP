# `invoice-capture` — Captura de facturas 🚧 No construido · fuera de venta desde 0124

**Que resuelve (cuando exista):** fotografias la factura del proveedor y el
sistema extrae RNC, NCF, fecha, ITBIS y lineas, para que el 606 no se arme
tecleando.

**Categoria:** `advanced` (§5.2 #93) · **Precio (cuando exista):** 400/1500/4000
instalacion · 45/160/420 mes (en `regb.module_pricing` desde
[`0012_catalog_built_modules.sql`](../../supabase/migrations/0012_catalog_built_modules.sql);
0124 lo conserva) · **Consumo medido:** 100 documentos incluidos al mes, luego
US$0.04 por documento (declarado en el manifiesto) · **Requiere:** ninguno ·
**Recomienda:** `ap`, `taxes`, `files` · **Plataformas:** web ✔️ desktop ✔️
movil ✔️ (`mobileScope: upload, view`)

---

> **Estado real, dicho primero:** de este modulo existe el manifiesto, la
> fila del catalogo con su precio, la ficha de marketplace (0013) y un tour.
> **No existe** ninguna tabla, ninguna pagina, ninguna accion ni ningun OCR.
> Ningun documento del repo le asigna trimestre.
>
> Como no existe, **no se vende ni se cobra**
> ([`0124_invoice_capture_no_se_vende.sql`](../../supabase/migrations/0124_invoice_capture_no_se_vende.sql)):
> esta sin publicar, nadie lo tiene activo y la base se niega a activarlo.

## Lo que hizo 0124 — y por que asi

Hasta 0124 estaba `is_published = true`, la siembra se lo activaba a
Distribuidora Caribe y **el motor de facturacion se lo cobraba**: REGB
Control y `generateMonthlyInvoices()` leen los modulos activos o en prueba de
`regb.tenant_modules` y se los pasan a `calculateMonthly`. Medido en la demo
(tier mediano, ciclo anual, 64 modulos de pago):

| | Mensualidad | Instalacion cotizada |
|---|---:|---:|
| Con `invoice-capture` activo | US$ 5,346.50 | US$ 56,900 |
| Tras 0124 | US$ 5,210.50 | US$ 55,400 |
| Diferencia | **US$ 136/mes** (160 − 15 % anual) | **US$ 1,500** |

El consumo medido no llegaba a cobrarse, pero solo porque nada lo mide:
`regb.usage_meters` ni siquiera admite la metrica.

| Que | Como |
|---|---|
| Fuera del escaparate | `is_published = false`. El marketplace lo pinta "En camino" y `solicitarActivacion` ya rechaza lo no publicado |
| Nadie lo tiene | Las activaciones vivas pasan a `archived` (con `archived_at`). Nada se borra |
| Nadie lo puede tener | Trigger `no_activar_invoice_capture` en `regb.tenant_modules`: rechaza `active` o `trial`, por alta, por `update` o por el upsert del panel. Errcode 55000 |
| Solicitudes viejas | Las pendientes que lo pedian lo pierden, con nota; si era lo unico, se cierran como descartadas |
| La ficha | Se quito la afirmacion "acierta casi siempre" -una cifra de un OCR que no existe- y los "15 minutos" de puesta en marcha |
| La siembra | `supabase/seed/demo.sql` ya no se lo activa a la distribuidora |
| El manifiesto | `routes`, `dashboardWidgets` y `reports` vacios: eran cuatro enlaces del menu a un 404 |

**Por que archivar y no "no cobrar lo no publicado".** `is_published`
significa "se vende hoy", no "funciona". Un modulo que se deja de vender y el
cliente usa se le sigue cobrando (grandfathering), y hoy `e-invoice` esta sin
publicar, construido y activo en la distribuidora: excluir lo no publicado del
calculo le regalaria ese modulo sin que nadie lo decidiera. A
`invoice-capture` no se le debe cobrar porque **el cliente no lo tiene**, y
archivar dice exactamente eso.

> **Decision pendiente (de producto, no de esta ficha): `e-invoice`.** Esta
> despublicado desde 0009 y su ficha de marketplace dice "todavia no se ha
> construido", pero SI existe (0101, pantallas de e-CF) y esta **activo y
> cobrandose** en Distribuidora Caribe como modulo advanced (US$160/mes en
> mediano, dentro o fuera de los 5 incluidos). No emite e-CF de verdad hasta
> tener el certificado DGII. Hay que elegir: publicarlo con una ficha
> honesta ("funciona en ambiente de pruebas; en produccion al tener tu
> certificado"), o dejar de cobrarlo -archivar la activacion, como aqui- hasta
> que emita. Lo que no se sostiene es lo de hoy: no se vende, pero se cobra.

**Para publicarlo el dia que exista:** en la misma migracion que lo publique,
`drop trigger no_activar_invoice_capture on regb.tenant_modules` y `drop
function regb.invoice_capture_no_existe_todavia()`, devolver las rutas al
manifiesto y reescribir la respuesta "¿Que tan bien lee?" con una cifra
medida.

## Por que es un modulo aparte y no una funcion de `ap`

Lo explica §5.2 del documento maestro, y es la unica decision de este modulo
que ya esta tomada:

1. **Cuesta dinero cada vez.** Cada documento consume OCR y un modelo de
   vision. Sin consumo medido, el cliente que sube 3,000 facturas al mes se
   come el margen.
2. **Se vende solo.** Un contador externo que lleva 15 empresas pequenas lo
   quiere sin comprar contabilidad completa.

## Las dos reglas que el manifiesto deja escritas

| Regla | Por que |
|---|---|
| **Nunca contabiliza solo.** Genera un borrador que una persona aprueba | Una extraccion con 94 % de confianza sigue siendo un 6 % de facturas mal contabilizadas, y en fiscalidad eso no se perdona |
| **La imagen se cifra y se purga a los 90 dias de aprobada** | Contiene RNC y montos de terceros; el dato que importa ya vive en `ap`. §5.2 nombra `pgsodium` para el cifrado |

## Pantallas previstas (ninguna existe ni esta declarada)

Salieron del manifiesto en 0124. Son el diseno, no rutas:

| Ruta | Permiso |
|---|---|
| `/invoice-capture` | `invoice-capture.view` |
| `/invoice-capture/review` | `invoice-capture.review` |
| `/invoice-capture/history` | `invoice-capture.view` |
| `/invoice-capture/:id` | `invoice-capture.view` |

El diseno esta en la ficha de marketplace
([`0013_module_detail.sql`](../../supabase/migrations/0013_module_detail.sql));
este mockup es una version recortada de aquel:

```
┌───────────────────────┬──────────────────────────────┐
│                       │ Factura de proveedor         │
│   [ FOTO DE LA        │ ──────────────────────────── │
│     FACTURA ]         │ Proveedor  Ferreteria Ochoa  │
│                       │ RNC        1-01-12345-6   ✓  │
│                       │ NCF        B0100000123    ✓  │
│                       │ Fecha      18/07/2026     ✓  │
│                       │ Subtotal   $ 24,500.00    ✓  │
│                       │ ITBIS      $  4,410.00    ⚠  │
│                       │   └ poco legible, verifica   │
│                       │ TOTAL      $ 28,910.00       │
│                       │ [Rechazar]      [Aprobar]    │
└───────────────────────┴──────────────────────────────┘
```

## Permisos declarados

`invoice-capture.view`, `.upload`, `.review`, `.approve`, `.reject`,
`.export` — en el manifiesto y en el catalogo (0010, 0012). Ninguna accion
los usa porque no hay acciones.

## Eventos declarados

`invoice-capture.document.extracted`, `invoice-capture.document.rejected`.
Se quedan en el manifiesto como contrato de lo que se va a construir; ningun
codigo los emite porque no hay nada que los produzca.

## Pruebas

| Archivo | Que fija |
|---|---|
| [`supabase/tests/invoice-capture.test.ts`](../../supabase/tests/invoice-capture.test.ts) | Sin publicar y con su precio de 3 tiers; ningun cliente lo tiene activo; la base no deja activarlo (alta, prueba, reactivar archivado, upsert del panel); apagar una licencia archivada no falla; la guarda no toca otros modulos; ninguna solicitud pendiente lo trae (10 pruebas) |
| [`apps/web/src/lib/cobro-invoice-capture.accion.test.ts`](../../apps/web/src/lib/cobro-invoice-capture.accion.test.ts) | El motor real (`loadTenantsWithModules` + `quoteTenant`) no lo lleva para ningun cliente; intentar activarlo no mueve la cotizacion; la accion real del marketplace no deja pedirlo (3 pruebas) |

Antes de 0124, 10 de las 13 estaban en rojo -la de la web dijo
`['distribuidora-caribe']` donde se espera `[]`-; las otras tres fijan lo que
no debe cambiar (el precio, que otro modulo se active normal, que no queden
solicitudes). Despues, 13 en verde.

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ valido para `audit:manifests` (verde tras 0124); sin rutas a proposito |
| 2 | Migraciones + RLS probadas | ❌ no hay tablas. Lo que si hay (la guarda de 0124) esta probado |
| 3 | Logica pura con cobertura | ❌ no hay logica |
| 4 | UI web responsive | ❌ no hay paginas |
| 5 | UI movil | ❌ no hay pantalla |
| 6 | Desktop verificado | ❌ |
| 7 | Tour ≥6 pasos | ❌ `f14.captura-facturas` tiene 4 pasos y el primero manda a `/pagar` a subir una foto que `ap` no sabe leer. Ya no lo ve nadie: el tutorial solo muestra tours de modulos licenciados |
| 8 | Datos demo | ✅ ninguno, a proposito: la siembra ya no lo activa |
| 9 | ≥2 widgets | ❌ ninguno; salieron del manifiesto |
| 10 | Eventos documentados | ⚠️ documentados; no se emiten porque no hay modulo |
| 11 | Precio en 3 tiers | ✅ 400/1500/4000 · 45/160/420, sin publicar |
| 12 | E2E en 3 plataformas | ❌ |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ❌ no hay pantallas que medir |

## Lo que queda

- **Construirlo** es la unica forma de que vuelva a venderse. Pide OCR y un
  proveedor externo, y consumo medido de verdad.
- **El consumo medido vive en dos sitios que no coinciden.** El manifiesto
  lo declara con `key: 'document'`; `apps/web/src/lib/marketplace.ts` lo
  cablea aparte con `key: 'documento'` y un `if row.id === 'invoice-capture'`
  (`audit:registry` no lo ve porque `invoice-capture` no esta en su lista de
  ids). Ninguno de los dos esta en `regb.module_pricing`, y
  `regb.usage_meters` no admite la metrica. El marketplace es de otro
  agente; queda anotado aqui.
