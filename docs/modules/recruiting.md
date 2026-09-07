# `recruiting` — Reclutamiento (ATS)

**Que resuelve:** vacantes, candidatos y su pipeline de aplicaciones,
con reglas reales de a que etapa se puede pasar y a cual no.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Recomienda:** `employees`

---

## Sin portal de empleo publico -por una regla ya establecida-

El catalogo (§5.6) promete un "portal de empleo": una pagina publica
donde cualquiera pueda ver las vacantes y aplicar sin iniciar sesion.
Ese portal **no se construye en esta version**, y no por falta de
tiempo: este esquema tiene una regla de seguridad establecida desde
`0005_rls_policies.sql` -"nunca otorgamos nada a `anon` sobre datos de
negocio"-, y una pagina de vacantes visible sin sesion romperia esa
regla directamente. Construirlo bien pide un diseño deliberado de que
exactamente puede ver un visitante anonimo, no una politica de RLS
improvisada para esta vez. Los candidatos se registran manualmente por
quien recluta -sin foto de curriculum procesada automaticamente, mismo
criterio que el recibo sin OCR de `expenses`-.

## El pipeline tiene reglas, no es un campo de texto libre

`transicionValida()` (`@regb/operations`) es una maquina de estados: de
`applied` solo se avanza a `screening`, de ahi a `interview`, luego
`offer`, luego `hired` -nunca saltando una etapa-. Se puede rechazar
desde cualquier etapa no terminal. `hired` y `rejected` son
terminales: no salen de ahi. Se valida en TypeScript, no en SQL -mismo
principio que `within_geofence` en `attendance` o `business_days` en
`time-off`-; la base de datos solo impone la mitad final de la regla
-que una aplicacion ya resuelta no se pueda editar ni borrar-, no la
maquina de estados completa.

## El mismo agujero de siempre, dos veces en la misma tabla

`recruiting_applications` referencia **dos** tablas de tenant a la vez
-`position_id` y `candidate_id`-, asi que `impedir_aplicacion_ajena()`
valida ambas referencias, no solo una. `recruiting_interviews.application_id`
se valida por separado con `impedir_entrevista_ajena()`.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/reclutamiento` | `recruiting.view` | Vacantes, candidatos, crear ambos |
| `/reclutamiento/[id]` | `recruiting.manage-pipeline` | El pipeline de una vacante: aplicar, avanzar etapa, agendar entrevista |

## Manifiesto

- **Permisos:** `view`, `manage-positions`, `manage-candidates`, `manage-pipeline`
- **Widgets:** `open-positions`, `pipeline-summary`
- **Reportes:** `time-to-hire`, `pipeline-by-stage`
- **Emite:** `recruiting.application.created`, `recruiting.application.stage-changed`, `recruiting.interview.scheduled`
- **Requiere:** ninguno · **Recomienda:** `employees`
- **Plataformas:** web y escritorio -sin movil, `platforms.mobile = false`-

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/recruiting.test.ts` — 11 casos: aislamiento, spoofing de tenant via vacante, candidato Y aplicacion ajenos (todos con el PROPIO tenant_id), una aplicacion resuelta (hired) no se edita ni se borra, modulo apagado, checks de tabla (estado invalido, la misma vacante-candidato no aplica dos veces) |
| 3 | Logica pura con cobertura | ✅ `recruiting.ts` — 10 pruebas: la maquina de estados completa (avanzar, saltar etapas, retroceder, rechazar, los dos estados terminales), dias en el pipeline |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: candidato avanzado de etapa en vivo, candidato contratado en vivo -confirmando que los botones de accion desaparecen al llegar a un estado terminal, reflejando el trigger de inmutabilidad- |
| 5 | UI movil | N/A — el modulo declara `platforms.mobile = false` a proposito |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ una vacante abierta con dos candidatos en distinta etapa -uno con entrevista agendada-, y una vacante ya cerrada |
| 9 | ≥2 widgets | ✅ `open-positions`, `pipeline-summary` |
| 10 | Eventos documentados | ✅ declarados con el formato correcto de 3 segmentos; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'advanced'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas -controles con nombre, sin ids duplicados, `<main>` presente- |

## Lo que NO hace

- **Portal de empleo publico.** Declarado explicitamente arriba: este
  esquema nunca otorga acceso a datos de negocio sin sesion iniciada.
- **Leer un curriculum automaticamente.** Sin OCR ni parseo de PDF; el
  candidato se registra a mano con lo que quien recluta ya sabe de el.
- **Enviar correos de seguimiento al candidato.** El pipeline es una
  herramienta interna de quien recluta, no un sistema de comunicacion
  con el candidato.
