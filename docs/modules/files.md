# `files` — Archivos

**Que resuelve:** un sitio para los documentos del negocio (contratos,
cedulas, facturas escaneadas) con papelera: nada se borra de verdad.

**Categoria:** `core` (§5.1 #11) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno ·
**Plataformas:** web ✔️ desktop ✔️ movil ✔️ (`mobileScope: view, upload`)

---

## Papelera, nunca borrado fisico

`public.files` ([`0016_core_platform.sql`](../../supabase/migrations/0016_core_platform.sql))
tiene `deleted_at`. "Enviar a la papelera" lo llena; "Restaurar" lo vacia.
Ninguna accion hace `delete`. Como la tabla lleva trigger `audit_me`, mandar
a la papelera queda en la bitacora como `delete` (ver [`audit`](audit.md)).

## El binario vive en la fila, con tope de 512 KB

La tabla tiene dos sitios para el contenido: `storage_key` (pensado para
Supabase Storage) y `content bytea` inline, con un `check` que limita el
inline a 524,288 bytes. **Hoy solo existe el camino inline:** `subirArchivo()`
escribe `content`, y ningun codigo escribe `storage_key`. El limite de 512 KB
lo impone el servidor antes de insertar y el error dice el tamano real
("Ese archivo pesa 830 KB y el limite es 512 KB").

## La descarga pasa por el mismo doble candado

`/archivos/:id/descargar` exige `files.view` en servidor y lee bajo RLS.
Adivinando ids no se descarga nada de otro tenant: la fila no existe bajo su
RLS. Un archivo en la papelera no se descarga.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/archivos` | `files.view` | Lista (200 mas recientes), busqueda por nombre, filtro por tipo, subir, enviar a papelera |
| `/archivos?papelera=1` | `files.view` | La papelera, con restaurar |
| `/archivos/:id/descargar` | `files.view` | Descarga el binario |

```
┌─ Archivos ────────────────────────────────────── [Papelera (1)] ─┐
│ ┌Archivos┐ ┌Espacio──┐ ┌En papelera┐                             │
│ │   12   │ │ 2.4 MB  │ │     1     │                             │
│ └────────┘ └─────────┘ └───────────┘                             │
│ [Nombre del archivo…]  Tipo [Todos v]                            │
│ ┌──────────────────────────────┐ ┌──────────────────────────────┐│
│ │ PDF Contrato-2026-Ferreteria │ │ IMG Cedula-Juana-Perez.jpg   ││
│ │     184.2 KB · 3 sept · Maria│ │     96.0 KB · 1 sept · Maria ││
│ │                         [🗑] │ │                         [🗑] ││
│ └──────────────────────────────┘ └──────────────────────────────┘│
│ [☁] [Elegir archivo…]                                   [Subir]  │
│  Hasta 512 KB por archivo en desarrollo; en produccion ...       │
└──────────────────────────────────────────────────────────────────┘
```

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `files.view` | Abre `/archivos` y descarga |
| `files.create` | Subir |
| `files.delete` | Enviar a la papelera |
| `files.edit` | Restaurar desde la papelera |
| `files.export` | Declarado; ninguna accion lo usa |

**Desajuste:** la pantalla muestra el boton de restaurar a quien tiene
`files.delete`, pero la accion exige `files.edit`. Un rol con `delete` y sin
`edit` ve el boton y recibe el error al pulsarlo.

## Eventos

| Evento | Cuando | Payload | Donde |
|---|---|---|---|
| `files.file.uploaded` | Al subir un archivo, en la **misma transaccion** que el `insert` | `{ fileId, mime, sizeBytes }` | `subir()` / `subirArchivo()` en [`archivos/actions.ts`](../../apps/web/src/app/archivos/actions.ts) |

- **Sin el nombre del archivo**: "cedula-maria-perez.pdf" es un dato
  personal y el evento puede viajar a un webhook de terceros. Tampoco el
  contenido. Quien lo necesite lo lee por el id, bajo RLS.
- Un archivo rechazado (vacio o de mas de 512 KB) no se guarda ni emite.
- Mandar a la papelera y restaurar **no** emiten: no hay tema declarado.
- Prueba: [`archivos.accion.test.ts`](../../apps/web/src/app/archivos/archivos.accion.test.ts),
  accion real contra `event_outbox`, que ademas comprueba que el nombre no
  aparece en el payload.

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega. `mobileScope` nombra `upload`, que no es ninguno de sus permisos |
| 2 | Migraciones + RLS probadas | ⚠️ solo la red de `isolation.test.ts` (RLS `enable` + `force` + politica). Sin prueba propia de aislamiento, papelera ni descarga |
| 3 | Logica pura con cobertura | ❌ `pinta()` y `tamano()` viven en la pagina, sin prueba |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ⚠️ `mobileScope` declarado; la app movil no tiene pantalla de archivos |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `f14.archivos` tiene 4 pasos |
| 8 | Datos demo | ❌ la siembra no crea archivos |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ✅ `files.file.uploaded` se emite al subir, sin nombre ni contenido; prueba de accion real contra el outbox |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/archivos` en la sonda de F4, tercera pasada sin fallos |

## Lo que NO hace

- **Archivos de mas de 512 KB, en ningun ambiente.** La nota de la pantalla
  ("en produccion el binario vive en Supabase Storage sin ese limite") describe
  algo que no esta construido: no hay codigo que suba a Storage.
- **Adjuntar un archivo a un registro.** El tour `f14.archivos` dice "el
  contrato con el cliente, la ficha con el producto" y "el permiso del archivo
  es el del sitio donde esta". La tabla no tiene `entity_id`: todos los
  archivos van a una lista unica, y los ve cualquiera con `files.view`.
- **Carpetas, versiones, OCR, previsualizacion.** Prometidos en §5.1 y en la
  descripcion del catalogo (0009); no existen.
- **Vaciar la papelera.** A proposito: nada se borra. Consecuencia: el
  espacio que ocupa lo borrado no se recupera nunca.
