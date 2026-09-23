# Estado del proyecto

> **Qué está hecho, qué falta y por qué.** Este es el único documento del
> repo que dice en qué punto está REGB ERP. El resto dice qué se va a
> construir (`PROYECTO-REGB-ERP.md`) y en qué orden (`FASES-DE-DESARROLLO.md`).

**Última verificación: 23 de septiembre de 2026**, contra el repo y no de
memoria, con la puerta `gate:f0` completa en verde. Cada número de abajo
dice cómo volver a comprobarlo.

---

## En una línea

**El flujo comercial de punta a punta ya está cerrado en código** —caja,
crédito, compras, contabilidad automática y DGII serie B—. El 22 sep este
documento decía que el código estaba "prácticamente terminado"; usar la app
como cliente el 23 sep demostró que no: el 607 se declaraba mal, un colmado
no podía cumplir con la DGII, el crédito no tenía límite y la contabilidad
no recibía nada de la operación. La ronda 2 lo arregló
([`esto_es.md`](esto_es.md)). **Lo que falta ahora es el e-CF** —obligatorio
desde el 15 nov 2026— **y lo que no es código:** credenciales y trabajo de
campo.

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
| Migraciones | **134** (hasta la 0135; la 0126 no existe) | `ls supabase/migrations` |
| Pruebas de base de datos | **1,342** en 96 archivos | `pnpm gate:f0` |
| Pruebas de la web (acciones reales y estáticas) | **319** en 38 archivos | `pnpm gate:f0` |
| Pruebas de lógica pura | **1,653** en los paquetes | `pnpm gate:f0` |
| Pantallas web | **179** | `find apps/web/src/app -name page.tsx` |
| Rutas registradas | **159**, sin colisión | `pnpm audit:manifests` |
| Módulos con captura real en el marketplace | **79** de 80 | `pnpm capturas:marketplace` |
| Pantallas móvil | **11** | `apps/mobile/app` |

La puerta `pnpm gate:f0` (typecheck + lint + pruebas + 4 auditorías) está
**en verde**: 3,314 pruebas. Las 134 migraciones aplican en orden desde una
base vacía, y la semilla de la demo también.

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

- **Ronda 2 de agentes** (23 sep): los seis hallazgos de la ronda 1
  cerrados; el análisis de flujo de punta a punta y sus arreglos (607/606
  e IT-1, colmado solo con caja, crédito con límite y B04, contabilidad
  automática, nómina sin doble pago y portal privado, alta de cliente sin
  SQL); escalada de rol cerrada; factura de REGB completa; roles de fábrica
  para clientes nuevos; marketplace con capturas reales; sidebar por áreas;
  tema oscuro por defecto. Detalle y pendientes en [`esto_es.md`](esto_es.md);
  a quién vender y cómo dejar Supabase listo en [`defi-v1.md`](defi-v1.md).
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
- **Muchas acciones de servidor todavía no tienen prueba propia.** El arnés
  (`apps/web/src/test/`) ya cubre caja, crédito, cobros, compras,
  contabilidad automática, nómina, portal, invitaciones, respaldo,
  importación, alta de cliente y eventos core (319 pruebas); los módulos de
  F8–F10 siguen sin prueba que llame a sus acciones.
- **Supabase de verdad nunca se ha usado.** El envío de invitaciones (Edge
  Function), el bloqueo de solo lectura por PostgREST y el pooler en modo
  transacción están escritos y probados contra Postgres local, no contra un
  proyecto Supabase.

---

## 🔧 Deuda conocida

Los seis hallazgos de la ronda 1 (FK sin guarda, respaldo incompleto,
`invoice-capture` a la venta, importar `1,234`, invitaciones, eventos core)
**están cerrados** desde el 23 sep. Esto es lo que sigue abierto:

| Deuda | Riesgo | Dónde |
|---|---|---|
| **El e-CF no emite**: la firma existe, pero nada arma ni envía un e-CF desde una venta o factura | **alto** | Obligatorio para pequeños y micro desde el 15 nov 2026. `modules/e-invoice.md`, [`defi-v1.md`](defi-v1.md) |
| Un Admin (o un gerente con `*.create`) puede crear un rol con `*` y dárselo a **otra** cuenta; solo el Owner está protegido | medio | `modules/users.md` |
| El despachador de eventos no corre solo: sin cron no salen asientos automáticos, automatizaciones ni webhooks | medio | Configurar Vercel Cron, `pg_cron` o `pnpm despachar`. [`defi-v1.md`](defi-v1.md) §4.9 |
| Sin asiento automático todavía: costo de venta a crédito, recepciones, devoluciones, nómina, depreciación | medio | `modules/accounting.md`, ADR 0001 |
| Nómina: horas extra, aportes patronales, archivo SUIR e IR-3 | medio | `modules/payroll.md` |
| Reglas DGII y TSS "por confirmar" (campo 15 del 606, fecha del 608, B04 en el 607, recargo de horas extra, artículos del Código de Trabajo) | medio | Fichas de `ar`, `taxes`, `payroll` |
| Consolidación: la foto es el acumulado, no el período | medio | Pide decidir cómo cerrar el año. Documentado en la ficha. |
| `e-invoice` está despublicado pero se cobra en la distribuidora | decisión | `modules/invoice-capture.md` |
| `rls.role_id()` (0109) convierte el claim sin `nullif` y puede reventar en conexiones de dueño que ya tuvieron claims | bajo | Lo esquiva la 0130; la función sigue igual |
| La caja no usa la lista de precios asignada al cliente (los pedidos sí) | bajo | Decisión deliberada: la caja cobra lo que muestra. `modules/sales-orders.md` |
| La app no lleva tildes fuera del catálogo del marketplace | bajo | Pasada de texto en pantallas y manifiestos |
| Tours de pedidos, cobrar y respaldos no mencionan lo nuevo | bajo | `packages/core/src/tours.ts` |
| Facturas marcadas vencidas antes de la 0128 | bajo | Revisarlas a mano: la 0128 no las mueve |
| Un tenant de prueba con asientos no se puede borrar | bajo | Son inmutables incluso en cascada. El script de limpieza no lo contempla. |

---

## ▶️ Lo siguiente

Por prioridad, según el plan Q4:

1. **Dejar Supabase de producción listo** siguiendo el checklist de
   [`defi-v1.md`](defi-v1.md) §4.21 (pooler, SMTP propio para
   invitaciones, hook de token, `pg_cron` para la bitácora y el
   despachador, PITR).
2. **Plan de e-CF** antes del 15 nov: certificado del cliente y set de
   pruebas de la DGII, o proveedor autorizado en paralelo.
3. **Desplegar el Cliente #1** en el mostrador: hardware POS, NCF B01/B02,
   crédito a 15 y 30 días, validación del 607. Pasos en `PRIMER-CLIENTE.md`.
4. **Conectar credenciales**: Stripe/Azul, certificado DGII.
5. **Probar el móvil en un teléfono de verdad** y la impresora térmica.
6. Ronda 3 de código, en este orden: escalada de Admin a otra cuenta,
   asientos de nómina y costo a crédito, horas extra y SUIR, pasada de
   tildes en la app.

La regla del plan: ante la duda entre construir un módulo más y que lo que
el cliente ya usa sea impecable, **gana lo segundo**.

---

## Cómo mantener este archivo

Se actualiza **al cerrar cada entrega**, en el mismo commit que la entrega.
Un documento de estado atrasado es peor que ninguno: el que lo lee actúa
sobre algo que ya no es verdad.

Antes de tocar un número, se vuelve a medir con el comando de su fila.
