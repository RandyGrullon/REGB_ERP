# Respaldos y restauración

> Un respaldo que nunca se restauró no es un respaldo: es un archivo con
> nombre bonito. Este documento existe para que restaurar sea un comando
> y no una improvisación con el cliente llamando.

Escrito el 11 de septiembre de 2026, cuando el proyecto llevaba 100
migraciones y **ninguna forma de recuperar nada**.

---

## Los tres comandos

```bash
pnpm db:respaldar            # crea un respaldo fechado y rota los viejos
pnpm db:verificar-respaldo   # restaura el último en una base desechable y compara
pnpm db:restaurar <archivo> --docker regb-test-db --sobre <base>   # restaura de verdad
```

Los respaldos caen en `respaldos/` (ignorada por git — una base de
clientes nunca va al repositorio).

## Por qué `pg_dump` y no un volcado propio

Reproducir en JavaScript el orden de dependencias, las secuencias, los
triggers y las políticas de RLS es exactamente el tipo de código que
parece funcionar hasta el día que hay que restaurar de verdad. La
herramienta oficial ya lo resuelve y se mantiene sola.

El formato es `custom` (`-Fc`): viene comprimido, permite restaurar
tablas sueltas y es el que entiende `pg_restore`. Un `.sql` plano se ve
más amigable y es peor en todo lo demás.

**No hace falta instalar Postgres en Windows.** Con `--docker
regb-test-db` se usa el `pg_dump` que vive dentro del contenedor.

## La parte que todo el mundo se salta

`pnpm db:verificar-respaldo` no revisa que el archivo exista ni que pese
algo. Hace lo único que prueba algo:

1. Crea una base desechable.
2. Restaura el respaldo ahí dentro.
3. Cuenta las filas de las tablas que de verdad importan y las compara
   contra la base viva.
4. Borra la desechable.

No se cuentan *todas* las tablas a propósito. Lo que le importa a un
negocio es que estén las ventas, el dinero y los comprobantes: si una
tabla de configuración viene distinta se nota poco; si falta un ticket
cobrado, alguien perdió plata.

```
tabla                              viva  restaurada
----------------------------------------------------
public.pos_sales                      0           0  ok
public.customer_invoices              3           3  ok
public.supplier_invoices              4           4  ok
public.inventory_movements           13          13  ok
public.products                      19          19  ok
regb.tenants                         10          10  ok

Respaldo verificado: la base "regb_test" se puede reconstruir de este archivo.
```

Verificado también al revés: con un archivo corrupto el comando dice
**"el respaldo no sirve"** y sale con código 1. Un verificador que sólo
sabe decir que sí no sirve de nada.

## Decisiones que no son obvias

- **La rotación borra los viejos DESPUÉS** de confirmar que el nuevo
  existe y no está vacío. Al revés —limpiar primero— un fallo de
  `pg_dump` dejaría al negocio sin respaldo viejo y sin respaldo nuevo.
- **Restaurar de verdad exige escribir el nombre de la base completo**
  (`--sobre regb_test`). No hay opción que lo adivine: es destructivo.
- **Dentro del contenedor la URL se traduce.** `localhost:55432` es el
  puerto publicado hacia afuera; adentro el Postgres está en
  `localhost:5432`. Sin esa traducción el respaldo falla con un
  "connection refused" que no explica nada.
- `pg_restore` avisa de objetos que ya existían. Eso **no** es un fallo,
  y por eso el script sigue y verifica el resultado en vez de abortar.

## Lo que falta

Esto es el mecanismo, no todavía la política. Falta:

- **Que corra solo.** Hoy alguien tiene que escribir el comando. Un
  respaldo que depende de que alguien se acuerde no es un respaldo.
  Toca una tarea programada (Windows) o un cron donde viva el servidor.
- **Que la copia salga de la máquina.** Un respaldo en el mismo disco
  que la base no protege del caso más común: que el disco muera.
- **Respaldo del Supabase real.** Estos comandos apuntan hoy al Postgres
  local de pruebas. Contra Supabase funcionan igual pasando
  `DATABASE_URL`, pero **no se ha probado todavía** contra el proyecto
  real.
- **Alertas.** Nadie se entera si un respaldo falla tres noches
  seguidas.
