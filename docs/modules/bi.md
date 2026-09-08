# `bi` — BI & Reportes

**Que resuelve:** un lugar central para ver los numeros del negocio
-reportes, dashboards y exports programados- en vez de que cada
gerente arme su propio calculo en una hoja de calculo aparte que nadie
mas puede verificar.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** nada · **Recomienda:** nada

Unico modulo de S61-62 (F9).

---

## Elegir, nunca escribir SQL

El "constructor visual de reportes" en realidad elige entre un
CATALOGO FIJO de cinco fuentes ya vetadas (`FUENTES_REPORTE` en
`@regb/operations`, respaldado por un `check` en la tabla): ventas por
dia, productos mas vendidos, facturas vencidas, leads por estado,
tickets por prioridad. Nunca acepta una cadena de SQL libre del
tenant -eso seria una puerta abierta a inyeccion y a fugas entre
clientes-. Cada fuente es una consulta ya escrita y parametrizada en
la capa de aplicacion (`reportSources.ts`), reutilizando exactamente
la misma logica que ya usan los widgets del dashboard para "los mas
vendidos" y "facturas vencidas" -ningun calculo nuevo, la misma
formula de siempre-.

## El aislamiento viene gratis de las tablas que ya existen

Ninguna fuente tiene su propia comprobacion de modulo activo: si
`crm` no esta activo, `leads_by_status` simplemente no devuelve
filas porque la RLS de `public.leads` ya lo exige -el mismo criterio
que protege cualquier widget del dashboard-. Por eso `bi` no declara
`requires` de nada: reportar sobre lo que YA existe no depende de
ningun modulo en particular.

## Un gap real que este modulo destapó

Al sembrar el reporte de "Facturas vencidas" sobre datos reales de
`distribuidora-caribe`, la fuente devolvia cero filas a pesar de que
el tenant ya tenia tres facturas sembradas (una de ellas vencida hace
96 dias). Diagnosticado: el modulo `ar` nunca se habia activado para
este tenant -un descuido de una fase anterior, no un bug de `bi`-,
y la RLS de `customer_invoices` exige `module_active('ar')`. Corregido
activando `ar` en el seed de demo -dato que ya existia, ahora
visible-. Verificado en vivo despues de la correccion: el reporte
mostro exactamente las dos facturas vencidas reales (El Martillo
RD$12,064/96 dias, Duarte RD$27,200/46 dias).

## Dashboards agrupan lo que ya existe

Un dashboard no duplica ninguna consulta: solo referencia reportes
guardados por posicion (`dashboard_items`). Un export programado
calcula su proxima fecha con `proximaEjecucion()` -diaria +1 dia,
semanal +7 dias, mensual mantiene el mismo dia del mes ajustandose al
ultimo dia si el mes siguiente es mas corto-. "Ejecutar ahora" es
honesto sobre lo que hace: registra `last_run_at` y calcula el
siguiente `next_run_at`, pero no manda ningun correo de verdad -mismo
criterio de honestidad que `marketing`-. Verificado en vivo: ejecutar
el export sembrado (vencido, semanal) avanzo su proxima ejecucion
exactamente 7 dias; pausarlo y reanudarlo alterno el estado sin tocar
el calendario.

## El agujero de siempre (0031)

Un item de dashboard valida que su dashboard Y su reporte sean del
mismo tenant; un export valida que su reporte lo sea.

## Lo que NO hace

- No acepta una consulta SQL libre -el catalogo de fuentes es fijo y
  vetado, declarado sin rodeos en el FAQ del marketplace-.
- No manda el export por correo de verdad -registra el calendario y
  la ultima ejecucion, el envio real no esta conectado-.
- No arma graficos interactivos -el `chart_type` se guarda como
  preferencia, pero esta version renderiza todo como tabla en la
  pantalla de detalle-.
