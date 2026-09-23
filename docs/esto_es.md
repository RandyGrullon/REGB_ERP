# Esto es: lo que resolvieron los agentes

> Registro de las rondas de agentes sobre [`ESTADO.md`](ESTADO.md). Cada
> ronda separa lo que un agente puede resolver de lo que no, lo reparte
> entre los agentes especializados del proyecto (`.claude/agents/`) y lo
> integra con la puerta `gate:f0` en verde.
>
> - [Ronda 2 — 23 de septiembre de 2026](#ronda-2--23-de-septiembre-de-2026): lo que quedó pendiente de la ronda 1, lo que salió de usar la app como cliente y de analizar el flujo de punta a punta.
> - [Ronda 1 — 22 de septiembre de 2026](#ronda-1--22-de-septiembre-de-2026)

---

## Ronda 2 — 23 de septiembre de 2026

### En una línea

**Se cerraron los seis hallazgos que dejó la ronda 1, y usar la app como
cliente destapó que el flujo de punta a punta tenía roturas que ninguna
prueba veía** —el 607 mal declarado, un colmado que no podía cumplir con la
DGII, crédito sin límite, contabilidad desconectada, nómina que podía pagar
doble—. Se arreglaron las más graves; lo que queda está abajo, dicho claro.

### Cómo se dividió

Tres oleadas, cada agente con su base de datos propia (un clon de la demo)
y sus números de migración asignados de antemano, para trabajar a la vez
sin pisarse.

**Oleada 1 — lo que `esto_es.md` dejó pendiente**

| Agente | Trabajo | Migración |
|---|---|---|
| `regb-db` + `regb-security` | Claves foráneas sin guarda de cliente, barridas en todo `public` | 0121 |
| `regb-db` | El respaldo del cliente trae todo el negocio y dice exactamente qué trae | 0122 |
| `regb-module-builder` + `regb-qa` | Importar `1,234` y contar bien los SKU repetidos | — |
| `regb-module-builder` + `regb-security` | Invitación de usuarios real, sin `user_id` inventados | 0123 |
| `regb-architect` + `regb-module-builder` | Los módulos core emiten los eventos que declaran | — |
| `regb-billing` + `regb-module-builder` | `invoice-capture` fuera de la venta; avisos leídos por persona | 0124, 0125 |
| `regb-design` + `regb-web` | Marketplace rediseñado con capturas reales | 0134 |
| `regb-docs` + `regb-architect` + `regb-db` | [`defi-v1.md`](defi-v1.md): a quién vender hoy y cómo dejar Supabase listo | — |
| `regb-architect` + `regb-qa` | Análisis del flujo de negocio de punta a punta, solo lectura | — |

**Oleada 2 — lo que encontraron las anteriores**

| Agente | Trabajo | Migración |
|---|---|---|
| `regb-db` + `regb-security` | Un Cajero podía hacerse Owner por PostgREST | 0127 |
| `regb-billing` | La factura de REGB cobraba de menos y mandaba a solo lectura el primer día | 0128 |

**Oleada 3 — lo que salió del análisis de flujo**

| Agente | Trabajo | Migración |
|---|---|---|
| `regb-db` + `regb-billing` | 607, 606, IT-1, fechas en hora de RD, colmado solo con caja | 0129 |
| `regb-module-builder` | Crédito: límite, mora, RNC, notas de crédito B04 | 0130 |
| `regb-architect` + `regb-db` | Contabilidad automática por eventos; recepciones | 0131 |
| `regb-module-builder` + `regb-security` | Nómina: doble pago, prorrateo, topes TSS; privacidad del portal | 0132 |
| `regb-module-builder` + `regb-web` | Alta de un cliente real sin SQL; carga inicial; tablero de onboarding | 0133 |

La 0126 no existe: el agente de eventos no la necesitó. La 0135 es del
líder (roles de fábrica, abajo).

### Lo que resolvió cada uno

#### Oleada 1

- **FK sin guarda (0121).** Era explotable: un usuario de A se ponía un rol
  de B y la app le aplicaba los permisos de B. El barrido encontró **45 FK
  sin ninguna guarda y 85 que solo se revisaban al insertar**. Todas
  cerradas con una función genérica; una red permanente en
  `fk-guardas.test.ts` falla si aparece una FK nueva sin guarda.
- **Respaldo (0122).** Trae toda tabla del cliente, decidida en cada
  respaldo —un módulo nuevo entra solo—, bajo RLS y sin credenciales. La
  pantalla y el archivo dicen lo mismo porque la pantalla se pinta del
  índice del archivo.
- **Importar.** `1,234` es 1234 en un archivo con formato dominicano, y lo
  ambiguo se **rechaza con motivo** en vez de adivinarse. El resumen separa
  nuevos, ya existían y rechazados. Arregló de paso que un CSV de Excel en
  español partía el precio en dos columnas.
- **Invitaciones (0123).** Token guardado como hash, la membresía nace solo
  cuando una persona real acepta con su correo, Edge Function para enviar el
  correo con Supabase y, en demostración, la pantalla dice "no se envió" y
  da el enlace.
- **Eventos core.** Los que tienen acción se emiten en la misma transacción;
  los que no tenían sentido se quitaron del manifiesto. Una prueba estática
  falla si un manifiesto core declara un evento que nadie emite.
- **`invoice-capture` (0124).** Despublicado, sus activaciones archivadas y
  la base se niega a activarlo: **se le estaba cobrando la mensualidad** a
  la demo.
- **Avisos (0125).** Cada persona tiene su "leído": antes, que uno leyera un
  aviso de equipo lo marcaba leído para todos.
- **Marketplace.** Captura real de cada módulo en su tarjeta y en su ficha,
  en tema oscuro y claro (`pnpm capturas:marketplace` las regenera);
  catálogo por áreas de negocio; 8 paquetes por tipo de negocio; simulador
  que cotiza con el **mismo motor que la factura**; los botones de la ficha,
  que no hacían nada, ahora piden de verdad; tildes en el catálogo (0134).

#### Oleada 2

- **Escalada dentro del cliente (0127).** Un Cajero podía darse `*` o
  pasarse a Owner por PostgREST. Ahora las escrituras de roles y membresías
  exigen el permiso, nadie se sube a sí mismo y siempre queda un Owner.
  **La web mandaba los claims sin `role_id`**, así que en la web ninguna
  política con `has_perm` aplicaba; ahora manda el rol real y `has_perm`
  falla cerrado.
- **Factura de REGB (0128).** Cobraba base + módulos sin usuarios extra, sin
  sucursales y **sin ITBIS**; vencía el primer día del período, así que la
  primera corrida de mora mandaba al cliente a solo lectura; las pruebas de
  módulo no vencían nunca; la instalación no se facturaba; y "solo lectura"
  no bloqueaba nada. Todo corregido con pruebas.

#### Oleada 3

- **Fiscal (0129).** El 607 restaba el descuento dos veces (un ticket de
  1,000 con 10% se declaraba 800); los reportes agrupaban por fecha UTC
  (una venta a las 9 p. m. del 30 caía en el mes siguiente); el 606
  mezclaba ISR con ITBIS retenido y el IT-1 lo sumaba al impuesto. Un
  colmado solo con caja ya puede cargar NCF y sacar su 607. Varias
  secuencias NCF del mismo tipo conviven sin desactivarse.
- **Crédito (0130).** Límite de crédito y bloqueo por facturas vencidas
  hace más de 30 días (configurable), con excepción auditada que autoriza
  quien tenga `ar.credit.override`; la mora ya no desaparece al cobrar; un
  RNC inválido da error en vez de caer en B02 en silencio; notas de crédito
  B04 que entran al 607 y restan del IT-1; reverso de cobros con motivo;
  factura a crédito con líneas y vista imprimible; se factura lo entregado,
  no lo pedido; los pedidos respetan la lista de precios del cliente.
- **Contabilidad (0131).** Venta de caja, factura a crédito, cobro, factura
  de proveedor y su pago generan su asiento: idempotente, cuadrado e
  inmutable, con un mapa de cuentas por cliente. La balanza ya no suma
  borradores. Recibir menos de lo pedido ya no revienta la pantalla y no se
  puede devolver al proveedor lo que nunca entró.
- **Nómina (0132).** El portal emparejaba empleado y usuario por correo: en
  la demo **un usuario veía el salario de otro**. Ahora el vínculo lo asigna
  RRHH. Los períodos no se solapan —antes dos quincenas pagaban dos meses—,
  se prorratea por días y los topes de TSS salen de una tabla por vigencia.
- **Alta de cliente (0133).** REGB Control da de alta un cliente real sin
  SQL —RNC validado, módulos con sus dependencias, empresa, sucursal,
  almacén, roles e invitación al dueño— en una transacción idempotente;
  existencias iniciales por CSV; el CSV de productos acepta código de barras
  y exento. **El tablero de onboarding se arrastra** entre etapas (con
  alternativa por teclado y "Mover a…" para el teléfono) **y se filtra por
  nombre y tamaño**, con el filtro en la URL.

### Lo que hizo el líder al integrar, y lo que encontró usando la app

- **Docker no arrancaba** por sockets huérfanos que Windows no deja borrar;
  se apartan las carpetas. Script: `code/docker-arrancar.ps1`.
- **Un clon limpio no arrancaba**: los paquetes exportan `dist/`, que no se
  versiona. El README ya lo dice.
- **Tema oscuro por defecto, claro a un clic**, sin destello al cargar
  (`TemaToggle`, cookie `regb-tema`).
- **Caja, abierta como el dueño del colmado:** el arroz cobraba 18% de ITBIS
  (en RD está exento, igual que las habichuelas; el aceite va al 16%) y la
  demo no tenía existencias ni NCF; "Cobrar" se quedaba apagado sin decir
  por qué; el carrito se vaciaba aunque la venta fallara; el cajero no
  podía abrir su propio ticket; el "vendido" usaba `sum(distinct)`; la caja
  solo cargaba 300 productos. Ahora el aviso dice "Cobrado RD$ 609.00 · NCF
  B0200000001" con el enlace al ticket, y el ticket imprime el tipo de
  comprobante y el "válido hasta" que pide la Norma 06-2018.
- **Roles de fábrica (0135).** 0025 arregló los roles que existían ese día;
  **todo cliente creado después nacía con los roles viejos**. Ahora una
  sola función alimenta la plantilla y los clientes existentes, y solo
  agrega. Arregló también el descuento del Cajero —nunca funcionó— y los
  404 del Almacenista, el Comprador y el Empleado en sus propias pantallas.
- **Supabase:** conexión con `prepare: false` y SSL fuera de local, para el
  pooler en modo transacción; `pnpm audit:identidad` en la puerta, que falla
  si algo fija la identidad de un cliente fuera de su transacción.
- **El despachador de eventos solo corría con un botón.** Ahora acepta el
  cron de Vercel (GET) y hay `pnpm despachar` para un servidor propio.
- **Una pantalla que falla ya no deja al usuario en blanco**: `error.tsx`.
- **Sidebar por áreas de negocio.** Con 67 módulos en "Operación", la
  distribuidora tenía más de 150 enlaces seguidos. Ahora cada manifiesto
  declara su área (las mismas del marketplace), cada módulo es una fila que
  despliega sus pantallas, las secciones se pliegan y se recuerdan, y con
  más de 20 módulos aparece "Buscar en el menú".

### Lo que queda pendiente

| Pendiente | Por qué importa | Quién |
|---|---|---|
| e-CF no emite | Obligatorio para pequeños y micro desde el **15 nov 2026** | Certificado DGII + trabajo de `e-invoice` |
| Supabase de producción, Stripe/Azul, certificado | Sin eso no hay primer cliente real | Tus credenciales — ver [`defi-v1.md`](defi-v1.md) §4 |
| Horas extra, aportes patronales, archivo SUIR, IR-3 | La nómina no reemplaza todavía la del cliente | Siguiente ronda |
| Asientos de nómina, depreciación, costo de venta a crédito | La contabilidad automática cubre venta, cobro y compra | Siguiente ronda |
| Un Admin puede crear un rol con `*` y dárselo a otro | Solo el Owner está protegido | Siguiente ronda |
| La app no lleva tildes fuera del catálogo | Se nota en cada pantalla | Pasada de texto |
| Reglas DGII y TSS "por confirmar" | Campo 15 del 606, 608, recargo de horas extra | Un contador y un abogado laboral |
| Móvil sin abrir en un teléfono; impresora térmica sin probar | Nadie lo ha usado con el aparato | Trabajo de campo |

### Resultado

| | 22 sep | 23 sep |
|---|---:|---:|
| Migraciones | 120 | **134** (0121–0135; la 0126 no existe) |
| Pruebas de base de datos | 1,099 | **1,342** en 96 archivos |
| Pruebas de la web (acciones reales y estáticas) | 15 de acciones | **319** en 38 archivos |
| Pruebas de lógica pura (paquetes) | 995 | **1,653** |
| Pantallas web | 172 | **179** |
| Rutas registradas | 158 | **159**, sin colisión |
| Módulos con captura real en el marketplace | 0 | **79** de 80 (`invoice-capture` no tiene pantalla) |
| Auditorías de la puerta | 3 | **4** (se sumó `audit:identidad`) |

Puerta `gate:f0` en verde con todo integrado: typecheck y lint en los 184
paquetes, las **3,314 pruebas**, y `audit:secrets`, `audit:identidad`,
`audit:registry` y `audit:manifests`. Las 134 migraciones aplican en orden
desde una base vacía, y la semilla de la demo también.

---

## Ronda 1 — 22 de septiembre de 2026

### Cómo se dividió

No todo `ESTADO.md` es código. Antes de repartir se separaron las dos
cosas, porque mandar un agente a resolver algo que no se resuelve
escribiendo código solo produce un informe que dice que lo intentó.

| Agente | Trabajo | De qué parte de `ESTADO.md` salía |
|---|---|---|
| `regb-db` | Que `tax_rates` alimente de verdad a los productos | Deuda |
| `regb-db` | Vigilar la moneda de una empresa dentro de un grupo | Deuda |
| `regb-qa` | Arnés para probar acciones de servidor reales | "Construido pero no probado" |
| `regb-docs` | Las 14 fichas de módulo que faltaban | Deuda |

Cada uno trabajó con **archivos propios** para no pisarse, y con números de
migración asignados de antemano (0118 y 0119). Detrás de cada uno, un
verificador con una sola misión: comprobar que lo que decía hecho lo
estaba — buscando pruebas que pasarían igual sin el arreglo, puertas
cerradas que dejan otra abierta, y afirmaciones que el código no respalda.

**Lo que no se repartió, y por qué:**

| Pendiente | Por qué ningún agente lo resuelve |
|---|---|
| Supabase en producción, Stripe/Azul, certificado DGII | Son credenciales tuyas |
| Cliente #1 en el mostrador | Es trabajo de campo |
| Probar el móvil y la impresora térmica | Hace falta el aparato físico |
| Consolidación por período | Pide una decisión contable: cómo cerrar el año |
| F11 enterprise y F12 verticales | Bajo demanda, por decisión del plan |

---

### Lo que resolvió cada uno

Los cuatro verificadores dieron veredicto **sólido**.

#### 1. La tasa de ITBIS por defecto ya se usa — `regb-db`

Los productos nuevos nacen con la tasa que el cliente marcó por defecto en
`/impuestos`, y con 18% si no tiene el módulo o no marcó ninguna. Nueva
función `public.tasa_itbis_por_defecto()` (migración 0118), que toma el
cliente del token y no de un parámetro.

La llaman los dos caminos que crean productos: la pantalla y la
importación CSV. Caja, pedidos y compras no hubo que tocarlos: ya copiaban
la tasa del producto.

Revisando el camino completo salieron **dos fallos más**, que corrigió:

- **Editar un producto lo devolvía al 18%.** Cada guardado escribía 0.18,
  así que un producto al 16% cambiaba de tasa solo con abrir la ficha y
  darle a guardar.
- **Las cotizaciones siempre iban al 18%**, incluidos los productos
  exentos: el formulario nunca mandaba la tasa y caía en el respaldo.

Lo que decidió **no** hacer: cambiar el default de columnas que usan 80
módulos, y reescribir la tasa de los productos existentes al cambiar la
tasa por defecto (recatalogar el inventario es decisión del cliente, no un
efecto secundario de marcar una casilla). La promesa del catálogo se
reescribió para decir exactamente esto. 16 pruebas nuevas.

#### 2. La moneda de una empresa en un grupo ya no se cambia — `regb-db`

Cerrada la puerta que había dejado abierta la consolidación. Un trigger
(migración 0119) impide cambiar la moneda de una empresa en dos casos:

- si aparece en un consolidado **cerrado** —aunque ya haya salido del
  grupo: la corrida cerrada sigue ahí—;
- si es miembro de un grupo que presenta en otra moneda.

La regla vale aunque el cliente tenga apagado el módulo de consolidación:
un módulo apagado no puede ser la forma de reescribir un consolidado
entregado. Una empresa que no está en ningún grupo cambia de moneda como
siempre.

#### 3. Las acciones de servidor ya se prueban de verdad — `regb-qa`

Hasta ahora varias pruebas de F6 copiaban el SQL de la acción dentro del
test. Si alguien rompía la acción, la prueba seguía en verde.

Ahora hay un arnés (`apps/web/vitest.config.ts` y `apps/web/src/test/`)
que llama a las **acciones reales**: pasa por el contexto de demostración,
el permiso, la RLS y las funciones SQL, contra la base de pruebas. Siembra
un cliente con nombre aleatorio y lo borra al terminar.

Con él, 15 pruebas nuevas sobre el cierre del IT-1 y la corrida de
consolidación. El agente **rompió cada acción a propósito** y comprobó que
la prueba se ponía roja antes de restaurarla.

#### 4. Las 14 fichas que faltaban — `regb-docs`

audit, auth, backup, branches, dashboard, files, imports,
invoice-capture, notifications, orgs, search, settings, tour y users.
Cada una salió de leer el manifiesto, las migraciones, las pantallas y las
pruebas; lo que no pudo verificar lo marcó como no verificado en vez de
cumplido.

Y al leer el código encontró cosas que nadie había visto — ver abajo.

---

### Lo que se arregló al integrar

Dos cosas que los agentes no dejaron bien y se corrigieron antes del
commit:

**Las pruebas del arnés estaban fuera de la puerta.** El agente las había
excluido de `pnpm test`, así que `gate:f0` no las corría. Una prueba que la
puerta no corre no protege nada: el objetivo era precisamente que quien
rompa la acción lo vea. Ahora corren en la puerta, junto a las de base de
datos, sin pisarse.

**Una bomba de tiempo en la bitácora.** El agente de fichas la encontró y
la dejó anotada, pero no podía esperar: `audit.log` está particionada por
mes y solo tenía particiones **hasta diciembre de 2026**. El 1 de enero,
cada escritura auditada —productos, facturas, cobros— habría fallado y
revertido su transacción: el ERP entero sin poder guardar, en todos los
clientes a la vez.

Migración 0120: particiones con **tres años de margen**. Y una prueba que
pone roja la puerta cuando queden menos de 12 meses — como la puerta se
corre a diario, el aviso llega con un año de margen, no el día del apagón.
Comprobado: roja antes de la migración, verde después.

También se hizo, fuera de los agentes:

- **Respaldo de la base**, verificado restaurándolo en una base desechable.
  El anterior era del 11 de septiembre.

---

### Lo que encontró el agente de fichas y queda pendiente

Leer el código para documentarlo destapó problemas reales. Están en la
tabla de hallazgos de [`docs/modules/README.md`](modules/README.md); estos
son los que más pesan:

| Hallazgo | Por qué importa |
|---|---|
| `memberships.role_id` y `branches.company_id`: clave foránea a una tabla con `tenant_id` **sin** la guarda que compara clientes | Es "el agujero de siempre". Hay que comprobar si un cliente puede apuntar a un rol o empresa de otro |
| El respaldo del cliente **no trae** ventas, facturas, inventario ni contabilidad, y el aviso le dice que sí | Un cliente que confía en ese respaldo puede perder datos creyendo que los tiene |
| `invoice-capture` está publicado con precio y no tiene ni una pantalla | Se estaría vendiendo algo que no existe |
| Importar lee `1,234` como 1.23 | Corrompe cantidades y precios en silencio |
| La invitación de usuarios no se envía e inventa un `user_id` | Invitar a alguien no funciona |
| Ningún módulo core emite los eventos que declara | Lo que dependa de esos eventos no ocurre |

Ninguno se mandó a arreglar en esta ronda porque no estaban en
`ESTADO.md`: salieron de ella. Son el candidato natural a la siguiente.

---

### Resultado

| | Antes | Después |
|---|---:|---:|
| Pruebas de base de datos | 1,067 | **1,099** |
| Pruebas de acciones de servidor | 0 | **15** |
| Migraciones | 117 | **120** |
| Fichas de módulo | 66 | **80** |
| Particiones de bitácora por delante | 3 meses | **36 meses** |

Puerta `gate:f0` en verde con todo integrado.

---

### En una línea

**Se cerró la deuda de código que se podía cerrar.** Lo que queda no se
arregla con agentes: credenciales, el Cliente #1 y hardware — más la lista
de hallazgos nuevos de arriba, que conviene resolver antes de que un
cliente real los encuentre.
