# Estado del proyecto

> **Qué está hecho, qué falta y por qué.** Este es el único documento del
> repo que dice en qué punto está REGB ERP. El resto dice qué se va a
> construir (`PROYECTO-REGB-ERP.md`) y en qué orden (`FASES-DE-DESARROLLO.md`).

**Última verificación: 22 de septiembre de 2026**, contra el repo y no de
memoria. Cada número de abajo dice cómo volver a comprobarlo.

---

## En una línea

**El código está prácticamente terminado. Lo que falta no es código:** es
poner al primer cliente a facturar, y eso depende de credenciales y de
trabajo de campo.

```
Plan base  ███████████████████████████████████████░  ~115 / 119 sp · 97%
Módulos    ████████████████████████████████████████    80 / 80 del plan base
```

El plan base es F0–F11. Los **11 verticales** (restaurante, clínica,
hotel…) se sacaron a una fase final aparte, **F12, bajo demanda**: solo se
construyen cuando un cliente de ese rubro los pide. No cuentan como
pendientes porque no lo son.

Lo que falta del plan base es la parte enterprise de F11 —ver abajo—, que
tampoco hace falta para una PYME.

---

## Los números

| | Valor | Cómo comprobarlo |
|---|---:|---|
| Módulos construidos | **80**: todos los del plan base | `ls modules`, y compararlo con el catálogo de `FASES` |
| Migraciones | **120** | `ls supabase/migrations` |
| Pruebas de base de datos | **1,099** en 85 archivos | `pnpm gate:f0` |
| Pruebas de acciones de servidor | **15**, llamando a la acción real | `pnpm gate:f0` |
| Pruebas de lógica pura | **995** en 74 archivos | `pnpm gate:f0` |
| Pantallas web | **172** | `find apps/web/src/app -name page.tsx` |
| Rutas registradas | **158**, sin colisión | `pnpm audit:manifests` |
| Pantallas móvil | **11** | `apps/mobile/app` |
| Commits | **160**, desde el 24 jul 2026 | `git log` |

La puerta `pnpm gate:f0` (typecheck + lint + pruebas + 3 auditorías) está
**en verde**. `pnpm sonda:rutas` abre las 118 rutas con tres roles sin
ninguna pantalla rota.

---

## ✅ Hecho

| Fase | Qué es | Estado |
|---|---|---|
| **F0** | Monorepo, Supabase, auth, RLS, sistema de diseño Aurora | ✅ |
| **F1** | Máquina de módulos: registry y bus de eventos | ✅ |
| **F2** | Los 15 módulos core y la app web | ✅ |
| **F3** | REGB Control: motor de precios, facturación, mora | ✅ |
| **F4** | MVP comercial: productos, inventario, pedidos, caja, cobros | ✅ código |
| **F5** | Escritorio (Electron) y móvil (Expo) | ✅ código · ⚠️ ver abajo |
| **F6** | Finanzas y fiscalidad DGII, 11 módulos | ✅ código |
| **F7** | RRHH y nómina, 10 módulos | ✅ |
| **F8** | Suministro y producción, 18 módulos | ✅ |
| **F9** | Ventas avanzado, BI e IA, 16 módulos | ✅ |
| **F10** | Proyectos, 5 módulos | ✅ |
| **F11** | Enterprise | 🟡 1 de 5 — ver abajo |
| **F12** | 11 verticales | ⬜ bajo demanda, fuera del plan base |

### Lo último que se hizo

- **Ronda de agentes sobre este documento** (22 sep): tasa de ITBIS por
  defecto en productos nuevos, moneda de empresas en grupos, arnés de
  pruebas para acciones de servidor, las 14 fichas que faltaban, y una
  bomba de tiempo desactivada en la bitácora. Detalle en
  [`esto_es.md`](esto_es.md).

- **Alertas** (`pnpm alertas`): el sistema avisa en vez de esperar a que
  alguien abra `/control/salud`. Cierra la mitad del blindaje que faltaba.
- **F6 cerrada**: `taxes` y `consolidation`, más 20 arreglos que encontró
  una revisión adversarial — entre ellos que se podía **fabricar** una
  declaración fiscal con un saldo a favor inventado.
- **Sonda de rutas** (`pnpm sonda:rutas`): la primera prueba del repo que
  abre páginas. Salió de encontrar la pantalla de inicio rota usando la app.
- **Cola offline del móvil**: lo que se hace sin señal se guarda en el
  teléfono y sube solo, sin duplicarse al reintentar.
- **Mudanza** a `D:\Users\randy\code\RegbERP` (antes `NexusERP` en C:).

---

## ⬜ Pendiente

### Lo que el código NO puede cerrar

Esto es lo que de verdad separa al proyecto de su primer peso cobrado, y
**ninguna línea de código lo resuelve**:

| Pendiente | Tipo | Bloquea |
|---|---|---|
| Login real contra Supabase en producción | credenciales | que un cliente entre sin modo demo |
| Pasarelas de pago Stripe + Azul | credenciales | el cobro automático de la mensualidad |
| Certificado digital DGII | credenciales | emitir e-CF de verdad |
| Despliegue en el mostrador del Cliente #1 | campo | todo lo anterior, en uso real |

Varias **puertas de fase** tampoco se pasan solo con código: la de F4 pide
un cliente pagando, y la de F6 que un contador firme el cierre de un mes y
que la DGII acepte un e-CF en producción. El código de esas fases está
completo; las puertas, no.

### Lo que falta de código

**F11 — Enterprise, a medias.** Solo está hecho uno de sus cinco sprints:

| Entregable | Estado |
|---|---|
| `consolidation` — estados consolidados multi-empresa | ✅ |
| Despliegue on-premise / VPC dedicada | ❌ |
| SSO empresarial: SAML, Azure AD, SCIM | ❌ el módulo `auth` lo difiere a "Supabase real" |
| Pentest externo + SOC2 lite + plan de continuidad | ❌ son actividades externas |
| SDK público para partners | ❌ `packages/sdk` es el SDK interno, no uno para terceros |

Estaba marcada como completa hasta el 22 sep 2026, y no lo estaba: se
confundió "su único módulo existe" con "la fase está hecha". Como los
verticales, esto solo hace falta cuando llega un cliente grande que lo
pida; para una PYME no.

**F12 — Verticales, bajo demanda.** Once módulos para rubros concretos.
No son atraso: la regla de oro dice que no se construye un vertical sin un
cliente que ya lo pidió y va a pagar la instalación. Detalle en
`FASES-DE-DESARROLLO.md` §13 bis.

### Lo que está construido pero no probado de verdad

Dicho claro porque es donde más fácil se miente:

- **La app móvil nunca se ha abierto en un teléfono.** Compila y empaqueta
  (`expo export`); nadie ha hecho login ni ha movido mercancía desde un
  dispositivo. La cola offline es lo que menos se puede dar por bueno sin
  eso: su razón de ser es lo que pasa cuando falla la red.
- **Escritorio:** la impresora térmica y la gaveta no se han probado con
  hardware físico, y `/api/pos/sync` nunca recibió una venta real.
- **La mayoría de acciones de servidor no tienen prueba propia.** Ya existe
  el arnés (`apps/web/src/test/`) y cubre el cierre del IT-1 y la corrida
  de consolidación; el resto de acciones sigue sin prueba que las llame.

---

## 🔧 Deuda conocida

| Deuda | Riesgo | Dónde |
|---|---|---|
| **Claves foráneas sin guarda de cliente**: `memberships.role_id` y `branches.company_id` | **alto** | "El agujero de siempre". Comprobar si un cliente puede apuntar a un rol o empresa de otro. Ver `modules/users.md` y `modules/branches.md` |
| El respaldo del cliente no trae ventas, facturas, inventario ni contabilidad, y el aviso dice que sí | **alto** | `modules/backup.md` |
| `invoice-capture` publicado con precio y sin ninguna pantalla | medio | Despublicarlo o construirlo. `modules/invoice-capture.md` |
| Importar lee `1,234` como 1.23 | medio | `modules/imports.md` |
| La invitación de usuarios no se envía e inventa un `user_id` | medio | `modules/users.md` |
| Ningún módulo core emite los eventos que declara | medio | `modules/README.md`, tabla de hallazgos |
| Consolidación: la foto es el acumulado, no el período | medio | Pide decidir cómo cerrar el año. Documentado en la ficha. |
| Un tenant de prueba no se puede borrar | bajo | Tiene asientos contabilizados, que son inmutables incluso en cascada. El script de limpieza no lo contempla. |

Las seis primeras filas las encontró el agente que escribió las fichas, al
leer el código. Salieron el 22 sep y ninguna está arreglada todavía.

---

## ▶️ Lo siguiente

Por prioridad, según el plan Q4:

1. **Resolver los hallazgos de alto riesgo** de la tabla de deuda —las
   dos claves foráneas y el respaldo del cliente— antes de que un cliente
   real los encuentre.
2. **Desplegar el Cliente #1** en el mostrador: hardware POS, NCF B01/B02,
   crédito a 15 y 30 días, validación del 607. Pasos en `PRIMER-CLIENTE.md`.
3. **Conectar credenciales**: Supabase, Stripe/Azul, certificado DGII.
4. **Probar el móvil en un teléfono de verdad.**
5. Caso de estudio comercial y cierre del Cliente #2.

La regla del plan: ante la duda entre construir un módulo más y que lo que
el cliente ya usa sea impecable, **gana lo segundo**.

---

## Cómo mantener este archivo

Se actualiza **al cerrar cada entrega**, en el mismo commit que la entrega.
Un documento de estado atrasado es peor que ninguno: el que lo lee actúa
sobre algo que ya no es verdad.

Antes de tocar un número, se vuelve a medir con el comando de su fila.
