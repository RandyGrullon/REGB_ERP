# `loyalty` — Fidelizacion

**Que resuelve:** un programa de puntos formal -bronce, plata, oro,
cupones, referidos- en vez de la libreta o la hoja de calculo que cada
negocio improvisa por su cuenta.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** nada · **Recomienda:** `pos`

Primer modulo de S59 (F9).

---

## El saldo se deriva, nunca se guarda

`public.loyalty_balance(customer_id)` suma directo el historial de
`loyalty_transactions` -mismo criterio que `bank_account_balance()` de
`treasury` y `fixed_asset_book_value()` de `fixed-assets`-: no hay una
columna de saldo que pueda desincronizarse del historial. Cada
transaccion es un hecho historico inmutable desde el insert -ganar o
redimir puntos nunca se edita despues-.

## El nivel nunca baja por redimir un premio

`nivelPorPuntosDeVida()` decide bronce/plata/oro por los puntos
GANADOS de por vida (`loyalty_lifetime_points()`, que solo suma las
filas positivas), no por el saldo actual. Verificado en vivo: Constructora
Duarte SRL con 550 puntos de por vida y un saldo de 450 (tras redimir
100) se mantuvo en Plata -si el nivel se calculara sobre el saldo
actual, redimir premios degradaria a los clientes mas fieles, justo lo
contrario de lo que un programa de fidelizacion deberia hacer-.

## Cupones y referidos con su propia maquina de estados

Un cupon activo es editable (`discount_value`, `expires_at`); redimido
o expirado se congela -`impedir_editar_cupon_resuelto()`-. Un referido
pendiente avanza a completado o expirado, ambos terminales. Completar
un referido acredita el bono al referente en el MISMO movimiento de
base de datos que congela la fila -nunca un referido completado sin su
bono, ni un bono sin que el referido quede marcado-. Verificado en
vivo: completar el referido sembrado (Duarte → El Martillo, bono de
100 puntos) subio el saldo de Duarte de 450 a 550 y su historial mostro
la fila "Bono por referido" exacta; el cupon `BIENVENIDA10` (10% para
El Martillo) se redimio y quedo congelado -sin boton para volver a
redimirlo-. Ambos revertidos despues para que la demo siga teniendo un
cupon y un referido reales por resolver.

## El agujero de siempre (0031)

Una transaccion, un cupon (si tiene cliente) y un referido validan que
sus clientes sean del mismo tenant -el referido valida DOS clientes a
la vez, referente y referido-.

## Lo que NO hace

- No gana puntos automaticamente en cada venta -recomienda `pos`, pero
  hoy toda transaccion se registra a mano desde esta pantalla, no hay
  una integracion que la dispare sola-.
- No calcula premios canjeables por catalogo -los puntos y los cupones
  son independientes entre si, redimir un cupon no descuenta puntos-.
- No expira puntos por inactividad -un saldo se queda como esta hasta
  que alguien lo redima o ajuste a mano-.
