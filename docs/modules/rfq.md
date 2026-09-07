# `rfq` — Cotizacion a proveedores

**Que resuelve:** comparar varias cotizaciones de proveedores para el
mismo pedido, con un ganador que se elige siempre por la misma regla
-nunca a criterio de quien compra-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `suppliers`

---

## El comparativo elige, no la persona

`mejorCotizacion()` (`@regb/operations`) toma la lista de cotizaciones
registradas y devuelve el `supplierId` con el `totalAmount` mas bajo
-desempate por el `leadTimeDays` mas corto-. La pantalla de detalle
(`/cotizaciones/[id]`) marca esa fila con el badge "Mejor oferta" en
vivo, calculado con la misma funcion que corre en las pruebas
unitarias. Verificado en el navegador con dos cotizaciones reales
sembradas -RD$43,000/15 dias contra RD$45,000/10 dias-: el badge cae
en la de RD$43,000, confirmando que el precio manda incluso cuando la
otra oferta entrega mas rapido.

## Una cotizacion registrada queda fija, siempre

`rfq_quotes` es inmutable desde el momento del insert
(`impedir_editar_cotizacion()`, sin condicion) -es un hecho historico
de lo que un proveedor ofrecio en un momento dado, no un borrador que
se edita-. Mismo criterio que `benefit_loan_payments` (0057) o
`performance_reviews` (0059): lo que ya paso no se reescribe.

## Adjudicar es terminal

Una vez `awarded` o `cancelled`, el RFQ ya no se puede editar
(`impedir_editar_rfq_resuelto()`). Adjudicar registra
`awarded_supplier_id` y `awarded_at`, y emite
`rfq.supplier.awarded`. Verificado en el navegador: al adjudicar el
RFQ sembrado a Ferreteria Central Import SRL (la oferta ganadora), el
estado cambio a "Adjudicado" y las acciones de invitar/registrar
desaparecieron de la pantalla -correcto, ya no hay nada que hacer ahi-.

## El mismo agujero de siempre, con dos tablas compartiendo un trigger

`impedir_referencia_ajena_rfq()` se reutiliza entre `rfq_invitations` y
`rfq_quotes` -ambas validan `rfq_id` Y `supplier_id` contra el
tenant de la fila nueva-, en vez de escribir la misma logica dos
veces. `impedir_rfq_ajeno()` cubre el `awarded_supplier_id` nullable
en la tabla `rfqs` misma.

## Honesto sobre lo que todavia no hace

No existe un portal publico donde el proveedor entre a ver el RFQ y
suba su propia cotizacion -las invitaciones y cotizaciones las
registra manualmente quien compra, dentro del ERP-. La razon es la
misma regla de todo este proyecto desde `0005_rls_policies.sql`:
"Nunca otorgamos nada a `anon` sobre datos de negocio". Construir un
portal de proveedor real requiere una capa de autenticacion externa
completa -magic link, sesion de invitado, RLS especifica para
`anon`-, que es trabajo genuino de una fase futura, no una casilla
que se marca aqui.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/cotizaciones` | `rfq.view` | Lista de RFQs con conteo de cotizaciones, crear uno nuevo |
| `/cotizaciones/[id]` | `rfq.view` | Comparativo con "Mejor oferta" calculada en vivo, invitar proveedor, registrar cotizacion, adjudicar |

## Manifiesto

- **Permisos:** `view`, `manage`, `award`
- **Widgets:** `rfqs-open`
- **Requiere:** `suppliers`
- **Emite:** `rfq.supplier.awarded`
- **Plataformas:** web y escritorio -sin movil, `platforms.mobile = false`-

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/rfq.test.ts` — 12 casos: aislamiento, spoofing de tenant via `rfq_id`/`supplier_id`/`awarded_supplier_id` ajenos, inmutabilidad incondicional de `rfq_quotes`, RFQ resuelto es inmutable, modulo apagado, checks de tabla |
| 3 | Logica pura con cobertura | ✅ `rfq.ts` — 4 pruebas: menor monto gana, desempate por plazo de entrega mas corto |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: lista con conteo de cotizaciones y adjudicado correcto, comparativo con el badge "Mejor oferta" cayendo en la oferta de menor precio, adjudicacion real ejecutada y revertida despues de confirmar el cambio de estado |
| 5 | UI movil | N/A — el modulo declara `platforms.mobile = false` a proposito |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un segundo proveedor sembrado (Ferreteria Central Import SRL), un RFQ abierto con dos cotizaciones competidoras, un RFQ ya adjudicado para variedad |
| 9 | ≥2 widgets | ⚠️ solo 1 (`rfqs-open`): el modulo es principalmente un comparativo, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas |

## Lo que NO hace

- **Portal publico para proveedores.** Ninguna cotizacion la sube el
  proveedor mismo; las registra quien compra, dentro del ERP -por la
  regla de nunca otorgar nada a `anon` sobre datos de negocio-.
- **Convertir la adjudicacion en orden de compra automaticamente.**
  Adjudicar marca el RFQ como resuelto; conectarlo con
  `purchase-orders` es un paso futuro, igual que en `requisitions`.
- **Notificar al proveedor por correo o SMS.** La invitacion queda
  registrada en el sistema; avisarle al proveedor todavia es manual.
