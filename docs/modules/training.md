# `training` — Capacitacion (LMS)

**Que resuelve:** cursos con nota que aprueba contra el minimo real de
cada uno, certificados con vigencia calculada, y una matriz de
competencias consultable.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `employees`

---

## Un sistema de registro, no una plataforma de contenido

El catalogo (§5.6) habla de un "LMS": este modulo es el registro de
seguimiento -quien se inscribio, que nota saco, que certificado tiene,
que nivel de competencia alcanzo-, no un motor de video ni de
contenido interactivo. Honesto desde el manifest, mismo criterio que
el resto de los "sin X real" de esta fase.

## Aprobar se calcula contra el minimo de CADA curso

`aproboEvaluacion(score, passingScore)` (`@regb/operations`) no usa un
70% fijo para todos los cursos: cada curso define su propio
`passing_score` -el ejemplo de la demo tiene un curso con minimo 70 y
otro con minimo 80-, y la accion del servidor (`registrarNota()`)
consulta ese minimo real antes de decidir si la inscripcion queda
`completed` o `failed`. La decision se toma en TypeScript, nunca en
SQL -mismo principio que `within_geofence` en `attendance`-.

## Un certificado vigente se calcula, nunca se guarda como bandera

`certificadoVigente(expiresAt, asOf)` compara la fecha de vencimiento
contra hoy en cada lectura; si `expiresAt` es nulo, el certificado
nunca vence. No hay una columna `is_valid` que alguien tenga que
actualizar cuando pasa la fecha.

## Dos niveles de inmutabilidad, igual que en `benefits`

- **`training_enrollments`** (la inscripcion): editable mientras esta
  `enrolled`, inmutable una vez `completed` o `failed` -mismo criterio
  que un prestamo activo/saldado-.
- **`training_certificates`** (el certificado): inmutable **desde el
  primer momento**, sin condicion de estado -igual que un pago de
  prestamo o una evaluacion de desempeno-. Solo se emite a una
  inscripcion ya `completed`; una vez emitido, no se corrige, se
  revoca conceptualmente dejandolo vencer o -en una fase futura- con un
  estado de revocacion explicito.

## El mismo agujero de siempre, cuatro veces

`training_enrollments` referencia **dos** tablas -`course_id` y
`employee_id`-, `training_certificates` referencia `enrollment_id`, y
`training_employee_competencies` referencia **otras dos**
-`employee_id` y `competency_id`-. Cuatro funciones de trigger
distintas, cada una validando exactamente las referencias de su tabla.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/capacitacion` | `training.view` | Cursos, inscripciones con nota y certificado, matriz de competencias -las cuatro piezas del catalogo en una sola pantalla, mismo patron que `desempeno`- |

## Manifiesto

- **Permisos:** `view`, `manage-courses`, `manage-enrollments`, `manage-competencies`
- **Widgets:** `enrollments-in-progress`, `certificates-expiring`
- **Reportes:** `completion-rate`, `competency-matrix`
- **Emite:** `training.enrollment.completed`, `training.certificate.issued`
- **Requiere:** `employees`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/training.test.ts` — 14 casos: aislamiento de las cinco tablas, spoofing de tenant via curso, empleado, inscripcion y competencia ajenos, una inscripcion resuelta no se edita, un certificado nunca se edita ni se borra, modulo apagado, checks de tabla |
| 3 | Logica pura con cobertura | ✅ `training.ts` — 8 pruebas: aprobacion contra un minimo variable, vigencia de un certificado con y sin fecha de vencimiento, nivel promedio de una competencia |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: nota registrada en vivo con la aprobacion calculada contra el minimo real del curso (88 aprobo un curso con minimo 70), certificado emitido en vivo -confirmado que la sonda de accesibilidad, ya con las etiquetas aplicadas desde el principio, no encontro fallos- |
| 5 | UI movil | 🔜 F5 — `mobileScope` declarado, sin implementar todavia |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un curso completado y certificado -con el certificado venciendo en 20 dias, para ver el widget de "por vencer" en accion-, uno en curso sin nota, uno no aprobado -por debajo del minimo de su curso-, y una competencia con dos empleados evaluados |
| 9 | ≥2 widgets | ✅ `enrollments-in-progress`, `certificates-expiring` |
| 10 | Eventos documentados | ✅ declarados con el formato correcto de 3 segmentos; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'advanced'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos -aplicando desde el principio la leccion de `performance`: todo input o boton sin texto visible lleva `aria-label`- |

## Lo que NO hace

- **Alojar contenido de curso.** No hay video, PDF ni quiz interactivo
  -es un registro de seguimiento, no una plataforma de contenido-.
- **Revocar un certificado.** Un certificado emitido es inmutable; no
  hay todavia un estado de "revocado" para cuando algo sale mal
  despues de emitirlo.
- **Sugerir competencias a partir de cursos completados.** La matriz de
  competencias se evalua y registra por separado; completar un curso no
  actualiza automaticamente el nivel de ninguna competencia.
