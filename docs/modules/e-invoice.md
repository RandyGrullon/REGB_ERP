# `e-invoice` — Facturacion electronica (e-CF)

**Que resuelve:** que el negocio pueda seguir facturando despues del 15
de noviembre de 2026, cuando la ley 32-23 vuelve obligatorio el e-CF
para un contribuyente pequeño.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** nada · **Recomienda:** `taxes`

Modulo 25 del catalogo (F6), construido fuera de orden por la fecha.

> ⚠️ **Todavia no emite.** Lo que hay es la configuracion, el enrutado
> de lo que entra y las reglas de negocio, todo probado. Falta el
> certificado digital, la firma XAdES y la transmision. **Nada se ha
> probado contra los servidores de la DGII.**

---

## La DGII tambien te llama a ti

Es el hallazgo que cambia la arquitectura y el que casi todo el mundo
subestima: integrarse **no es escribir un cliente HTTP**. Al postular,
el contribuyente declara TRES URL suyas y la DGII le pega a ellas —
recepcion, aprobacion comercial y su propio servicio de autenticacion.
En el set de pruebas (pasos 8-11) la DGII manda comprobantes y exige los
acuses de vuelta: sin esa mitad no hay certificacion, por muy bien que
se emita.

## El problema multi-tenant, y como se resuelve

La DGII le pega a UNA URL; nosotros servimos muchos RNC desde el mismo
despliegue.

**Lo que no se hace:** leer el RNC del comprador que viene dentro del XML
para elegir el tenant. Es el patron que la puerta F0 prohibe -"tenant_id
nunca se lee de body"- y aqui seria peor que en una pantalla: quien sepa
el RNC de un cliente podria escribirle facturas en su cuenta.

**Lo que si:** cada tenant tiene un token opaco de 128 bits y declara
URL que lo llevan dentro. El token identifica Y autentica, igual que el
enlace del portal del cliente (0084). `ecf_tenant_por_token()` es la
unica puerta y es `security definer` por eso. Despues, defensa en
profundidad: el RNC del documento tiene que coincidir con el del tenant
del token; si no, el acuse sale con motivo 4 y no se guarda nada.

El token es una **credencial**, no un id: otro tenant no puede leerlo, y
hay una prueba que lo verifica.

## El corte de RD$250,000 parte la arquitectura en dos

Una Factura de Consumo (E32) por debajo de ese monto **no la recibe** el
servicio de recepcion normal: va un resumen (RFCE) a otro dominio y otro
endpoint. Para una PYME dominicana eso **no es un caso borde, es el
camino principal**: casi todas las facturas de un colmado caen por
debajo. `rutaDeEnvio()` lo decide, y el corte aplica solo a E32 -un
credito fiscal de RD$500 va completo igual, porque el comprador necesita
el detalle para descontarse el ITBIS-.

## Tres polaridades invertidas, y las tres muerden

1. **Estado del e-CF:** `1` = aceptado. Y **`4` (aceptado condicional)
   TAMBIEN es valido fiscalmente** -la DGII dice que "implica la validez
   del e-CF"-. Tratarlo como error bloquea ventas buenas; tratarlo como
   exito limpio esconde algo que hay que corregir. Por eso
   `esValidoFiscalmente()` y `requiereRevision()` son dos funciones.
2. **`secuenciaUtilizada`:** `true` significa que la secuencia YA se
   quemo y NO se puede reutilizar. Confundirla agota el rango autorizado
   de un cliente sin que haya vendido nada.
3. **Estado del acuse:** `0` = recibido (bien), `1` = NO recibido (mal).
   Al reves de leerlo como booleano y al reves del punto 1.

## Contingencia: una es codigo nuevo, la otra un interruptor

Las dos del Art. 40 del Decreto 587-24 no se resuelven igual:

- **Sin conexion:** hay sistema, no hay internet. Se siguen emitiendo
  e-CF y hay **72 horas** para remitirlos. La representacion impresa
  lleva una leyenda obligatoria, que es texto legal y se copia tal cual.
- **Sin sistema:** no se puede emitir. Se vuelve al **papel de la serie
  B**, maximo **15 dias**, avisando a la DGII por la Oficina Virtual
  -eso lo hace una persona-. Buena noticia: ese papel el ERP **ya lo
  emite**, asi que esta contingencia es un interruptor sobre lo que hay.

## No se pasa a produccion sin certificar

Cambiar el ambiente a `ecf` sin estar certificado se bloquea con un
motivo: cada comprobante seria rechazado y **quemaria una secuencia
autorizada**. El ambiente se guarda por tenant y no global, porque
mientras un cliente se certifica en `certecf` otro ya factura de verdad.

## El agujero de siempre (0031)

No aplica igual que en otros modulos -no hay FK cruzada entre tablas de
tenants distintos-, pero su equivalente aqui es el enrutado por token, y
tiene seis pruebas dedicadas.

## Lo que NO hace

- **No emite.** No hay firma XAdES ni transmision.
- No genera el XML contra los XSD (~235 elementos, ~75 validaciones).
- No implementa los tres servicios entrantes: hay enrutado y decision de
  acuse, no las rutas HTTP.
- No consulta el directorio de emisores de la DGII.
- No hace la aprobacion comercial de lo que recibe.
- No renueva certificados ni vigila su vencimiento.
