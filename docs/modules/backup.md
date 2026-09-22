# `backup` — Respaldos

**Que resuelve:** una copia de los datos maestros del cliente en JSON,
descargable, y un aviso honesto de **cuanto perderia hoy** si la base
desapareciera.

**Categoria:** `core` (§5.1 #15) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno ·
**Plataformas:** web ✔️ desktop ✔️ movil ✖️

---

> **Lee esto antes que el resto.** El respaldo de este modulo **no contiene
> ventas, facturas, cobros, compras, inventario ni contabilidad.** Contiene
> seis cosas: empresas, sucursales, roles, equipo, productos y configuracion.
> Ver "Lo que NO hace".

## El respaldo se arma bajo la RLS del que lo pide

`crearRespaldo()` ([`apps/web/src/app/respaldos/actions.ts`](../../apps/web/src/app/respaldos/actions.ts))
arma el snapshot con `jsonb_build_object` dentro de `asUser()`: el respaldo
**no puede contener nada que ese usuario no vea**. Se arma e inserta en una
sola sentencia, sin pasar por JavaScript.

Por que en una sola sentencia: la primera version lo traia a JS y lo
reenviaba con `${JSON.stringify(obj)}::jsonb`. postgres.js lo volvia a
serializar y Postgres guardaba un jsonb de tipo *string*. El archivo
descargado salia con comillas escapadas. Fijado en
`supabase/tests/jsonb-params.test.ts`.

## El estado se mide sobre el ultimo que SALIO

Un respaldo que vive en la misma base que respalda se pierde junto con ella.
Un cliente con cuarenta respaldos en pantalla y ninguno descargado esta a
cero, pero se siente cubierto.

Por eso [`0104_respaldo_salida.sql`](../../supabase/migrations/0104_respaldo_salida.sql)
agrega `downloaded_at`/`downloaded_by`, la descarga los marca **la primera
vez** (no se pisan despues), y `estadoDeRespaldos()`
([`packages/operations/src/respaldos.ts`](../../packages/operations/src/respaldos.ts))
calcula el aviso sobre esa fecha:

| Nivel | Cuando | Tono |
|---|---|---|
| `sin-respaldo` | No hay ninguno | peligro |
| `nunca-salio` | Hay, pero ninguno se descargo | peligro |
| `muy-viejo` | El ultimo que salio tiene ≥ 7 dias | peligro |
| `viejo` | ≥ 3 dias | aviso |
| `al-dia` | Menos de 3 dias | exito |

Los umbrales son fijos a proposito: un umbral configurable acaba puesto en el
valor que hace desaparecer el aviso.

No se guarda **a donde** se lo llevo: el navegador no lo dice, y un campo
"destino" que nadie llena se leeria como si fuera cierto.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/respaldos` | `backup.view` | Aviso de estado, lista de los ultimos 50, crear uno |
| `/respaldos/:id/descargar` | `backup.export` | Descarga el JSON y marca que salio |

```
┌─ Respaldos ─────────────────────────────── [Crear respaldo ahora] ┐
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │ ⚠ Tus respaldos no han salido de aqui                        │  │
│ │   Viven en la misma base que respaldan: un incendio, un robo │  │
│ │   o un ransomware se lleva las dos cosas.                    │  │
│ └──────────────────────────────────────────────────────────────┘  │
├───────────────────┬────────┬────────┬───────────────┬────────────┤
│ Fecha             │ Tipo   │ Tamano │ Fuera de aqui │            │
├───────────────────┼────────┼────────┼───────────────┼────────────┤
│ 22 sept 2026 9:10 │ Manual │ 14.2 KB│ [Solo aqui]   │ [Descargar]│
│ 11 sept 2026 17:02│ Manual │ 13.9 KB│ [Descargado]  │ [Descargar]│
└───────────────────┴────────┴────────┴───────────────┴────────────┘
```

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `backup.view` | Abre `/respaldos` |
| `backup.create` | Boton "Crear respaldo ahora" y su accion |
| `backup.export` | Descargar el JSON |
| `backup.edit`, `backup.delete` | Declarados; ninguna accion los usa |

## Eventos

No declara ni emite eventos.

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega |
| 2 | Migraciones + RLS probadas | ⚠️ solo la red de `isolation.test.ts` (RLS `enable` + `force` + politica). Sin prueba propia de aislamiento ni de la marca de descarga |
| 3 | Logica pura con cobertura | ✅ `respaldos.ts` — 8 pruebas: los cinco niveles, los dos umbrales en su borde, el titulo con el numero de dias |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ➖ no aplica: `platforms.mobile = false` |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `f13.respaldos` tiene 4 pasos |
| 8 | Datos demo | ❌ la siembra no crea respaldos: la pantalla arranca en `sin-respaldo` |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ➖ no tiene |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ⚠️ `/respaldos` paso la sonda de F4, pero el aviso de estado (0104) se agrego despues y no se volvio a medir |

## Lo que NO hace

- **Respaldar el negocio.** El JSON trae `empresas`, `sucursales`, `roles`,
  `equipo` (perfiles), `productos` y `configuracion`. **No** trae clientes,
  pedidos, facturas, NCF, cobros, inventario, compras, nomina ni asientos.
  Y sin embargo el aviso `muy-viejo` dice "eso es lo que perderias hoy
  mismo: mas de una semana de ventas, compras y cobros", y `al-dia` dice
  "eso es lo que perderias si la base desaparece": con un respaldo de hoy
  descargado, el cliente perderia igual todas sus ventas. **El aviso promete
  una proteccion que el archivo no da.** Es exactamente la creencia falsa
  que este modulo dice querer evitar, y se resuelve de una de dos formas:
  ampliar el snapshot a las tablas del negocio, o cambiar el texto para que
  diga lo que el archivo contiene. Ninguna de las dos es de documentacion.
- **Respaldos programados.** `kind = 'scheduled'` existe en la tabla y la
  pantalla vacia dice "en produccion ademas se genera uno automatico cada
  noche", pero no hay ninguna tarea que lo cree.
- **Restaurar.** No hay importacion del JSON ni restauracion a un punto en el
  tiempo, aunque el tour `f13.respaldos` diga "Pruebalo restaurando" y la
  descripcion del catalogo (0009) prometa "restauracion a un punto".
- **Sustituir el respaldo de la base.** `pnpm db:respaldar` (el que marca
  `pnpm alertas`) es otra cosa: un volcado de la base entera por parte del
  proveedor, no este modulo.
