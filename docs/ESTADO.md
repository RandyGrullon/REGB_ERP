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
Esfuerzo   █████████████████████████████████████░░░  ~119 / 130 sp · 92%
Módulos    ██████████████████████████████████░░░░░░    80 / 91
```

---

## Los números

| | Valor | Cómo comprobarlo |
|---|---:|---|
| Módulos construidos | **80** de 91 | `ls modules` |
| Migraciones | **117** | `ls supabase/migrations` |
| Pruebas de base de datos | **1,067** en 82 archivos | `pnpm gate:f0` |
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
| **F10** | Proyectos (5 de 16) | 🟡 parcial, a propósito |
| **F11** | Enterprise | ✅ |

### Lo último que se hizo

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

| Pendiente | Tamaño | Por qué no está hecho |
|---|---|---|
| 11 verticales de F10 (restaurante, clínica, hotel, taller, inmobiliaria, educación, gimnasio, farmacia, agro, construcción, lavandería) | ~11 sp | **A propósito.** La regla de oro de F10: no se construye un vertical sin un cliente que ya lo pidió y va a pagar la instalación. |

### Lo que está construido pero no probado de verdad

Dicho claro porque es donde más fácil se miente:

- **La app móvil nunca se ha abierto en un teléfono.** Compila y empaqueta
  (`expo export`); nadie ha hecho login ni ha movido mercancía desde un
  dispositivo. La cola offline es lo que menos se puede dar por bueno sin
  eso: su razón de ser es lo que pasa cuando falla la red.
- **Escritorio:** la impresora térmica y la gaveta no se han probado con
  hardware físico, y `/api/pos/sync` nunca recibió una venta real.
- **Muchas acciones de servidor no tienen prueba propia.** El repo no tiene
  arnés para ellas: `tsc` es lo único que garantiza que una página llame a
  la función correcta. Varias pruebas de F6 comprueban el SQL copiado, no
  la acción.

---

## 🔧 Deuda conocida

| Deuda | Riesgo | Dónde |
|---|---|---|
| El último respaldo es del **11 de septiembre** | alto | `pnpm alertas` lo marca crítico. Correr `pnpm db:respaldar`. |
| `tax_rates` no la lee nadie fuera de `/impuestos` | medio | products, pos y quotes siguen con `0.18` cableado. La promesa del catálogo ya se bajó a lo que hay. |
| Consolidación: la foto es el acumulado, no el período | medio | Sin cierre anual en el repo, separar balance y resultado pide inventar el arrastre. Documentado en la ficha. |
| Cambiar la moneda de una empresa ya dentro de un grupo se deja | bajo | `update public.companies set currency` no está vigilado. |
| 14 módulos sin ficha en `docs/modules/` | bajo | 13 son los core de F2, anteriores a la convención. El único hueco real es `invoice-capture`. |
| Tenants de prueba viejos en la base local | bajo | `node scripts/limpiar-tenants-de-prueba.mjs --si` |

---

## ▶️ Lo siguiente

Por prioridad, según el plan Q4:

1. **Correr un respaldo** — la alerta lo está pidiendo.
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
