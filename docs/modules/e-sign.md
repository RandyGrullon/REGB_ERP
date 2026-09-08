# `e-sign` — Firma electronica

**Que resuelve:** flujo de clic para firmar con rastro de auditoria
real -quien, cuando, desde que IP, sobre que version exacta del
documento (su hash)- para cualquier documento, tenga o no otro modulo
que lo respalde.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** ninguno · **Recomienda:** `quotes`,
`contracts`

Segundo modulo de S56 (F9).

---

## Honesto sobre lo que NO es

Esto NO es una firma criptografica con certificado ni PKI -declarado
explicitamente en el FAQ del marketplace, no escondido en la letra
pequeña-. Lo que ofrece es trazabilidad real: cada paso del flujo
(`signature_events`) queda registrado con fecha e IP, inmutable desde
el momento que ocurre, igual que `audit.log`. Al firmar, se calcula un
hash SHA-256 real de tipo + folio + etiqueta + correo del firmante +
momento exacto -una huella verificable de que se firmo, no un numero
decorativo-. Verificado en vivo: firmar la solicitud sembrada capturo
una IP real (`::1`, la del entorno de desarrollo) y un hash de 64
caracteres hexadecimales genuino, no un valor de relleno.

## Sin FK a lo que firma, a proposito

`document_id` es un `uuid` deliberadamente SIN referencia (`references`)
a ninguna tabla: `contracts` (modulo 33) todavia no existe en este
catalogo construido, y `quotes` solo se recomienda, no se exige. La
referencia es polimorfica por `document_type` (`quote`/`contract`/
`other`), con `document_label` guardando una etiqueta legible en vez
de depender de un JOIN que podria fallar si el modulo referenciado no
esta activo. Verificado en vivo con el caso de honestidad completo:
una solicitud de tipo `other` -sin ningun lazo real a `quotes`- se creo,
envio y firmo exactamente igual que si hubiera sido sobre una
cotizacion real, demostrando que el modulo funciona solo.

## Maquina de estados con un solo camino de entrada

`transicionValidaFirma()`: `pending → sent → signed | declined |
expired`. Firmada, rechazada o vencida son terminales -no se reabren-.

## Inmutabilidad: solicitud congelada al resolverse, evento siempre

Una solicitud es editable mientras sigue `pending` o `sent`
-permitiendo reenviarla o corregir el correo del firmante-, y se
congela en cuanto llega a un estado terminal, el mismo patron que
`traffic_fines` de `fleet`. Un evento es inmutable desde el primer
insert, sin excepcion -es el rastro de auditoria, y un rastro que se
puede editar no es un rastro-.

## El agujero de siempre (0031)

Un evento valida que su solicitud sea del mismo tenant. La solicitud
misma no necesita ese trigger -no tiene ninguna referencia real a otra
tabla de negocio que pudiera pertenecer a otro tenant-.

## Lo que NO hace

- No es una firma digital certificada legalmente equivalente a la
  firma autografa -ninguna certificacion, ningun PKI-.
- No envia el correo de verdad al firmante -el flujo de "enviar" es
  un cambio de estado en el sistema, la integracion de correo real
  queda pendiente-.
- No verifica la identidad del firmante mas alla de lo que el
  correo/nombre indican -no hay verificacion biometrica ni de
  documento de identidad-.
