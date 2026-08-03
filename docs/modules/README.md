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
| 2 | Migraciones + RLS probadas | ✅ | ✅ | ⚠️ | ✅ | ✅ |
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

**11 de 14 cumplidos o casi, 3 diferidos a F5.** Los ⚠️ están explicados en cada
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
- **RLS: falta `sales-orders`.** `products`, `inventory`, `pos` y `ar` tienen
  pruebas de aislamiento y módulo apagado. Los pedidos y sus líneas solo están
  verificados en el navegador con roles distintos, que no defiende de una
  regresión. Es el hueco que queda.

---

## Lo que encontraron estas pruebas

Escribir los tests de aislamiento **no fue un trámite**: destapó dos fugas
entre clientes en la capa fiscal que ninguna cantidad de uso de la aplicación
habría revelado, porque las dos requieren hablarle a la base directamente.

1. **`assign_ncf` aceptaba el tenant de otro.** La función es
   `security definer` —tiene que serlo— y recibía `p_tenant` sin comprobarlo
   contra `auth.tenant_id()`. Cualquier usuario autenticado podía agotarle los
   NCF a otro cliente y dejarlo sin poder facturar por días.

2. **Las vistas `dgii_607` y `dgii_608` se saltaban la RLS.** Una vista corre
   con los privilegios de su dueño salvo que lleve `security_invoker`. Como se
   crearon sin esa opción, `select * from public.dgii_607` devolvía las ventas
   de **todos** los clientes: RNC, montos y NCF incluidos.

Ambas corregidas en
[`0030_fuga_fiscal_entre_clientes.sql`](../../supabase/migrations/0030_fuga_fiscal_entre_clientes.sql).

La lección operativa: **toda vista nueva sobre una tabla con RLS necesita
`security_invoker = true`**, y toda función `security definer` que reciba un
`tenant_id` por parámetro tiene que validarlo ella misma.
