# `cost-centers` — Centros de costo

**Que resuelve:** a que sucursal, departamento o proyecto se le atribuye
cada gasto, y como se reparte uno solo entre varios.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Recomienda:** `accounting`, `budgets`

---

## El prorrateo cuadra exacto, siempre

`splitAmount()` (`@regb/operations`) reparte un monto entre varios
centros por peso relativo -los pesos no necesitan sumar 100, se
normalizan solos-. El bug clasico de un prorrateo manual es que
33.33 + 33.33 + 33.33 = 99.99, no 100: aqui el **ultimo** centro de la
lista absorbe el residuo de redondeo, para que la suma de las partes
sea siempre exacta contra el total, nunca un centavo perdido. Probado
explicitamente con un reparto en tercios y con pesos que no suman 100.

## No exige `accounting`, y es correcto que no lo haga

A diferencia de `budgets` (que si corrigio su `requires` a `accounting`
en la 0043-style de esta migracion), `cost-centers` funciona solo con
asignaciones manuales: un gasto se reparte entre sucursales sin que
tenga que pasar por un asiento contable. Si `accounting` esta activo,
una asignacion puede ademas etiquetar una linea de asiento ya existente
(`source_type = 'journal_entry'`) para trazabilidad, pero nunca es
obligatorio.

## `source_id` no lleva llave foranea, a proposito

Apunta a `public.journal_entry_lines` cuando `source_type =
'journal_entry'`, pero sin restriccion `references` fisica: una FK
obligaria a que `accounting` siempre exista para que la tabla sea
valida, contradiciendo que este modulo es independiente. La integridad
la garantiza la aplicacion al momento de etiquetar, no la base.

## El mismo agujero de siempre, tapado desde el primer dia

`cost_center_allocations` tiene su propio `tenant_id`, asi que la RLS
de insercion solo compara ese valor -no revisa a quien pertenece
`cost_center_id`-. `impedir_asignacion_centro_ajeno()` cierra esto
desde la migracion original (0048), mismo criterio que `ap`,
`treasury`, `bank-rec`, `fixed-assets` y `budgets` ya aplicaron.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/centros-costo` | `cost-centers.view` | Lista con total por centro, prorratear entre varios, asignar a uno solo, crear centro |
| `/centros-costo/:id` | `cost-centers.view` | Historial completo de asignaciones de un centro |

## Manifiesto

- **Permisos:** `view`, `center.create`, `allocation.create`, `export`
- **Widgets:** `cost-center-top`, `cost-center-total`
- **Reportes:** `cost-center-distribution`
- **Emite:** `cost-centers.allocation.created`
- **Requiere:** ninguno · **Recomienda:** `accounting`, `budgets`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/cost-centers.test.ts` — 8 casos: aislamiento, spoofing de tenant en asignacion, asignacion propia funciona normal, modulo apagado, restriccion de `source_id` obligatorio para `journal_entry`, restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `cost-centers.ts` — 8 pruebas: reparto exacto en tercios, pesos no normalizados, peso total cero, un solo centro, suma de totales |
| 4 | UI web responsive | ✅ verificado en navegador con datos reales: prorrateo 1:2 aplicado en vivo (3,000/6,000 de RD$9,000), historial reflejando cada asignacion |
| 5 | UI movil | 🔜 F5 — sin `mobileScope`: `platforms.mobile = false` |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ dos sucursales reales (Santo Domingo, Santiago) con un gasto prorrateado 2:1 y uno asignado manual |
| 9 | ≥2 widgets | ✅ `cost-center-top`, `cost-center-total` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas nuevas |

## Lo que NO hace

- **Rentabilidad por centro.** El catalogo lo promete, y este primer
  corte solo cubre el lado del costo. Atribuir tambien el ingreso por
  centro es una decision de negocio -por sucursal que vendio, por
  vendedor- que no se asume aqui.
- **Forzar que un prorrateo sume el 100% de un gasto real.** Un usuario
  puede prorratear solo una parte de un gasto y dejar el resto sin
  asignar; el sistema no lo impide ni lo detecta.
- **Jerarquia de centros.** Cada centro es un nivel plano -sin centro
  padre/hijo-. Una estructura de sub-departamentos queda para una
  mejora futura.
