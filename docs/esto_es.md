# Esto es: lo que resolvieron los agentes

> Registro de la ronda del **22 de septiembre de 2026**: se tomó
> [`ESTADO.md`](ESTADO.md), se separó lo que un agente puede resolver de lo
> que no, y se repartió entre agentes especializados del proyecto. Cada
> entrega pasó por un verificador escéptico antes de integrarse.

---

## Cómo se dividió

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

## Lo que resolvió cada uno

Los cuatro verificadores dieron veredicto **sólido**.

### 1. La tasa de ITBIS por defecto ya se usa — `regb-db`

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

### 2. La moneda de una empresa en un grupo ya no se cambia — `regb-db`

Cerrada la puerta que había dejado abierta la consolidación. Un trigger
(migración 0119) impide cambiar la moneda de una empresa en dos casos:

- si aparece en un consolidado **cerrado** —aunque ya haya salido del
  grupo: la corrida cerrada sigue ahí—;
- si es miembro de un grupo que presenta en otra moneda.

La regla vale aunque el cliente tenga apagado el módulo de consolidación:
un módulo apagado no puede ser la forma de reescribir un consolidado
entregado. Una empresa que no está en ningún grupo cambia de moneda como
siempre.

### 3. Las acciones de servidor ya se prueban de verdad — `regb-qa`

Hasta ahora varias pruebas de F6 copiaban el SQL de la acción dentro del
test. Si alguien rompía la acción, la prueba seguía en verde.

Ahora hay un arnés (`apps/web/vitest.config.ts` y `apps/web/src/test/`)
que llama a las **acciones reales**: pasa por el contexto de demostración,
el permiso, la RLS y las funciones SQL, contra la base de pruebas. Siembra
un cliente con nombre aleatorio y lo borra al terminar.

Con él, 15 pruebas nuevas sobre el cierre del IT-1 y la corrida de
consolidación. El agente **rompió cada acción a propósito** y comprobó que
la prueba se ponía roja antes de restaurarla.

### 4. Las 14 fichas que faltaban — `regb-docs`

audit, auth, backup, branches, dashboard, files, imports,
invoice-capture, notifications, orgs, search, settings, tour y users.
Cada una salió de leer el manifiesto, las migraciones, las pantallas y las
pruebas; lo que no pudo verificar lo marcó como no verificado en vez de
cumplido.

Y al leer el código encontró cosas que nadie había visto — ver abajo.

---

## Lo que se arregló al integrar

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

## Lo que encontró el agente de fichas y queda pendiente

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

## Resultado

| | Antes | Después |
|---|---:|---:|
| Pruebas de base de datos | 1,067 | **1,099** |
| Pruebas de acciones de servidor | 0 | **15** |
| Migraciones | 117 | **120** |
| Fichas de módulo | 66 | **80** |
| Particiones de bitácora por delante | 3 meses | **36 meses** |

Puerta `gate:f0` en verde con todo integrado.

---

## En una línea

**Se cerró la deuda de código que se podía cerrar.** Lo que queda no se
arregla con agentes: credenciales, el Cliente #1 y hardware — más la lista
de hallazgos nuevos de arriba, que conviene resolver antes de que un
cliente real los encuentre.
