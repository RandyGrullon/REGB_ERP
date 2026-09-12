# Facturación electrónica dominicana (e-CF) — investigación

Qué exige realmente la DGII para emitir Comprobantes Fiscales Electrónicos,
**de dónde sale cada afirmación**, y qué quedó sin confirmar.

Investigado el 10 de septiembre de 2026.

> **Cómo leer este documento.** Cada afirmación lleva su fuente. Lo que dice
> *"sin confirmar"* es exactamente eso: no lo pude verificar, y no se debe
> construir encima sin verificarlo primero.

---

## 0. Lo que esta investigación sí pudo hacer (y la anterior no)

El documento hermano [`DGII-FORMATO-ENVIO.md`](DGII-FORMATO-ENVIO.md) reconoce
dos límites: nunca abrió el artefacto primario (el Excel con macros) y la pasada
adversarial no corrió. Aquí el primero **sí se resolvió**:

- Se **descargaron los XSD oficiales** desde dgii.gov.do y se analizaron
  localmente. No son citas de blogs: son los archivos.
- Se **extrajo el texto** de los PDF normativos y técnicos de la DGII con
  `pdftotext`, en vez de confiar en el resumen de un tercero. Esto importó:
  una tabla del PDF de servicios sale **desalineada** al extraerla, y habría
  hecho creer que `ACECF` es el acuse de recibo. **No lo es** — se corrigió
  leyendo el contenido real de cada XSD (§1.3).

Detalle operativo, por si hay que repetirlo: `dgii.gov.do` devuelve **403** a
`curl` con el User-Agent por defecto. Con un User-Agent de navegador los
archivos bajan sin problema. Un 403 aquí **no** significa "el archivo no existe"
— significa "manda otro User-Agent".

Lo que **no** se hizo: no se corrió una pasada adversarial que intentara refutar
estos hallazgos, ni se ejecutó una sola llamada real contra el ambiente de
pre-certificación. Todo lo de abajo es lectura de especificación, no
comportamiento observado. Es la misma debilidad de la investigación anterior, en
otro nivel.

---

## 1. Formato técnico

### 1.1 Es XML, con XSD publicado por tipo

La DGII fijó XML como lenguaje de intercambio y publica un XSD por cada tipo de
comprobante, "a modo de referencia estructural".

Fuente: [Descripción Técnica Servicios DGII](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Informe%20y%20Descripci%C3%B3n%20T%C3%A9cnica/Descripcion%20Tecnica%20Servicios%20DGII.pdf)
(actualizado 29/05/2026), sección "Lenguaje Estándar de Comunicación".

### 1.2 Los diez tipos de e-CF — confirmados contra los XSD

Existen los 10 que se preguntaban. **No hay otros** en la lista publicada:

| Tipo | Comprobante |
|---|---|
| 31 | Factura de Crédito Fiscal Electrónica |
| 32 | Factura de Consumo Electrónica |
| 33 | Nota de Débito Electrónica |
| 34 | Nota de Crédito Electrónica |
| 41 | Compras Electrónico |
| 43 | Gastos Menores Electrónico |
| 44 | Regímenes Especiales Electrónico |
| 45 | Gubernamental Electrónico |
| 46 | Exportaciones Electrónico |
| 47 | Pagos al Exterior Electrónico |

Fuente: índice de
[Documentación sobre e-CF](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/documentacionSobreE-CF.aspx),
apartado "Documentación Técnica (XSD)". Confirmado además porque la lista
oficial de proveedores autorizados certifica a cada uno para *"31, 32, 33, 34,
41, 43, 44, 45, 46, 47"*.

**Ojo con las fechas de los XSD.** No son un formato congelado:

| XSD | Última modificación |
|---|---|
| 31, 41, 43, 44, 45, 46, 47 | 16/10/2025 |
| **33 y 34** | **01/04/2026** |

Los XSD de notas de débito y crédito cambiaron hace cinco meses. Cualquier
implementación tiene que asumir **versionado de esquemas como trabajo
recurrente**, no como carga inicial.

### 1.3 Los cinco formatos XML y su etiqueta raíz

Esto es lo que la extracción del PDF desalinea. **Verificado abriendo cada XSD**
y leyendo su `<xs:element name="...">` raíz y sus campos:

| Etiqueta raíz | Qué es realmente | Cómo se verificó |
|---|---|---|
| `ECF` | El e-CF | raíz de `e-CF 31/32/...xsd` |
| `ACECF` | **Aprobación Comercial** | contiene `DetalleAprobacionComercial`, `FechaHoraAprobacionComercial` |
| `ARECF` | **Acuse de Recibo** | contiene `DetalleAcusedeRecibo`, `CodigoMotivoNoRecibido` |
| `ANECF` | **Anulación de rangos de e-NCF** | contiene `SecuenciaeNCFDesde` / `Hasta` |
| `RFCE` | Resumen de Factura de Consumo (< RD$250k) | raíz de `RFCE 32 v.1.0.xsd` |
| `SemillaModel` | La semilla de autenticación (`valor`, `fecha`) | raíz de `Semilla v.1.0.xsd` |

Las siglas son contraintuitivas: **ARECF es acuse, ACECF es aprobación
comercial.** Invertirlas es un error silencioso y caro.

### 1.4 Tamaño real del esquema

Medido sobre los archivos descargados:

| | e-CF 31 | e-CF 32 |
|---|---|---|
| Elementos definidos | 237 | 234 |
| Tipos simples (reglas de validación) | 73 | 75 |
| Campos **obligatorios** en Encabezado | 27 | 24 |
| Campos opcionales en Encabezado | 105 | 104 |

Estructura de primer nivel de `ECF`, en orden:
`Encabezado` (1..1) → `DetallesItems` (1..1) → `Subtotales` (0..1) →
`DescuentosORecargos` (0..1) → `Paginacion` (0..1) → `InformacionReferencia`
(0..1) → `FechaHoraFirma` (1..1).

La lectura honesta: **el encabezado obligatorio es chico (24–27 campos), pero la
superficie total es enorme (~235 elementos, ~75 validaciones)**. Se puede emitir
una factura simple cumpliendo poco; lo que consume el tiempo es la cola larga de
casos (ISC, exportación, monedas, retenciones, paginación).

### 1.5 Dónde publica la DGII los esquemas

Página índice:
https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/documentacionSobreE-CF.aspx

Los `.xsd` cuelgan de
`.../Documentacin sobre eCF/Documentación Técnica (XSD)/e-CF 31 v.1.0.xsd`
(nótese `Documentacin`, sin la "ó" — es así en el servidor, no es un typo mío).

### 1.6 Regla de negocio que cambia la arquitectura: el corte de RD$250,000

- Factura de Consumo (32) **≥ RD$250,000** → se envía el e-CF **completo** al
  servicio de recepción normal.
- Factura de Consumo (32) **< RD$250,000** → **no se recibe** por ese servicio.
  Se manda un **resumen (RFCE)** a *otro dominio y otro endpoint*.

> "Las Facturas de Consumo Electrónicas con un monto inferior a los
> RD$250,000.00 no serán recibidas por este servicio"

El emisor igual **debe conservar el e-CF extendido**. Fuente: Descripción
Técnica Servicios DGII, sección "Recepción de e-CF" / "Recepción de RFCE".

Para un ERP de PYMEs esto es *el* camino caliente: la mayoría de las facturas de
un colmado o una tienda de electrónicos caen por debajo de RD$250k, o sea que
**el flujo RFCE no es un caso borde, es el caso principal.**

### 1.7 Nombre de archivo

Formato `RNC+e-NCF`, ejemplo `101672919E3100000001.xml`. Fuente: misma sección.
(Contrasta con el 607, donde el nombre de archivo quedó *sin confirmar* — aquí
sí está en la norma técnica.)

> **Corrección (2026-09-11).** Ese ejemplo tiene el e-NCF con **8** dígitos de
> secuencia (`E31`+`00000001`, 11 caracteres). El e-NCF real son **13**
> caracteres: `E` + 2 de tipo + **10** de secuencia, confirmado contra la DGII
> —*"la letra E indica la serie, los siguientes 2 dígitos el tipo y los últimos
> 10 el secuencial"*—. El ejemplo del documento está abreviado o mal; el nombre
> correcto sería `101672919E310000000001.xml`. El repo ya generaba 10 dígitos
> (`formatNcf` en `dgii.ts`), o sea que **el código estaba bien y el ejemplo de
> la investigación es el que induce a error**. Anotado para que nadie lo
> "arregle" al revés.

---

## 2. Firma digital

### 2.1 El estándar — confirmado en documento oficial

**XMLDSig (W3C), firma envolvente (enveloped), RSA-SHA256.** La DGII publica la
estructura exacta:

```xml
<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
  <SignedInfo>
    <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
    <SignatureMethod        Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
    <Reference URI="">
      <Transforms>
        <Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
      </Transforms>
      <DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
      <DigestValue>...</DigestValue>
    </Reference>
  </SignedInfo>
  <SignatureValue>...</SignatureValue>
  <KeyInfo><X509Data><X509Certificate>...</X509Certificate></X509Data></KeyInfo>
</Signature>
```

Dos reglas explícitas del documento:

- `Reference URI` **tiene que ir vacío** (`URI=""`), para que la firma aplique al
  documento completo.
- SHA256 es **obligatorio**: *"es obligatorio usar este tipo de función al firmar
  el XML de la e-CF"*.

Fuente: [Firmado de e-CF](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Instructivos%20sobre%20Facturaci%C3%B3n%20Electr%C3%B3nica/Firmado%20de%20e-CF.pdf).
La DGII incluye ejemplos de código en C#, VB.Net, **TypeScript**, Java y PHP — y
que exista el ejemplo en TypeScript es relevante para un stack Next.js.

### 2.2 Qué certificado y quién lo emite

Se requiere un **Certificado Digital para Procedimiento Tributario**, emitido por
una entidad de certificación autorizada bajo la **Ley 126-02** de Comercio
Electrónico, Documentos y Firmas Digitales, y debe corresponder a **la persona
física que actuará como Usuario Administrador e-CF**, vinculada al RNC del
contribuyente.

Fuente: [Proceso de Certificación para ser Emisor Electrónico](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Documentaciones%20Proceso%20de%20Certificaci%C3%B3n%20FE/Proceso%20de%20Certificacion%20para%20ser%20Emisor%20Electronico.pdf)
(julio 2025), "Requisitos para solicitar ser autorizado".

**Detalle que sorprende: el certificado es de persona física, no de la empresa.**
Eso hace que el certificado quede atado a un individuo concreto. Si esa persona
se va de la empresa, hay trámite. El propio documento de certificación dedica
una sección al "cambio de representante" — y obliga a **cancelar la postulación
en curso** y empezar otra.

Entidades de certificación acreditadas por **INDOTEL** (fuente secundaria, ver
§9): AVANSI SRL, Cámara de Comercio y Producción de Santo Domingo (Digifirma) y
OGTIC. Listado oficial: https://indotel.gob.do/firma-digital/entidades-de-certificacion/

### 2.3 Costo y vigencia — **NO CONFIRMADO**

**No encontré una tarifa oficial publicada.** Fuentes secundarias (blogs de
proveedores) dicen que varía por emisor y que se renueva anualmente. **No cité
un número de precio porque no lo pude verificar en fuente primaria.** Hay que
pedirlo directo a AVANSI o a la Cámara de Comercio.

Lo que **sí** está en fuente oficial: la DGII ofrece **certificado digital
gratuito** a quienes usen el Facturador Gratuito — *"Someter la solicitud del
certificado digital gratuito a través del Facturador Gratuito"*
([página del Facturador Gratuito](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/facturador-gratuito.aspx)).
Esto es competencia directa, ver §8.

---

## 3. Transmisión

### 3.1 Es REST, con Swagger publicado en cada ambiente

*"arquitectura API REST"*, y *"En cada URL base de los diferentes ambientes se
puede encontrar el documento Swagger (OpenAPI)"*. No es SOAP.

### 3.2 Los tres ambientes

| Ambiente | Slug | Para qué |
|---|---|---|
| Pre-Certificación | `testecf` | pruebas libres; guarda envíos **60 días** |
| Certificación | `certecf` | el set de pruebas formal de la DGII |
| Producción | `ecf` | validez fiscal |

En pre-certificación cada contribuyente recibe rangos de secuencia de 1 a
10,000,000 por tipo (1 a 50,000,000 para el 32), con vencimiento **31-12-2028**
(el 32 y el 34 no llevan vencimiento de secuencia).

### 3.3 Autenticación: semilla → firma → token

Flujo de dos pasos:

1. `GET /api/autenticacion/semilla` → devuelve XML `<SemillaModel>` con `valor` y
   `fecha`.
2. **Se firma esa semilla** con el certificado digital y se manda:
   `POST /api/autenticacion/validarsemilla`, `Content-Type: multipart/form-data`,
   campo `xml`.
3. Respuesta: `{ "token", "expira", "expedido" }`.

El token es **Bearer, y dura 1 hora** — el documento dice literalmente *"1 hora
por el momento"*, o sea que no es un contrato estable. Se usa como
`Authorization: Bearer {token}`. El doc referencia el
[RFC 6750](https://tools.ietf.org/html/rfc6750). El JWT de ejemplo trae
`"iss":"DGII.FE"`.

### 3.4 Endpoints (todos verbatim del documento oficial)

Base e-CF: `https://ecf.dgii.gov.do/{ambiente}/...`
Base facturas de consumo: `https://fc.dgii.gov.do/{ambiente}/...` — **dominio
distinto**, fácil de pasar por alto.

| Servicio | Método | Ruta |
|---|---|---|
| Semilla | GET | `/{amb}/autenticacion/api/autenticacion/semilla` |
| Validar semilla | POST | `/{amb}/autenticacion/api/autenticacion/validarsemilla` |
| **Recepción e-CF** | POST | `/{amb}/recepcion/api/facturaselectronicas` |
| **Recepción RFCE** | POST | `fc.../{amb}/recepcionfc/api/recepcion/ecf` |
| Consulta RFCE | GET | `fc.../{amb}/consultarfce/api/Consultas/Consulta` |
| **Consulta resultado** (por trackId) | GET | `/{amb}/consultaresultado/api/consultas/estado?trackid=` |
| Consulta estado (por RNC+eNCF+cód. seguridad) | GET | `/{amb}/consultaestado/api/consultas/estado` |
| Consulta trackIds | GET | `/{amb}/consultatrackids/api/trackids/consulta` |
| Aprobación comercial | POST | `/{amb}/aprobacioncomercial/api/aprobacioncomercial` |
| Anulación de rangos | POST | `/{amb}/anulacionrangos/api/operaciones/anularrango` |
| Consulta directorio | GET | `/{amb}/consultadirectorio/api/consultas/listado` |
| Directorio por RNC | GET | `/{amb}/consultadirectorio/api/consultas/obtenerdirectorioporrnc` |
| Timbre (QR) | GET | `/{amb}/consultatimbre?...` |
| Timbre FC (QR) | GET | `fc.../{amb}/consultatimbrefc?...` |

El envío del comprobante es **`multipart/form-data` con un campo `xml`**, no un
POST de body XML. Es un detalle que rompe la primera integración de todo el
mundo.

### 3.5 El hallazgo arquitectónico: **la DGII también te llama a ti**

Esto no es un cliente HTTP. En el formulario de postulación el contribuyente
debe declarar **tres URL propias**:

- **URL Recepción** — dónde recibe los e-CF que *otros* le emiten (rol receptor).
- **URL Aprobación** — dónde recibe aprobaciones/rechazos comerciales de los
  e-CF que él emitió.
- **URL Autenticación** — su *propio* servicio semilla→token, para que terceros
  se autentiquen contra él.

Y en el set de pruebas (pasos 8–11) la DGII **envía comprobantes al sistema del
contribuyente** y exige que devuelva los acuses de recibo.

Fuente: Proceso de Certificación, §1.2 pasos 1 y 8–11; y "Comunicación
Emisor-Receptor" en la Descripción Técnica.

**Implicación directa para REGB ERP:** hay que construir **servidor**, no solo
cliente. Y en multi-tenant, cada tenant emisor necesita su propio juego de URL
públicas y alcanzables (o un ruteo por RNC sobre un endpoint compartido —
**diseño sin confirmar**, ver §9).

---

## 4. Acuse y estados

### 4.1 La respuesta al enviar

El POST de recepción **no** devuelve aceptado/rechazado. Devuelve
`{ "trackId", "error", "mensaje" }`. Es asíncrono: el `trackId` es el acuse de
recibo, y con él se consulta el resultado.

### 4.2 Los cinco estados — verbatim

| Código | Estado | Significado |
|---|---|---|
| 0 | No encontrado | no se halló el trackId |
| 1 | **Aceptado** | el e-CF es válido |
| 2 | **Rechazado** | nulo para fines tributarios |
| 3 | **En Proceso** | aún no validado; reconsultar |
| 4 | **Aceptado Condicional** | no cumplió en algún punto, pero **implica la validez del e-CF** |

Dato operativo útil: *"El promedio estimado de validación es de 200 ms."*

**Aceptado Condicional es válido fiscalmente.** Tratarlo como error bloquearía
ventas buenas; tratarlo como éxito limpio esconde irregularidades que la DGII
espera que se corrijan. La UI tiene que distinguirlo.

### 4.3 El campo que evita quemar secuencias

`secuenciaUtilizada` (booleano) dice si el e-NCF **puede reutilizarse** tras un
rechazo:

- `true` = **no** puede reutilizarse
- `false` = **sí** puede reutilizarse

(La polaridad es al revés de lo que sugiere el nombre. Es una trampa.)

Reutilizable cuando el rechazo fue por: certificado/firma inválida, XML mal
estructurado, firmante no delegado, e-NCF no autorizado o vencido, RNC emisor no
es emisor electrónico / no existe / no activo.

### 4.4 Consulta posterior

- Por `trackId` → servicio Consulta Resultado (el emisor).
- Por `RNC emisor + e-NCF + RNC comprador + código de seguridad` → servicio
  Consulta Estado (sirve al receptor). Requiere estar delegado para emisor o
  receptor.

---

## 5. Modo contingencia

Confirmado en documento oficial, con cita normativa: **Art. 40 del Decreto
587-24**, reglamento de la Ley 32-23.

Fuente: [Instructivo de Contingencia de FE](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Instructivos%20sobre%20Facturaci%C3%B3n%20Electr%C3%B3nica/Instructivo-Contingencia-FE.pdf)
(25/02/2026).

Son **dos situaciones distintas**, y se resuelven distinto:

### 5.1 Falta de conectividad (hay sistema, no hay internet)

- Se **generan los e-CF offline** y se remiten al reestablecerse la conexión, en
  **plazo no mayor de 72 horas**.
- Se entrega al cliente una representación impresa con la leyenda obligatoria:
  > "e-CF emitido en modalidad de Contingencia, el cual podrá ser consultado para
  > su validez fiscal, a partir de las setenta y dos (72) horas."

### 5.2 Imposibilidad técnica de emitir e-CF

- Se emiten **comprobantes fiscales NO electrónicos autorizados (Serie B)**.
- **Máximo 15 días calendario.**
- Hay que **notificar a la DGII vía Oficina Virtual** (menú Facturación
  Electrónica → "Contingencia FE"), declarando entrada y salida, en modalidad
  **Total o Parcial** (parcial = solo algunas sucursales).

**Esto es una buena noticia para REGB ERP:** el caso 5.2 exige seguir emitiendo
NCF tradicionales B01/B02 — que el sistema **ya tiene**. La contingencia no es
código nuevo desde cero, es un interruptor sobre lo existente más el manejo de
la cola offline de 72h del caso 5.1.

---

## 6. Representación impresa (RI)

### 6.1 El QR

- Se codifica una **URL al servicio de timbre de la DGII**, concatenando:
  `RncEmisor`, `RncComprador`, `ENCF`, `FechaEmision`, `MontoTotal`,
  `FechaFirma`, `CodigoSeguridad`.
- Ejemplo oficial:
  `https://ecf.dgii.gov.do/testecf/consultatimbre?rncemisor=130000001&rnccomprador=130000002&encf=e310000000001&fechaemision=10-10-2020&montototal=02.11&fechafirma=10-10-2020%2009:00:00&codigoseguridad=dcp79q`
- **QR versión 8** (el doc enlaza qrcode.com/en/about/version.html).
- Para RFCE el QR lleva menos: `RNCEmisor`, `e-NCF`, `MontoTotal`,
  `CódigoSeguridad`, contra `fc.dgii.gov.do/{amb}/consultatimbrefc`.

### 6.2 El código de seguridad — cómo se calcula

> "codigoSeguridad: extraído de los primeros seis (6) dígitos del hash generado
> en el SignatureValue de la firma digital"

O sea: **los primeros 6 caracteres del `SignatureValue`**. No es un número
aleatorio ni lo asigna la DGII: sale de la firma. Fuente: Descripción Técnica
Servicios DGII, secciones Consulta RFCE y Consulta Estado.

### 6.3 Escapado de caracteres

El documento de Emisores Electrónicos trae una tabla de caracteres reservados
que **deben ir en hexadecimal** dentro de la URL del QR (espacio `%20`, `!`
`%21`, `#` `%23`, `$` `%24`, `&` `%26`, `'` `%27`, `(` `%28`, `)` `%29`, `*`
`%2A`, `+` `%2B`, …). Es un `encodeURIComponent` bien hecho, pero está normado.

### 6.4 Los modelos de RI

La DGII publica
[modelos ilustrativos](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Informe%20y%20Descripci%C3%B3n%20T%C3%A9cnica/Representaci%C3%B3n%20Impresa%20(Modelos%20ilustrativos).pdf)
(22/04/2025) que cubren: e-FCF con totales al final, ITBIS en el campo Valor,
ISC, notas de débito y crédito, paginación de 2 páginas, factura de consumo ≥ y
< RD$250k, **papel continuo**, envío diferido, y las dos modalidades de
contingencia.

**Limitación:** ese PDF es **solo imágenes**. Extraje el índice, no los campos.
La lista campo-por-campo obligatoria de la RI **quedó sin confirmar** (§9).

Lo que sí se sabe con certeza: la RI **se valida formalmente en la
certificación** — es el paso 6, y se puede recibir "Representación Impresa
Rechazada". Se sube en PDF, máximo 10MB.

---

## 7. Proceso de certificación

### 7.1 Se certifica **la empresa emisora**, declarando cuál software usa

Esta es la pregunta del encargo y tiene respuesta clara. El formulario de
postulación tiene una sección **"Datos del software a utilizar"** donde se
declara:

- **Tipo de Software:** *"si el software con el que se está certificando es
  adquirido a través de un proveedor externo a su empresa o desarrollado de
  manera interna"*
- Nombre y versión del software
- URL de Recepción, Aprobación y Autenticación
- **Datos del Proveedor** (solo si el software es de un tercero)

O sea: **la certificación la saca el contribuyente (la empresa), no el
producto.** Un ERP no se "certifica" de una vez para todos sus clientes: **cada
cliente emisor pasa su propio proceso**, declarando a REGB ERP como su software.

Esto tiene una consecuencia comercial enorme, y explica el modelo de Gestarux:
el ingreso recurrente no es por licencia de software, es por **acompañar a cada
empresa en su trámite**.

**Excepción:** existe una vía aparte —
[Proceso de Certificación para ser Emisor Electrónico **con Proveedor de
Servicios de FE Certificado**](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Documentaciones%20Proceso%20de%20Certificaci%C3%B3n%20FE/Proceso-Certificacion-EmisorElectronico-Proveedor-Servicios-FECertificado.pdf)
(29/05/2026) — que es más corta. Ahí está el negocio real (§7.4).

### 7.2 Requisitos previos

- RNC inscrito y activo
- Clave de Oficina Virtual
- **Alta de NCF** (autorización para emitir comprobantes)
- Certificado digital de Procedimiento Tributario del Usuario Administrador e-CF
- **Disponer de un software para emitir e-CF**
- Estar al día con las obligaciones tributarias

### 7.3 Las tres etapas y los 14 pasos

`Solicitud` → `Set de Pruebas` → `Certificación`

1. Registrado (postulación en XML, **firmada digitalmente**)
2. Pruebas de Datos (set Excel de la DGII → generar XML → enviar)
3. Pruebas de Datos de Aprobaciones/Rechazos Comerciales
4. Pruebas de Simulación — envío de e-CF con datos reales
5. Pruebas de Simulación (cont.)
6. **Validación de la Representación Impresa** (PDF, ≤10MB)
7. URL de servicios de prueba
8. URL Pruebas de Comunicación (descarga del certificado raíz)
9. **Recepción de e-CF** — la DGII envía, tú devuelves acuses
10. Inicio prueba de Aprobaciones Comerciales
11. **Recepción de Aprobaciones Comerciales**
12. URL de servicios de **producción**
13. **Declaración Jurada** (XML firmado, con responsabilidad legal)
14. Verificación del estatus del contribuyente

Regla dura del paso 2: *"En el caso de que un e-CF generado resulte con estado
'Rechazado', deberá reiniciar la generación del set de datos de prueba."* **Un
rechazo te devuelve al principio del set.**

### 7.4 Ser Proveedor de Servicios de FE (lo que vende Gestarux)

Un **Proveedor de Servicios de FE** es *"todo aquel Emisor Electrónico
autorizado por Impuestos Internos para comercializar servicios de Facturación
Electrónica"*.

Requisitos ([Guía Básica PSP](https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/facturacion/Documents/Facturaci%C3%B3n%20Electr%C3%B3nica/Guia-Basica-Proveedor-de-Servicios-de-Facturacion-Electronica.pdf)):

- RNC activo y clave OFV
- **Estar ya autorizado y certificado como Emisor Electrónico** (o sea: primero
  §7.3 completo, para uno mismo)
- Certificado Digital de Persona Física para procedimientos tributarios (Ley
  126-02)
- **Actividad económica registrada de venta y/o desarrollo de aplicaciones
  informáticas**
- Estar al día en obligaciones
- Cumplir exigencias técnicas de la DGII y anexar documentación de soporte

**Es una secuencia, no un atajo:** para vender e-CF hay que certificarse primero
como emisor uno mismo.

### 7.5 ¿Cuánto tarda? — **NO CONFIRMADO**

**La DGII no publica un plazo** en ninguno de los documentos que revisé. Hay 14
pasos, con validación humana de la RI y reinicios por rechazo. **Cualquier
número que se ponga en un plan sería inventado.** Hay que preguntarlo a la DGII
o a alguien que ya lo pasó.

---

## 8. El contexto comercial que cambia la decisión

### 8.1 El plazo legal **ya venció**

Artículo 37 de la Ley 32-23, **verbatim** del
[texto oficial](https://dgii.gov.do/transparencia/baseLegal/Documents/Leyes/Ley%2032-23.pdf):

> "1) Grandes contribuyentes nacionales: Doce (12) meses […]
> 2) Grandes contribuyentes locales y medianos: Veinticuatro (24) meses […]
> 3) Pequeños, Micro y no clasificados: Treinta y seis (36) meses contados a
> partir de la vigencia de la ley."

Los 36 meses vencieron el **15 de mayo de 2026**. Hoy es septiembre de 2026:
**el segmento exacto al que apunta REGB ERP (PYMEs) ya está legalmente
obligado y en falta.** No es un mercado futuro, es un incumplimiento activo.

(El **15 de mayo de 2026** como fecha concreta viene de fuentes secundarias y de
avisos de la DGII, no del texto del artículo, que fija plazos relativos. La
*vigencia* de la ley y por tanto la fecha exacta **no la verifiqué en el aviso
oficial** — ver §9.)

Art. 7 del Decreto 587-24: los contribuyentes inscritos **después** del
vencimiento tienen **120 días** para implementar (fuente secundaria).

### 8.2 Los incentivos: probablemente ya se perdieron

Art. 41 de la Ley 32-23 fija créditos fiscales para quienes **"se beneficien del
calendario de implementación establecido en el artículo 37"**:

| Clasificación | Crédito fiscal |
|---|---|
| Grandes MIPYMES | RD$300,000 |
| Medianos | RD$200,000 |
| **Pequeños** | **RD$75,000** |
| **Microempresas y no clasificados** | **RD$25,000** |

Art. 39 lo condiciona a haber sido autorizado **"en el periodo de
voluntariedad"**. Art. 40 Párrafo IV **excluye** a quienes usen el Facturador
Gratuito.

**Como argumento de venta esto es delicado:** con el plazo vencido, es muy
probable que el incentivo ya no aplique para un cliente nuevo. **No se puede
prometer.** Si se quiere usar comercialmente, hay que confirmarlo con la DGII
(§9).

### 8.3 El competidor gratuito: el Facturador Gratuito de la DGII

La DGII regala una herramienta de facturación **y el certificado digital**,
dirigida a *"profesionales liberales, Personas Físicas y MIPYMES, que no posean
ningún sistema para estos fines"*.

Condición de elegibilidad: *"no haber sido autorizado a emitir e-CF por otra de
las vías previstas en la Ley 32-23 en el artículo 12"*.

**Esto presiona el precio por abajo** en el segmento más chico. El argumento de
REGB ERP no puede ser "te dejo facturar electrónicamente" — eso es gratis.
Tiene que ser "te dejo facturar electrónicamente **desde el ERP donde ya llevas
inventario, cuentas y 607/608**". Los límites de volumen del Facturador Gratuito
**no los pude confirmar** (§9).

### 8.4 Gestarux **no aparece** en la lista oficial de PSP autorizados

Descargué y parseé la
[lista oficial de Proveedores de Servicios de FE Autorizados](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/Proveedores-servicios-FE-autorizados.aspx).
La cadena "gestarux" **no aparece en el HTML de la página**. Sí aparecen ~47
autorizados (38 con razón social de empresa + personas físicas), entre ellos
ALANUBE SOLUCIONES, THE FACTORY HKA DOMINICANA, VOXEL CARIBE, INDEXA, DIGIFACT,
REPUBLICA FEL, WEBPOS, GURUSOFT.

**Advertencia de honestidad:** esto **no prueba** que Gestarux opere ilegalmente.
Puede estar listado bajo otra razón social/RNC, o puede vender software sin ser
PSP (algo posible: el cliente se certifica solo, declarando el software de un
"proveedor externo", §7.1). Pero **sí significa** que "certificamos empresas
como emisoras" es un servicio de acompañamiento, no un sello que Gestarux
otorgue — **la certificación siempre la emite la DGII a la empresa cliente.**

Y significa otra cosa: **la lista de 47 competidores ya autorizados es la
medida real del mercado.** No está vacío.

---

## 9. Lo que quedó SIN CONFIRMAR

Ordenado por cuánto duele no saberlo.

| # | Sin confirmar | Por qué importa |
|---|---|---|
| 1 | **Nada se probó contra `testecf`.** Cero llamadas reales. | Todo §3 y §4 es lectura de spec. La spec y el servidor pueden diferir. |
| 2 | **Cuánto tarda la certificación.** La DGII no publica plazo. | No se puede prometer fecha a un cliente. |
| 3 | **Costo y vigencia del certificado digital.** Sin tarifa oficial. | Es un costo directo del cliente y entra en el precio. |
| 4 | **Si el incentivo fiscal (§8.2) sigue vivo** con el plazo vencido. | Es un argumento de venta de RD$25k–75k que puede ser falso. |
| 5 | **Campos obligatorios exactos de la RI.** El PDF es solo imágenes. | El paso 6 de certificación puede rebotar por esto. |
| 6 | **Cómo hace multi-tenant las 3 URL por emisor** (§3.5). | Es *la* decisión de arquitectura y no hay guía oficial encontrada. |
| 7 | **Si un emisor 100% e-CF deja de remitir 606/607/608.** Sigue sin confirmarse desde la investigación anterior. | Define si el módulo actual se mantiene o se retira. |
| 8 | **Límites de volumen del Facturador Gratuito.** | Define desde qué tamaño de cliente REGB puede competir. |
| 9 | **La fecha exacta del 15-may-2026** en aviso oficial de la DGII. | Cambia el tono del discurso comercial. |
| 10 | **Si Gestarux es PSP bajo otra razón social.** | Afecta cómo se posiciona uno contra ellos. |
| 11 | **Pasada adversarial: no corrió.** Nadie intentó refutar esto. | Mismo hueco que `DGII-FORMATO-ENVIO.md`. |

---

## 10. Estimación honesta del trabajo

Separando lo que es **código** de lo que es **trámite** — porque son
responsabilidades distintas y el trámite no se acelera contratando.

### 10.1 Código (lo que se puede estimar)

| Bloque | Tamaño | Notas |
|---|---|---|
| Mapeo de dominio → XML por tipo | **Grande** | ~235 elementos, ~75 validaciones por tipo. Arrancar con **31, 32, 33, 34** cubre casi todo el uso de PYMEs. Los 41/43/44/45/46/47 son cola larga. |
| Firma XMLDSig RSA-SHA256 en Node | **Mediano** | Estándar, con ejemplo oficial en TypeScript. El riesgo real es la **canonicalización C14N**, que es donde fallan todas las implementaciones. |
| Cliente HTTP + sesión semilla/token | **Chico** | Token de 1h, refresco, `multipart/form-data`. |
| Máquina de estados asíncrona (trackId, polling, 5 estados, `secuenciaUtilizada`) | **Mediano** | Es lo que decide si se quema o se reutiliza una secuencia. Aquí un bug pierde numeración fiscal. |
| **Camino RFCE (< RD$250k)** | **Mediano** | Otro dominio, otro formato, otro QR. **Es el flujo principal en PYMEs, no un caso borde.** |
| **Servidor: 3 endpoints públicos por emisor** (recepción, aprobación, autenticación) | **Grande** | El pedazo subestimado. Implica ser servidor y resolver multi-tenant (§9 #6). |
| RI en PDF + QR v8 + código de seguridad | **Mediano** | El código sale de los 6 primeros chars del `SignatureValue`. Ojo con el escapado hex de la URL. |
| Contingencia (cola offline 72h + leyenda + fallback a B01/B02) | **Chico–Mediano** | **Se apoya en los NCF tradicionales que ya existen.** Ventaja real de REGB. |
| Gestión de certificados por tenant (custodia, vencimiento, rotación) | **Mediano** | Es material sensible de terceros. Tiene peso de seguridad, no solo de código. |
| Versionado de XSD | **Recurrente** | Los XSD 33 y 34 cambiaron en abril 2026. Esto no termina nunca. |

**Lectura de conjunto:** el emisor "feliz" (31/32 + firma + envío + consulta) es
la mitad chica. Lo que multiplica el trabajo es **el lado servidor, el camino
RFCE y la gestión de certificados multi-tenant.**

### 10.2 Trámite burocrático (no es código y no se acelera programando)

Para REGB ERP como producto:

1. Conseguir certificado digital de persona física (AVANSI / Cámara de Comercio)
   — costo y plazo **sin confirmar**.
2. Certificarse **la propia empresa** como Emisor Electrónico: 14 pasos, con
   validación humana de la RI y reinicio del set ante cualquier rechazo.
3. Solo después: postular como **Proveedor de Servicios de FE**, con actividad
   económica de desarrollo de software registrada y documentación de soporte.

Y por **cada cliente**: su certificado, su alta de NCF, su postulación, su
declaración jurada. Aun con la vía abreviada de §7.1, **el trámite se repite por
cliente**. Eso es precisamente lo que cobra Gestarux a RD$3,000/mes.

### 10.3 Lo que yo diría antes de decidir

- **El plazo vencido (§8.1) es el hecho más fuerte a favor.** Los clientes de
  REGB ERP ya están obligados. No es una feature opcional; sin e-CF el ERP queda
  incompleto para su propio segmento.
- **El trámite, no el código, es el cuello de botella.** Y es también el foso:
  es donde un competidor con 47 rivales ya autorizados gana o pierde.
- **Antes de escribir una línea**, hacer lo barato que esta investigación no
  hizo: sacar un certificado, entrar a `testecf`, firmar un XML y mandarlo. Un
  e-CF aceptado en pre-certificación vale más que todo este documento.

---

## 11. Cómo se investigó

Fuentes primarias (dgii.gov.do) en todo lo que se pudo: XSD **descargados y
analizados localmente**, PDF normativos **extraídos con `pdftotext`** en vez de
resumidos por terceros, y el texto de la Ley 32-23 leído directamente. Fuentes
secundarias (Gosocket, Viafirma, Alegra, blogs de proveedores) **solo** para el
calendario de fechas concretas y las entidades certificadoras — y marcadas como
tales.

Se corrigió al menos un error que la lectura superficial habría producido: la
tabla de etiquetas madre del PDF de servicios sale desalineada, y `ACECF` /
`ARECF` habrían quedado invertidos. Se resolvió leyendo los XSD reales.

**No corrió una pasada adversarial.** Igual que en `DGII-FORMATO-ENVIO.md`. Lo
de arriba es una sola pasada con fuentes citadas, no un hallazgo verificado en
contra. Trátese en consecuencia.

---

## 10. Lo que encontró validar contra el XSD de verdad (2026-09-11)

Se descargó `e-CF 32 v.1.0.xsd` (123 KB) de dgii.gov.do y se validó un
documento generado con `lxml`. Dos hallazgos que **leer el esquema a ojo
no había dado**, y que se replican con
`python scripts/validar-ecf-xsd.py`:

### 10.1 La firma es un hijo OBLIGATORIO del documento

Después de `FechaHoraFirma`, el esquema pide:

```xml
<xs:any processContents="skip" minOccurs="1" maxOccurs="1"/>
```

`minOccurs="1"`. O sea: **un e-CF sin firmar no valida contra el
esquema**, por perfecto que esté el resto. La firma no es un paso
posterior opcional — es parte del documento. Eso cambia el orden de
trabajo: no se puede "dejar la firma para después" y dar el XML por
terminado.

### 10.2 `TelefonoEmisor` exige guiones

Patrón `\d{3}-\d{3}-\d{4}`. Un teléfono en dígitos corridos —que es como
sale de cualquier base de datos— **invalida el documento entero por un
campo opcional**. El generador ahora lo formatea, y si no cabe en ese
formato lo omite en vez de romper el e-CF.

### 10.3 Confirmación definitiva del e-NCF de 13 caracteres

`eNCFValidationType` dice `minLength=13, maxLength=13` con patrón
`([a-z0-9A-Z]{13})`. Cierra la duda de §1.7 desde la fuente primaria: son
13, y el ejemplo de nombre de archivo del documento de la DGII está
abreviado.

### 10.4 Valores permitidos, verbatim del esquema

| Campo | Valores |
|---|---|
| `TipoeCF` | 31, 32, 33, 34, 41, 43, 44, 45, 46, 47 |
| `TipoIngresos` | 01–06 |
| `TipoPago` | 1, 2, 3 |
| `FormaPago` | 1–8 |
| `IndicadorFacturacion` | 0–4 |
| `IndicadorBienoServicio` | 1, 2 |
| `FechaEmision` | `DD-MM-AAAA` (no ISO) |
| `FechaHoraFirma` | `DD-MM-AAAA HH:mm:ss` (espacio, no "T") |
| Montos | `[0-9]{1,16}(\.[0-9]{1,2})?` — sin separador de miles |

El XSD quedó versionado en `supabase/xsd/` para que la validación no
dependa de que dgii.gov.do esté arriba.

---

## 11. La firma, construida y verificada (2026-09-11)

`@regb/ecf-firma` firma un e-CF con XMLDSig envolvente, RSA-SHA256 y C14N,
como exige el instructivo. Probado con un certificado **autofirmado**
generado al vuelo: no sirve para la DGII, pero prueba lo único que se
puede probar sin uno real.

**Tres verificaciones independientes, las tres en verde:**

1. El `DigestValue` recalculado con `lxml` (otra implementación, otro
   lenguaje) coincide con el declarado.
2. La firma verifica con `xml-crypto`.
3. El documento firmado **valida contra el XSD oficial**.

### 11.1 Dos trampas de `xml-crypto` que habrían llegado hasta producción

Ninguna da error al firmar. Las dos producen un documento que se ve
perfecto y que la DGII rechazaría.

**a) Los elementos vacíos rompen la firma.** `xml-crypto` calcula el
digest sobre su propia serialización, que escribe los elementos vacíos
auto-cerrados (`<a/>`). El C14N del W3C dice lo contrario: un elemento
vacío **siempre** se canonicaliza como `<a></a>`. Comprobado midiendo los
dos hashes:

```
declarado:                DPZUpvVfVAOC+ApWq/4di3BjyPqSBFKE5xw0dBkLi/Q=
C14N correcto (<a></a>):  2o6Ha45GnMvVy884yOJEznzDIlHHfxSsb9EvGwiWse4=
auto-cerrado (<a/>):      DPZUpvVfVAOC+ApWq/4di3BjyPqSBFKE5xw0dBkLi/Q=  <<< este
```

**No es teórico:** el esquema exige `<Comprador>` (1..1) y en una venta de
mostrador a consumidor final no hay nada que poner dentro. O sea que el
caso más común de una PYME dominicana es justo el que rompía.

Dos defensas: el generador escribe `CONSUMIDOR FINAL` en
`RazonSocialComprador` —lo que ya dice cualquier factura de consumo en
papel— y el firmador **se niega a firmar** un documento con elementos
vacíos, nombrándolos.

**b) `uri: ''` no es lo mismo que `isEmptyUri`.** Con el primero,
`xml-crypto` le añade un atributo `Id="_0"` a la raíz para poder
apuntarle, y el XSD **no admite un `Id` en `<ECF>`**: el documento deja de
validar. Con `isEmptyUri: true` emite `URI=""` —lo que la DGII exige
literalmente— y no toca el documento.

### 11.2 Lo que sigue sin poder probarse

- **Firmar con un certificado real.** Hace falta un Certificado Digital
  para Procedimiento Tributario, de **persona física** (Ley 126-02).
- Que la DGII acepte esta firma. Nuestra verificación es consistente
  consigo misma y con el estándar; la de ellos es la que cuenta.

---

## 12. Transporte construido (2026-09-11)

`@regb/ecf-firma` incluye ahora el cliente: autenticación semilla→token,
envío y consulta de resultado. 38 pruebas contra un `fetch` inyectado —
sin red y sin certificado.

**Las cuatro cosas que rompen la primera integración, ya resueltas en
código:**

1. El envío es **`multipart/form-data` con un campo `xml`**, no un POST
   con el XML en el cuerpo.
2. Las facturas de consumo por debajo de RD$250,000 van a **otro
   dominio** (`fc.dgii.gov.do`). Hay dos funciones de URL, no una, para
   que no se pueda confundir por descuido.
3. La autenticación es **en dos pasos con firma**: se pide una semilla,
   se firma, se cambia por un token. No hay usuario y contraseña.
4. El POST de envío **no dice aceptado ni rechazado**: devuelve un
   `trackId`. El veredicto se consulta después.

**Un defecto que encontró una prueba:** con una respuesta que no era
JSON, el cliente reportaba "respuesta ilegible" y **perdía el código
HTTP**. Un 503 con una página de error delante quedaba indistinguible de
un cuerpo corrupto, escondiendo lo único accionable: que el servicio
está caído. Ahora el código HTTP manda cuando la llamada falla, y el
motivo de la DGII se conserva al lado si lo hubo.

**El token se cachea** y se descuenta un margen de 60 s a su vigencia:
uno que expira en diez segundos ya no sirve, porque entre pedirlo y que
la DGII procese el envío pasa tiempo. La duración (1 hora) **no se
codifica**: sale de la respuesta, porque el propio documento la da como
provisional.

⚠️ **Ninguna llamada se ha hecho contra un servidor real.** Hace falta el
certificado de persona física para dar el primer paso.

---

## 13. El resumen (RFCE) construido — y un defecto en el XSD de la DGII

### 13.1 El atajo que no existe

El resumen **no reemplaza** al e-CF completo: lo resume. Lleva un campo
`CodigoSeguridadeCF` que son los 6 caracteres del `SignatureValue` **del
documento completo**. Así que para mandar el resumen hay que:

1. armar el e-CF completo,
2. **firmarlo** — de ahí sale el código,
3. conservarlo (la norma obliga),
4. armar el resumen con ese código dentro,
5. **firmar también el resumen**,
6. mandar el resumen a `fc.dgii.gov.do`.

Lo natural sería pensar *"factura chica, armo solo el resumen"* y es
**imposible**: sin el documento completo firmado no existe el código que
el resumen exige. Dado que este es el camino principal de una PYME, es
una restricción que cambia el diseño y no una nota al pie.

Lo que el resumen NO lleva: `DetallesItems`, ni una línea. Tampoco la
dirección ni el teléfono del emisor. Pesa ~85% de lo que pesa el
completo en el ejemplo probado.

### 13.2 El `RFCE 32 v.1.0.xsd` publicado NO COMPILA

Verificado con `lxml`. El archivo trae patrones que la especificación de
XML Schema no admite, así que **ningún validador conforme puede
cargarlo**:

| Defecto | En el RFCE | En el e-CF 32 (correcto) |
|---|---|---|
| Grupo sin captura | `(?:19\|20)` ×4 — XSD no los soporta | `((19\|20)` |
| Clase de caracteres | `[12][$0-9]` — `$` colado | `[12][0-9]` |

`scripts/validar-ecf-xsd.py` los corrige **en memoria** y avisa cuando lo
hace. El archivo en `supabase/xsd/` se deja tal como lo publica la DGII:
es la fuente, y falsearla escondería el problema.

Con esa corrección mínima, nuestro resumen firmado **valida**, y su firma
verifica con lxml de forma independiente.
