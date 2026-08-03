# Fichas de módulo

Una por módulo entregado. Cada una responde lo mismo: qué hace, qué tablas
toca, qué decisiones se tomaron y **qué falta** — con los 14 puntos de la
Definición de Terminado (§15.4) marcados uno por uno.

Los puntos que dependen de Electron o Expo aparecen como **diferidos a F5**,
no como cumplidos. Se marcan así a propósito: F4 no puede cumplirlos porque
esas apps se construyen en F5, y declararlos hechos sería mentir en el único
documento donde alguien va a buscar la verdad.

| Módulo | Qué resuelve | Ficha |
|---|---|---|
| `products` | Qué vendes, a qué precio, con qué impuesto | [products.md](products.md) |
| `inventory` | Cuánto tienes, cuánto vale, por qué cambió | [inventory.md](inventory.md) |
| `sales-orders` | Vender a crédito con el stock apartado | [sales-orders.md](sales-orders.md) |
| `pos` | Vender al contado en el mostrador | [pos.md](pos.md) |
| `ar` | Cobrar y declarar | [ar.md](ar.md) |

Contexto transversal en [../HARDWARE-Y-DGII.md](../HARDWARE-Y-DGII.md): qué
hardware funciona hoy y qué parte de la DGII está conectada.

## Estado de los 14 puntos, de un vistazo

| # | Punto | products | inventory | sales-orders | pos | ar |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 1 | `manifest.ts` completo | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | Migraciones + RLS probadas | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 3 | Lógica pura con cobertura | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 4 | UI web responsive | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | UI móvil | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 |
| 6 | Desktop verificado | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 |
| 7 | Tour ≥6 pasos | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | Datos demo | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9 | ≥2 widgets | ✅ | ✅ | ✅ | ✅ | ✅ |
| 10 | Eventos documentados | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | Precio en los 3 tiers | ✅ | ✅ | ✅ | ✅ | ✅ |
| 12 | E2E en 3 plataformas | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 | 🔜 F5 |
| 13 | Ficha en `docs/modules/` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 14 | Accesibilidad AA | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |

**11 de 14 en camino, 3 diferidos a F5.** Los ⚠️ están explicados en cada
ficha; ninguno es un "casi": o falta la prueba automatizada, o falta la
auditoría formal.

### Deuda declarada, común a los cinco

- **Migraciones sin `down`.** El runner es forward-only y ninguna de las 28
  tiene rollback. Se sustituye por *"la migración se prueba desde base
  limpia"*, que es la garantía que de verdad se ejerce en cada `gate:f0`.
- **Cobertura sin medir.** `@vitest/coverage-v8` no está instalado, así que
  el ≥80% del punto 3 **no está verificado**. Lo que sí hay son 107 tests de
  dominio en `@regb/operations`. Instalar el reporter es trabajo de una
  tarde y hasta entonces el número no se afirma.
- **Accesibilidad sin auditar.** Se usaron `aria-label`, `role="alert"`,
  foco visible y contraste del design system, pero **no** se pasó axe ni un
  lector de pantalla. Marcarlo ✅ sin correr la herramienta sería inventar.
- **RLS sin test por módulo.** Solo `products` tiene pruebas de aislamiento
  y módulo apagado (`supabase/tests/products.test.ts`). Las tablas de
  inventario, pedidos, caja y cobros llevan las mismas políticas escritas a
  mano y verificadas en el navegador con roles distintos, pero no hay una
  prueba automatizada que lo defienda de una regresión.
