# `pipeline` — Oportunidades

**Que resuelve:** kanban de etapas con maquina de estados real,
forecast ponderado -cada monto por su propia probabilidad, nunca el
monto crudo- y motivo de perdida obligatorio.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `crm` · **Recomienda:** ninguno

---

## Forecast ponderado de verdad

`forecastPonderado()` suma `monto x probabilidad` de cada oportunidad
abierta -nunca el monto crudo de todo lo que esta "en conversacion"-.
La probabilidad se actualiza SOLA al valor por defecto de la nueva
etapa cada vez que una oportunidad avanza
(`PROBABILIDAD_POR_ETAPA`: 10/25/50/75/100%), para que no quede un
numero viejo de la etapa anterior olvidado en el calculo. Verificado
en vivo con la oportunidad sembrada (RD$850,000 en `negotiation`,
75%): forecast ponderado de RD$637,500 -el producto exacto, confirmado
en el widget del dashboard-.

## Reutiliza `diasEnPipeline()` de `recruiting.ts`, tal cual

`diasEnEtapa` es un alias directo: la misma resta de dias entre una
fecha y hoy, sea un candidato en un pipeline de contratacion o una
oportunidad en un pipeline de ventas. La maquina de estados
(`transicionValidaEtapa()`) sigue el MISMO PATRON que ya uso
`recruiting.ts` -secuencial hacia adelante, con una salida terminal
alcanzable desde cualquier etapa no terminal- pero con su propio tipo
propio: no se puede reutilizar la funcion en si porque las etapas son
otras, solo el criterio de diseno.

## Motivo de perdida obligatorio, a nivel de tabla

Un `check` en la base impide marcar una oportunidad `lost` sin
`lost_reason` -no es una validacion que la UI pueda saltarse-.
Verificado en vivo: intentar marcar perdida sin escribir el motivo no
tuvo ningun efecto, la oportunidad siguio en `negotiation`.

## Requiere `crm`, de verdad

A diferencia de `crm` (que no exige nada), `pipeline` SI declara
`requires: ['crm']`: una oportunidad puede nacer de un lead real, y
esa referencia (`lead_id`) es una FK autentica hacia `public.leads`,
no un campo de texto libre.

## Congelada solo en su estado terminal

Una oportunidad es editable -monto, etapa, fecha esperada- mientras
sigue abierta; se congela en cuanto llega a `won` o `lost`, el mismo
patron que `traffic_fines` de `fleet`. Verificado en vivo: marcar
ganada la oportunidad sembrada la congelo de inmediato, confirmado
intentando avanzarla de nuevo; revertida despues para que la demo
siga teniendo una oportunidad real por cerrar.

## El agujero de siempre (0031)

Una oportunidad valida que su lead -si tiene uno- sea del mismo
tenant.

## Lo que NO hace

- No calcula comisiones de venta -eso es responsabilidad de un futuro
  modulo `commissions`, no de este-.
- No tiene una nocion de "oportunidad recurrente" o de renovacion:
  cada oportunidad es un trato unico, de principio a fin.
- La probabilidad por etapa es un valor por defecto fijo, no
  ajustable por el historial de conversion real del tenant.
