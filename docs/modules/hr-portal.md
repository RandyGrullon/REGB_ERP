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

## "Quien mira" es el expediente que RRHH vinculo (0132)

Hasta 0132 el portal emparejaba el correo de la cuenta
(`user_profiles.email`) con el del expediente (`employees.email`), **sin
unicidad**. En la demo, el expediente de Rafael Encarnacion tenia el
correo de la cuenta de Maria Rosario, y Maria abria `/portal` y veia el
salario (85,000) y el volante (71,399.44) de Rafael. Las funciones del
telefono (`pedir_vacaciones`, `reportar_gasto`) resolvian "quien soy"
igual: con un correo repetido se pedian vacaciones a nombre de otro.

Ahora:

- **`employees.user_id`**: el vinculo explicito, **unico por cliente**, con
  la guarda de cliente en la propia llave -(tenant_id, user_id) apunta a
  `memberships`: la cuenta tiene que ser del equipo de ESE cliente-. Si la
  persona sale del equipo, el expediente queda sin vinculo.
- **Solo RRHH lo asigna**, desde `/empleados/:id` ("Acceso al portal"),
  con `employees.employee.link`, via `vincular_empleado_usuario()`. Un
  token no puede escribir la columna directo: si pudiera, alguien con
  `employees.view` se vincularia al expediente del gerente y leeria su
  volante.
- **El portal no consulta tablas con un filtro de la app**: le pregunta a
  la base por el token. `mi_expediente()`, `mis_volantes()` y
  `editar_mi_telefono()` resuelven por el vinculo y no reciben ningun id.
  `pedir_vacaciones()` y `reportar_gasto()` tambien.
- **Sin vinculo, el portal lo dice** ("Tu cuenta no esta vinculada a un
  expediente") y no muestra nada. **Nunca se adivina por correo**, ni
  siquiera para rellenar el vinculo al migrar: el correo es justo lo que
  emparejaba mal.

## Datos personales: solo el telefono, deliberadamente

El "autoservicio de datos personales" del catalogo se implementa como
edicion del telefono -el unico campo de `employees` para el que
editarlo desde el propio empleado no tiene ninguna consecuencia hacia
otro modulo-; editar el salario claramente no es autoservicio. Desde
0132 pasa por `editar_mi_telefono()`: con el rol real en el token
(`asUser`, 0127) el rol Empleado no tiene `employees.view` y no puede
-ni debe- tocar la tabla `employees`.

## Anuncios: la unica tabla nueva

`hr_announcements` no referencia ninguna otra tabla de tenant -no hay
`employee_id` ni `branch_id`-, asi que el patron de trigger de
referencia cruzada (0031 y siguientes) no aplica aqui: la RLS de
`tenant_id` es suficiente.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/portal` | `hr-portal.view` | Tu expediente, tus volantes (dias, bruto, reembolsos, TSS, ISR, descuentos, neto), tu saldo y tus solicitudes de vacaciones, los anuncios |
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
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/hr-portal.test.ts` — 8 casos de anuncios; `supabase/tests/nomina-vinculo-y-periodos.test.ts` — dos cuentas con el MISMO correo: cada una ve solo su expediente y su volante, una tercera sin vinculo no ve nada, el vinculo no se escribe con token, no cruza de cliente, una cuenta = un expediente, telefono solo el propio |
| 3 | Logica pura con cobertura | ✅ `hr-portal.ts` — 5 pruebas de `esAnuncioVigente()`; el resto de la logica se reutiliza de `time-off.ts` y `payroll` sin reimplementar |
| 4 | UI web responsive | ✅ `apps/web/src/app/portal/portal.accion.test.ts` (8, acciones reales): el caso exacto de la demo -dos expedientes con el correo de la cuenta- no muestra ninguno hasta que RRHH vincula, y despues solo el propio. Verificado en navegador (0132): estado "sin vincular", vincular desde `/empleados/:id`, portal con el expediente y el volante vinculados |
| 5 | UI movil | 🔜 F5 — `mobileScope` declarado, sin implementar todavia |
| 6 | Desktop verificado | N/A — el modulo declara `platforms.desktop = false` a proposito |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ dos anuncios -uno vigente, uno vencido-. El seed ya NO le pone a Rafael el correo del usuario demo (era el hallazgo) y no vincula a nadie: la demo arranca en "sin vincular" y el vinculo se hace en vivo desde `/empleados/:id` |
| 9 | ≥2 widgets | ⚠️ solo 1 (`recent-announcements`): el portal es ante todo una ventana de autoservicio, no genera mas metricas de dashboard propias que las que ya aportan `payroll`/`time-off`/`attendance` |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas -controles con nombre, sin ids duplicados, `<main>` presente- |

## Lo que NO hace

- **Abrirse al rol Empleado de fabrica.** La plantilla de 0006 le da
  `hr-portal.view.own`, que ningun manifiesto declara, y no `hr-portal.view`
  (la ruta), `hr-portal.request-time-off` ni `hr-portal.edit-profile`: una
  cuenta con el rol Empleado recibe 404 en `/portal`. Va en
  `regb.permisos_de_fabrica()` (0135, del dueño de roles), no aqui.
- **Editar mas que el telefono.** Nombre, puesto, salario y el resto
  del expediente son de solo lectura desde el portal -se editan desde
  `employees`, no aqui-.
- **Recalcular nada.** Volante y saldo de vacaciones son exactamente
  los que ya calcularon `payroll` y `time-off`; el portal nunca vuelve
  a correr esa aritmetica.
