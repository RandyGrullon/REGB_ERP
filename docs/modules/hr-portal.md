# `hr-portal` — Portal del Empleado

**Que resuelve:** autoservicio -volantes, saldo de vacaciones, datos
personales y anuncios- sin que RRHH conteste la misma pregunta cien
veces.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `employees`

---

## Una ventana, no un motor de calculo nuevo

A diferencia de casi todos los modulos de esta fase, `hr-portal` no
introduce una formula nueva: el volante sigue siendo la fila de
`payroll_lines` que `payroll` ya calculo y dejo inmutable; el saldo de
vacaciones sigue siendo `saldoVacaciones()` de `time-off.ts`, sin
reimplementarlo. La unica pieza de logica genuinamente nueva es
`esAnuncioVigente()` -si un anuncio todavia cuenta como "reciente" para
resaltarlo con una insignia-.

## "Quien mira" se resuelve por correo, no por un `employees.user_id`

Este esquema nunca vinculo formalmente un empleado con una cuenta de
usuario. `resolverMiEmpleado()` (`apps/web/src/app/portal/mi-empleado.ts`)
compara `public.user_profiles.email` (el correo de quien inicio sesion)
contra `public.employees.email` (el correo del expediente), ambos del
mismo tenant. Si no coinciden -o el expediente nunca tuvo correo
cargado- el portal no encuentra a quien mostrar, y lo dice
explicitamente en pantalla: nunca muestra el expediente de otra
persona ni falla en silencio. Toda accion del portal (editar telefono,
pedir vacaciones) resuelve el empleado propio de esta misma forma
-nunca confia en un `employeeId` que venga del formulario-, para que
nadie pueda operar sobre el expediente de otro cambiando un id.

## Datos personales: solo el telefono, deliberadamente

El "autoservicio de datos personales" del catalogo se implementa como
edicion del telefono -el unico campo de `employees` para el que
editarlo desde el propio empleado no tiene ninguna consecuencia hacia
otro modulo-. Editar el correo, por ejemplo, rompería la propia
vinculacion de "quien mira"; editar el salario claramente no es
autoservicio. Declarado explicitamente como el alcance real, no como
un descuido.

## Anuncios: la unica tabla nueva

`hr_announcements` no referencia ninguna otra tabla de tenant -no hay
`employee_id` ni `branch_id`-, asi que el patron de trigger de
referencia cruzada (0031 y siguientes) no aplica aqui: la RLS de
`tenant_id` es suficiente.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/portal` | `hr-portal.view` | Tu expediente, tus volantes, tu saldo y tus solicitudes de vacaciones, los anuncios |
| `/portal/anuncios` | `hr-portal.manage-announcements` | Publicar anuncios para todo el equipo |

## Manifiesto

- **Permisos:** `view`, `request-time-off`, `edit-profile`, `manage-announcements`
- **Widgets:** `recent-announcements`
- **Emite:** `hr-portal.announcement.published`
- **Requiere:** `employees`
- **Plataformas:** web y movil -**sin escritorio**, `platforms.desktop = false`, coherente con ser ante todo un portal de autoservicio-

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/hr-portal.test.ts` — 8 casos: aislamiento de anuncios, spoofing de tenant_id directo (sin trigger de referencia cruzada porque no aplica), modulo apagado, checks de tabla (titulo/cuerpo obligatorios) |
| 3 | Logica pura con cobertura | ✅ `hr-portal.ts` — 5 pruebas de `esAnuncioVigente()`; el resto de la logica se reutiliza de `time-off.ts` y `payroll` sin reimplementar |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: expediente propio resuelto por correo con datos reales (saldo, volantes y solicitudes de Rafael), telefono editado en vivo, vacaciones pedidas en vivo desde el portal, anuncio publicado en vivo con la insignia "Nuevo" apareciendo y desapareciendo segun antiguedad |
| 5 | UI movil | 🔜 F5 — `mobileScope` declarado, sin implementar todavia |
| 6 | Desktop verificado | N/A — el modulo declara `platforms.desktop = false` a proposito |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ el correo de Rafael enlazado al del usuario demo -para que el portal muestre un expediente real, no el estado vacio-, dos anuncios -uno vigente, uno vencido- |
| 9 | ≥2 widgets | ⚠️ solo 1 (`recent-announcements`): el portal es ante todo una ventana de autoservicio, no genera mas metricas de dashboard propias que las que ya aportan `payroll`/`time-off`/`attendance` |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas -controles con nombre, sin ids duplicados, `<main>` presente- |

## Lo que NO hace

- **Vincular formalmente un usuario con un empleado.** La resolucion es
  por coincidencia de correo entre `user_profiles` y `employees` -sin
  una columna `employees.user_id` real, sujeto a que el correo del
  expediente este cargado y coincida con el de la cuenta-.
- **Editar mas que el telefono.** Nombre, puesto, salario y el resto
  del expediente son de solo lectura desde el portal -se editan desde
  `employees`, no aqui-.
- **Recalcular nada.** Volante y saldo de vacaciones son exactamente
  los que ya calcularon `payroll` y `time-off`; el portal nunca vuelve
  a correr esa aritmetica.
