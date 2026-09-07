# `payments` — Pasarelas de cobro

**Que resuelve:** links de cobro y cobro recurrente, con confirmacion
manual del pago -sin conexion a una pasarela real todavia-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Recomienda:** `ar`

---

## Sin Stripe, Azul, CardNet ni PayPal de verdad: declarado, no escondido

El catalogo (§5.2) nombra pasarelas reales. Integrarlas de verdad pide
credenciales de comercio reales y la revision de seguridad que eso
exige -este sistema **nunca** construye un formulario que capture
datos de tarjeta sin esa base, ni finge procesar un cobro que en
realidad no llega a ningun lado-. `gateway` guarda cual pasarela se
**pretende** usar -hoy las cinco opciones (`manual`, `stripe`, `azul`,
`cardnet`, `paypal`) se resuelven exactamente igual: una confirmacion
manual-, dejando el esquema listo para el dia que una integracion real
exista, sin migrar otra vez.

## Confirmar el pago es manual, y es lo correcto para este corte

Mismo criterio que un cobro de `ar` (0023) o un pago de `ap` (0042): el
dinero se recibe por el canal real que sea -transferencia, tarjeta
fisica, efectivo-, y `mark_payment_link_paid()` solo registra que ya
llego. No hay ninguna ilusion de automatizacion que no exista de
verdad.

## El cobro recurrente avanza desde CUANDO DEBIO cobrar, no desde hoy

`run_recurring_charges()` genera un link por cada cobro vencido y
calcula la siguiente fecha sumando la frecuencia a `next_charge_date`
-la fecha que vencio-, nunca a la fecha de la corrida. Si el sistema
estuvo apagado varios dias y la corrida se atrasa, el calendario
original no se pierde. Es idempotente por diseño: al avanzar la fecha
INMEDIATAMENTE despues de generar el link, correr la funcion otra vez
el mismo dia no encuentra nada vencido -sin necesitar una columna
aparte para marcarlo-.

## Un link pagado o cancelado queda historico

Igual que un activo dado de baja (0046) o un presupuesto cerrado
(0047): una vez `paid` o `canceled`, el link no se edita ni se borra.

## El mismo agujero de siempre, tapado desde el primer dia

`payment_links` y `recurring_charges` comparten la misma forma
(`customer_id` + `tenant_id`), asi que una sola funcion
`impedir_cliente_ajeno()` protege las dos -en `payment_links` el
cliente es opcional, la funcion lo respeta-. Mismo criterio que `ap`,
`treasury`, `bank-rec`, `fixed-assets`, `budgets` y `cost-centers` ya
aplicaron.

## Bug encontrado en el camino: `demo.sql` nunca creaba clientes

Al sembrar datos de este modulo se descubrio que `supabase/seed/demo.sql`
**nunca insertaba** `public.customers` para `distribuidora-caribe` -el
archivo siempre los SELECCIONABA rio abajo (en el cargo por mora de
`ar`, y ahora en `payments`) asumiendo que ya existian-. Exactamente el
mismo tipo de bug que ya aparecio con `warehouses` antes en esta fase:
enmascarado por inserts manuales de sesiones pasadas, invisible hasta
el primer reset completo de la base de esta sesion. Corregido con
inserts idempotentes reales (comprobados por nombre, porque
`customers.code` es nullable y un `unique` con NULL no sirve de "on
conflict").

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/cobros` | `payments.view` | Links de cobro (generar, confirmar, cancelar), cobros recurrentes (configurar, generar vencidos) |

## Manifiesto

- **Permisos:** `view`, `link.create`, `link.confirm`, `recurring.create`, `export`
- **Widgets:** `payment-links-pending`, `recurring-charges-due`
- **Reportes:** `payment-links-status`
- **Emite:** `payments.link.created`, `payments.link.paid`
- **Requiere:** ninguno · **Recomienda:** `ar`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/payments.test.ts` — 13 casos: aislamiento, spoofing de tenant en link/recurrente via cliente ajeno, doble confirmacion de pago bloqueada, pago de link cancelado bloqueado, inmutabilidad de link terminal, idempotencia de la corrida recurrente, modulo apagado, restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `payments.ts` — 13 pruebas: avance de fecha en las tres frecuencias, deteccion de vencidos calculando desde la fecha que vencio, vencimiento de link |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: cobro recurrente generado en vivo (link de RD$3,500, siguiente fecha avanzada un mes), pago confirmado en vivo reflejado en el total pagado |
| 5 | UI movil | ✅ `mobileScope: ['view']` -unica pantalla de este sprint con alcance movil declarado, al ser principalmente informativa- |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un link pendiente, uno pagado, y un cobro recurrente ya vencido -para poder generar su link en vivo sin esperar un mes- |
| 9 | ≥2 widgets | ✅ `payment-links-pending`, `recurring-charges-due` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en la pantalla nueva |

## Lo que NO hace

- **Procesar un pago de verdad.** Ninguna pasarela esta conectada. Ver
  arriba.
- **Capturar datos de tarjeta.** Este sistema no construye ese
  formulario sin las credenciales reales y la revision de seguridad que
  exige -no hay, ni habra en este corte, un campo de numero de tarjeta.
- **Enviar el link por WhatsApp o correo automaticamente.** Se genera
  el registro; compartirlo por el canal que sea es manual.
