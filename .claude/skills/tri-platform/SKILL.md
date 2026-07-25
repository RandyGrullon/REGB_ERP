---
name: tri-platform
description: Implementa una feature de REGB ERP coordinadamente en las tres plataformas — web (Next.js), desktop (Electron) y móvil (React Native) — colocando la lógica compartida en packages/ y solo lo específico en cada app. Úsalo cuando una feature deba existir en más de una plataforma o cuando haya que verificar paridad entre las tres.
---

# Implementar en las 3 plataformas — REGB ERP

Un cerebro, tres cuerpos. **70% del código es compartido.** Si escribes la misma regla dos veces, algo está mal.

## Paso 1 — Reparto

Antes de escribir nada, clasifica cada pieza de la feature:

| Va en                         | Qué                                                                  |
| ----------------------------- | -------------------------------------------------------------------- |
| `packages/core`               | Tipos, esquemas Zod, cálculos, reglas de negocio, máquinas de estado |
| `packages/sdk`                | Acceso a datos, queries, mutaciones, cola offline                    |
| `packages/permissions`        | Quién puede qué                                                      |
| `packages/config/tokens.json` | Colores, tipografía, espaciado                                       |
| `packages/ui`                 | Componente web                                                       |
| `packages/ui-native`          | Componente RN                                                        |
| `apps/web`                    | Ruta, layout, server actions, SEO                                    |
| `apps/desktop`                | IPC, impresión, offline SQLite, ventanas, atajos                     |
| `apps/mobile`                 | Navegación, cámara, GPS, push, biometría, gestos                     |

**Regla:** si una pieza podría vivir en `packages/`, vive en `packages/`. Sin excepciones.

## Paso 2 — Define el alcance por plataforma

En el manifest del módulo:

```ts
platforms: { web: true, desktop: true, mobile: true },
mobileScope: ['view', 'scan', 'approve'],   // el móvil NO hace todo
```

Declara explícitamente qué **no** hará cada plataforma y por qué. Es una decisión de producto, no una deuda.

| Feature típica             |     Web     |  Desktop  |       Móvil       |
| -------------------------- | :---------: | :-------: | :---------------: |
| CRUD completo              |     ✔️      |    ✔️     | solo lo del scope |
| Reportes complejos         |     ✔️      |    ✔️     |   solo consulta   |
| Impresión térmica/fiscal   |  ⚠️ agente  | ✔️ nativo |   ⚠️ bluetooth    |
| Escaneo con cámara         |     ✔️      |    ✔️     |     ✔️ óptimo     |
| Firma con el dedo          |     ⚠️      |    ⚠️     |     ✔️ óptimo     |
| GPS / geocerca             |     ⚠️      |     —     |        ✔️         |
| Offline completo           | parcial PWA |    ✔️     |        ✔️         |
| Aprobar desde notificación |     ✔️      |    ✔️     |     ✔️ óptimo     |

## Paso 3 — Orden de construcción

1. **`core`** — tipos, Zod, lógica, tests. Nada de UI.
2. **`sdk`** — queries y mutaciones, con soporte de cola offline.
3. **Web** — es la referencia visual y la base de Electron.
4. **Desktop** — reutiliza la web y añade solo lo nativo (IPC, impresión, offline SQLite).
5. **Móvil** — UI propia, solo `mobileScope`, diseñada para el pulgar.
6. **Verificación cruzada.**

## Paso 4 — Verificación de paridad

- [ ] La misma acción produce el mismo resultado en las 3
- [ ] Los mismos permisos se aplican en las 3 (y se validan en servidor)
- [ ] Los mismos mensajes de error, palabra por palabra
- [ ] Los mismos tokens de color (verifica que nadie hardcodeó un hex)
- [ ] La lógica se probó **una sola vez** en `core`, no tres veces
- [ ] Offline: mutación creada en móvil se sincroniza y aparece en web
- [ ] El tour existe y funciona en web y móvil

## Errores clásicos que debes cazar

| Error                                     | Corrección                                 |
| ----------------------------------------- | ------------------------------------------ |
| Cálculo duplicado en web y móvil          | Muévelo a `packages/core`                  |
| Validación solo en el cliente             | Toda validación existe también en servidor |
| Color hardcodeado en RN                   | Consúmelo de `tokens.json`                 |
| Móvil intentando replicar el ERP completo | Recorta a `mobileScope`                    |
| Electron reimplementando la UI web        | Debe reutilizar `apps/web`, ~95%           |
| Textos distintos entre plataformas        | Un solo archivo de i18n compartido         |

## Cierre

Reporta plataforma por plataforma: qué quedó implementado, qué quedó fuera por diseño, y qué falta. No declares paridad sin haber corrido la feature en las tres.
