# Conectar Supabase, paso a paso

Esta guía deja REGB ERP funcionando con **inicio de sesión real** sobre un
proyecto de Supabase y la web en Vercel. Todo lo que dice se probó el
30 de septiembre de 2026 contra el Supabase completo corriendo en local
(CLI 2.109, Postgres 17, claves nuevas `sb_publishable_…`/`sb_secret_…`).
Se hizo el recorrido entero con sesiones reales: alta del proveedor, alta de
un cliente, invitación del dueño y del cajero por correo, una venta en la
caja y cerrar sesión. También se probó el aislamiento entre clientes por la
API, con tokens reales.

Si algo de aquí no coincide con lo que ves en el panel de Supabase (los
menús cambian de nombre de vez en cuando), el dato que importa es el mismo:
búscalo por la palabra en **negrita**.

---

## Lo que tienes que conseguir (la lista corta)

| #   | Qué                                                              | De dónde sale                                                                                                 | Dónde va                                                |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | **Project URL** (`https://<ref>.supabase.co`)                    | Supabase → botón **Connect**, o Project Settings → **Data API**                                               | `NEXT_PUBLIC_SUPABASE_URL` (Vercel y `.env.local`)      |
| 2   | **Publishable key** (`sb_publishable_…`)                         | Project Settings → **API Keys**                                                                               | `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel y `.env.local`) |
| 3   | **Contraseña de la base**                                        | La pones al crear el proyecto. Si no la tienes: Project Settings → **Database** → **Reset database password** | Dentro de las dos cadenas de conexión                   |
| 4   | Cadena **Transaction pooler** (puerto 6543)                      | Botón **Connect** → Connection string                                                                         | `DATABASE_URL` en Vercel                                |
| 5   | Cadena **Session pooler** (puerto 5432)                          | Botón **Connect** → Connection string                                                                         | `DATABASE_URL_MIGRACIONES` en tu `.env.local`           |
| 6   | Un **secreto para los cron**                                     | Lo inventas: `openssl rand -hex 32`                                                                           | `REGB_CRON_SECRET` y `CRON_SECRET` en Vercel            |
| 7   | Cuenta en **Resend** con tu dominio verificado y una **API key** | resend.com                                                                                                    | SMTP de Supabase (paso 5.5)                             |
| 8   | El **dominio** de la web (o la URL que te da Vercel)             | Tu registrador / Vercel                                                                                       | Site URL, Redirect URLs y el secreto `REGB_SITE_URL`    |
| 9   | Un **webhook** de Discord o Slack (opcional)                     | Ajustes del canal → Integraciones → Webhooks                                                                  | `ALERTAS_WEBHOOK` en Vercel                             |

La **Secret key** (`sb_secret_…`) **no la copies a ningún lado**. Solo la usa
la función que manda las invitaciones, y Supabase se la pasa sola.

---

## 1. Crear el proyecto

1. En [supabase.com](https://supabase.com) → **New project**.
2. **Name**: `regb-prueba` para la prueba y `regb-prod` para producción. Son
   proyectos separados: lo que rompas probando no toca a los clientes.
3. **Database password**: usa **Generate a password** y guárdala en tu gestor
   de contraseñas. La vas a necesitar en el paso 2.
4. **Region**: **East US (North Virginia)**, `us-east-1`, es la más cercana a
   RD. La región no se cambia después. **La web tiene que correr al lado de
   la base**: cada pantalla hace muchas consultas, y cruzar el país en cada
   una la vuelve lenta. `apps/web/vercel.json` dice la región de Vercel:
   `iad1` para `us-east-1`, `pdx1` para `us-west-2` (Oregón). El proyecto
   de prueba actual está en `us-west-2`, por eso hoy dice `pdx1`.
5. **Plan**:
   - **Free** para la prueba. Pausa el proyecto tras una semana sin uso y
     **no tiene respaldos**.
   - **Pro** para producción: respaldo diario de 7 días. El cómputo **Small**
     es el mínimo para PITR (paso 9).

> ¿Ya tienes el proyecto del 2 de septiembre? Ve primero a
> [Un proyecto que ya existe](#un-proyecto-que-ya-existe).

---

## 2. Copiar los valores y llenar un archivo

En tu PC, en la **raíz** del repositorio, copia `.env.example` a
`.env.local` y llena estas líneas:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
DATABASE_URL=postgresql://postgres.<ref>:<CLAVE>@aws-<n>-us-east-1.pooler.supabase.com:6543/postgres
DATABASE_URL_MIGRACIONES=postgresql://postgres.<ref>:<CLAVE>@aws-<n>-us-east-1.pooler.supabase.com:5432/postgres
```

El `.env.local` de la raíz lo leen los comandos `pnpm db:*`. La web **no** lo
lee, así que llenarlo no cambia nada de la demo en tu PC. No se sube al
repositorio.

**¿Por qué dos cadenas de conexión?**

| Cadena                 | Puerto                         | Para qué                                                      | Por qué                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Transaction pooler** | 6543                           | La web en Vercel (`DATABASE_URL`)                             | Vercel levanta muchas copias cortas de la web. Este pooler reparte pocas conexiones reales entre todas. No admite "sentencias preparadas", y por eso la app usa `prepare: false` (`apps/web/src/lib/db.ts`). Con esta cadena la app funciona tal cual. |
| **Session pooler**     | 5432                           | Migraciones, semilla y respaldos (`DATABASE_URL_MIGRACIONES`) | Los scripts sí usan sentencias preparadas: por el 6543 fallan con `prepared statement … does not exist`. Si les pasas la del 6543, se niegan con un mensaje.                                                                                           |
| Direct connection      | 5432 en `db.<ref>.supabase.co` | No la uses                                                    | Exige IPv6, y la mayoría de las redes en RD no lo tienen.                                                                                                                                                                                              |

Si algún día sirves la web desde un servidor propio siempre encendido, en
vez de Vercel, su `DATABASE_URL` es la del **Session pooler**.

En la cadena que copias, cambia `[YOUR-PASSWORD]` por la contraseña del
paso 1. Si la contraseña tiene `@`, `:` o `/`, escríbelos como `%40`, `%3A`
y `%2F`.

---

## 3. Crear la base (un comando)

```bash
pnpm install
pnpm db:preparar          # migraciones + datos de demostración
```

- `pnpm db:preparar` corre `pnpm db:migrar` y después `pnpm db:demo`.
- **En producción** corre solo `pnpm db:migrar`. `db:demo` crea clientes
  ficticios (Colmado La Esperanza, Distribuidora Caribe) y en producción
  sobran.
- `pnpm db:migrar` aplica **solo lo que falta**. Anota cada migración en
  `regb.migraciones_aplicadas` junto con una huella de su contenido. Si una
  migración ya aplicada cambió en el repo, avisa de **DERIVA** y no toca
  nada. Se puede correr las veces que quieras.
- No uses `supabase db push`: lleva un registro propio y los dos no se
  conocen (docs/defi-v1.md §4.4).

Si todo salió bien, termina así:

```text
N en el repo · 0 aplicadas · N pendientes
0001_schemas_and_helpers.sql ... OK
…
N migracion(es) aplicadas. La base esta al dia.
```

Después revisa la base con:

```bash
pnpm db:verificar-supabase
```

Ese comando solo lee. Comprueba el libro de migraciones, que el hook existe y
pone el cliente en el token, que la RLS cubre todas las tablas, los permisos
que no deben existir, pg_cron, las particiones de la bitácora y la zona
horaria. La línea del proveedor sale en rojo hasta el paso 7.

### Si tu red no deja conectar a la base

Muchas redes de empresa cortan los puertos de Postgres (5432 y 6543) y dejan
pasar la web. Se nota así: los comandos `pnpm db:*` se quedan esperando o
dicen `Connection terminated`, mientras el panel de Supabase carga normal.
Hay dos salidas:

- **Otra red.** La de tu casa, o el hotspot del celular: `pnpm db:migrar`
  desde ahí. Es lo más simple.
- **El SQL Editor del panel.** Va por la web, así que pasa. Primero genera
  los bloques:

  ```bash
  pnpm db:sql-para-editor
  ```

  Quedan en `supabase/.temp/sql-editor/`: `bloque-01.sql`, `bloque-02.sql`…
  (unos 7) y `demo-opcional.sql`. En Supabase → **SQL Editor** → **New
  query**, pega **cada bloque entero, en orden**, y pulsa **Run**. Cada uno
  termina diciendo `Bloque N aplicado`.

  - Si falla, **no se aplicó nada de ese bloque**: arregla y vuelve a pegar
    el mismo.
  - Si pegas uno que ya estaba aplicado, o te saltas uno, se niega y te dice
    cuál toca.
  - `demo-opcional.sql` es la semilla de demostración: pégala solo en el
    proyecto de prueba.
  - Anota lo mismo que `pnpm db:migrar`. El día que conectes desde otra red,
    `pnpm db:migrar` verá la base al día.

---

## 4. Data API (lo que queda expuesto en internet)

Project Settings → **Data API**:

- **Enable Data API**: encendido. La app móvil la usa.
- **Exposed schemas**: solo `public` (y `graphql_public`, que viene de
  fábrica). **No** agregues `regb` ni `audit`: son del proveedor y de la
  bitácora. La web no los necesita porque va directo a Postgres. Así está
  también `supabase/config.toml`.

---

## 5. Authentication

### 5.1 Quién puede entrar

Authentication → **Sign In / Providers**:

- **Allow new users to sign up**: **apagado**. Nadie se registra solo: al
  dueño lo invitas tú (PRIMER-CLIENTE §3) y al equipo lo invita el
  dueño desde `/usuarios`.
- Proveedor **Email**: **encendido**. Si lo apagas, nadie entra por correo:
  sale _"Email logins are disabled"_. Con la CLI pasa algo parecido:
  `[auth.email] enable_signup = false` apagaba el proveedor entero, y ya
  está corregido en `supabase/config.toml`.
- **Confirm email**: encendido.

### 5.2 Adónde vuelven los enlaces

Authentication → **URL Configuration**:

- **Site URL**: `https://erp.tu-dominio.do` (o la de Vercel,
  `https://<proyecto>.vercel.app`, mientras no tengas dominio).
- **Redirect URLs**, una por línea:
  - `https://erp.tu-dominio.do/auth/callback`
  - `https://erp.tu-dominio.do/auth/invitacion/**`
  - `regb://auth` (la app móvil)

Sin la línea de `/auth/invitacion/**`, Supabase ignora el destino del correo
de invitación, manda a la Site URL y el enlace de la invitación se pierde.

### 5.3 El hook que pone el cliente en el token (imprescindible)

Authentication → **Hooks** → **Add hook** → **Customize Access Token (JWT)
Claims** → tipo **Postgres** → esquema **`rls`** → función
**`custom_access_token_hook`** → **Create**.

Es `rls`, **no** `auth`: en Supabase el esquema `auth` no es nuestro
(PRIMER-CLIENTE.md §1). Sin el hook, la persona entra pero no ve nada: el
token sale sin cliente y la RLS no le deja ver ninguna fila.

### 5.4 Las plantillas de correo (en español y con el enlace correcto)

Authentication → **Emails** → **Templates**:

| Plantilla       | Asunto                             | Cuerpo                                                          |
| --------------- | ---------------------------------- | --------------------------------------------------------------- |
| **Invite user** | `Te invitaron a REGB ERP`          | Pega el contenido de `supabase/templates/invitacion.html`       |
| **Magic link**  | `Tu enlace para entrar a REGB ERP` | Pega el contenido de `supabase/templates/enlace-de-acceso.html` |

La de invitación **tiene que ser esa**. La plantilla de fábrica manda el
acceso en la parte de la URL que va después de `#`, y el servidor nunca la
ve. La nuestra lo manda como `token_hash` a `/auth/invitacion/<token>`, y
ahí se abre la sesión y se acepta la invitación.

### 5.5 SMTP propio (para que las invitaciones salgan de verdad)

El correo que trae Supabase es para pruebas: manda muy pocos correos por
hora y solo a miembros de tu equipo en Supabase. Con él, la invitación a un
cajero no le llega. Recomendación: **Resend**, que tiene plan gratis
(consulta los límites vigentes). Postmark o Amazon SES también sirven.

1. En [resend.com](https://resend.com): **Domains → Add domain**, con un
   subdominio tuyo (por ejemplo `correo.tu-dominio.do`).
2. Resend te da unos registros DNS: **SPF** (TXT), **DKIM** (TXT) y un
   **MX** de rebote. Cárgalos donde administras el dominio y espera a que
   Resend diga _Verified_.
3. Resend → **API Keys → Create API key** con permiso **Sending access**.
   Empieza por `re_`. Guárdala: solo se ve una vez.
4. En Supabase → Authentication → **Emails → SMTP Settings** → **Enable
   custom SMTP**:
   - **Sender email**: `no-responder@correo.tu-dominio.do`
   - **Sender name**: `REGB ERP`
   - **Host**: `smtp.resend.com` · **Port**: `465`
   - **Username**: `resend` · **Password**: la API key `re_…`
5. Authentication → **Rate Limits** → sube el límite de correos por hora
   (por ejemplo, a 100).
6. Pruébalo: invítate a un correo tuyo de Gmail desde `/usuarios` y
   confirma que llega a la bandeja principal y no al spam.

A Resend (o a quien elijas) le pides: el **host**, el **puerto**, el
**usuario**, la **contraseña o API key** y que **verifique tu dominio**
(SPF y DKIM). Sin el dominio verificado, los correos caen en spam o se
rechazan.

---

## 6. La función que manda las invitaciones (`invitar-usuario`)

Es la única pieza que usa la clave secreta, y la usa **solo** para mandar
el correo. Quién puede invitar lo decide la base (permiso `users.create`
del cliente). También cubre el caso del dueño recién dado de alta, que
todavía no tiene cuenta: abre su enlace, pulsa **Mandarme el correo para
entrar** y la invitación le llega a **su** correo (migración 0143).

Con la CLI, desde la raíz del repo:

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase functions deploy invitar-usuario --no-verify-jwt
npx supabase secrets set REGB_SITE_URL=https://erp.tu-dominio.do
```

- `<ref>` es lo que va antes de `.supabase.co` en la Project URL.
- `--no-verify-jwt` es **a propósito**. Las claves nuevas (`sb_publishable_…`)
  no son JWT, y quien abre el enlace del dueño no tiene sesión. La función
  valida contra la base en los dos casos.
- Si la CLI pide Docker y no lo tienes, agrega `--use-api`.
- `REGB_SITE_URL` es la dirección de la web. Con ella se arma el enlace del
  correo, y nunca con algo que venga en la petición.

**Sin CLI**, desde el panel:

1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre: `invitar-usuario`. Pega el contenido de
   `supabase/functions/invitar-usuario/index.ts` y despliega.
3. En los ajustes de la función, apaga **Verify JWT**.
4. En **Edge Functions → Secrets**, agrega `REGB_SITE_URL`.

Las claves (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`,
`SUPABASE_SECRET_KEYS`) las pone Supabase dentro de la función. No las
cargues tú: Supabase ni siquiera deja crear secretos que empiecen por
`SUPABASE_`.

---

## 7. Darte de alta como proveedor

1. Authentication → **Users** → **Add user** → **Create new user**: tu
   correo, una contraseña y marca **Auto Confirm User**.
2. Desde tu PC:

   ```bash
   pnpm db:alta-proveedor --correo tu@correo.do --nombre "Randy Grullón"
   ```

   Si tu red bloquea la base, pega esto en el **SQL Editor**:

   ```sql
   insert into regb.provider_users (user_id, full_name, role, is_active)
   select id, 'Randy Grullón', 'owner', true from auth.users where email = 'tu@correo.do'
   on conflict (user_id) do update set is_active = true;
   ```

3. Entra a la web con ese correo y esa contraseña. Te lleva sola a
   `/control`.

Después sigue con [PRIMER-CLIENTE.md](PRIMER-CLIENTE.md) §3, el alta del
cliente.

---

## 8. Vercel

1. **Add New → Project** → importa el repositorio de GitHub.
2. **Root Directory**: `apps/web`. El framework lo detecta solo (Next.js).
   `apps/web/vercel.json` ya dice cómo instalar y compilar el monorepo, en
   qué región correr (la de la base: `pdx1` para `us-west-2`, `iad1` para
   `us-east-1`) y qué crons programar.
3. **Node.js Version**: 22 (Project Settings → General).
4. **Environment Variables**, para Production y Preview:

   | Variable                        | Valor                                     |
   | ------------------------------- | ----------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | La Project URL                            |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | La publishable key (`sb_publishable_…`)   |
   | `DATABASE_URL`                  | La del **Transaction pooler** (6543)      |
   | `REGB_CRON_SECRET`              | Tu secreto de cron                        |
   | `CRON_SECRET`                   | **El mismo** valor que `REGB_CRON_SECRET` |
   | `ALERTAS_WEBHOOK`               | Opcional                                  |

   **No** pongas la clave secreta de Supabase ni `DATABASE_URL_MIGRACIONES`.

5. **Deploy**. Cuando tengas el dominio, agrégalo en **Settings → Domains**
   y actualiza la Site URL y las Redirect URLs (paso 5.2) y el secreto
   `REGB_SITE_URL` (paso 6).

**Los crons** (`apps/web/vercel.json`):

| Ruta                     | Cuándo                       | Qué pasa si no corre                                                                           |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `/api/eventos/despachar` | Cada minuto                  | No salen los asientos contables automáticos, ni las automatizaciones, ni los webhooks          |
| `/api/alertas`           | 11:00 UTC (7:00 a. m. en RD) | Nadie se entera de un NCF agotado o de eventos atascados. Manda el resumen a `ALERTAS_WEBHOOK` |

Vercel los llama con `Authorization: Bearer $CRON_SECRET`, y cada ruta
rechaza cualquier otra llamada.

> **Plan Hobby (gratis) de Vercel:** solo permite crons **una vez al día**,
> y el despliegue falla con _"Hobby accounts are limited to daily cron
> jobs"_. Hay dos salidas: **Pro** (lo recomendado para producción), o en
> la prueba cambiar el despachador a `0 10 * * *` y llamarlo cada minuto
> desde fuera (cron-job.org, con el encabezado
> `Authorization: Bearer <tu secreto>`).

La mora (`regb.apply_dunning()`, del día 5 a la suspensión) **no** se
programa a propósito. Los pagos se registran a mano (PRIMER-CLIENTE §7), y
una corrida automática suspendería a un cliente que pagó por transferencia
si nadie anotó el pago. Se corre desde `/control/facturacion`.

---

## 9. Respaldos

- **Free**: sin respaldos. Solo para probar.
- **Pro**: respaldo diario, 7 días. Está en Database → **Backups**.
- **PITR** (volver a cualquier minuto): Project Settings → **Add-ons** →
  **Point in time recovery**. Exige cómputo Small o mayor. Cuesta unos
  US$100 al mes por 7 días. Actívalo desde el primer cliente cuyas ventas
  vivan solo en REGB (docs/defi-v1.md §4.10).
- **Copia propia fuera de Supabase** (RESPALDOS.md): un proyecto nuevo es
  Postgres 17, y el `pg_dump` 16 de `regb-test-db` no le sirve. Usa el del
  Supabase local, que es 17:

  ```bash
  node --import ./scripts/entorno.mjs scripts/respaldo.mjs --docker supabase_db_regb-erp
  ```

- **pg_cron** (lo enciende la migración 0146): el día 1 de cada mes crea las
  particiones de la bitácora del año siguiente. Se revisa en el SQL Editor
  con `select jobname, schedule, active from cron.job;`.

---

## 10. Cómo saber que quedó bien

| #   | Prueba                                                                                    | Qué debe pasar                                                             |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | `pnpm db:verificar-supabase`                                                              | Todo `[ok]`                                                                |
| 2   | Entrar con tu usuario de proveedor                                                        | Te lleva a `/control`                                                      |
| 3   | Dar de alta un cliente de prueba (`/control/onboarding/nuevo`)                            | Te da el enlace del dueño                                                  |
| 4   | Abrir ese enlace en una ventana privada → **Mandarme el correo para entrar**              | Llega el correo _"Te invitaron a REGB ERP"_. Al tocarlo, entras como dueño |
| 5   | Como dueño, abrir `/perfil`                                                               | Dice **Tu rol: Owner** (el hook funciona)                                  |
| 6   | Invitar a un cajero desde `/usuarios`                                                     | Dice _Correo enviado_ y el correo llega (SMTP y función)                   |
| 7   | El cajero abre su correo                                                                  | Entra directo a la caja                                                    |
| 8   | Una venta en `/pos` y **Cerrar sesión**                                                   | La venta queda y vuelves al login                                          |
| 9   | Pedir un enlace de acceso en el login ("No recuerdo mi contraseña")                       | Llega y te deja dentro                                                     |
| 10  | Vercel → Settings → **Cron Jobs** → despachador → **Run**                                 | Responde 200. Sin el secreto responde 401                                  |
| 11  | `curl https://<ref>.supabase.co/rest/v1/products -H "apikey: <publishable>"` (sin sesión) | `401 permission denied`, nunca filas                                       |

Si en el 5 no ves tu rol, el hook no está encendido (paso 5.3). Cierra
sesión y vuelve a entrar después de encenderlo: los datos del token se
calculan al entrar.

---

## Un proyecto que ya existe

Esto es para el proyecto del 2 de septiembre, o cualquiera al que ya le
aplicaste migraciones.

1. Pon su cadena del **Session pooler** en `DATABASE_URL_MIGRACIONES` y
   corre:

   ```bash
   pnpm db:migrar --listar
   ```

2. Si dice **"N aplicadas · M pendientes"**, el proyecto ya tiene libro de
   migraciones. Corre `pnpm db:migrar` y queda al día. Si avisa **DERIVA**,
   para y pregunta: una migración ya aplicada cambió en el repo.
3. Si dice **"0 aplicadas"** pero la base ya tiene tablas, se migró a mano
   antes de que existiera el libro. Tienes dos caminos:
   - **Sin datos de clientes reales** (lo normal en una prueba): crea un
     **proyecto nuevo** y sigue esta guía desde el paso 1. Es lo más seguro:
     ese proyecto se migró con versiones viejas de las migraciones, las que
     fallaban con _permission denied for schema auth_.
   - **Con datos que no puedes perder**: averigua hasta qué migración se
     aplicó y dala por puesta con
     `pnpm db:migrar --marcar-hasta NNNN`. Después corre `pnpm db:migrar`.
     Una forma de averiguarlo: buscar la tabla más nueva que exista
     (`select to_regclass('public.<tabla>')`) y en qué migración se crea.
     Marcar de más se salta migraciones que nunca corrieron. Si dudas, mejor
     un proyecto nuevo y migrar los datos.

---

## Probarlo todo en tu PC antes (Supabase local)

Así se hizo la validación de esta guía. Hace falta Docker Desktop (en esta
máquina, `code/docker-arrancar.ps1` lo levanta).

```bash
npx supabase start                    # la primera vez baja las imágenes
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:preparar
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:verificar-supabase
```

En PowerShell, la línea es
`$env:DATABASE_URL='postgresql://…'; pnpm db:preparar`.

- **Studio** (el panel local): <http://127.0.0.1:54323>. Ahí están
  Authentication → Users → Add user para crear tu proveedor.
- **Correos** (Mailpit): <http://127.0.0.1:54324>. Ahí caen las invitaciones
  y los enlaces de acceso: nada sale a internet.
- **Claves locales**: son las de ejemplo de la CLI, iguales en todas las
  máquinas y **solo** para el stack local. `npx supabase status` las
  muestra (una `sb_publishable_…` y una `sb_secret_…`). No se copian aquí:
  un texto con forma de clave secreta hace que GitHub frene el push.
- `supabase/config.toml` ya trae el hook, el registro cerrado, las
  plantillas en español, las URL del 3100 y del 3150, y la función con
  `verify_jwt = false`. `npx supabase start` **no** aplica las migraciones
  (`[db.migrations] enabled = false`): hay un solo camino, `pnpm db:migrar`.
- El secreto local de la función va en `supabase/functions/.env` (copia
  `supabase/functions/.env.example`).

**Una segunda web con inicio de sesión real**, sin tocar la demo del 3100 y
sin crear `apps/web/.env.local`:

```bash
cd apps/web
REGB_NEXT_DIST_DIR=.next-3150 \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY='<la sb_publishable_ que muestra npx supabase status>' \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
npx next dev -p 3150
```

`REGB_NEXT_DIST_DIR` hace que las dos instancias no compartan la carpeta
`.next`. Next agrega esa carpeta al `include` de `apps/web/tsconfig.json` y
cambia `next-env.d.ts` al arrancar: no subas esos dos cambios.

---

## Qué se corrigió para que esto funcione (30 sep 2026)

Para quien mantenga el código:

- **Migraciones 0143–0146**:
  - **0143**: el dueño que sale del alta puede pedir su correo desde el
    enlace.
  - **0144**: se quitaron los TRUNCATE/TRIGGER/REFERENCES/MAINTAIN que
    Supabase da a `anon` y `authenticated`, y el libro de migraciones quedó
    con RLS.
  - **0145**: 18 funciones SECURITY DEFINER devolvían o escribían datos de
    otro cliente por `/rest/v1/rpc` (algunas sin sesión). Ahora tienen
    guarda.
  - **0146**: pg_cron para las particiones de la bitácora.
- **Middleware**:
  - Las rutas de cron ya no se mandan al login.
  - Cortado el bucle `/` ⇄ `/login` del proveedor y de quien no tiene
    cliente.
  - `siguiente` solo acepta rutas de la app.
- **Login**: el enlace de acceso no intenta crear cuentas, codifica
  `siguiente` y los errores salen en español.
- **`/sin-acceso`**: en modo demostración ya no da 500.
- **`scripts/aplicar-migraciones.mjs`**: la huella ignora CRLF/LF, que antes
  daba DERIVA según la copia de Windows.
- **Nuevo**: `apps/web/vercel.json`, `/api/alertas`, `pnpm db:migrar`,
  `db:demo`, `db:preparar`, `db:alta-proveedor`, `db:verificar-supabase`,
  `db:sql-para-editor`, y los `.env.example` de la raíz, la web, el móvil y
  la función.
