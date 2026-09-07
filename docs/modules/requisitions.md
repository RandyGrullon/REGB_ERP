# `requisitions` — Requisiciones

**Que resuelve:** pedir algo antes de comprarlo, con aprobacion por
monto real -el limite de cada rol decide, no una firma en papel ni un
hilo de WhatsApp-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Recomienda:** `purchase-orders`

---

## La jerarquia es el sistema de roles mismo, no una tabla nueva

Aprobar una requisicion llama `exigir(ctx, 'requisitions',
'requisitions.approve', estimated_amount)` -el mismo mecanismo
`max_amount` que ya existe en `@regb/permissions` desde antes de esta
fase-. Si el rol de quien aprueba tiene un limite mas bajo que el
monto pedido, `can()` lo rechaza con el motivo `amount-exceeded`; un
rol sin ese limite (Owner, Gerente General) aprueba en su lugar. No
hace falta una cadena de aprobacion aparte: la jerarquia ya existe.
Verificado en vivo: una requisicion de RD$75,000 se rechazo
correctamente con un rol tope RD$50,000 (Gerente de Sucursal), y se
aprobo sin problema como Owner.

## Un bug real, encontrado al verificar la aprobacion como Owner

`approved_by` se definio originalmente como `uuid references
public.employees(id)` -copiando sin pensar el patron de `employee_id`,
que si es una fila de `employees`-. Pero quien aprueba es el
**usuario autenticado** (`ctx.userId`, de `user_profiles`), no
necesariamente alguien con fila en `employees`. El resultado: **ningun
rol podia aprobar nada**, porque el `UPDATE` violaba la FK casi
siempre. Se encontro al intentar aprobar como Owner en el navegador y
ver que la fila se quedaba en `pending` sin ningun error visible -la
accion silenciosamente fallaba y el `<form action>` que la envuelve
descarta el `ActionResult`, asi que nadie veia el motivo-. Se
corrigio quitando la FK y la validacion cruzada de `approved_by` en
`impedir_requisicion_ajena()`, siguiendo el mismo criterio que
`decided_by` en `time-off` (0054) y `expenses` (0055): un uuid sin
FK, porque su tenant ya lo garantiza la sesion bajo la que corre
`asUser()`, no una fila de `employees`.

## La transicion de estado se valida en TypeScript, no en SQL

`transicionValidaRequisicion()` en `@regb/operations` define el flujo:
`draft → pending → approved | rejected`, y `approved → converted` es
la unica salida desde ahi. `rejected` y `converted` son terminales.

## Aprobada NO es terminal, convertida SI

Solo `rejected` y `converted` bloquean edicion
(`impedir_editar_requisicion_resuelta()`). Una requisicion `approved`
sigue editable -tipicamente para agregar la `po_reference` cuando se
marca convertida-, porque "aprobada" todavia esta en progreso, no
resuelta.

## Honesto sobre lo que todavia no hace

"Convertida" es un estado manual con una referencia de texto libre a
la orden de compra resultante -todavia NO crea automaticamente una
fila en `purchase_orders`-. Esa integracion real (requisicion →
orden de compra con un clic) es un paso futuro, declarado
explicitamente en la migracion, el manifest y aqui.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/requisiciones` | `requisitions.view` | Lista con estado, solicitar una nueva, aprobar/rechazar (segun `max_amount` del rol), marcar convertida |

## Manifiesto

- **Permisos:** `view`, `request`, `approve`
- **Widgets:** `requisitions-pending`
- **Recomienda:** `purchase-orders` (sin requerirlo: funciona solo, la conversion es manual)
- **Emite:** `requisitions.requisition.submitted`, `requisitions.requisition.approved`, `requisitions.requisition.rejected`
- **Plataformas:** web y escritorio

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/requisitions.test.ts` — 11 casos: aislamiento, spoofing de tenant via `employee_id` ajeno, `approved_by` acepta cualquier uuid (no se valida como empleado, a proposito), aprobada NO es terminal pero convertida SI, modulo apagado, checks de tabla |
| 3 | Logica pura con cobertura | ✅ `requisitions.ts` — 6 pruebas: la maquina de estados completa |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: las tres requisiciones sembradas (pendiente, rechazada con nota, convertida con referencia de OC) renderizan correctamente; se creo una requisicion de prueba de RD$75,000, se confirmo que un rol con limite RD$50,000 NO puede aprobarla (bloqueada, se queda pendiente), y que Owner SI puede -momento en el que se encontro y corrigio el bug de `approved_by`- |
| 5 | UI movil | 🔜 F9 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ una pendiente (RD$3,500, papeleria), una aprobada y convertida (RD$45,000, con `po_reference`), una rechazada con nota de decision (RD$85,000, cambio de aire acondicionado) |
| 9 | ≥2 widgets | ⚠️ solo 1 (`requisitions-pending`): el modulo es principalmente un flujo de aprobacion, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos |

## Lo que NO hace

- **Crear la orden de compra automaticamente.** "Convertida" es una
  referencia de texto libre; la integracion real con
  `purchase_orders` es un paso futuro.
- **Una cadena de aprobacion configurable.** No hay una tabla de
  aprobadores por nivel; la jerarquia es el `max_amount` que ya tiene
  cada rol en el sistema de permisos.
- **Notificar automaticamente al aprobador.** Quien aprueba tiene que
  entrar a mirar la lista; no hay alerta push todavia.
