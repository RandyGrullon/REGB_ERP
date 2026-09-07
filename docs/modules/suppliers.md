# `suppliers` — Proveedores

**Que resuelve:** documentos con vigencia calculada, cuentas bancarias
y evaluacion sobre la MISMA ficha de proveedor que ya usan compras y
cuentas por pagar -homologacion como un estado visible, no un tramite
perdido en WhatsApp-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Recomienda:** `ap`

---

## Un bug real, encontrado antes de escribir una sola tabla nueva

`public.suppliers` existe desde `purchase-orders` (0038), con un
comentario que ya anticipaba este momento: *"vive aqui y no en un
modulo `suppliers` propio... hasta que exista `ap` o `suppliers`"*.
Pero cuando `ap` (0042) se construyo, referencio `suppliers` desde
`supplier_invoices.supplier_id` sin que nadie volviera a tocar la RLS
de la ficha basica -que seguia revisando **solo**
`rls.module_active('purchase-orders')`-. El catalogo de `ap` no
requiere `purchase-orders` (`requires: {}`): un tenant con **solo**
`ap` activo es un caso perfectamente valido segun el propio catalogo.

Se reproduzco antes de tocar nada: un tenant asi ve su factura de
proveedor, pero el nombre del proveedor le llega `null` -la fila de
`suppliers` queda invisible bajo RLS, aunque la factura la referencia
correctamente-. No es un agujero de seguridad -nadie ve datos de otro
tenant-, pero SI es un bug de correctitud real, ya en produccion desde
que `ap` se publico.

**Corregido ampliando la politica, nunca reduciendo el acceso ya
existente**: `purchase-orders`, `ap` o `suppliers` -cualquiera de los
tres- desbloquea ahora la ficha basica. Verificado con un tenant
sintetico con solo `ap` activo antes y despues del cambio.

## Las tablas nuevas SI son exclusivas de `suppliers`

A diferencia de la ficha basica -ahora compartida entre tres modulos-,
`supplier_documents`, `supplier_bank_accounts` y `supplier_evaluations`
solo se desbloquean con `rls.module_active('suppliers')`: son la parte
nueva del catalogo (documentos, cuentas bancarias, evaluacion) que
`purchase-orders` y `ap` nunca prometieron.

## Vigencia y promedio: reutilizados, no reimplementados

`tieneDocumentoVencido()` (`@regb/operations`) reutiliza
`certificadoVigente()` de `training.ts` -misma forma exacta: una fecha
de vencimiento nullable contra hoy- en vez de reimplementar la misma
comparacion una tercera vez en el modulo. El promedio de evaluaciones
se calcula igual que en `training`/`performance`: derivado siempre de
las filas individuales, nunca guardado aparte.

## Una evaluacion registrada es inmutable -sin excepcion-

Mismo criterio que `performance_reviews` o `training_certificates`: una
vez registrada, no se edita ni se borra. Un error se corrige con una
evaluacion nueva, nunca reescribiendo la anterior.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/proveedores` | `suppliers.view` | Homologacion, documentos con vigencia calculada, cuentas bancarias, evaluacion -sobre los proveedores ya creados desde Compras > Proveedores- |

## Manifiesto

- **Permisos:** `view`, `manage`, `manage-documents`, `evaluate`
- **Widgets:** `suppliers-expiring-docs`, `suppliers-pending-qualification`
- **Reportes:** `supplier-scorecard`
- **Emite:** `suppliers.evaluation.recorded`, `suppliers.qualification.changed`
- **Recomienda:** `ap`
- **Plataformas:** web y escritorio -sin movil, `platforms.mobile = false`-

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/suppliers.test.ts` — 14 casos, incluidos dos que prueban directamente el bug encontrado (un tenant con SOLO `ap` activo SI ve la ficha; sin ninguno de los tres modulos, NO la ve), aislamiento de las tres tablas nuevas, spoofing de tenant via proveedor ajeno, una evaluacion nunca editable, modulo apagado, checks de tabla |
| 3 | Logica pura con cobertura | ✅ `suppliers.ts` — 4 pruebas de `tieneDocumentoVencido()`, reutilizando `certificadoVigente()` de `training.ts` en vez de reimplementarlo |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: homologacion cambiada en vivo, documento vencido registrado en vivo con el badge "Vencido" apareciendo de inmediato, evaluacion promedio correcta (4.5 de dos evaluaciones sembradas) |
| 5 | UI movil | N/A — el modulo declara `platforms.mobile = false` a proposito |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ el proveedor ya sembrado por `purchase-orders` (Materiales Del Este SRL), homologado, con un documento vigente, uno por vencer en 25 dias, una cuenta bancaria y dos evaluaciones |
| 9 | ≥2 widgets | ✅ `suppliers-expiring-docs`, `suppliers-pending-qualification` |
| 10 | Eventos documentados | ✅ declarados con el formato correcto de 3 segmentos; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos -aplicando aria-label desde el principio en todo control sin texto visible- |

## Lo que NO hace

- **Crear proveedores.** Eso sigue siendo `purchase-orders` (`/compras/proveedores`);
  este modulo solo agrega funciones nuevas sobre proveedores que ya
  existen.
- **Adjuntar el archivo del documento.** Registra tipo, numero y
  vigencia -no hay almacenamiento de archivos-.
- **Bloquear una orden de compra a un proveedor no homologado.**
  `qualification_status` es informativo; no hay todavia una validacion
  cruzada con `purchase-orders` que impida comprarle a un proveedor
  `disqualified`.
