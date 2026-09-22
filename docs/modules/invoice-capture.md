# `invoice-capture` — Captura de facturas 🚧 Planificado — sin trimestre asignado

**Que resuelve (cuando exista):** fotografias la factura del proveedor y el
sistema extrae RNC, NCF, fecha, ITBIS y lineas, para que el 606 no se arme
tecleando.

**Categoria:** `advanced` (§5.2 #93) · **Precio:** 400/1500/4000
instalacion · 45/160/420 mes (cargado en `regb.module_pricing` por
[`0012_catalog_built_modules.sql`](../../supabase/migrations/0012_catalog_built_modules.sql))
· **Consumo medido:** 100 documentos incluidos al mes, luego US$0.04 por
documento (declarado en el manifiesto) · **Requiere:** ninguno ·
**Recomienda:** `ap`, `taxes`, `files` · **Plataformas:** web ✔️ desktop ✔️
movil ✔️ (`mobileScope: upload, view`)

---

> **Estado real, dicho primero:** de este modulo existe el manifiesto, la
> fila del catalogo con su precio, la ficha de marketplace (0013) y un tour.
> **No existe** ninguna tabla, ninguna pagina, ninguna accion, ningun OCR ni
> ninguna prueba. `ESTADO.md` lo llama "el unico hueco real" de las fichas
> pendientes, y es mas que un hueco de documentacion: es un modulo que se
> vende y no esta construido. Ningun documento del repo le asigna trimestre,
> por eso el aviso de arriba no lleva uno.

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

## Pantallas declaradas (ninguna existe)

| Ruta | Permiso | Estado |
|---|---|---|
| `/invoice-capture` | `invoice-capture.view` | 🚧 sin pagina en `apps/web/src/app` |
| `/invoice-capture/review` | `invoice-capture.review` | 🚧 sin pagina |
| `/invoice-capture/history` | `invoice-capture.view` | 🚧 sin pagina |
| `/invoice-capture/:id` | `invoice-capture.view` | 🚧 sin pagina |

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
Ningun codigo los emite.

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega |
| 2 | Migraciones + RLS probadas | ❌ no hay tablas |
| 3 | Logica pura con cobertura | ❌ no hay logica |
| 4 | UI web responsive | ❌ no hay paginas |
| 5 | UI movil | ❌ no hay pantalla |
| 6 | Desktop verificado | ❌ |
| 7 | Tour ≥6 pasos | ❌ `f14.captura-facturas` tiene 4 pasos, y el primero manda a `/pagar` a subir una foto que `ap` no sabe leer |
| 8 | Datos demo | ⚠️ la siembra **activa** el modulo para el tenant demo mediano (`demo.sql`), sin datos |
| 9 | ≥2 widgets | ❌ `pending-review` y `capture-accuracy` declarados, sin implementacion |
| 10 | Eventos documentados | ⚠️ documentados aqui; no se emiten |
| 11 | Precio en 3 tiers | ✅ 400/1500/4000 · 45/160/420 |
| 12 | E2E en 3 plataformas | ❌ |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ❌ no hay pantallas que medir |

## Lo que NO hace — y lo que hay que decidir

- **Nada de lo que su ficha de marketplace promete.** Y el catalogo lo
  tiene `is_published = true` desde 0012: un cliente lo ve, puede pedirlo, y
  la matriz de precios le cobraria de US$400 a US$4,000 de instalacion por un
  modulo sin pantallas. El tenant demo "Distribuidora Caribe" ya lo tiene activo. Si el
  registry ofrece sus cuatro rutas en el menu -no verificado en navegador-,
  quien las abra recibe 404, y `sonda-rutas.mjs` cuenta el 404 como
  respuesta valida, asi que no lo marca. **Despublicarlo o construirlo es
  una decision de producto**, no de esta ficha.
- **El consumo medido vive en dos sitios que no coinciden.** El manifiesto
  lo declara con `key: 'document'`; `apps/web/src/lib/marketplace.ts` lo
  cablea aparte con `key: 'documento'` y un `if row.id === 'invoice-capture'`.
  Ninguno de los dos esta en `regb.module_pricing`, que es la fuente de
  precios.
