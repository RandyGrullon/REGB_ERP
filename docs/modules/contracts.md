# `contracts` — Contratos & Suscripciones

**Que resuelve:** recurrencia y renovacion con escalamiento de precio
real -renovar crea un contrato nuevo, nunca sobrescribe el anterior-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** ninguno · **Recomienda:** `ar`

Primer modulo de S57 (F9).

---

## La vigencia reutiliza `training.ts` por sexta vez

`contratoVigente` es un alias directo de `certificadoVigente()` -la
misma pregunta ("esto ya vencio?") resuelta una sexta vez esta fase,
despues de `fleet`, `lots-serials`, `quality`, `maintenance` y
`quotes`-.

## Renovar crea un contrato NUEVO, nunca edita el actual

`calcularEscalamiento(montoBase, pctEscalamiento)` es la unica formula
que decide el monto de la renovacion. `renovarContrato()` marca el
contrato actual `renewed` -terminal- y crea uno nuevo en `draft` con
`renewed_from_id` apuntando al anterior, la misma fecha de fin
extendida por la misma duracion, y el monto escalado. Es el mismo
criterio de versionado que `quotes` con `supersedes_id`.

Verificado en vivo con el contrato sembrado (Ferreteria El Martillo
SRL, RD$15,000/mes, escalamiento 5%, venciendo en 20 dias): renovarlo
produjo CTR-0002 en borrador con RD$15,750.00 -exactamente
15000 × 1.05- y una fecha de fin un año despues, enlazado de vuelta al
original ya marcado "renovado". Revertido despues -CTR-0002 borrado,
CTR-0001 devuelto a `active`- para que la demo siga teniendo un
contrato real por renovar.

## Terminos congelados fuera de borrador

Un trigger de campo por campo (mismo patron que `bom`/`quotes`)
bloquea cambiar `customer_id`, `billing_frequency`, fechas, monto o
escalamiento una vez el contrato sale de `draft` -pero el `status`
mismo SI puede seguir avanzando hacia `cancelled`/`expired`-.

## El agujero de siempre (0031), dos veces

Un contrato valida que su cliente y el contrato que renueva sean del
mismo tenant.

## Lo que NO hace

- No genera automaticamente las facturas periodicas del contrato
  -recomienda `ar`, pero la facturacion recurrente en si no esta
  implementada todavia-.
- La renovacion automatica (`auto_renew`) es solo un campo informativo:
  no hay un proceso en segundo plano que renueve solo al llegar la
  fecha de fin -alguien tiene que iniciar la renovacion-.
