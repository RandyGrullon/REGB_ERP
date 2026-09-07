# Fichas de módulo

Una por módulo entregado. Cada una responde lo mismo: qué hace, qué tablas
toca, qué decisiones se tomaron y **qué falta** — con los 14 puntos de la
Definición de Terminado (§15.4) marcados uno por uno.

Los puntos que dependen de Electron o Expo aparecen como **diferidos a F5**,
no como cumplidos. Se marcan así a propósito: F4 no puede cumplirlos porque
esas apps se construyen en F5, y declararlos hechos sería mentir en el único
documento donde alguien va a buscar la verdad.

| Módulo | Qué resuelve | Ficha |
|---|---|---|
| `products` | Qué vendes, a qué precio, con qué impuesto | [products.md](products.md) |
| `inventory` | Cuánto tienes, cuánto vale, por qué cambió | [inventory.md](inventory.md) |
| `sales-orders` | Vender a crédito con el stock apartado | [sales-orders.md](sales-orders.md) |
| `pos` | Vender al contado en el mostrador | [pos.md](pos.md) |
| `ar` | Cobrar y declarar | [ar.md](ar.md) |
| `purchase-orders` | Pedir al proveedor y recibir con el costo real | [purchase-orders.md](purchase-orders.md) |
| `accounting` | Partida doble, mayor y balanza (F6) | [accounting.md](accounting.md) |
| `ap` | Facturas de proveedor, pagos y retenciones (F6) | [ap.md](ap.md) |
| `treasury` | Cuentas bancarias, transferencias y flujo de caja proyectado (F6) | [treasury.md](treasury.md) |
| `bank-rec` | Import de estados de cuenta y conciliacion asistida (F6) | [bank-rec.md](bank-rec.md) |
| `fixed-assets` | Alta, depreciacion, revaluo y baja de activos (F6) | [fixed-assets.md](fixed-assets.md) |
| `budgets` | Presupuesto por cuenta y mes, real vs. plan (F6) | [budgets.md](budgets.md) |
| `cost-centers` | Distribucion y prorrateo de gasto por centro (F6) | [cost-centers.md](cost-centers.md) |
| `multicurrency` | Tasas de cambio, conversion y diferencia cambiaria (F6) | [multicurrency.md](multicurrency.md) |
| `payments` | Links de cobro y cobro recurrente, confirmacion manual (F6) | [payments.md](payments.md) |
| `employees` | Expediente, contratos y organigrama (F7) | [employees.md](employees.md) |
| `payroll` | TSS, ISR, regalia y volantes por periodo (F7) | [payroll.md](payroll.md) |
| `attendance` | Marcaje con geocerca real, horas extra y tardanza calculadas (F7) | [attendance.md](attendance.md) |

Contexto transversal en [../HARDWARE-Y-DGII.md](../HARDWARE-Y-DGII.md): qué
hardware funciona hoy y qué parte de la DGII está conectada.

## Estado de los 14 puntos, de un vistazo

| # | Punto | products | inventory | sales-orders | pos | ar | purchase-orders |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|
| 1 | `manifest.ts` completo | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | Migraciones + RLS probadas | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3 | Lógica pura con cobertura | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4 | UI web responsive | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | UI móvil | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 |
| 6 | Desktop verificado | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 |
| 7 | Tour ≥6 pasos | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | Datos demo | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9 | ≥2 widgets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 10 | Eventos documentados | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | Precio en los 3 tiers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 12 | E2E en 3 plataformas | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 |
| 13 | Ficha en `docs/modules/` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 14 | Accesibilidad AA | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Los seis: 11 de 14 cumplidos, 3 diferidos a F5** (móvil, escritorio, E2E en
3 plataformas — todos atados a Electron/Expo, que se construyen en F5).
`purchase-orders` llegó despues pero cerró los mismos 11, incluida la sonda
de accesibilidad sobre sus 3 pantallas nuevas: cero fallos, copiando los
patrones que `sales-orders` ya habia corregido.

### Deuda declarada, común a los cinco

- **Migraciones sin `down`.** El runner es forward-only y ninguna de las 28
  tiene rollback. Se sustituye por *"la migración se prueba desde base
  limpia"*, que es la garantía que de verdad se ejerce en cada `gate:f0`.
- **Cobertura medida.** `pnpm test:coverage` la reporta por paquete.
  `@regb/operations` —donde vive toda la lógica de F4— está en **97.8 %** de
  líneas, con `costing`, `cash`, `fulfillment`, `receivables` y `documents` al
  100 %. `module-registry` 95.1 %, `permissions` 93.7 %, `billing` 93.5 %.
  `@regb/core` marca 44 % porque `tours.ts` son 316 líneas de contenido de
  tutorial sin una sola rama; su lógica de verdad (`csv`, `events`) está entre
  95 % y 100 %.
- **Accesibilidad: medida y corregida.** Ver abajo. Lo que sigue sin
  comprobarse es lo que una máquina no decide: orden de foco lógico, si un
  texto alternativo describe de verdad, y si el flujo completo se puede
  hacer solo con teclado. Eso pide una persona y un lector de pantalla.
- **RLS: los dieciocho cubiertos.** 346 pruebas contra Postgres real
  (163 de los cinco de F4 + 23 de `purchase-orders` + 10 del cargo por
  mora en `ar` + 22 de `accounting` + 8 de `ap` + 15 de `treasury` + 13 de
  `bank-rec` + 18 de `fixed-assets` + 11 de `budgets` + 8 de
  `cost-centers` + 8 de `multicurrency` + 13 de `payments` + 11 de
  `employees` + 11 de `payroll` + 12 de `attendance`). La numeración de
  `purchase-orders` y de
  `accounting` se escribió con la guarda de tenant y módulo activo desde
  la primera versión — el agujero que `sales-orders` tuvo que tapar
  despues con la 0031 no llegó a existir en ninguna de las dos.
  `accounting` sí encontró su propia variante al escribir el test de
  aislamiento: colar una línea con el tenant propio pero apuntando a un
  asiento o cuenta ajenos, tapada con una comprobación cruzada en el
  trigger de inmutabilidad. `ap`, `treasury`, `bank-rec`, `fixed-assets`,
  `budgets`, `cost-centers`, `payments`, `employees`, `payroll` y
  `attendance` aprendieron la lección de una vez: sus triggers
  equivalentes (`impedir_pago_a_factura_ajena`,
  `impedir_transaccion_cuenta_ajena`,
  `impedir_transferencia_cuenta_ajena`, `impedir_import_cuenta_ajena`,
  `impedir_linea_ajena`, `impedir_activo_ajeno`,
  `impedir_linea_presupuesto_ajena`, `impedir_asignacion_centro_ajeno`,
  `impedir_cliente_ajeno`, `impedir_referencia_ajena_empleado`,
  `impedir_contrato_ajeno`, `impedir_linea_nomina_ajena`,
  `impedir_geocerca_ajena`, `impedir_marcaje_ajeno`) se escribieron
  desde el primer día, no como corrección posterior. `multicurrency`
  encontró su propio descuido -no un agujero de aislamiento, sino
  `currencies` con RLS activo pero sin `FORCE`- atrapado por la red de
  seguridad `isolation.test.ts` que corre contra todo el esquema
  `public`, no por un test propio del módulo. `payments` destapó otra vez
  el bug de `demo.sql`: nunca creaba `public.customers` para
  `distribuidora-caribe`, solo los seleccionaba río abajo -mismo patrón
  que el bug de `warehouses` encontrado con `ap`. `employees` encontró su
  propio bug de lógica pura escribiendo la prueba, no en producción:
  `buildOrgChart()` dejaba desaparecer del organigrama a cualquier par de
  empleados atrapados en un ciclo de dos jefes, corregido antes de
  publicar. `payroll` encontró un hueco distinto a todos los anteriores:
  su trigger de inmutabilidad original solo bloqueaba `UPDATE`/`DELETE`
  en `payroll_lines`, no `INSERT` -un periodo ya procesado seguia
  aceptando líneas nuevas sin que nada lo impidiera-, atrapado por su
  propio test de inmutabilidad antes de llegar a Supabase real.
  `attendance` no encontró un agujero de seguridad, pero sí dos bugs
  reales de zona horaria en su propia verificación en vivo: la "hora
  esperada" para calcular tardanza se fijaba en la zona del *servidor*,
  no en la de Republica Dominicana (UTC-4 fijo, sin horario de verano) —
  corregido con `horaEsperadaEnRD()`, una función pura con sus propias
  pruebas — y el seed de demo generaba un marcaje "de hoy" fechado un día
  adelante de la hora real de RD porque `current_date` usa la zona de la
  sesión de Postgres, no la de RD. Un tercer bug, de formato: los eventos
  se emitían como `attendance.checked-in/out` (dos segmentos) cuando
  `emit_event()` exige `<modulo>.<entidad>.<accion>` (tres) — como
  corría en la misma transacción que el check-out exitoso, el error de
  formato revertía el check-out entero sin que la pantalla mostrara nada,
  porque el `<form action>` no propaga el error. Los tres solo aparecieron
  usando la pantalla de verdad, no en el review de código.

---

## Lo que encontraron estas pruebas

Escribir los tests de aislamiento **no fue un trámite**: destapó dos fugas
entre clientes en la capa fiscal que ninguna cantidad de uso de la aplicación
habría revelado, porque las dos requieren hablarle a la base directamente.

1. **`assign_ncf` aceptaba el tenant de otro.** La función es
   `security definer` —tiene que serlo— y recibía `p_tenant` sin comprobarlo
   contra `rls.tenant_id()`. Cualquier usuario autenticado podía agotarle los
   NCF a otro cliente y dejarlo sin poder facturar por días.

2. **Las vistas `dgii_607` y `dgii_608` se saltaban la RLS.** Una vista corre
   con los privilegios de su dueño salvo que lleve `security_invoker`. Como se
   crearon sin esa opción, `select * from public.dgii_607` devolvía las ventas
   de **todos** los clientes: RNC, montos y NCF incluidos.

Ambas corregidas en
[`0030_fuga_fiscal_entre_clientes.sql`](../../supabase/migrations/0030_fuga_fiscal_entre_clientes.sql).

La lección operativa: **toda vista nueva sobre una tabla con RLS necesita
`security_invoker = true`**, y toda función `security definer` que reciba un
`tenant_id` por parámetro tiene que validarlo ella misma.


---

## Accesibilidad

Se auditaron las **29 pantallas** de F4 con una sonda propia
([`scripts/sonda-a11y.js`](../../scripts/sonda-a11y.js)) que comprueba las
cinco familias de WCAG 2.1 AA que se pueden decidir con la página pintada:
nombre accesible de cada control, jerarquía de encabezados, landmarks, ids
repetidos y contraste real calculado sobre los colores computados.

No depende de una CDN a propósito: así corre contra el servidor local sin
internet, que es donde de verdad se prueba.

**Primera pasada: 21 de 29 pantallas con fallos.** Tres problemas, y los tres
se arreglaron en el sitio correcto:

| Problema | Dónde estaba | Arreglo |
|---|---|---|
| `h1 → h3` en 18 pantallas | `CardTitle` y `EmptyState` renderizaban `h3` | Pasan a `h2`. Un salto de nivel se anuncia como *"falta una sección"*: quien navega por encabezados se queda buscando algo que no existe |
| 5 controles sin nombre | Filtro de almacén, buscador de la caja, dos campos de alcance en Roles, subida de CSV | `aria-label`. El `<label>` de Roles era hermano y no envolvía, así que no nombraba nada; el placeholder tampoco sirve — desaparece al escribir |
| 2 pantallas sin `main` | Roles y Marketplace tienen chrome propio, fuera del Shell | El panel de contenido pasa a `<main>` |

**Segunda pasada: 4 pantallas.** **Tercera: 0 de 29.**

**Contraste: cero fallos desde la primera pasada.** El design system Aurora
aguanta sin excepciones, que era lo que más riesgo tenía de no cumplir.

Las **3 pantallas de `purchase-orders`** (`/compras`, `/compras/proveedores`,
`/compras/:id`) llegaron limpias desde la primera pasada — se construyeron
copiando los patrones de `sales-orders` ya corregidos, no repitiendo los
errores originales.
