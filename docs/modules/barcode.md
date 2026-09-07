# `barcode` — Codigos de barra & RFID

**Que resuelve:** EAN-13 real con digito verificador calculado -no un
numero inventado a mano-, etiquetas listas para imprimir con el codigo
de barras dibujado de verdad, y escaneo con la camara del celular
-con entrada manual como respaldo, identica a un lector fisico-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `products`

---

## EAN-13 real, no un numero al azar

`digitoVerificadorEan13()` (`@regb/operations`) implementa el
algoritmo oficial de GS1: impares ×1, pares ×3, resto de 10. Probado
contra un EAN-13 real conocido (`4006381333931`, el ejemplo estandar
de GS1/Wikipedia) antes de generar el primero propio. `generarCodigosFaltantes()`
asigna un codigo nuevo a cada producto activo sin uno, con el prefijo
`20` -el rango que GS1 reserva para circulacion restringida/uso
interno, no un prefijo de pais real inventado-.

## El codigo de barras se dibuja de verdad, sin ninguna libreria

`patronBarrasEan13()` codifica el patron completo de 95 modulos -guarda
lateral, 6 digitos izquierdos (L o G segun la paridad que marca el
primer digito), guarda central, 6 digitos derechos (R)- usando las
tablas oficiales del estandar. La pantalla de etiquetas lo convierte
en rectangulos SVG directamente: es un codigo de barras real, escaneable
por cualquier lector, no una imagen generica ni un placeholder.

## Escaneo: camara donde el navegador la soporta, manual donde no

`EscaneoCodigoBarras` (componente cliente) usa `BarcodeDetector`, la
API nativa del navegador -sin libreria externa-. Donde no existe
(Safari y la mayoria de navegadores fuera de Chrome/Edge/Android), la
pantalla NUNCA pide camara: se queda en la entrada manual, que funciona
identico a un lector fisico tipo "keyboard wedge" -escribe o escanea,
Enter, listo-. Verificado en el navegador de este entorno (sin
`BarcodeDetector`): el mensaje de respaldo aparecio correctamente y la
busqueda manual funciono igual.

## No agrega una columna nueva -escribe sobre la que ya existia

`products.barcode` y su indice unico parcial (`products_barcode_idx`)
ya existian desde el catalogo original (0016). Este modulo no la
duplica ni la reemplaza: la generacion escribe ahi directamente. La
unica tabla nueva es `barcode_scans`, una bitacora de cada escaneo
-inmutable desde el primer insert, igual que `audit.log`-.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/codigos-barra` | `barcode.view` | Catalogo con codigo asignado o no, generar los que faltan |
| `/codigos-barra/etiquetas` | `barcode.view` | Etiquetas para imprimir, con el codigo de barras real dibujado |
| `/codigos-barra/escaneo` | `barcode.scan` | Camara o entrada manual, busca el producto y muestra su existencia por almacen |

## Manifiesto

- **Permisos:** `view`, `generate`, `scan`
- **Widgets:** `products-without-barcode`
- **Requiere:** `products`
- **Emite:** `barcode.code.generated`, `barcode.product.scanned`
- **Plataformas:** web, escritorio y movil (`mobileScope: ['view', 'scan']`)

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/barcode.test.ts` — 7 casos: aislamiento, spoofing de tenant via producto ajeno, inmutabilidad incondicional del escaneo, modulo apagado |
| 3 | Logica pura con cobertura | ✅ `barcode.ts` — 11 pruebas: digito verificador contra un EAN-13 real conocido, generacion, validacion, y el patron de barras completo (95 modulos, guardas en su lugar, paridad distinta segun el primer digito) |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: generados dos EAN-13 reales en vivo (validados de nuevo con `codigoEan13Valido()`), etiquetas con las barras dibujadas correctamente para los tres productos, escaneo manual encontrando el producto correcto con su existencia por almacen, y un codigo inexistente mostrando "sin coincidencia" sin registrar ningun escaneo falso |
| 5 | UI movil | 🔜 F9 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un producto con EAN-13 ya asignado y un escaneo previo registrado; dos productos deliberadamente sin codigo, para que "generar codigos faltantes" tenga trabajo real en la demo |
| 9 | ≥2 widgets | ⚠️ solo 1 (`products-without-barcode`): el modulo es principalmente generacion/etiquetas/escaneo, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 3 pantallas |

## Lo que NO hace

- **RFID.** El nombre del catalogo lo menciona, pero no hay hardware de
  lectura RFID que integrar en este sistema. Optico solamente.
- **Escaneo con camara en todos los navegadores.** Depende de
  `BarcodeDetector`, no soportada en Safari ni la mayoria de
  navegadores fuera de Chrome/Edge/Android -la entrada manual siempre
  esta disponible como respaldo real, no decorativo-.
- **Prefijos de pais/empresa reales de GS1.** Los codigos generados
  usan el rango `20` de circulacion restringida -no son codigos
  registrados ante GS1 para venta en comercios que verifiquen el
  prefijo real-.
