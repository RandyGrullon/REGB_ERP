# Poner el primer cliente en producción

Qué hace falta, en orden, para que un negocio real empiece a usar REGB ERP
mañana. Nada de esto es código nuevo: el código está. Lo que falta es
**configurar y cargar datos**, y algunas cosas solo las puedes hacer tú
porque implican crear cuentas y credenciales.

Verificado contra el repo el 3 de agosto de 2026.

---

## Antes de empezar: qué está listo y qué no

| | Estado |
|---|---|
| Catálogo, inventario, pedidos, caja y cobros | ✅ funcionando |
| NCF, reportes 607 y 608, validación de RNC | ✅ funcionando |
| Lector de código de barras y ticket de 80 mm | ✅ funcionando |
| Aislamiento entre clientes (RLS) | ✅ con 136 pruebas |
| Responsive 375 / 768 / 1440 | ✅ 29 pantallas verificadas |
| **Inicio de sesión real** | ⚠️ el código está, falta configurarlo — [paso 1](#1-conectar-supabase) |
| **Cobro automático de la mensualidad** | ❌ pasarelas sin conectar — [paso 7](#7-cobrar) |
| App de escritorio y móvil | ❌ son F5 |
| Envío de e-CF a la DGII | ❌ es F6 |

**Se puede operar sin las tres últimas.** Un colmado factura con NCF en
papel y paga por transferencia; eso es exactamente cómo opera hoy la
mayoría en el país.

---

## 1. Conectar Supabase

Hoy la app corre en **modo demostración**: el cliente y el rol viajan en la
URL (`?tenant=…&rol=…`) y no hay contraseña. Eso es una vitrina, no un
sistema. `apps/web/src/lib/supabase.ts:38` lo decide con una sola condición:
si existen las dos variables de entorno, hay login real.

1. Crea un proyecto en Supabase y apunta `DATABASE_URL` a su Postgres.
2. Aplica las 32 migraciones sobre esa base, **desde cero y en orden**. No
   hay `down`: la garantía es que arranca limpia, y es la que se ejerce en
   cada `gate:f0`.
3. Crea `apps/web/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
DATABASE_URL=postgresql://…
```

4. **Registra el hook de token.** Sin esto nada funciona: es lo que mete
   `tenant_id` y `is_provider` en el JWT, y toda la RLS del sistema cuelga
   de ese claim. En el panel de Supabase, *Authentication → Hooks → Custom
   Access Token*, apunta a `auth.custom_access_token_hook`. La migración
   [`0008_auth_token_hook.sql`](../supabase/migrations/0008_auth_token_hook.sql)
   ya le dio el `grant` a `supabase_auth_admin`.

**Cómo saber que quedó bien:** entra con un usuario y abre `/perfil`. Si
ves tu rol y tus permisos, el claim llegó. Si recibes un 404, no llegó.

---

## 2. Darte de alta a ti como proveedor

Tú necesitas ver `/control`; el cliente no debe poder ni sospechar que
existe (`requireProvider()` devuelve 404, no 403).

```sql
insert into regb.provider_users (user_id, full_name, role, is_active)
values ('<tu-user-id-de-supabase>', 'Randy Grullón', 'owner', true);
```

Cierra sesión y vuelve a entrar: los claims se calculan al emitir el token,
no al vuelo.

---

## 3. Crear el cliente

Desde `/control/onboarding`, o directo:

```sql
insert into regb.tenants (slug, legal_name, trade_name, tax_id, tier, status)
values ('colmado-x', 'Colmado X SRL', 'Colmado X', '130111111', 'pyme', 'active');
```

El trigger `regb.on_tenant_created()` le crea solo los 14 roles y los
módulos core. **Usa el RNC real y correcto**: se valida con el dígito
verificador y un RNC malo hace rebotar el 607 completo el día 20.

Activa lo que compró en `regb.tenant_modules` — o desde el marketplace,
que es lo mismo con una pantalla delante.

---

## 4. Cargar sus datos

En este orden, porque cada paso depende del anterior:

1. **Empresa y sucursales** — `/empresas`, `/sucursales`. La razón social y
   el RNC salen impresos en cada comprobante.
2. **Catálogo** — `/importar` con un CSV. Prueba primero con 10 filas: si
   esas quedan bien, el resto también. Carga el **código de barras**, que es
   lo que hace que el lector sirva.
3. **Revisa el ITBIS** — 18% en casi todo, pero arroz, habichuela y plátano
   van exentos. Un impuesto mal puesto no se nota vendiendo; se nota
   declarando.
4. **Existencias iniciales** — `/inventory/movements` como ajuste de
   entrada **con su costo**. Sin costo, la valorización nace mal. Hazlo de
   noche o un domingo: cargar existencias mientras se vende garantiza que
   no cuadre.
5. **Clientes a crédito** — `/pedidos/clientes`, con sus días de crédito.
   Esos días son los que después deciden quién está en mora.

---

## 5. Cargar los NCF de la DGII

**Es lo que no puede faltar.** Sin una secuencia vigente no emite una
factura válida. Pedirle a la DGII una autorización nueva toma días.

En `/cobrar/ncf`, registra los rangos autorizados. Como mínimo:

- **B02** consumo — lo que se lleva quien pasa por el mostrador.
- **B01** crédito fiscal — para clientes con RNC que deducen el ITBIS.

La caja avisa al abrir si no hay secuencia, el ticket impreso dice *"sin
comprobante fiscal"*, y `/control/salud` te lo muestra a ti antes de que el
cliente lo note.

---

## 6. Crear sus usuarios

`/usuarios`. Un usuario por persona, **nunca uno compartido**: dos personas
en el mismo usuario dejan la bitácora inservible, y la bitácora es lo que
permite deshacer un error sin discutir de memoria.

Empieza con roles estrechos. Ampliar permisos toma un minuto; explicar un
descuadre, una tarde.

Que cada quien abra `/perfil` el primer día: ahí ve exactamente qué puede
hacer, y eso te ahorra la mitad de las llamadas de la primera semana.

---

## 7. Cobrar

`/control/facturacion` genera la factura del mes y calcula la mora, pero
**el cobro no está automatizado**: `regb.payment_attempts` acepta el
proveedor `manual`, y Stripe y Azul no están conectados.

Para el primer cliente eso sobra: emites la factura, cobras por
transferencia y registras el pago. Automatizarlo antes de tener a quién
cobrarle es construir para nadie.

---

## Lo que hay que mirar cada mañana

`/control/salud`, en ese orden:

1. **NCF en riesgo** — sin comprobantes no factura hoy.
2. **Respaldos atrasados** — solo duele el día que hace falta, pero ese día
   duele entero.
3. **Eventos atascados** — la única señal de error que persiste hoy.
4. **Impersonaciones abiertas** — si quedó una abierta, alguien está viendo
   datos que no son suyos.

Y `/control` con el filtro **"solo en riesgo"**: mora, silencio de más de
14 días, salud bajo 70 o un bloqueo de onboarding.

---

## Antes de cada despliegue

```bash
pnpm gate:f0
```

Typecheck, lint, 136 pruebas contra Postgres real y tres auditorías: que no
haya secretos en código de cliente, que el core no conozca módulos, y que
los manifiestos sean válidos y sin colisión de rutas.

Si tocas la base, además:

```bash
pnpm db:limpiar-pruebas
```

Lista los tenants que dejan las pruebas cuando el proceso muere a media, y
solo los borra con `--si`.

---

## Lo que va a fallar primero, y qué hacer

| Síntoma | Causa casi siempre | Dónde |
|---|---|---|
| «No me deja» | Un permiso que su rol no tiene | `/perfil`, sección *Qué puedes hacer* |
| El ticket sale sin NCF | No hay secuencia cargada o se agotó | `/cobrar/ncf` |
| El inventario no cuadra | Se cargaron existencias mientras se vendía | `/inventory/movements` — corregir con el movimiento contrario, nunca editando |
| El 607 rebota | Un RNC con el dígito mal | `/pedidos/clientes` — ahora se valida al guardar |
| La caja no cuadra | Vuelto mal dado o precio desactualizado | `/pos/shifts` — mirar el arqueo con el nombre del cajero |
| El cliente entra a un 404 | Su rol no tiene la ruta de inicio | ya resuelto: aterriza en la primera pantalla que sí puede abrir |
