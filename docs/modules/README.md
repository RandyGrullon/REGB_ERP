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
| `time-off` | Vacaciones y permisos con saldo calculado -Codigo de Trabajo Art. 177- (F7) | [time-off.md](time-off.md) |
| `expenses` | Gastos y reembolsos con ITBIS deducible calculado por NCF (F7) | [expenses.md](expenses.md) |
| `hr-portal` | Autoservicio: volantes, vacaciones, datos personales y anuncios (F7) | [hr-portal.md](hr-portal.md) |
| `benefits` | Prestamos internos, adelantos y planes de seguro con aporte patronal (F7) | [benefits.md](benefits.md) |
| `recruiting` | Vacantes, candidatos y pipeline de aplicaciones con maquina de estados (F7) | [recruiting.md](recruiting.md) |
| `performance` | OKR con progreso derivado, evaluacion 360, 1:1 y planes de mejora (F7) | [performance.md](performance.md) |
| `training` | Cursos con aprobacion contra el minimo real, certificados y matriz de competencias (F7) | [training.md](training.md) |
| `suppliers` | Documentos con vigencia calculada, cuentas bancarias y evaluacion de proveedores (F8) | [suppliers.md](suppliers.md) |
| `price-lists` | Precio por cliente, canal o volumen con precedencia real (F8) | [price-lists.md](price-lists.md) |
| `requisitions` | Pedir antes de comprar, con aprobacion por monto real -el limite de cada rol decide- (F8) | [requisitions.md](requisitions.md) |
| `rfq` | Comparar cotizaciones de proveedores con un ganador que elige siempre la misma regla (F8) | [rfq.md](rfq.md) |
| `receipts` | Inspeccion real al recibir -aceptado contra rechazado-, discrepancia y devolucion al proveedor (F8) | [receipts.md](receipts.md) |
| `lots-serials` | Trazabilidad por lote/serie, FEFO como algoritmo, alertas de vencimiento y recall (F8) | [lots-serials.md](lots-serials.md) |
| `transfers` | Traslado entre almacenes con estado de transito real y discrepancia visible (F8) | [transfers.md](transfers.md) |

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
- **RLS: los treinta y dos cubiertos.** 519 pruebas contra Postgres real
  (163 de los cinco de F4 + 23 de `purchase-orders` + 10 del cargo por
  mora en `ar` + 22 de `accounting` + 8 de `ap` + 15 de `treasury` + 13 de
  `bank-rec` + 18 de `fixed-assets` + 11 de `budgets` + 8 de
  `cost-centers` + 8 de `multicurrency` + 13 de `payments` + 11 de
  `employees` + 11 de `payroll` + 12 de `attendance` + 12 de
  `time-off` + 12 de `expenses` + 8 de `hr-portal` + 13 de
  `benefits` + 11 de `recruiting` + 14 de `performance` + 14 de
  `training` + 14 de `suppliers` + 12 de `price-lists` + 11 de
  `requisitions` + 12 de `rfq` + 16 de `receipts` + 13 de
  `lots-serials` + 12 de `transfers`). La numeración
  de `purchase-orders` y de
  `accounting` se escribió con la guarda de tenant y módulo activo desde
  la primera versión — el agujero que `sales-orders` tuvo que tapar
  despues con la 0031 no llegó a existir en ninguna de las dos.
  `accounting` sí encontró su propia variante al escribir el test de
  aislamiento: colar una línea con el tenant propio pero apuntando a un
  asiento o cuenta ajenos, tapada con una comprobación cruzada en el
  trigger de inmutabilidad. `ap`, `treasury`, `bank-rec`, `fixed-assets`,
  `budgets`, `cost-centers`, `payments`, `employees`, `payroll`,
  `attendance`, `time-off` y `expenses` aprendieron la lección de una
  vez: sus triggers equivalentes (`impedir_pago_a_factura_ajena`,
  `impedir_transaccion_cuenta_ajena`,
  `impedir_transferencia_cuenta_ajena`, `impedir_import_cuenta_ajena`,
  `impedir_linea_ajena`, `impedir_activo_ajeno`,
  `impedir_linea_presupuesto_ajena`, `impedir_asignacion_centro_ajeno`,
  `impedir_cliente_ajeno`, `impedir_referencia_ajena_empleado`,
  `impedir_contrato_ajeno`, `impedir_linea_nomina_ajena`,
  `impedir_geocerca_ajena`, `impedir_marcaje_ajeno`,
  `impedir_solicitud_ausencia_ajena`, `impedir_gasto_ajeno`,
  `impedir_prestamo_ajeno`, `impedir_pago_prestamo_ajeno`,
  `impedir_inscripcion_ajena`, `impedir_aplicacion_ajena`,
  `impedir_entrevista_ajena`, `impedir_objetivo_ajeno`,
  `impedir_resultado_clave_ajeno`,
  `impedir_referencia_ajena_empleado_desempeno`,
  `impedir_inscripcion_curso_ajena`, `impedir_certificado_ajeno`,
  `impedir_competencia_ajena`, `impedir_referencia_ajena_proveedor`,
  `impedir_lista_precio_ajena`, `impedir_entrada_lista_precio_ajena`,
  `impedir_lista_precio_ajena_en_cliente`, `impedir_requisicion_ajena`,
  `impedir_editar_requisicion_resuelta`, `impedir_rfq_ajeno`,
  `impedir_referencia_ajena_rfq`, `impedir_editar_cotizacion`,
  `impedir_editar_rfq_resuelto`, `impedir_recepcion_ajena`,
  `impedir_referencia_ajena_linea_recepcion`, `impedir_devolucion_ajena`,
  `impedir_editar_recepcion`, `impedir_editar_devolucion_resuelta`,
  `impedir_lote_ajeno`, `impedir_referencia_ajena_lot_stock`,
  `impedir_recall_ajeno`, `impedir_editar_recall_cerrado`,
  `impedir_transferencia_ajena`, `impedir_referencia_ajena_linea_transferencia`,
  `impedir_editar_linea_transferencia_resuelta`,
  `impedir_borrar_linea_transferencia_despachada`) se
  escribieron desde el
  primer día, no
  como corrección posterior. `expenses` tiene una variante nueva en el
  patron: valida la referencia cruzada tambien en `update`, no solo
  `insert`, porque `payroll_period_id` se rellena despues de crear la
  fila, al momento de reembolsar. `benefits` tiene la misma referencia
  cruzada hacia `payroll_period_id` -en `benefit_loan_payments`- pero
  SIN necesitar esa variante de `update`: ahi el periodo se rellena en
  el mismo `insert` del pago, no despues. `multicurrency`
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
  usando la pantalla de verdad, no en el review de código. `time-off` no
  encontró un bug de aplicación, sino uno de higiene de pruebas: la
  primera versión de `afterAll()` en su test de aislamiento intentaba
  borrar una fila ya resuelta sin desactivar antes el trigger de
  inmutabilidad -exactamente lo que el trigger debía impedir, pero
  rompiendo la limpieza del propio test-, y una corrida manual
  intermedia de ese mismo arreglo dejó el trigger deshabilitado en la
  base compartida de Docker local sin el `enable` de vuelta, haciendo
  que la siguiente corrida de `gate:f0` pasara de largo sus dos pruebas
  de inmutabilidad sin lanzar ningún error. Corregido copiando el patrón
  ya usado en `payroll.test.ts` (`disable trigger` antes de borrar,
  `enable trigger` después) y reactivando el trigger a mano en la base
  que había quedado así. `expenses` no encontró ni un bug de aplicación
  ni uno de pruebas -el patrón de disable/enable trigger alrededor del
  delete de limpieza se copió directo del arreglo de `time-off`, y el
  módulo pasó limpio en su primera corrida completa de `gate:f0`-.
  `hr-portal` es el primer módulo de la serie 0031-0057 sin un trigger
  de referencia cruzada: su única tabla nueva, `hr_announcements`, no
  tiene `employee_id` ni `branch_id` -nada que pueda apuntar a un
  registro de otro tenant-, así que la RLS de `tenant_id` sola basta.
  `benefits` no encontró bugs nuevos, pero sí introdujo un matiz de
  inmutabilidad que ningún módulo anterior necesitó: `benefit_loans`
  (el préstamo) es editable mientras está `active` -mismo patrón que
  `approved` en `expenses`-, pero `benefit_loan_payments` (cada pago)
  es inmutable **desde el primer momento**, sin condición de estado
  -ni siquiera con el préstamo todavía activo se puede editar un pago
  ya registrado-, la única tabla de la serie con un trigger de
  inmutabilidad incondicional. `recruiting` es el primer módulo cuya
  tabla puente referencia **dos** tablas de tenant a la vez
  (`position_id` y `candidate_id` en `recruiting_applications`), así
  que su trigger de referencia cruzada valida ambas, no solo una -y,
  deliberadamente, no construye el "portal de empleo" público del
  catálogo: este esquema nunca otorga acceso a datos de negocio al rol
  `anon` (regla establecida desde `0005_rls_policies.sql`), y una
  página de vacantes sin sesión rompería esa regla directamente-.
  `performance` es el primer módulo de la serie donde la mayoría de las
  tablas **no llevan** trigger de inmutabilidad, a propósito: un
  objetivo se actualiza seguido, una nota de 1:1 se corrige después de
  la reunión, y forzarlos a comportarse como un asiento contabilizado
  no reflejaría cómo se usan de verdad. Solo `performance_reviews`
  (inmutable desde el primer momento, sin condición de estado) y
  `performance_improvement_plans` (editable mientras está `active`,
  fijo una vez resuelto) lo necesitan, cada una con su propia razón. Su
  única sonda de accesibilidad SÍ encontró un fallo real -un input y un
  botón de guardar sin nombre accesible en la fila de progreso de un
  resultado clave, el `<Icon>` bastaba visualmente pero no aportaba
  nombre accesible por ir con `aria-hidden`-, corregido con `aria-label`
  antes de dar el módulo por terminado. `training` encontró un choque de
  nombres, no un agujero de seguridad: su primer intento de migración
  reutilizó `impedir_inscripcion_ajena`, ya tomado por `benefits` para
  `benefit_enrollments` -Postgres rechazó la migración completa
  (`function "impedir_inscripcion_ajena" already exists`), sin dejar
  nada a medio aplicar porque el archivo corre como una sola transacción
  implícita-. Renombrada a `impedir_inscripcion_curso_ajena` antes de
  reintentar, aplicando desde entonces la lección de la propia sonda de
  accesibilidad de `performance`. `suppliers` encontró el hallazgo más
  serio de esta serie: no un bug de su propio código nuevo, sino uno ya
  **en producción** desde que `ap` se publicó. `public.suppliers`
  (0038, dueño original `purchase-orders`) traía un comentario que
  anticipaba este momento -"vive aquí... hasta que exista `ap` o
  `suppliers`"-, pero cuando `ap` (0042) se construyó y referenció
  `suppliers` desde `supplier_invoices`, nadie volvió a tocar su RLS:
  seguía exigiendo solo `purchase-orders` activo, aunque el catálogo de
  `ap` no lo requiere (`requires: {}`). Un tenant con SOLO `ap` activo
  -un caso perfectamente válido- veía su factura de proveedor con el
  nombre en `null`: la fila de `suppliers` quedaba invisible bajo RLS.
  No es un agujero de seguridad -nadie veía datos de otro tenant-, pero
  sí un bug de correctitud real. Reproducido contra Docker local antes
  de tocar nada, y corregido ampliando la política -nunca reduciendo el
  acceso ya existente- para que `purchase-orders`, `ap` o `suppliers`
  desbloqueen la ficha básica. `price-lists` encontró su propio
  scaffold muerto: `customers.price_list` (0020) era una columna de
  texto libre que nunca se leyó ni se escribió desde ningún código de
  la app -mismo hallazgo que `payroll`/`attendance` antes de que esta
  fase les diera contenido real-. Eliminada y reemplazada por
  `customers.price_list_id`, la primera vez en la serie 0031-0062 que
  el agujero de referencia cruzada aparece en una columna agregada
  *después* a una tabla que ya existía, no en la tabla original.
  `requisitions` reutiliza infraestructura en vez de inventar una
  nueva: aprobar una requisicion llama al mismo mecanismo `max_amount`
  que ya vive en `@regb/permissions` desde antes de esta fase -si el
  límite del rol no alcanza, `can()` lo rechaza con
  `amount-exceeded`; un rol sin ese límite aprueba en su lugar-, así
  que la "jerarquía de aprobación" del catálogo es el sistema de
  roles mismo, no una tabla de cadena de aprobación aparte. Pero
  también encontró un bug real de aplicación, no de seguridad:
  `approved_by` se definió copiando sin pensar el patrón de
  `employee_id` -una FK a `public.employees(id)`-, cuando quien
  aprueba en realidad es el usuario autenticado
  (`ctx.userId`, de `user_profiles`), casi nunca una fila de
  `employees`. El resultado: **ningún rol podía aprobar ninguna
  requisición**, porque el `UPDATE` violaba la FK casi siempre. Se
  encontró probando el flujo completo en el navegador -Owner
  intentando aprobar y la fila quedándose en `pending` sin ningún
  error visible, porque el `<form action>` que envuelve la acción
  descarta el `ActionResult`-, y se corrigió quitando la FK y la
  validación cruzada de `approved_by`, adoptando el mismo criterio ya
  usado en `decided_by` de `time-off` (0054) y `expenses` (0055): un
  uuid sin FK, porque su tenant ya lo garantiza la sesión bajo la que
  corre `asUser()`. `rfq` no encontró bugs nuevos, pero sí reafirma
  dos patrones: `rfq_quotes` es inmutable desde el primer insert, sin
  condición -una cotización registrada es un hecho histórico de lo
  que un proveedor ofreció, no un borrador-, y el "portal de
  proveedor" del catálogo deliberadamente no se construye, por la
  misma regla de `recruiting`: nunca se otorga acceso a datos de
  negocio al rol `anon`. Verificado en vivo que el comparativo
  `mejorCotizacion()` elige siempre el monto más bajo -con dos
  cotizaciones sembradas a propósito donde la más barata entrega más
  lento, confirmando que el precio manda sobre el plazo de entrega- y
  que adjudicar deja el RFQ inmutable. `receipts` no reinventa lo que
  `purchase-orders` ya hace -reutiliza `pendingReceipt()`,
  `validateReceipt()` y `costVariance()` de `procurement.ts` tal
  cual-, y agrega lo que a la orden de compra le faltaba: un documento
  de recepción que agrupa varias líneas de un mismo camión, inspección
  real (aceptado contra rechazado, no solo "cuánto llegó"),
  discrepancia detectada sola contra lo esperado, y devolución al
  proveedor con su propio movimiento de inventario en sentido
  contrario (`return_to_supplier`, un tipo nuevo agregado al check
  constraint existente de `inventory_movements` sin tocar el trigger
  que ya proyecta el kardex). Encontró un bug real de aplicación
  probando el flujo completo en el navegador, no en el review de
  código: `goods_receipts` se diseñó inmutable desde el primer insert
  -mismo criterio que `rfq_quotes`-, pero la primera versión de la
  acción insertaba el encabezado SIN el estado derivado y luego
  intentaba un `UPDATE` separado para fijarlo, exactamente lo que el
  propio trigger de inmutabilidad bloquea incluso dentro de la misma
  transacción del insert. El resultado: **ninguna recepción se podía
  registrar nunca**, revirtiendo la transacción entera con un error de
  servidor. Corregido restructurando la acción para calcular el estado
  final de todas las líneas ANTES de insertar el encabezado, para que
  nunca exista un update posterior al insert. `lots-serials` no
  reinventa "esto ya venció?" -`loteVigente()` es literalmente
  `certificadoVigente()` de `training.ts` reexportada con otro
  nombre-, y agrega FEFO como un algoritmo real
  (`seleccionFefo()`/`consumirFefo()`) en vez de una tabla que alguien
  revisa a mano: verificado en vivo consumiendo 10 unidades con tres
  lotes disponibles (3 ya vencidas, 8 por vencer, 20 lejanas), y el
  sistema tomó las 3 vencidas y 7 de las por vencer sin tocar la lejana
  -confirmado en `inventory_movements` y en la tabla nueva `lot_stock`-.
  Es el primer módulo de la serie 0031-0066 donde la tabla principal
  (`product_lots`) NO lleva trigger de inmutabilidad a propósito -un
  lote es un registro vivo, corregir una fecha de vencimiento mal
  capturada es una corrección de datos legítima, mismo criterio que los
  objetivos de OKR en `performance`-, mientras que `product_recalls` sí
  es un flujo con estados (`open` editable, `closed` terminal),
  verificado abriendo y cerrando un recall real sobre el lote vencido
  sembrado. Un item serializado deliberadamente no es un concepto
  aparte: es un lote de cantidad 1 cuyo número de lote ES el número de
  serie, para no duplicar la idea en dos columnas. `transfers` no
  reemplaza ni toca la transferencia simple de un paso que ya trae
  `inventory` (`stock_transfers`, 0019) -sigue funcionando igual para
  quien no necesita más-, y agrega el flujo completo con estado de
  tránsito: despachado postea `transfer_out` en el origen, recibido
  postea `transfer_in` en el destino, y la discrepancia entre ambos se
  calcula con `detectarDiscrepancia()` -la misma función de
  `receipts.ts`, reutilizada tal cual-. Es el primer módulo de la serie
  donde la inmutabilidad se aplica **por campo, no por fila entera**:
  `qty_requested` se congela al despachar (fijar `qty_sent`), y la
  línea completa se congela al recibir (fijar `qty_received`) -dos
  transiciones de un solo uso sobre la misma fila, en vez de mover el
  registro completo a una tabla histórica aparte-. Verificado en vivo
  recibiendo una transferencia real de 15 sacos con solo 14 llegando:
  el badge "Faltó 1" apareció automáticamente, los movimientos
  `transfer_out`/`transfer_in` quedaron confirmados en
  `inventory_movements`, y un intento posterior de editar
  `qty_received` por SQL directo fue rechazado por el trigger de
  inmutabilidad.

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
