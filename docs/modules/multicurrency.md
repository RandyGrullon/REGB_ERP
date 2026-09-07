# `multicurrency` — Multimoneda

**Que resuelve:** historial de tasas de cambio capturadas a mano,
conversion entre moneda extranjera y pesos, y diferencia cambiaria entre
dos momentos.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Recomienda:** `accounting`

---

## Sin conexion automatica al Banco Central: declarado, no escondido

El catalogo (§5.2) promete "tasas automaticas (BCRD/API)". Traer la tasa
sola de una API real del Banco Central es una integracion de red que
este primer corte no construye -mismo criterio que la retencion de `ap`
(0042) o el cargo por mora de `ar` (0040): el sistema informa, la
persona decide el numero-. La columna `exchange_rates.source` solo
acepta `'manual'` hoy, pero ya deja espacio para un futuro
`'bcrd_api'` sin migrar el esquema otra vez.

## Autocontenido: no reescribe el esquema de otros modulos

Es un catalogo de monedas + historial de tasas + una calculadora de
conversion/diferencia cambiaria, independiente. **Todavia no** conecta
con `ar`, `ap` o `treasury` para que esos modulos registren facturas o
movimientos en moneda extranjera -eso pediria agregar una columna de
moneda a `customer_invoices`, a `supplier_invoices` y a
`bank_accounts`, un cambio de esquema en tres modulos ya construidos y
probados que este primer corte no asume-.

## `currencies` es catalogo global, `exchange_rates` es por tenant

Las monedas del mundo no cambian entre clientes -`public.currencies` no
tiene `tenant_id`, y su politica es `using (true)`: cualquier
autenticado la lee-. Las tasas SI son por tenant -cada cliente capta la
suya, y no ve la de otro-. Es la unica migracion de esta fase con una
tabla de solo lectura publica: se probo explicitamente que sigue
siendo la MISMA para cualquier tenant.

## `findApplicableRate`: nunca una tasa futura

Sin captura automatica, casi nunca hay una tasa exacta del dia que se
necesita. `findApplicableRate()` (`@regb/operations`) busca la mas
reciente conocida **en o antes** de la fecha pedida -jamas una
posterior, que seria inventar el futuro-. Si no hay ninguna tasa previa
o igual, devuelve `null` en vez de adivinar.

## El indice unico evita el error tipico, no una funcion aparte

`unique (tenant_id, currency_code, rate_date)` impide capturar dos
tasas distintas para la misma moneda el mismo dia -la accion de
"capturar tasa" hace `on conflict ... do update`, asi que corregir una
tasa del mismo dia es normal, nunca un error confuso-.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/monedas` | `multicurrency.view` | Ultima tasa por moneda, calculadora de conversion, capturar tasa |
| `/monedas/:code` | `multicurrency.view` | Historial completo, calculadora de diferencia cambiaria |

## Manifiesto

- **Permisos:** `view`, `rate.set`, `export`
- **Widgets:** `exchange-rate-today`, `rate-staleness`
- **Reportes:** `exchange-rate-history`
- **Emite:** `multicurrency.rate.set`
- **Requiere:** ninguno · **Recomienda:** `accounting`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/multicurrency.test.ts` — 8 casos: catalogo global visible para cualquier tenant, aislamiento de tasas entre clientes, DOP sin tasa propia, modulo apagado, restricciones de tabla. Encontro y corrigio en el camino: `currencies` tenia RLS activo pero sin FORCE, atrapado por la red de seguridad `isolation.test.ts` de todo el proyecto |
| 3 | Logica pura con cobertura | ✅ `multicurrency.ts` — 14 pruebas: conversion en las dos direcciones, diferencia cambiaria en los tres casos (ganancia/perdida/sin cambio), tasa aplicable con y sin dato exacto, nunca una tasa futura |
| 4 | UI web responsive | ✅ verificado en navegador: conversion 100 USD a RD$5,890.00 con la tasa correcta, diferencia cambiaria de RD$700 de ganancia entre la primera y la ultima tasa capturadas |
| 5 | UI movil | 🔜 F5 — sin `mobileScope`: `platforms.mobile = false` |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ tres tasas de USD en fechas distintas, para que el historial y la diferencia cambiaria tengan algo real que comparar |
| 9 | ≥2 widgets | ✅ `exchange-rate-today`, `rate-staleness` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas nuevas |

## Lo que NO hace

- **Traer la tasa sola de una API del BCRD.** Se captura a mano. Ver
  arriba.
- **Que `ar`/`ap`/`treasury` registren montos en moneda extranjera.**
  Es autocontenido: catalogo, historial y calculadora, sin tocar el
  esquema de esos modulos todavia.
- **Reexpresion automatica de saldos.** El catalogo la promete; hoy la
  "reexpresion" es la calculadora manual de conversion -aplicar una
  tasa nueva a un monto-, no un proceso que recorra saldos existentes
  y los actualice solo.
