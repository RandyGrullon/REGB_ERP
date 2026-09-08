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
| `stock-counts` | Clasificacion ABC real, conteo ciego y ajuste con aprobacion (F8) | [stock-counts.md](stock-counts.md) |
| `barcode` | EAN-13 real, etiquetas con el codigo dibujado y escaneo con la camara (F8) | [barcode.md](barcode.md) |
| `fleet` | Vehiculos, combustible, mantenimiento vencido, documentos y multas (F8) | [fleet.md](fleet.md) |
| `logistics` | Planificacion de rutas y prueba de entrega real -sin GPS ni optimizacion falsos- (F8) | [logistics.md](logistics.md) |
| `bom` | Costeo multinivel real, versiones y sustitutos de lista de materiales (F8.5) | [bom.md](bom.md) |
| `manufacturing` | Lanzamiento, consumo real, avance y mermas de ordenes de produccion (F8.5) | [manufacturing.md](manufacturing.md) |
| `mrp` | Explosion de necesidades multinivel real y sugerencias de comprar o producir, nunca automaticas (F8.5) | [mrp.md](mrp.md) |
| `quality` | Planes de inspeccion, resultado no binario, no conformidad y CAPA con maquina de estados (F8.5) | [quality.md](quality.md) |
| `maintenance` | Ordenes de trabajo, vencimiento por uso o fecha y MTBF real entre fallas (F8.5) | [maintenance.md](maintenance.md) |
| `shopfloor` | Terminal tactil, marcaje de tiempos y OEE calculado -no estimado- (F8.5) | [shopfloor.md](shopfloor.md) |
| `crm` | Puntaje explicable de leads y asignacion automatica en round-robin (F9) | [crm.md](crm.md) |
| `pipeline` | Kanban de etapas, forecast ponderado y motivo de perdida obligatorio (F9) | [pipeline.md](pipeline.md) |
| `quotes` | Versiones reales, contenido congelado al enviar, mismos totales que pedidos/POS/facturas (F9) | [quotes.md](quotes.md) |
| `e-sign` | Firma con rastro de auditoria real -hash e IP-, honesto sobre no ser PKI certificado (F9) | [e-sign.md](e-sign.md) |
| `contracts` | Renovacion que crea un contrato nuevo con escalamiento de precio, nunca sobrescribe (F9) | [contracts.md](contracts.md) |
| `commissions` | Una formula por plan, liquidacion con aprobacion real -el bug que su propia prueba encontro- (F9) | [commissions.md](commissions.md) |
| `customer-portal` | Acceso por token sin contraseña -la primera ruta publica del proyecto, sin sesion de empleado- (F9) | [customer-portal.md](customer-portal.md) |
| `helpdesk` | Un ticket resuelto se puede reabrir; uno cerrado es terminal de verdad (F9) | [helpdesk.md](helpdesk.md) |
| `loyalty` | El nivel se gana con puntos de por vida -redimir un premio nunca baja de nivel- (F9) | [loyalty.md](loyalty.md) |
| `marketing` | Honesto sobre lo que es: toma la foto de a quien se le envio, no manda el correo (F9) | [marketing.md](marketing.md) |
| `ecommerce` | Honesto sobre lo que es: registra el pedido tal cual llego, no inventa su propio total (F9) | [ecommerce.md](ecommerce.md) |
| `bi` | Un catalogo fijo de reportes ya vetados, no una consola SQL abierta (F9) | [bi.md](bi.md) |

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
- **RLS: los cincuenta y cuatro cubiertos.** 757 pruebas contra Postgres real
  (163 de los cinco de F4 + 23 de `purchase-orders` + 10 del cargo por
  mora en `ar` + 22 de `accounting` + 8 de `ap` + 15 de `treasury` + 13 de
  `bank-rec` + 18 de `fixed-assets` + 11 de `budgets` + 8 de
  `cost-centers` + 8 de `multicurrency` + 13 de `payments` + 11 de
  `employees` + 11 de `payroll` + 12 de `attendance` + 12 de
  `time-off` + 12 de `expenses` + 8 de `hr-portal` + 13 de
  `benefits` + 11 de `recruiting` + 14 de `performance` + 14 de
  `training` + 14 de `suppliers` + 12 de `price-lists` + 11 de
  `requisitions` + 12 de `rfq` + 16 de `receipts` + 13 de
  `lots-serials` + 12 de `transfers` + 12 de `stock-counts` + 7 de
  `barcode` + 16 de `fleet` + 10 de `logistics` + 11 de `bom` + 14 de
  `manufacturing` + 10 de `mrp` + 16 de `quality` + 11 de
  `maintenance` + 8 de `shopfloor` + 7 de `crm` + 8 de
  `pipeline` + 12 de `quotes` + 9 de `e-sign` + 9 de `contracts` + 11
  de `commissions` + 10 de `customer-portal` + 10 de `helpdesk` + 15
  de `loyalty` + 11 de `marketing` + 12 de `ecommerce` + 10 de `bi`).
  La numeración
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
  `impedir_borrar_linea_transferencia_despachada`,
  `impedir_programacion_conteo_ajena`, `impedir_conteo_ajeno`,
  `impedir_referencia_ajena_linea_conteo`, `impedir_editar_conteo_resuelto`,
  `impedir_editar_linea_conteo_no_editable`, `impedir_escaneo_ajeno`,
  `impedir_editar_escaneo`, `impedir_vehiculo_ajeno`,
  `impedir_referencia_ajena_vehiculo`, `impedir_referencia_ajena_combustible`,
  `impedir_editar_combustible`, `impedir_editar_mantenimiento`,
  `impedir_editar_multa_resuelta`, `impedir_ruta_ajena`,
  `impedir_referencia_ajena_parada`, `impedir_editar_ruta_resuelta`,
  `impedir_editar_parada_resuelta`, `impedir_bom_ajeno`,
  `impedir_referencia_ajena_linea_bom`, `impedir_editar_bom_no_borrador`,
  `impedir_editar_linea_bom_no_borrador`,
  `impedir_orden_produccion_ajena`, `impedir_referencia_ajena_linea_produccion`,
  `impedir_reporte_ajeno`, `impedir_editar_orden_produccion_resuelta`,
  `impedir_editar_linea_produccion`, `impedir_editar_reporte`,
  `impedir_producto_ajeno_corrida_mrp`, `impedir_referencia_ajena_sugerencia_mrp`,
  `impedir_editar_corrida_mrp`, `impedir_editar_sugerencia_resuelta`,
  `impedir_referencia_ajena_criterio`, `impedir_referencia_ajena_inspeccion`,
  `impedir_referencia_ajena_resultado`, `impedir_referencia_ajena_no_conformidad`,
  `impedir_no_conformidad_ajena_capa`, `impedir_producto_ajeno_certificado`,
  `impedir_editar_inspeccion`, `impedir_editar_no_conformidad_resuelta`,
  `impedir_editar_capa_cerrado`, `impedir_equipo_ajeno_orden`,
  `impedir_referencia_ajena_parte`, `impedir_editar_orden_resuelta`,
  `impedir_editar_parte`, `impedir_orden_ajena_sesion`,
  `impedir_editar_sesion_cerrada`, `impedir_editar_paro_cerrado`,
  `impedir_lead_ajeno_actividad`, `impedir_editar_actividad`,
  `impedir_lead_ajeno_oportunidad`,
  `impedir_editar_oportunidad_resuelta`,
  `impedir_referencia_ajena_cotizacion`,
  `impedir_referencia_ajena_linea_cotizacion`,
  `impedir_editar_cotizacion_no_borrador`,
  `impedir_editar_linea_cotizacion`, `impedir_solicitud_ajena_evento`,
  `impedir_editar_solicitud_firma_resuelta`, `impedir_editar_evento`,
  `impedir_referencia_ajena_contrato`, `impedir_editar_contrato_activo`,
  `impedir_referencia_ajena_comision`,
  `impedir_editar_comision_resuelta`, `impedir_cliente_ajeno_invitacion`,
  `impedir_invitacion_ajena_acceso`, `impedir_editar_invitacion_revocada`,
  `impedir_editar_acceso`, `impedir_cliente_ajeno_ticket`,
  `impedir_ticket_ajeno_mensaje`, `impedir_editar_ticket_cerrado`,
  `impedir_editar_mensaje`, `impedir_cliente_ajeno_transaccion_puntos`,
  `impedir_cliente_ajeno_cupon`, `impedir_cliente_ajeno_referido`,
  `impedir_editar_transaccion_puntos`, `impedir_editar_cupon_resuelto`,
  `impedir_editar_referido_resuelto`, `impedir_lead_ajeno_destinatario`,
  `impedir_editar_campana_resuelta`, `impedir_editar_destinatario`,
  `impedir_borrar_destinatario`, `impedir_producto_ajeno_vinculo`,
  `impedir_canal_ajeno_pedido`, `impedir_pedido_ajeno_linea`,
  `impedir_editar_pedido_canal_resuelto`,
  `impedir_editar_linea_pedido_canal`, `impedir_reporte_ajeno_item`,
  `impedir_reporte_ajeno_export`) se
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
  inmutabilidad. `stock-counts` agrega las tres cosas que
  `stock_counts` de `inventory` (0019) no tiene, sin tocarla:
  clasificación ABC real (`clasificarAbc()`, un Pareto 80/15/5 sobre el
  valor acumulado ANTES de cada producto, no después -así el producto
  que por sí solo empuja el acumulado más allá del 80% sigue siendo
  A-), conteo CIEGO de verdad (la pantalla mientras se cuenta ni
  siquiera trae `system_qty` en la consulta, no es una columna oculta
  con CSS), y un ajuste que espera aprobación
  (`transicionValidaConteo()`: `counting → pending_approval →
  approved | rejected`, nunca salta directo). Encontró un bug real en
  su propia prueba unitaria, antes de tocar la base: la primera versión
  de `clasificarAbc()` acumulaba el valor DESPUÉS de cada producto, así
  que un producto que por sí solo es el 90% del valor total quedaba
  clasificado como B -su propio acumulado ya superaba el corte de 80%
  para A-, contradiciendo el propósito mismo de un análisis ABC (el
  producto de mayor valor siempre debería ser A). El test "un solo
  producto domina" lo encontró antes de escribir una sola línea de SQL.
  Verificado en vivo: un conteo real aprobado con su ajuste confirmado
  en `inventory_movements`/`stock_levels`, y un conteo nuevo contado a
  ciegas -confirmado que `system_qty` nunca aparece en esa pantalla-,
  enviado a aprobación y rechazado sin tocar el inventario. `barcode`
  no agrega una columna nueva -`products.barcode` y su índice único
  parcial ya existían desde 0016-: escribe ahí directamente.
  `digitoVerificadorEan13()` implementa el algoritmo oficial de GS1
  -probado contra un EAN-13 real conocido
  (`4006381333931`) antes de generar el primero propio-, y
  `patronBarrasEan13()` codifica el patrón completo de 95 módulos con
  las tablas L/G/R del estándar para dibujar el código de barras real
  en SVG, sin ninguna librería externa. La única tabla nueva,
  `barcode_scans`, es una bitácora inmutable de cada escaneo, igual que
  `audit.log`. El escaneo con cámara usa `BarcodeDetector` -la API
  nativa del navegador-, con entrada manual como respaldo real (no
  decorativo) donde no está soportada; verificado en el navegador de
  este entorno, sin `BarcodeDetector`, confirmando que el mensaje de
  respaldo aparece y la búsqueda manual funciona igual. Verificado en
  vivo: generados dos EAN-13 reales (validados de nuevo con
  `codigoEan13Valido()`), etiquetas con las barras dibujadas
  correctamente, y un escaneo manual encontrando el producto correcto
  con su existencia por almacén. `fleet` reutiliza infraestructura en
  vez de reinventarla dos veces más: `documentoVehiculoVigente()` es
  literalmente `certificadoVigente()` de `training.ts` reexportada con
  otro nombre, y la pantalla de detalle reutiliza `loteProximoAVencer()`
  de `lots-serials.ts` -una función genérica de umbral de días- para la
  alerta "por vencer", aunque el nombre mencione lotes. El mantenimiento
  vencido se detecta por kilometraje o por fecha, cada uno con su propia
  función pura, y el rendimiento de combustible se calcula entre cada
  carga y la anterior, no se declara a mano. Las multas tienen un flujo
  real (`pending → paid | disputed`, `disputed → paid | dismissed`),
  verificado en vivo pagando una multa real, confirmando que queda
  inmutable, y restaurándola a `pending` para no romper el escenario de
  demo. Es el primer módulo con documentación de vehículo (`vehicles`,
  `vehicle_documents`) sin trigger de inmutabilidad -mismo criterio que
  `product_lots`- mientras que `fuel_logs`/`maintenance_records` sí son
  hechos históricos inmutables desde el insert, mismo criterio que
  `benefit_loan_payments`. `logistics` completa el sprint declarando
  honestamente lo que el catálogo promete y no construye: "seguimiento
  GPS" y "optimización de rutas" no existen -ningún dispositivo está
  conectado, y el orden de las paradas lo decide quien planifica, no un
  motor de rutas-. Lo real es la máquina de estados
  (`transicionValidaRuta()`) y la prueba de entrega -el nombre de quien
  recibió, no una firma digital-. Deliberadamente NO tiene acoplamiento
  duro con `fleet`: el vehículo de una ruta es texto libre (la placa),
  porque `logistics` solo RECOMIENDA `sales-orders`, y una referencia
  silenciosa a una tabla de otro módulo violaría la regla del registry
  de que el core no conoce los módulos. `rutaCompleta()` exige que
  ninguna parada siga `pending` antes de cerrar la ruta, y
  `tasaEntregaExitosa()` se calcula solo sobre las paradas ya resueltas
  -las pendientes no cuentan ni para arriba ni para abajo-. Verificado
  en vivo: una parada pendiente resuelta con su prueba de entrega, la
  ruta completada, y una ruta en planificación despachada -todo
  confirmado inmutable después y restaurado al canónico de la siembra-.
  `bom` cierra el bloque de manufactura declarando costeo MULTINIVEL de
  verdad: `costoUnitarioMultinivel()` es una función recursiva pura que
  expande un componente con su propia receta en vez de asumir que todo
  se compra ya terminado. Verificado en vivo con un caso real de dos
  niveles (un "kit básico de reparación" que usa una "varilla
  reforzada" con su propia receta): el costo se calculó en
  RD$1,081.00, y para confirmar que la recursión era genuina -no una
  coincidencia entre el costo directo declarado del sub-ensamble y su
  costo calculado, que se hicieron coincidir a propósito en la
  siembra- se alteró temporalmente una cantidad dentro de la receta
  del sub-ensamble: el costo del padre cambió de inmediato a
  RD$1,793.00, confirmando que de verdad recorre el árbol. Solo una
  versión por producto puede estar `active` a la vez (índice único
  parcial), y un BOM deja de ser editable en cuanto sale de `draft`
  -con una excepción deliberada: la transición `active → obsolete` al
  activar una versión nueva del mismo producto SÍ se permite, porque
  es el ciclo de vida esperado, no una corrección-. Un trigger bloquea
  el caso directo de un producto como componente de sí mismo; ciclos
  más profundos entre varios productos no se detectan, declarado
  explícitamente, con un tope de profundidad como red de seguridad en
  el resolvedor de costo. `manufacturing` cierra el bloque de
  manufactura reutilizando infraestructura dos veces más:
  `explotarCantidad()` -la misma función de `bom.ts`- calcula el
  consumo real al liberar una orden, y `progresoResultadoClave()` -la
  misma función de `performance.ts` que ya mide el avance de un
  resultado clave de OKR- mide el avance de la orden, la misma
  pregunta sin importar la meta. El consumo es "backflush al liberar"
  -todo de una vez, no proporcional al avance-, una simplificación
  deliberada que trae una consecuencia honesta: una orden liberada ya
  no se cancela, porque el inventario ya salió. `ordenCompleta()`
  cierra la orden sola cuando lo completado más lo mermado ya cubre lo
  planificado, y cada reporte de avance es un hecho histórico
  inmutable, igual que una carga de combustible de `fleet`. Verificado
  en vivo liberando una orden real de dos niveles -los tres consumos
  coincidieron exactamente con la explosión multinivel de `bom`-, y
  completándola con dos reportes reales (uno con merma genuina), con
  las entradas de producto terminado confirmadas en
  `inventory_movements` y la inmutabilidad de la receta verificada
  incluso ya completada. `mrp` cierra el bloque de manufactura de F8.5
  reutilizando el mismo tipo de recorrido recursivo que `bom` una
  tercera vez: `explotarNecesidadesMrp()` recorre el árbol exactamente
  como `costoUnitarioMultinivel()`, pero acumula CANTIDAD por producto
  en vez de costo, sumando entre ramas que repiten la misma materia
  prima -verificado con el mismo par KIT-100/VAR-REF que `bom` usó
  para probar su propia recursión: la pintura aparece tanto dentro de
  la receta de VAR-REF como directamente en la del kit, y las dos
  ramas se sumaron en una sola sugerencia de 4.5, no en dos filas
  separadas-. La honestidad del módulo está en lo que NO hace al
  aceptar una sugerencia: aceptar una de producir crea una orden real
  en borrador -`manufacturing` es un `requires` declarado, ese
  acoplamiento es legítimo-, pero aceptar una de comprar solo cambia
  su propio estado, sin crear una requisición ni una orden de compra
  por su cuenta, porque ese acoplamiento no está declarado
  (`recommends`, no `requires`). Verificado en vivo los tres caminos
  sobre una corrida real de 10 kits: aceptar la sugerencia de comprar
  cemento no tocó `production_orders`; aceptar la de producir VAR-REF
  creó una orden real de 20 unidades en el almacén elegido,
  confirmada abriendo su propio detalle; descartar la de pintura la
  dejó sin ningún efecto -las tres revertidas después, para que la
  corrida sembrada siga siendo el punto de partida de una demostración
  desde cero-. `quality` cierra F8.5 con un resultado de inspección
  que deliberadamente NO es binario: `resultadoInspeccion()` reprueba
  la inspección ENTERA si un criterio marcado como crítico reprueba,
  pero deja un criterio menor reprobado como "condicional" -aprobada
  con salvedad, no reprobada de plano-. A diferencia de `mrp`, este
  módulo NO exige `manufacturing` -una inspección de recepción sirve
  para cualquier distribuidor, fabrique o no-, solo lo recomienda. Sus
  dos máquinas de estados se refuerzan entre sí: una no conformidad no
  se cierra directo -tiene que pasar por un CAPA con causa raíz y
  acción correctiva-, y un CAPA no se cierra sin verificar primero que
  la corrección funcionó; cerrar el CAPA cierra su no conformidad en
  la MISMA transacción, no en dos pasos que alguien podría dejar
  desincronizados. Verificado en vivo sobre el plan y la no
  conformidad sembrados (cemento recibido con el empaque mojado,
  reprobado por el criterio crítico): creado el CAPA -la no
  conformidad pasó a `capa_created` en el mismo paso-, avanzado
  `open → in_progress → verified → closed`, con la no conformidad
  cerrándose sola junto con el CAPA; y una segunda inspección de
  prueba con ambos criterios aprobados confirmó el otro lado de
  `resultadoInspeccion()` (`passed`, tasa de aprobación de 0% a 50%).
  Ambas pruebas revertidas después -el CAPA borrado, la no conformidad
  devuelta a `investigating`, la inspección de prueba borrada- para
  que la no conformidad sembrada siga siendo un problema real por
  resolver, no uno ya resuelto de antemano. `maintenance` cierra S53
  reutilizando el vencimiento de `fleet` una CUARTA vez -después de
  `lots-serials`, `quality` y el propio `fleet`-:
  `mantenimientoEquipoVencidoPorFecha`/`PorUso` son alias directos de
  `mantenimientoVencidoPorFecha()`/`PorKm()`, la misma pregunta ("ya
  toca?") sea un vehículo con kilometraje o una máquina con horas de
  uso. Su aporte propio es `calcularMtbfDias()`: promedia los
  intervalos ENTRE fallas correctivas consecutivas, nunca desde la
  primera falla hasta hoy -eso mediría antigüedad del equipo, no
  frecuencia de fallas-. Deliberadamente sin ningún `requires`: el
  equipo a mantener es propio del módulo, no depende de
  `fixed-assets` (financiero) ni de `fleet` (vehículos); solo
  recomienda `inventory`, y ni siquiera ahí descuenta stock
  automáticamente -`inventory_movements` exige el módulo `inventory`
  activo en su propia RLS, y escribir ahí en silencio para un tenant
  sin `inventory` violaría la regla del registry-. Verificado en vivo
  con un compresor sembrado con 1,200 horas acumuladas contra un
  intervalo de 1,000: marcado "Vencido" automáticamente, con MTBF de
  37.5 días calculado sobre sus tres fallas correctivas (45 y 30 días
  de intervalo). El ciclo completo de una orden -repuesto registrado,
  `open → in_progress → completed`, confirmando que completada ya no
  admite cambios- se probó en vivo y se revirtió después, para que la
  orden sembrada siga siendo un problema real por resolver.
  `shopfloor` cierra F8 -18/18- con OEE calculado, no estimado:
  `calcularOee()` multiplica disponibilidad x rendimiento x calidad,
  cada factor recortado a `[0,1]` ANTES de multiplicar, para que un
  ciclo ideal mal estimado no pueda inflar el número final por encima
  de 100%. El tiempo trabajado reutiliza `workedHours()` de
  `attendance.ts` -la misma resta entre entrada y salida que ya usa el
  marcaje de asistencia de empleados-; la calidad reutiliza
  `tasaMerma()` de `manufacturing.ts` con el signo invertido, la misma
  pregunta resuelta dos veces. Es el único módulo de F8.5 que SÍ
  declara `requires: manufacturing` -el terminal marca tiempos sobre
  una orden de producción real, no existe sin ella-, y por eso su
  migración altera directamente `production_orders` para agregarle
  `ideal_cycle_hours`, el mismo criterio que `lots-serials` usó para
  alterar `inventory_movements`/`products`. Verificado en vivo con una
  orden sembrada (VAR-REF, liberada hace 6 horas, con un paro de 45
  minutos ya cerrado): disponibilidad 88%, rendimiento 49%, calidad
  94%, OEE 40% -confirmado como el producto exacto de los tres-. El
  ciclo completo del terminal -marcar entrada, iniciar un paro,
  terminarlo, marcar salida- se probó en vivo sobre esa misma orden y
  se revirtió después, para que quede exactamente como la sembró la
  demo. `crm` abre F9 (Ventas avanzado, BI e inteligencia) con un
  puntaje de lead que es una regla fija -40 puntos por email, 20 por
  teléfono, el resto según la calidad de la fuente-, nunca un modelo
  de IA opaco, y una asignación round-robin que retoma la vuelta
  desde el último vendedor que recibió un lead en vez de reiniciar
  siempre desde el primero. `pipeline` -que sí declara `requires: crm`,
  a diferencia de `crm` mismo, que no exige nada- sigue el mismo
  patrón de máquina de estados que `recruiting.ts` ya usó para su
  propio pipeline de contratación (secuencial hacia adelante, con una
  salida terminal alcanzable desde cualquier etapa no terminal) pero
  con su propio tipo -no se puede reutilizar la función, solo el
  criterio-, y reutiliza `diasEnPipeline()` de `recruiting.ts` tal
  cual bajo el alias `diasEnEtapa`. Su forecast pondera cada monto por
  SU propia probabilidad -nunca el monto crudo-, y la probabilidad se
  actualiza sola al avanzar de etapa para que ningún número viejo
  quede olvidado en el cálculo; un `check` en la base (no solo en la
  UI) impide marcar una oportunidad perdida sin explicar el motivo.
  Verificado en vivo con los leads y la oportunidad sembrados: el
  puntaje de dos leads reales (100 y 90) calzó exacto con la fórmula;
  la asignación round-robin repartió el lead pendiente al único
  vendedor activo del tenant demo; el lead avanzó de `new` a
  `contacted` con una actividad real registrada; la oportunidad
  sembrada (RD$850,000 en `negotiation`, 75%) confirmó un forecast
  ponderado de RD$637,500 exacto, y marcarla ganada la congeló de
  inmediato. Todo revertido después -lead devuelto a `new` sin
  asignar, actividad borrada, oportunidad devuelta a `negotiation`-
  para que la demo siga teniendo un pendiente real que resolver.
  `quotes` cierra S56 sin escribir una sola formula de dinero nueva:
  `documentTotals()`/`lineTotals()` de `documents.ts` -las MISMAS
  funciones que ya usan pedidos, POS y facturas- calculan cada total
  aqui tambien, respetando la puerta F5 (`grep` de una formula de
  dinero, una sola ocurrencia en `packages/`). Su aporte real son las
  versiones: revisar una cotizacion enviada nunca la edita -crea una
  fila nueva con `supersedes_id` apuntando a la anterior, que se marca
  `superseded`-, asi que el historial completo de que se cotizo cada
  vez queda intacto. Un trigger de campo por campo (mismo patron que
  `bom`) congela `customer_id`/`terms`/totales en cuanto sale de
  `draft`, pero sus propias lineas son mas estrictas -se congelan por
  completo, no campo por campo, en cuanto la cotizacion padre deja
  `draft`-. Deliberadamente sin FK a `leads`: recomienda `crm`, no lo
  exige, mismo criterio que `logistics` con el vehiculo de `fleet`.
  Verificado en vivo sobre la cotizacion sembrada (Constructora Duarte
  SRL, RD$54,870): agregar una segunda linea real (20 unidades a
  RD$380) confirmo el subtotal, el ITBIS y el total combinados
  exactos; enviarla y crear una version nueva produjo una v2 real en
  borrador enlazada de vuelta a la v1 ya `superseded`. Todo revertido
  despues -v2 borrada, v1 devuelta a `draft`- para que la demo siga
  teniendo una cotizacion real por enviar desde cero. `e-sign` cierra
  S56 siendo honesto sobre lo que NO es: un flujo de clic para firmar
  con rastro de auditoria real -no una firma criptografica con
  certificado ni PKI, declarado sin rodeos en el FAQ del marketplace-.
  Al firmar se calcula un hash SHA-256 real de tipo, folio, etiqueta,
  correo del firmante y momento exacto, y se captura la IP de origen
  -verificado en vivo: un hash de 64 caracteres hexadecimales genuino
  y una IP real (`::1`, la del entorno de desarrollo), no valores de
  relleno-. Es el unico modulo de F9 hasta ahora sin ningun `requires`
  Y sin ninguna FK real hacia lo que firma: `document_id` es un `uuid`
  deliberadamente sin `references`, polimorfico por `document_type`,
  porque `contracts` (modulo 33) todavia no existe en este catalogo
  construido y `quotes` solo se recomienda. Verificado en vivo con el
  caso de honestidad completo: una solicitud de tipo `other` -sin
  ningun lazo real a `quotes`- se creo, envio y firmo exactamente
  igual que si hubiera sido sobre una cotizacion real, confirmando que
  el modulo funciona por su cuenta. Revertido despues -evento de firma
  borrado, solicitud devuelta a `sent`- para que la demo siga teniendo
  una firma real por resolver. `contracts` cierra S57 con el mismo
  criterio de versionado que `quotes`: renovar NO edita el contrato
  actual -lo marca `renewed` (terminal) y crea uno NUEVO con
  `renewed_from_id` apuntando al anterior-, con `calcularEscalamiento()`
  decidiendo el monto. Verificado en vivo: renovar el contrato sembrado
  (RD$15,000/mes, escalamiento 5%, venciendo en 20 dias) produjo un
  contrato nuevo con RD$15,750.00 exacto y una fecha de fin extendida
  un año, revertido despues para que la demo siga teniendo un contrato
  real por renovar. `commissions` -que SI declara `requires:
  sales-orders`, a diferencia de `contracts`- encontro un bug real en
  su PROPIO trigger de inmutabilidad: la version original congelaba la
  fila en cuanto el estado salia de `pending`, pero `approved` NO es
  terminal -tiene que poder seguir avanzando a `paid`-. Se descubrio
  probando el flujo en vivo (pagar una comision ya aprobada fallaba con
  "ya se resolvio"), exactamente el mismo tipo de error que `bom`
  cometio con su transicion `active → obsolete` -un estado que "ya no
  es el primero" no siempre es "terminal"-. Corregido para congelar
  solo en `paid`/`rejected`, con la prueba de RLS reescrita para
  confirmar la secuencia completa (`pending → approved → paid`) en vez
  de asumir que `approved` ya era el final. Verificado en vivo después
  de la corrección: una comision del 5% sobre una orden real de
  RD$25,000 calculó RD$1,250.00 exacto, y el flujo completo
  pendiente → aprobada → pagada se completó sin errores, revertido
  después para que la demo siga teniendo una comision real por
  aprobar. `customer-portal` cierra S58 abriendo una categoria nueva:
  es el primer modulo de todo el proyecto cuya pantalla real de cliente
  NO vive dentro del `Shell` autenticado. `/portal-cliente/[token]` es
  una ruta publica de verdad -sin `modulePage()`, sin rol, sin tenant en
  la URL- que usa la conexion de servicio `db()` (documentada en
  `lib/db.ts` como la que NO aplica RLS por si sola) para resolver
  exactamente el token recibido, y de ahi en adelante filtra cada
  consulta por el `tenant_id`/`customer_id` que ESA busqueda devolvio,
  nunca por un parametro que mande el cliente. El manifest lo refleja:
  su `routes[]` solo declara la pantalla de staff, la publica queda
  deliberadamente fuera del sistema de RBAC porque nadie con sesion de
  tenant la visita. Verificado en vivo de punta a punta: la invitacion
  sembrada para Ferreteria El Martillo mostro sus dos facturas reales
  (RD$21,830 abierta + RD$11,564 vencida = RD$33,394 pendiente, exacto)
  sin ninguna sesion abierta; un token inventado dio 404 limpio; y
  revocar la invitacion desde el panel de staff invalido el mismo token
  real en el mismo segundo -tambien confirmado con un 404-. Revertido
  despues -invitacion devuelta a `active`- para que la demo siga
  teniendo un enlace real por visitar. `helpdesk` cierra S58 con el mismo
  criterio de "terminal de verdad" que ya aplicaron `commissions` y los
  CAPA de `quality`: un ticket resuelto puede reabrirse si el cliente
  responde que el problema sigue, pero uno cerrado no tiene marcha
  atras -reforzado por `no_editar_ticket_cerrado`, no solo por la UI-.
  El vencimiento del SLA reutiliza `certificadoVigente()` de
  `training.ts` como `slaVigente()` -**septima vez** que esa funcion se
  reusa en el proyecto-, y `diasAbierto()` de `quality.ts` se reusa tal
  cual para saber cuanto lleva abierto un caso. Verificado en vivo la
  secuencia completa open -> in_progress -> resolved (5/5 satisfaccion)
  -> in_progress (reabierto) -> resolved -> closed, confirmando que una
  vez cerrado la pantalla ya no ofrece ningun boton ni formulario de
  respuesta; revertido despues -ticket devuelto a `open`, mensaje de
  prueba borrado- para que la demo siga teniendo un caso real por
  resolver. `loyalty` abre S59 con el mismo criterio de "se deriva,
  nunca se guarda" que ya usan `bank_account_balance()` de `treasury`
  y `fixed_asset_book_value()` de `fixed-assets`: el saldo de puntos se
  suma directo del historial completo de transacciones, y el nivel
  -bronce, plata, oro- se decide por los puntos GANADOS de por vida,
  no por el saldo actual, para que redimir un premio nunca degrade a
  un cliente fiel. Verificado en vivo: completar el referido sembrado
  (Constructora Duarte SRL → Ferreteria El Martillo, bono de 100
  puntos) acredito el bono en el MISMO movimiento que congelo la fila
  -saldo de Duarte subiendo de 450 a 550 exacto-, y redimir el cupon
  `BIENVENIDA10` lo dejo sin boton para volver a redimirlo. Ambos
  revertidos despues. `marketing` cierra S59 con el mismo criterio de
  honestidad que `e-sign`: no manda ningun correo ni WhatsApp de
  verdad todavia -"enviar" una campana toma la foto real de los leads
  que hoy cumplen el segmento (una FK autentica hacia `crm`, modulo que
  SI requiere) y crea un destinatario por cada uno-. Encontro su propio
  bug real: la maquina de estados original solo permitia enviar desde
  `scheduled`, pero la pantalla ofrece "Enviar ahora" directo desde
  borrador -verificado en vivo, el primer intento no hizo nada porque
  la transicion `draft → sent` devolvia `false`-, corregido para
  permitir el envio directo desde borrador (un flujo legitimo que no
  depende de programar primero). Vuelto a probar en vivo: la campana
  sembrada, segmentada por fuente `referral`, encontro exactamente el
  lead que cumplia el filtro, y marcar apertura y clic movio la tasa de
  "—" a 100%/0% y luego a 100%/100%, exacto sobre un solo destinatario.
  Revertido despues -destinatario borrado, atribucion del lead
  limpiada, campana devuelta a borrador- para que la demo siga
  teniendo una campana real por enviar. `ecommerce` es el unico modulo
  de S60 y aplica la misma disciplina de honestidad que `marketing`:
  no llama a la API de Shopify/WooCommerce/Tiendanube de verdad, y un
  pedido entrante se registra TAL CUAL llegaria por un webhook -su
  total nunca se recalcula con una formula propia, porque ya lo
  calculo el canal externo, y reinventar esa cuenta aqui podria
  mostrar un numero distinto al que el cliente realmente pago-. Un
  vinculo de catalogo es una FK real hacia `products` (que SI
  requiere), y "sincronizar" solo registra la fecha -sin ninguna
  llamada de red real-. Verificado en vivo: el pedido sembrado
  `#SHOP-1042` (Yolanda Perez, RD$2,325.00 exacto = 5 sacos de cemento
  a RD$465) paso de "Recibido" a "Importado" y perdio sus botones de
  transicion -terminal de verdad-, y sincronizar el vinculo de
  "Cemento gris 42.5 kg" actualizo su fecha al instante. Ambos
  revertidos despues para que la demo siga teniendo un pedido real por
  importar. `bi` es el unico modulo de S61-62 y resuelve el riesgo mas
  obvio de un "constructor visual de reportes": nunca acepta SQL libre
  del tenant. En cambio elige entre un catalogo FIJO de cinco fuentes
  ya vetadas (ventas por dia, productos mas vendidos, facturas
  vencidas, leads por estado, tickets por prioridad), cada una una
  consulta parametrizada ya escrita en la aplicacion -reutilizando la
  MISMA logica que ya usan los widgets del dashboard para "los mas
  vendidos" y "facturas vencidas", ningun calculo nuevo-. Ninguna
  fuente necesita su propia comprobacion de modulo activo: si `crm` no
  esta activo, `leads_by_status` no devuelve filas porque la RLS de
  `leads` ya lo exige, el mismo criterio que protege cualquier widget.
  Sembrar el reporte de facturas vencidas destapó un gap real de una
  fase anterior: el modulo `ar` nunca se habia activado para
  `distribuidora-caribe` a pesar de que el tenant ya tenia facturas
  sembradas -la fuente devolvia cero filas no por un bug de `bi`, sino
  porque la RLS de `customer_invoices` exige `module_active('ar')`-.
  Corregido activando `ar` en el seed. Verificado en vivo despues:
  el reporte mostro las dos facturas vencidas reales (El Martillo
  RD$12,064/96 dias, Duarte RD$27,200/46 dias); ejecutar el export
  programado sembrado avanzo su proxima fecha exactamente 7 dias
  (`proximaEjecucion()`), y pausarlo/reanudarlo alterno el estado sin
  tocar el calendario -honesto sobre no mandar el correo de verdad,
  mismo criterio que `marketing`-.

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
