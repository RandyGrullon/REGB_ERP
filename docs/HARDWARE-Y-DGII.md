# Hardware de mostrador y conexión con la DGII

Qué funciona hoy, qué necesita la app de escritorio y qué depende de un
trámite ante la DGII. Se escribe aparte porque es lo que más pregunta un
cliente antes de comprar, y prometer de más aquí es lo que hace que la
instalación termine mal.

---

## 1. Lector de código de barras — **funciona hoy, sin driver**

Un lector USB **es un teclado**. No hay puerto serial que abrir ni librería
que instalar: enfoca el buscador, teclea el código y manda `Enter`.

La caja (`/pos`) escucha ese `Enter` y resuelve en este orden:

1. código de barras exacto (`products.barcode`),
2. SKU exacto,
3. si el filtro dejó **un solo** producto, ese.

Si no resuelve, muestra el código que llegó — no agrega nada a ciegas.

**Detalle de implementación que importa:** el código se lee del DOM
(`e.currentTarget.value`), no del estado de React. Un lector teclea y manda
`Enter` en milisegundos, así que el estado va un render atrasado y con el
closure viejo se leería un código a medias.

**Para que funcione en un cliente:** cargar `barcode` en el catálogo. Se puede
por CSV desde `/importar`. Sin código de barras el lector no falla, cae al SKU.

**Configuración del lector:** modo *keyboard wedge* (el de fábrica en casi
todos) y sufijo `Enter` activado. Nada más.

---

## 2. Impresora térmica 80 mm — **funciona hoy, como impresora normal**

Una térmica USB se instala en Windows como cualquier impresora. El ticket
(`/pos/ticket/[id]`) es una página de 80 mm de ancho con `@page { size: 80mm
auto; margin: 0 }`: lo que se ve es lo que sale del papel.

Sale **fuera del shell** a propósito —sin barra ni menú— y `print-color-adjust:
exact` obliga a Chrome a imprimir los separadores, que si no los quita.

Se llega desde **Caja → Cierres**, tocando el número del ticket.

**Pendiente para F5 (escritorio):** impresión directa sin el diálogo de
Chrome, apertura de gaveta de efectivo (pulso ESC/POS por el puerto de la
impresora) y corte automático de papel. Nada de eso lo puede hacer una página
web: requieren hablar con el dispositivo, y eso es Electron.

---

## 3. Impresora fiscal / lector fiscal — **no está, y es F5**

Aquí hay que ser exacto para no vender humo.

Una **impresora fiscal certificada** no es una impresora: es un dispositivo con
memoria fiscal propia que lleva su propio consecutivo y responde a un protocolo
binario por puerto serial o USB (cada fabricante el suyo). Un navegador no
puede abrir ese puerto. Requiere la app de escritorio → **F5**.

Contexto dominicano: la DGII **no exige** impresora fiscal certificada para
operar. Lo que exige es el **NCF** en el comprobante y los reportes 606/607/608.
Eso sí está resuelto (punto 4), y es la razón por la que un colmado o una
ferretería pueden operar hoy con una térmica común.

---

## 4. DGII — qué está conectado y qué no

### Está hecho

| Pieza | Dónde |
|---|---|
| Secuencias NCF autorizadas (alta, vencimiento, agotamiento) | `/cobrar/ncf` |
| Asignación atómica del próximo NCF | `public.assign_ncf()` |
| NCF en factura de crédito y en ticket de caja | `customer_invoices`, `pos_sales` |
| Validación de RNC (módulo 11) y cédula (Luhn) | `packages/operations/src/dgii.ts` |
| Reporte 607 (ventas) | vista `public.dgii_607` |

**Regla del mostrador:** cliente con RNC → **B01** (crédito fiscal, para que
pueda deducir el ITBIS); cliente de mostrador → **B02** (consumo).

**Si no hay secuencia cargada, la venta NO se detiene.** Un colmado que recién
abre vende antes de que la DGII le autorice el primer rango, y trancar la caja
por eso sería peor que el ticket sin NCF. El ticket sale marcado `sin NCF` en
Cierres y la pantalla de Comprobantes avisa. Es una decisión deliberada, no un
descuido.

**Un NCF consumido no vuelve**, ni aunque se anule la venta: la DGII espera
verlo reportado como anulado en el 608, no desaparecido.

### No está — **F6, `e-invoice`**

Transmisión de e-CF a la DGII: firma con certificado digital, serialización
XML, endpoint de recepción, acuse, y **modo contingencia** para cuando el
servicio del Estado está caído.

No se construye a ciegas: necesita credenciales reales de un contribuyente y es
la parte que más cambia por decreto. Por eso vive aislada y versionada, no
esparcida por el resto del ERP.

---

## Resumen para vender sin prometer de más

| | Web (hoy) | Escritorio (F5) |
|---|---|---|
| Lector de código de barras | ✅ | ✅ |
| Ticket térmico 80 mm | ✅ (diálogo de impresión) | ✅ directo |
| Gaveta de efectivo | ❌ | ✅ |
| Impresora fiscal certificada | ❌ | ✅ |
| Vender sin internet | ❌ | ✅ |
| NCF en el comprobante | ✅ | ✅ |
| Envío de e-CF a la DGII | F6 | F6 |
