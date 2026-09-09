# `timesheets` — Hojas de tiempo

**Que resuelve:** cuantas horas reales tomo cada tarea, con aprobacion
formal antes de facturarlas -en vez de estimar de memoria al momento de
cobrarle al cliente-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `projects` · **Recomienda:** `ar`

Segundo modulo de F10 (S67).

---

## Rechazado no es el final

`transicionValidaRegistroTiempo()`: `draft → submitted`, `submitted →
approved | rejected`, y **`rejected → draft`** -un registro rechazado
se corrige y se reenvia, no se pierde-. Solo `approved` es terminal, y
lo respalda `impedir_editar_registro_aprobado()` a nivel de base de
datos, no solo la pantalla. Es la misma distincion que `commissions`
tuvo que aprender por las malas en F9: "ya no es el primer estado" no
significa "terminal".

## Requiere `projects` de verdad

Cada registro apunta a una tarea real con una FK autentica -no un
texto libre sin respaldo-, igual que `commissions` exige
`sales-orders`. Si no existe la tarea, no hay registro que aprobar.

## El monto facturable se calcula una sola vez

`montoFacturable(horas, tarifa, facturable)` es la unica formula: horas
x tarifa, cero si el registro no es facturable. Verificado en vivo: el
registro sembrado (4 horas a RD$350) aprobado mostro exactamente
RD$1,400.00 en el total facturable de la pantalla. Revertido despues
para que la demo siga teniendo un registro real por aprobar.

## El agujero de siempre (0031)

Un registro valida que su tarea sea del mismo tenant.

## Lo que NO hace

- No factura automaticamente las horas aprobadas -recomienda `ar`,
  pero emitir la factura sigue siendo una accion aparte-.
- No tiene cronometro en vivo -se registran horas ya trabajadas, no se
  mide el tiempo mientras ocurre-.
- No valida que la suma del dia de una persona no pase de 24 horas
  -cada registro individual si esta limitado a 24, pero nada impide
  cargar varios registros del mismo dia que sumados excedan-.
