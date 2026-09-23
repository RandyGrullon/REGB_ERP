---
name: aurora-ui
description: Genera o revisa componentes y pantallas de REGB ERP (web y React Native) con el lenguaje visual de Apple que usa el proyecto desde el 23 sep 2026, con tokens correctos, todos los estados y accesibilidad AA. Úsalo cuando se pida crear o revisar un componente de UI, una pantalla, un mockup o auditar el estilo de la app.
---

# Diseño de REGB ERP — lenguaje Apple

Desde el 23 de septiembre de 2026 REGB ERP usa el lenguaje de Apple. **La
fuente de las reglas es la skill `apple-design-system`** (`.claude/skills/
apple-design-system/`): léela primero. Este archivo solo dice cómo se
aterriza en ESTE repo.

> El nombre "Aurora" sobrevive en los identificadores del código por no
> tocar 170 pantallas. La identidad Aurora anterior —oscuro por defecto,
> teal como marca— ya no existe.

## Las 8 reglas, en corto

Un solo acento azul · botones en píldora · cero sombras · pesos 400/600/700
(el 500 prohibido) · líneas finas, no bordes gruesos · radios de la escala ·
aire alrededor del contenido · diálogos y hojas al estilo Apple.

## Dónde vive cada cosa

- **Colores, radios, sombras, tipografía:** `packages/config/tokens.json`,
  temas `light` y `dark`. Se genera `tokens.css` con
  `pnpm --filter @regb/config build`. Web, escritorio y móvil leen de ahí.
- **Nunca un hex en un componente.** Siempre `var(--color-...)` en web y
  `useTema()` en móvil. `packages/ui-native/src/aurora.test.ts` falla si
  aparece uno.
- **Tema por defecto: oscuro, claro a un clic** (decisión del 23 sep 2026).
  El oscuro usa los tiles de Apple (#1D1D1F, #272729); el claro es el
  lienzo de Apple. `apps/web/src/app/layout.tsx` pinta `data-theme` desde
  la cookie `regb-tema` (`apps/web/src/lib/tema.ts`) y `TemaToggle` la
  cambia; está en el Shell y en las pantallas sin Shell (marketplace,
  roles, REGB Control). Lo que solo existe en un tema se marca con
  `.tema-si-oscuro` / `.tema-si-claro` (`globals.css`). Todo componente
  nuevo se revisa en los dos.

## Lo que se adaptó para un ERP (y por qué)

| Regla de Apple | En REGB | Motivo |
|---|---|---|
| Cuerpo 17px | Cuerpo **14px** | La escala de Apple es para páginas de producto; a 17px las tablas de montos no caben |
| Rojo `#FF3B30`, verde `#34C759` | En claro, rellenos y texto con variantes de alto contraste (`#D70015`, `#1E7A34`). En oscuro, los vivos (`#FF453A`, `#30D158`) y texto aún más claro (`#FF6961`) | En claro, los vivos con blanco encima dan 2–3:1. En oscuro pasa al revés: los de alto contraste desaparecen sobre el fondo (2.8:1) |
| Gris de texto `#7A7A7A` | `#6E6E73` en claro, `#98989D` en oscuro | El de la guía da 4.3:1 sobre blanco; el `#86868B` de Apple, 4.1:1 sobre tarjeta oscura |
| Hover del botón `#0077ED` (oscuro) | `#0068D6` | Con texto blanco, el de Apple da 4.3:1 |

Todo lo anterior lo vigila `packages/config/src/contrast.test.ts`: si un
color nuevo no llega a AA, la puerta se pone roja. No bajes el umbral para
que pase — cambia el color.
| Un solo acento | La zona del proveedor (REGB Control) se marca con la barra negra/clara, no con un segundo color | Antes era ciruela |
| Inter fuera de Apple | SF Pro en Apple (`-apple-system`), Inter en el resto, servida desde node_modules | La caja tiene que funcionar sin internet |

## Atajos que ya están resueltos en la hoja base

`packages/ui/src/styles.css` remapea en un solo sitio lo que Apple prohíbe:

- `font-medium` pinta **600** (había 327 usos del peso 500).
- Todas las utilidades `shadow-*` quedan en `none`.

No hace falta, por tanto, buscarlos a mano. Sí hay que respetar la regla
al escribir código nuevo: usa `font-semibold` y no pongas sombras.

## Botones

- `Button` de `@regb/ui` ya es píldora en todos los tamaños.
- Un botón hecho a mano (`<button>`, `BotonEnvio`, enlace de acción) lleva
  `rounded-full`. Los contenedores con fondo azul que NO son acciones —el
  logo, insignias, barras de progreso— no.

## Qué entregas por componente

1. Versión web en `packages/ui/` (React + Tailwind + CVA).
2. Versión native en `packages/ui-native/`, con los mismos tokens.
3. Todos los estados: reposo, hover, foco visible, activo, deshabilitado,
   cargando, error y vacío.
4. Contraste AA comprobado en los dos temas.
