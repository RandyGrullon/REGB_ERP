# `fleet` — Flota & Vehiculos

**Que resuelve:** vehiculos, combustible, mantenimiento vencido por
kilometraje o por fecha, documentos con vigencia real, y multas con un
flujo de estados de verdad -no un campo de texto libre-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes

---

## Reutiliza infraestructura en vez de reinventarla

`documentoVehiculoVigente()` es literalmente `certificadoVigente()` de
`training.ts` reexportada con otro nombre -la misma pregunta ("esto ya
vencio?") que ya se resolvio para certificados de empleados y lotes,
aplicada a licencias, seguros e inspecciones-. La pantalla de detalle
tambien reutiliza `loteProximoAVencer()` de `lots-serials.ts` para la
alerta "por vencer" -una funcion generica de umbral de dias que no
tenia por que reescribirse solo porque el nombre menciona lotes-.

## Mantenimiento vencido, dos maneras de medirlo

`mantenimientoVencidoPorKm()` compara el kilometraje actual contra el
del ultimo servicio mas el intervalo. `mantenimientoVencidoPorFecha()`
resuelve lo mismo por fecha limite. Ninguna de las dos vive en SQL: la
pantalla de detalle calcula la alerta "Mantenimiento vencido" en el
momento, a partir del kilometraje real del vehiculo. Verificado en
vivo con un vehiculo sembrado cuyo ultimo servicio marcaba
`next_due_km = 45000` y cuyo odometro real ya llego exactamente ahi:
la alerta aparecio sin tener que registrar nada nuevo.

## El rendimiento de combustible se calcula, no se declara

Cada carga de combustible guarda el kilometraje real al momento de
llenar el tanque. La pantalla de detalle ordena las cargas y calcula
`eficienciaCombustible()` entre cada carga y la anterior -kilometros
recorridos entre litros consumidos-, mostrando el rendimiento real de
cada tramo, no un numero que alguien escribio a mano.

## Multas con flujo real, no un campo de texto

`transicionValidaMulta()` valida `pending → paid | disputed`,
`disputed → paid | dismissed`; `paid`/`dismissed` son terminales.
Verificado en el navegador: una multa pendiente marcada "Pagada",
confirmada como inmutable despues (`impedir_editar_multa_resuelta()`
rechazo un intento posterior de editar el monto), y restaurada a
`pending` para dejar el escenario de demo intacto.

## Un vehiculo es un registro vivo; combustible y mantenimiento son hechos historicos

`vehicles`/`vehicle_documents` no llevan trigger de inmutabilidad -su
kilometraje, estado y documentos cambian seguido, mismo criterio que
`product_lots`-. `fuel_logs`/`maintenance_records` son inmutables
desde el primer insert -lo que ya paso no se reescribe, mismo criterio
que `benefit_loan_payments`-.

## Honesto sobre lo que todavia no hace

No hay integracion real con telematica/GPS de vehiculos -eso es
`logistics` (53), y tampoco esta conectado a ningun dispositivo real
todavia-. Las multas se registran manualmente; no hay verificacion
contra el registro de transito real de la DGII o de transito -esa
integracion externa es un paso futuro-.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/flota` | `fleet.view` | Lista de vehiculos con alertas, registrar uno nuevo |
| `/flota/[id]` | `fleet.view` | Documentos, combustible con rendimiento calculado, mantenimiento, multas |

## Manifiesto

- **Permisos:** `view`, `manage`, `fines.manage`
- **Widgets:** `fleet-maintenance-due`
- **Recomienda:** `logistics`
- **Emite:** `fleet.maintenance.recorded`, `fleet.fine.registered`
- **Plataformas:** web, escritorio y movil (`mobileScope: ['view', 'manage']`)

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/fleet.test.ts` — 16 casos: aislamiento, spoofing de tenant via conductor/vehiculo ajenos en las cuatro tablas nuevas, vehiculo editable siempre, combustible y mantenimiento inmutables desde el insert, multa editable solo mientras no este resuelta, modulo apagado, checks de tabla (placa duplicada, estado invalido, monto invalido) |
| 3 | Logica pura con cobertura | ✅ `fleet.ts` — 11 pruebas: eficiencia de combustible, mantenimiento vencido por km y por fecha, maquina de estados de multas. Reutiliza `certificadoVigente()` de `training.ts` sin duplicar |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: alerta de mantenimiento vencido visible sin interactuar, rendimiento de combustible calculado correctamente entre dos cargas reales (33.3 km/gal), una multa pagada y confirmada inmutable, restaurada a pendiente despues de verificar |
| 5 | UI movil | 🔜 F9 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un vehiculo con conductor asignado, tres documentos en los tres estados de vigencia posibles, dos cargas de combustible reales, un mantenimiento cuyo proximo servicio ya se alcanzo, una multa pendiente |
| 9 | ≥2 widgets | ⚠️ solo 1 (`fleet-maintenance-due`): el modulo es principalmente registro y alertas, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas |

## Lo que NO hace

- **Telematica/GPS real.** Ningun vehiculo esta conectado a un
  dispositivo de rastreo; el kilometraje se actualiza manualmente al
  cargar combustible o registrar mantenimiento. Eso es `logistics`.
- **Verificar multas contra el registro de transito real.** Se
  registran manualmente, sin integracion externa.
- **Recordatorios automaticos de vencimiento.** La alerta se calcula
  al abrir la pantalla; no hay notificacion push ni correo cuando un
  documento esta por vencer.
