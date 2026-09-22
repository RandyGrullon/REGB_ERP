# `dashboard` — Inicio

**Que resuelve:** la primera pantalla al entrar. Cuatro indicadores del
tenant, accesos rapidos y los widgets que aporta cada modulo activo.

**Categoria:** `core` (§5.1 #6) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno ·
**Plataformas:** web ✔️ desktop ✔️ movil ✔️ (`mobileScope: view`)

---

## El lienzo no sabe de quien son los widgets

Cada modulo declara sus widgets en su propio manifiesto
(`dashboardWidgets`). El registry los junta segun lo que el tenant tiene
activo, y el inicio pinta esa lista. Si un modulo se apaga, su widget
desaparece sin tocar esta pantalla: es la regla "el core no conoce los
modulos" (§2.2) aplicada al tablero.

Los datos de todos los widgets se cargan en **el mismo** `asUser()` que los
indicadores: una sola sesion de RLS para la pantalla que mas se abre del ERP.

## Quien no puede ver el inicio no recibe un 404

Un cajero no tiene `dashboard.view` ni lo necesita. Antes, su primera
pantalla del dia era un 404. `primeraRutaVisible()`
([`apps/web/src/lib/module-page.ts`](../../apps/web/src/lib/module-page.ts))
lo manda a la primera ruta que su rol **si** puede abrir, en el orden del
menu.

## El costo lo decide el servidor, no la consulta

Si el rol puede ver costos (`inventory.cost.view`) se decide con el mismo
`can()` que el resto de la web y se le pasa a los widgets. No se delega a
`rls.has_perm()` dentro de la consulta porque `asUser` no lleva `role_id`
en los claims, y en ese caso `has_perm()` dice que si a cualquiera (ver
`docs/PERMISOS-Y-RLS.md`).

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/` | `dashboard.view` | Indicadores, accesos rapidos, widgets y un diagnostico del registry |

```
┌─ Buenos dias, Maria  [MEDIANO] ───────────────────────────────────┐
│ ┌Usuarios act.┐ ┌Sucursales──┐ ┌Productos───┐ ┌Modulos act.┐     │
│ │      3      │ │  2         │ │   148      │ │    31      │     │
│ │con acceso   │ │ 1 empresa  │ │en catalogo │ │licenciados │     │
│ └─────────────┘ └────────────┘ └────────────┘ └────────────┘     │
│ [Invita a tu equipo] [Activa modulos] [Trae tus datos] [Tour]     │
│ ┌ stock-alerts ──────┐ ┌ inventory-value ──┐ ┌ ... ────────────┐  │
│ │ 4 bajo reorden     │ │ RD$ 1,284,500.00  │ │                 │  │
│ └────────────────────┘ └───────────────────┘ └─────────────────┘  │
│ > Diagnostico del registry: 24 modulos visibles · 0 no cargados   │
└───────────────────────────────────────────────────────────────────┘
```

Sin ningun tenant en la base, en vez del tablero sale la receta de arranque
(`docker start`, `migrate`, `seed:demo`).

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `dashboard.view` | Abre `/`; sin el, redirige a la primera ruta visible |
| `dashboard.create`, `dashboard.edit`, `dashboard.delete`, `dashboard.export` | Declarados; ninguna accion los usa |

## Eventos

No declara ni emite eventos.

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega |
| 2 | Migraciones + RLS probadas | ➖ no tiene tablas propias; lee las de otros bajo su RLS |
| 3 | Logica pura con cobertura | ➖ no tiene |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ⚠️ la app movil tiene su propio inicio (`apps/mobile/app/(app)/index.tsx`), que es un menu por permiso, no este tablero. Nunca abierto en un telefono segun `ESTADO.md` |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `f14.tablero` tiene 4 pasos |
| 8 | Datos demo | ✅ los indicadores salen de la siembra de los dos tenants demo |
| 9 | ≥2 widgets | ➖ es el lienzo: los widgets los aportan los demas modulos |
| 10 | Eventos documentados | ➖ no tiene |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/` en la sonda de F4, tercera pasada sin fallos |

## Lo que NO hace

- **Un tablero por usuario o por rol.** El tour `f14.tablero` dice "cada
  usuario arma el suyo" y §5.1 promete "home configurable por rol, widgets
  arrastrables". Hoy todos ven los mismos widgets, en el orden del registry,
  sin poder quitar ni mover ninguno.
- **Filtrar los accesos rapidos por permiso.** Las cuatro tarjetas
  ("Invita a tu equipo", "Activa modulos", "Trae tus datos", tutorial) salen
  a todo el que ve el inicio; si el rol no puede abrir el destino, el clic
  termina en 404.
- **Saludar segun la hora.** Dice "Buenos dias" siempre.
