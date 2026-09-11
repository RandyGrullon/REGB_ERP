# Formato de envío del 606, el 607 y el 608

Lo que sabemos del layout, **de dónde lo sacamos**, y lo que sigue sin
confirmarse. Se escribe aparte porque es la parte del sistema donde
equivocarse le rebota una declaración a un negocio real.

Investigado el 4 de agosto de 2026. El **606 se añadió el 10 de
septiembre de 2026** — ver su sección al final.

---

## De dónde sale

| Fuente | Qué aporta |
|---|---|
| **Norma General 07-2018 sobre Comprobantes Fiscales**, Anexos B y C | El layout: delimitador, cabecera y orden de columnas |
| Instructivo oficial del 607 (dic. 2025) | Precisiones sobre longitudes y campos opcionales |
| Instructivo oficial del 608 (mar. 2026) | Los códigos de motivo de anulación |
| Comunidad de ayuda de la DGII | Confirma que la NG 07-2018 sigue siendo la especificación vigente |

La norma dice literalmente:

> "Para el archivo en formato .txt los campos deberán ser delimitados por
> pipe (|)"

---

## Lo confirmado

- **Delimitador:** pipe `|`.
- **Línea de cabecera obligatoria**, 4 campos:
  `607|RNC_DEL_EMISOR|AAAAMM|CANTIDAD_REGISTROS`
- El **conteo no incluye la cabecera**. La norma lo dice explícitamente.
- **607: 23 campos** por línea de detalle. **608: 3 campos.**
- Fechas en **AAAAMMDD**. Montos con **punto** decimal.
- El RNC de la cabecera es el del **contribuyente que remite**, no el del
  cliente. Confundirlos rebota el archivo entero, no una línea.
- Los campos 17-23 del 607 son las **formas de pago**, y esos sí incluyen
  impuestos: deben sumar el total de la factura.

---

## Lo que NO está confirmado

Estas decisiones se tomaron sin respaldo documental. Están aisladas en
constantes al principio de
[`packages/operations/src/dgii-envio.ts`](../packages/operations/src/dgii-envio.ts)
para que se puedan cambiar en un sitio si el primer envío rebota.

| Decisión | Por qué se eligió así |
|---|---|
| Sin pipe extra al final | 23 campos son 22 separadores. Un campo final vacío deja la línea acabando en `\|`, y eso es legítimo |
| Fin de línea **CRLF** | La herramienta oficial es una macro de Excel sobre Windows |
| **UTF-8 sin BOM** | Ningún campo que generamos lleva acentos |
| Campos vacíos como `\|\|` | El formato es posicional: colapsarlos correría todo |

Y dos **contradicciones entre documentos de la propia DGII**:

1. **Longitud del NCF (607, campos 3 y 4).** El Anexo B declara 11 y 19; el
   instructivo de dic. 2025 dice 11 para ambos, admitiendo 19 solo para
   comprobantes anteriores a mayo 2018.
2. **Qué fecha lleva el 608.** El Anexo C dice *"fecha en que se anuló el
   NCF"*; el instructivo de mar. 2026 dice *"la fecha en que fue emitida la
   factura"*. **Son cosas distintas.** Hoy se emite la fecha de emisión,
   que es lo que dice el documento más reciente.

También sin confirmar: si la Oficina Virtual valida el **nombre del
archivo**. Se replica `DGII_F_607_<RNC>_<AAAAMM>.TXT` porque es lo que
genera la herramienta de la DGII y lo que el contador espera ver, pero eso
sale de una captura de pantalla, no de una norma.

---

## El hueco real: el motivo de anulación del 608

La DGII pide un **código del 1 al 8**, no una descripción:

| | |
|---|---|
| 1 | Deterioro de factura preimpresa |
| 2 | Errores de impresión (factura preimpresa) |
| 3 | Impresión defectuosa |
| 4 | Corrección de la información |
| 5 | Cambio de productos |
| 6 | Devolución de productos |
| 7 | Omisión de productos |
| 8 | Errores en secuencia de NCF |

**Nosotros guardamos el motivo en palabras.** Cuando un cajero anula un
ticket escribe *"devolución del cliente"*, y eso no se puede declarar.

El generador **se niega** a producir el archivo en vez de inventar un
código: un 608 con un motivo equivocado es peor que no entregarlo, porque
el contribuyente cree que declaró.

**Lo que falta:** que la pantalla de anulación pida el código en vez de —o
además de— el texto libre. Es un cambio pequeño y hay que hacerlo antes de
que un cliente tenga que declarar un mes con anulaciones.

---

## Antes del primer envío de un cliente

1. Generar el TXT desde `/cobrar/dgii` con **TXT de envío**.
2. Abrirlo **al lado de un archivo suyo que la DGII ya haya aceptado**.
3. Comparar campo por campo: separadores, fechas, decimales, fin de línea.
4. Si algo no cuadra, tocar solo `dgii-envio.ts` — el resto no depende del
   layout.

Mientras eso no ocurra, el **CSV es el camino recomendado**: el contador lo
abre, lo revisa y lo carga en la herramienta que ya usa. Es más lento y no
falla en silencio.

---

## Lo que la investigación no pudo hacer

La fuente definitiva byte a byte sería el Excel con macros *"Herramienta de
Envío Formato 607"* que la DGII distribuye en un ZIP. **No se descargó ni
se abrió**: es un archivo con macros y eso pide autorización explícita.

También quedó sin confirmar en texto normativo si un emisor 100%
electrónico (e-CF, ley 32-23) deja de remitir 607 y 608. Fuentes
secundarias y una respuesta de soporte de la DGII lo dicen, pero sin cita.
Importa cuando llegue F6.

---

## Cómo se investigó

Tres agentes independientes buscando por ángulos distintos —fuente oficial,
cómo lo implementan otros ERP dominicanos, y si el formato cambió—, con la
regla de citar la fuente de cada afirmación y **decir explícitamente lo que
no se pudo confirmar**.

La pasada adversarial que debía refutar los hallazgos **no llegó a
correr**: se agotó el límite de sesión. Así que lo de arriba es de una sola
fuente-pass, no verificado en contra. Es una razón más para comparar contra
un archivo real antes de fiarse.

---

## 606 — Compras de bienes y servicios

Añadido el 10 de septiembre de 2026. Es el que faltaba: el repo tenía el
607 y el 608 desde F6, pero sin el 606 un cliente **no puede declarar**,
por muy bien que funcione el mostrador. Vence el día 15 de cada mes.

### De dónde sale

| Fuente | Qué aporta |
|---|---|
| **Norma General 07-2018**, Anexo A | El layout |
| [Comunidad de ayuda DGII, CA3839](https://ayuda.dgii.gov.do/conversations/formatos-de-envo-de-datos/ca3839-cmo-est-compuesto-el-formato-de-compras-de-bienes-y-servicios-606/5f3c17978cd858ce87a1b13d) | Los 23 campos del detalle, en orden, y el encabezado |
| [Comunidad de ayuda DGII, CA2438](https://ayuda.dgii.gov.do/conversations/formatos-de-envo-de-datos/ca2438-cul-es-la-clasificacin-de-costos-y-gastos-que-tiene-el-formato-606/5f3c17608cd858ce879a2751) | Los once códigos de clasificación de costos y gastos |

### Lo confirmado

- **23 campos** de detalle, el mismo número que el 607 (pero **no** los
  mismos campos).
- Encabezado igual en forma al del 607: `606|RNC|AAAAMM|CANTIDAD`.
- El orden de los 23 campos, verificado contra CA3839 de la DGII.
- Los once códigos de clasificación de gasto (01 a 11), verificados
  contra CA2438.
- Nueve códigos de tipo de retención en ISR (01 a 09).

### La diferencia que confunde a todo el mundo

El **607 reparte el total en columnas de monto** por forma de pago
(efectivo, cheque, tarjeta, crédito…). El **606 pide UN solo código**
de forma de pago. Por eso una compra pagada mitad en efectivo y mitad
por transferencia va como `07` (mixto) en el 606 y **no se puede
partir**.

### Lo NO confirmado

1. **Que el encabezado lleve el literal `606` como primer campo.** La
   DGII describe el encabezado como de 3 campos (RNC, período,
   cantidad), pero describe el del 607 igual — y el 607 del repo sí
   lleva el literal, tomado de la norma. Se asume la misma convención.
   Si el primer envío rebota, es lo primero que hay que mirar.
2. **Los siete códigos de forma de pago.** El conjunto (efectivo,
   cheque/transferencia/depósito, tarjeta, compra a crédito, permuta,
   nota de crédito, mixto) está confirmado; **el número exacto que le
   toca a cada uno no** se pudo verificar contra fuente oficial. Se
   asignó 01–07 en ese orden.
3. Las mismas cuatro decisiones sin documentar que el 607: sin pipe
   final, CRLF, UTF-8 sin BOM, campos vacíos entre pipes.

⚠️ **Igual que el 607: NO verificado contra un archivo real aceptado.**

### Lo que el sistema se niega a hacer

Una compra sin clasificar el tipo de gasto **bloquea el TXT completo** y
la pantalla dice qué NCF son. No se le pone un código por defecto: marcar
todo como `09` (costo de venta) declararía el alquiler del local como
mercancía. Mejor no generar el archivo que generarlo mal.

La forma de pago sí **se deriva** de los pagos reales al proveedor —sin
pagos es `04` a crédito, un solo método es su código, varios métodos es
`07` mixto—, porque ese dato ya existe y pedirlo otra vez sería pedirle
al usuario que repita lo que el sistema ya sabe.

### Un bug que este trabajo destapó

Al probar el 606 en vivo salió que el TXT **del 607 tampoco se generaba**:
la consulta que limpia el RNC de la empresa usaba `'\D'` dentro de una
plantilla de JavaScript, y JavaScript se come la barra invertida antes de
que llegue a Postgres. El patrón viajaba como la letra `D`, el RNC salía
con guiones y el archivo se negaba a generarse **culpando al RNC del
cliente**. Corregido a `'[^0-9]'`, que no tiene nada que perder.
