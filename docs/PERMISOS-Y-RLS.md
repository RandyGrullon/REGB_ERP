# Permisos, RLS y lo que la base todavía no vigila

> La app comprueba el permiso antes de cada consulta. La base de datos,
> hasta hoy, solo comprueba el **cliente** y el **módulo**. Este
> documento existe para que esa diferencia sea una decisión conocida y no
> una sorpresa el día que alguien la encuentre.

Escrito el 13 de septiembre de 2026, al construir las primeras pantallas
móviles.

---

## 1. Por qué apareció esto ahora

Mientras el único cliente del sistema fue la app web, la diferencia no se
notaba: cada pantalla y cada acción del servidor llaman a `can()` antes
de tocar la base. La app estaba **siempre** en el medio.

La app móvil no funciona así. Habla con **PostgREST** —el API que
Supabase expone sobre el esquema `public`— usando la *anon key*, que es
pública por diseño, y el token del propio usuario. Ahí no hay servidor
nuestro en el medio: lo único que decide qué sale es la RLS.

Y la RLS no miraba el rol.

### Lo que se midió

Con el rol **Cajero** del tenant de demo, hablándole directo a la base:

```
select avg_cost from stock_levels  ->  620.0000, 411.5000
select count(*) from employees     ->  3
```

Las dos cosas que la app le esconde a ese rol.

De 370 políticas en `public`, **cero** mencionaban el rol o el permiso.
Todas tienen esta forma:

```sql
(tenant_id = rls.tenant_id()) and rls.module_active('<modulo>')
```

---

## 2. Lo que sí está cerrado (migración 0109)

Se añadieron dos helpers:

| Función                | Qué hace                                                     |
| ---------------------- | ------------------------------------------------------------ |
| `rls.role_id()`        | El `role_id` del token, o null                                |
| `rls.patrones_de(a)`   | Réplica exacta de `matchingPatterns()` de `@regb/permissions` |
| `rls.has_perm(accion)` | Réplica de `can()`: comodines + la denegación gana siempre    |

Y se aplicaron a **cuatro superficies**:

| Superficie                 | Permiso exigido      | Por qué esa                                    |
| -------------------------- | -------------------- | ---------------------------------------------- |
| Costo de inventario        | `inventory.cost.view`| El margen del negocio                          |
| `employees`                | `employees.view`     | Datos personales y salarios                    |
| `payroll_lines`            | `payroll.view`       | Lo mismo                                       |
| `api_keys`                 | `api-webhooks.view`  | Llaves de integración                          |
| `ecf_config`               | `e-invoice.view`     | Ahí vive el token de las URL públicas de e-CF  |

### Y lo que cerró 0115: contar

Las dos tablas de líneas de conteo se cerraron por otra vía, porque el
problema ahí no era solo de lectura:

| Tabla                | Cómo se cierra                | Permiso exigido       |
| -------------------- | ----------------------------- | --------------------- |
| `stock_count_lines`  | `public.contar()`             | `inventory.count`     |
| `cycle_count_lines`  | `public.contar_ciclico()`     | `stock-counts.count`  |

Se revocó el `UPDATE` directo sobre `counted_qty` (que 0106 había dejado
abierto) y se entra solo por la función. La función mira dos cosas que la
política no miraba: **quién** —el permiso— y **hasta cuándo** —que el
conteo siga abierto—.

Lo segundo solo faltaba en el conteo simple: el cíclico ya lo protegía un
trigger desde 0068. Lo primero faltaba en los dos, o sea que un cajero
con su token podía escribir lo contado vía PostgREST.

Importa porque cerrar un conteo convierte la diferencia en movimientos de
ajuste del kardex, y el kardex es inmutable (0107): cambiar lo contado
después deja el conteo diciendo una cosa y los ajustes otra, sin forma de
realinearlos.

### El caso del costo, que no fue directo

El costo es **una columna**, y la RLS filtra **filas**. Hicieron falta
dos cosas:

1. Quitarle a `authenticated` el permiso de `SELECT` sobre la columna
   `avg_cost`. Ojo con la forma: en Postgres `revoke select (col)` **no**
   puede restarle una columna a un `grant select` de tabla entera. Hay
   que revocar la tabla y reconceder columna por columna.
2. `public.existencias()`, una función `security definer` que sí puede
   leerla y la devuelve o la tapa según `rls.has_perm`.

**Es función y no vista a propósito.** Una vista que corre como su dueño
es el patrón que ya se coló dos veces en este repo (`dgii_607`,
`dgii_608`) y hay una prueba permanente que lo rechaza. Con
`security_invoker` tampoco servía: hereda los permisos de quien
pregunta.

Las **cantidades** no se tocaron. Un sistema que le esconde el stock al
que vende no se usa.

---

## 3. Lo que NO está cerrado

**Todo lo demás.** Un usuario autenticado de un tenant puede leer y
escribir, vía PostgREST, cualquier tabla de `public` que su tenant tenga
por módulo activo, **sin importar su rol**.

Ejemplos concretos de lo que eso significa hoy:

- Un cajero puede leer la lista completa de clientes con sus condiciones
  de crédito, aunque la app no se la enseñe.
- Un almacenista puede leer las órdenes de compra y los precios
  negociados con cada proveedor.
- Cualquiera puede leer la bitácora completa de su tenant.

Nada de eso cruza la frontera entre clientes —el aislamiento multi-tenant
sí está sólido y tiene 922 pruebas detrás— pero sí cruza la frontera
entre roles **dentro** de un cliente.

### Las tres formas de cerrarlo

| Opción                         | Coste     | Riesgo                                       |
| ------------------------------ | --------- | -------------------------------------------- |
| `has_perm` en las 370 políticas| Días      | Dejar fuera a un usuario legítimo             |
| No exponer PostgREST; solo RPC | Rediseño  | Cambia cómo se construye todo el móvil        |
| Dejarlo así y documentarlo     | Cero      | Es lo que hay hoy                             |

---

## 4. Una decisión que conviene entender

`rls.has_perm()` devuelve **true** cuando el token no trae `role_id`.

Es deliberado. Denegar por defecto convierte un despliegue con el auth
hook a medias —sesiones viejas, hook sin activar en el dashboard— en
"nadie puede trabajar". En una caja, un sábado, eso es peor que el
problema que arregla.

La puerta se cierra cuando el token trae el rol, que es el 100% de las
sesiones que abre el sistema hoy. Pero si algún día el hook deja de
poner `role_id` en `app_metadata`, **la protección desaparece en
silencio**. Conviene saberlo.

---

## 5. La trampa de replicar `can()` en SQL

`rls.patrones_de()` y `rls.has_perm()` son una **réplica** de
`@regb/permissions`. Es el mismo caso del costo promedio en 0019: un
trigger no puede llamar a TypeScript.

Si las dos implementaciones divergen, la base y la app opinan distinto
sobre quién puede qué, y manda la que conteste primero. Por eso hay una
prueba en `supabase/tests/inmutabilidad.test.ts` que compara los patrones
caso por caso.

**Si cambias `matchingPatterns()` o `can()`, cambia también el SQL.**
