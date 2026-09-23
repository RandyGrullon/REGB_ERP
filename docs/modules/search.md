# `search` — Busqueda global

**Que resuelve:** `Ctrl+K` (o `Cmd+K`) desde cualquier pantalla abre un
buscador de modulos, acciones, productos, companeros y ayuda, para no
navegar por menus.

**Categoria:** `core` (§5.1 #7) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno ·
**Plataformas:** web ✔️ desktop ✔️ movil ✔️ en el manifiesto
(`mobileScope: view`)

---

## Sin rutas propias: vive en el Shell

El manifiesto declara `routes: []`. El buscador es el componente
`GlobalSearch` ([`apps/web/src/components/GlobalSearch.tsx`](../../apps/web/src/components/GlobalSearch.tsx)),
que el Shell pinta en la barra superior de toda pantalla de modulo.

## El indice llega hecho del servidor

`buildSearchIndex()` ([`apps/web/src/lib/module-page.ts`](../../apps/web/src/lib/module-page.ts))
arma la lista en cada carga de pagina y el navegador solo filtra sobre ella:

| Tipo | De donde sale | Filtro |
|---|---|---|
| Modulo | Las rutas del menu **ya resuelto por rol** | El rol |
| Accion | Siete accesos fijos ("Invitar a alguien", "Abrir una sucursal"…) | Solo que el modulo este licenciado |
| Registro | Hasta 50 productos activos y 50 nombres de companeros, bajo RLS | Solo que el modulo este licenciado |
| Ayuda | Tres tours del core | Que `tour` este licenciado |

La coincidencia es "contiene", sin acentos ni mayusculas
(`normaliza()`): `codigo` encuentra `Código`. Muestra 8 resultados sin
escribir nada y hasta 10 al escribir. Flechas para moverse, Enter para ir,
Esc para cerrar.

## Pantallas

Superposicion, no pantalla:

```
┌──────────────────────────────────────────────────────┐
│ 🔍 arroz                                        Esc  │
├──────────────────────────────────────────────────────┤
│ REGISTRO  Arroz Selecto 5 lb                         │
│           Producto · A1                              │
│ REGISTRO  Arroz Premium 10 lb                        │
│           Producto · A7                              │
└──────────────────────────────────────────────────────┘
```

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `search.view`, `.create`, `.edit`, `.delete`, `.export` | Declarados; **ninguno se comprueba**. El buscador sale a todos |

## Eventos

No declara ni emite eventos, **a proposito**: `Ctrl+K` solo lee un indice
armado en el servidor y navega. No escribe nada. Emitir "alguien busco X"
mandaria a webhooks lo que la gente escribe en el buscador, que puede ser
un nombre o una cedula.

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega |
| 2 | Migraciones + RLS probadas | ➖ no tiene tablas; lee `products` y `user_profiles` bajo su RLS |
| 3 | Logica pura con cobertura | ❌ el filtro y `normaliza()` viven dentro del componente, sin prueba |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega. El boton de la barra se oculta bajo `sm`; en pantallas pequenas solo queda el atajo de teclado |
| 5 | UI movil | ⚠️ la app movil no tiene buscador |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `f14.busqueda` tiene 4 pasos |
| 8 | Datos demo | ✅ indexa los productos y el equipo sembrados |
| 9 | ≥2 widgets | ➖ no aplica |
| 10 | Eventos documentados | ➖ no aplica: modulo de solo lectura; razon en "Eventos" |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ⚠️ no medido: la sonda de F4 recorre rutas y el buscador no tiene ruta. Tiene `role="dialog"`, `aria-modal`, `role="listbox"` y `aria-selected`, pero no atrapa el foco dentro del dialogo |

## Lo que NO hace

- **Respetar el permiso en acciones y registros.** El componente dice que "el
  indice llega ya filtrado… solo contiene lo que este rol puede ver", y el
  tour `f14.busqueda` dice "no va a mostrarte lo que la pantalla te oculta".
  Es cierto para los modulos, no para lo demas: acciones y registros se
  filtran por **licencia**, no por rol. Un cajero sin `users.view` encuentra
  por nombre a todo el equipo, y una accion como "Invitar a alguien al
  equipo" aparece aunque el rol no pueda abrir `/usuarios` (el clic termina
  en 404). Los productos salen con nombre y SKU, sin precio ni costo.
- **Dos acciones que nunca aparecen.** "Crear un rol o cambiar permisos"
  exige el modulo `rbac` y "Activar un modulo nuevo" exige `marketplace`;
  ninguno de los dos es un modulo del registry, asi que esas dos entradas no
  salen nunca (el mismo error que `tours.test.ts` ya encontro en los tours).
- **Buscar clientes, facturas, RNC o numeros de documento.** El tour dice
  "escribe un cliente, un numero de factura o un producto" y "el RNC o el
  numero". El indice solo tiene productos y companeros.
- **Busqueda en toda la base.** Son 50 productos y 50 personas, ordenados
  por nombre: con un catalogo de 3,000 productos, el que empieza por "Z" no
  se encuentra. No hay texto completo ni busqueda difusa, que prometen §5.1
  y el catalogo.
- **Ser barato.** El indice se reconstruye con dos consultas en **cada**
  carga de cualquier pantalla de modulo, se use el buscador o no.
