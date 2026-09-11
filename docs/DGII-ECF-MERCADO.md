# e-CF en República Dominicana — realidad práctica, regulatoria y de mercado

> Investigación para REGB ERP. Enfoque: negocio pequeño (colmado, ferretería, tienda de
> electrónicos) en Santo Domingo y el negocio de venderle software.
> Fecha de la investigación: **10 de septiembre de 2026**.
> Este documento NO cubre el formato XML ni la firma digital (eso lo ve otro investigador).

---

## 0. TL;DR — la respuesta corta

| Pregunta | Respuesta |
|---|---|
| ¿Desde cuándo está obligado un negocio pequeño? | **15 de noviembre de 2026** (era 15 de mayo 2026, la DGII dio prórroga de 6 meses) |
| ¿Cuánto falta desde hoy (10/sep/2026)? | **~9 semanas** |
| ¿Habrá otra prórroga? | El director de la DGII dijo públicamente el 10/sep/2026 que **no** |
| ¿Existe herramienta gratis de la DGII? | **Sí**, el Facturador Gratuito (~150 facturas/mes, gratis de verdad) |
| ¿Hace falta un proveedor autorizado? | **No**. La ley permite sistema de desarrollo propio certificado ante la DGII |
| ¿Es urgente que REGB ERP emita e-CF? | **Sí, pero no para vender "e-CF por sí solo"** — ver sección 8 |

---

## 1. Calendario de obligatoriedad (LO MÁS IMPORTANTE)

### 1.1 Lo que dice la ley (texto literal)

Ley núm. 32-23 de Facturación Electrónica, promulgada el **16 de mayo de 2023**.
**Artículo 37.- Calendario de implementación** (texto literal del PDF oficial de la DGII):

> 1) Grandes contribuyentes nacionales: Doce (12) meses contados a partir de la vigencia de la ley;
> 2) Grandes contribuyentes locales y medianos: Veinticuatro (24) meses contados a partir de la vigencia de la ley; y
> 3) Pequeños, Micro y no clasificados: Treinta y seis (36) meses contados a partir de la vigencia de la ley.

Fuente (PDF oficial DGII): https://dgii.gov.do/transparencia/baseLegal/Documents/Leyes/Ley%2032-23.pdf

El **Párrafo II del art. 37** además permite que un contribuyente, *de mutuo acuerdo con la DGII*,
acuerde una extensión individual de su plazo, previa aprobación o rechazo de la DGII.

### 1.2 Cómo quedaron las fechas en la práctica

| Grupo | Plazo de ley | Fecha efectiva |
|---|---|---|
| Grandes contribuyentes nacionales | 12 meses → may/2024 | **mayo 2024** (confirmado, ya vencido) |
| Grandes locales y medianos | 24 meses → may/2025 | **15 de noviembre de 2025** (hubo prórroga; ver nota) |
| **Pequeños, Micro y no clasificados** | 36 meses → **15 mayo 2026** | **15 de noviembre de 2026** ← *aquí caen los colmados, ferreterías, la tienda de electrónicos* |

> Nota sobre grandes locales/medianos: la prensa dominicana de agosto 2026 reportaba que a
> partir de **noviembre de 2026** grandes locales y medianos deben emitir **exclusivamente**
> facturas electrónicas, lo que sugiere que ese grupo también arrastró plazos/prórrogas.
> **No pude reconstruir con fuente oficial el detalle exacto de la(s) prórroga(s) de ese grupo** —
> ver sección "No confirmado". Para REGB ERP no cambia nada: el grupo relevante es Pequeños/Micro.
> - https://listindiario.com/economia/20260828/noviembre-grandes-medianos-contribuyentes-deberan-emitir-facturas-electronicas_919969.html

### 1.3 La prórroga de pequeños y micro — FUENTE OFICIAL

**Aviso DGII núm. 06-26, del 6 de mayo de 2026**, firmado por Pedro Urrutia Sangiovanni,
Director General. Texto literal:

> "La Dirección General de Impuestos Internos (DGII) informa a todos los contribuyentes
> identificados como Pequeños, Micros y no clasificados cuya fecha límite para la implementación
> de la Factura Electrónica es el quince (15) de mayo del año 2026, que se ha otorgado una
> **prórroga administrativa de carácter excepcional y generalizada por un período de seis (6)
> meses** contados a partir de la referida fecha. **Esta prórroga será concedida automáticamente,
> sin necesidad de realizar una solicitud.**
>
> Una vez vencido el plazo de otorgado, los contribuyentes que no hayan implementado la
> facturación electrónica, serán pasibles de las sanciones previstas en el artículo 27 de la
> Ley núm. 32-23, por las infracciones tributarias estipuladas en su artículo 26."

Fuente (PDF oficial): https://dgii.gov.do/publicacionesOficiales/avisosInformativos/Documents/2026/06-26.pdf
Nota de prensa DGII: https://dgii.gov.do/noticias/Paginas/DGII-otorga-prorroga-seis-meses-Peque%C3%B1os-Micros-y-no-clasificados.aspx
Cobertura: https://www.diariolibre.com/economia/negocios/2026/05/06/dgii-da-prorroga-para-implementacion-de-facturacion-electronica/3524934

➡️ **15 de mayo 2026 + 6 meses = 15 de noviembre de 2026.**
Es automática: el cliente no tiene que pedir nada, pero tampoco le sirve de excusa después.

### 1.4 ¿Viene otra prórroga? — dato fresco de HOY

El **10 de septiembre de 2026** (hoy), el director de la DGII, **Pedro Urrutia**, declaró
públicamente que **no habrá otra prórroga**:

> "tendrá consecuencia (quien no lo haga) porque no podemos estar de prórroga en prórroga"

Datos que dio en esa misma nota:
- ~**87,000** de **más de 200,000** contribuyentes alcanzados ya se registraron.
- Emisores electrónicos autorizados: **23,686** (enero 2026) → **84,003** (septiembre 2026).
- Ya se han emitido **2,077 millones** de e-CF.

Fuente: https://www.diariolibre.com/economia/negocios/2026/09/10/dgii-advierte-no-habra-prorroga-para-la-factura-electronica/3655048

➡️ Lectura de negocio: **faltan más de 110,000 contribuyentes por incorporarse en 9 semanas.**
Ese es exactamente el mercado de Randy. Y la curva de adopción (23k → 84k en 8 meses) dice que
el pico de demanda es AHORA, entre septiembre y noviembre 2026.

### 1.5 Validez de los comprobantes en papel (tipo B)

Varias fuentes secundarias indican que las secuencias de comprobantes **no electrónicos tipo "B"**
asignadas a este grupo solo son válidas **hasta el 31 de octubre de 2026**, conforme al
**artículo 55 del Reglamento 587-24**.

- https://blog.alegra.com/republica-dominicana/prorroga-ecf-pymes/

⚠️ **No pude verificar el texto del art. 55 del Decreto 587-24 en fuente oficial.** Si es cierto,
el corte real para un colmado es **31 de octubre**, no el 15 de noviembre — o sea, 2 semanas antes.
**Verificar antes de usarlo como argumento de venta.**

---

## 2. Qué pasa si no cumples (sanciones)

### 2.1 Infracciones tributarias — Art. 26 Ley 32-23 (texto literal, parcial)

> "1) La inobservancia del uso de factura electrónica, salvo en los casos excepcionales que prevé esta ley;
> 2) La emisión de facturas electrónicas sin el debido reconocimiento y autorización por parte de la DGII;
> 3) La no disposición de un certificado digital para Procedimiento Tributario...
> 7) La modificación de una factura electrónica luego de firmada y enviada a la DGII;
> 8) La emisión de facturas electrónicas que no cumplan con el formato estándar establecido por la DGII;
> ...
> 16) El no envío oportuno a la DGII de los comprobantes fiscales electrónicos."

### 2.2 Las sanciones — Art. 27 y 28

> **Artículo 27.- Sanciones.** Lo dispuesto en los numerales 1) al 15) del artículo 26 será
> sancionado según lo establecido por el **artículo 257 de la Ley núm. 11-92** (Código Tributario).
>
> **Artículo 28.-** Lo dispuesto en el numeral 16) será sancionado según el **numeral 3) del
> artículo 205** del Código Tributario.

**Artículo 257 del Código Tributario** = incumplimiento de deberes formales:
**multa de cinco (5) a treinta (30) salarios mínimos**, más sanciones accesorias de suspensión
de concesiones/privilegios o **cierre del local**, según agravantes. En casos de incumplimiento
relativo a envío de información, puede añadirse **0.25% de los ingresos declarados en el período
fiscal anterior**.

- https://dgii.gov.do/legislacion/leyesTributarias/Documents/Codigo%20Tributario%20y%20Leyes%20que%20lo%20modifican%20y%20complementan/11-92.pdf
- https://siemprealdia.co/republica-dominicana/impuestos/incumplimiento-de-los-deberes-formales-del-contribuyente/

⚠️ **No confirmé cuál salario mínimo aplica** (sector público vs. privado, y cuál escala), así que
**no puedo dar el monto exacto en RD$**. Fuentes secundarias hablan de "5 a 50 salarios mínimos",
pero el texto de la ley remite al art. 257, que dice **5 a 30**. Usar 5–30 y decir "según el
salario mínimo vigente".

### 2.3 Lo penal (esto sí asusta, pero es otra cosa)

- **Art. 30 — facturas apócrifas**: 1 a 5 años de prisión, multa del **duplo al cuádruplo** del
  valor de la factura, y **cierre definitivo del negocio**.
- **Art. 31 — hacking / alterar el sistema de la DGII**: 5 a 10 años de prisión y multa de
  100 a 400 salarios mínimos del sector público.

Estos aplican a fraude, no a "no me dio tiempo de implementar". No los uses para asustar clientes.

### 2.4 La consecuencia comercial real (más importante que la multa)

Una factura que no es e-CF válido **no sustenta crédito fiscal ni gasto** para el comprador
(arts. 13 y 14 de la Ley 32-23). Traducción para una ferretería: **sus clientes empresa dejan de
comprarle** porque no pueden deducir. Esa es la presión real que empuja al pequeño, más que la multa.

Argumento adicional: **Art. 34** — los proveedores del Estado autorizados como emisores
electrónicos quedan **exentos de la retención del 5% del ISR** en pagos del Estado. Si el cliente
le vende al gobierno, eso es flujo de caja inmediato.

---

## 3. El Facturador Gratuito de la DGII — competencia directa y gratis

### 3.1 Sí existe, y es oficial

Está en la propia ley. **Art. 12 de la Ley 32-23**, vías para emitir e-CF (texto literal):

> "1) **Sistemas de desarrollo propio**: La DGII autorizará a los contribuyentes que deseen
> incorporarse a la facturación electrónica a través de un sistema de desarrollo propio, siempre
> y cuando cumplan con los requisitos establecidos para la emisión y recepción de E-CF;
> 2) **Proveedores de servicios de facturación electrónica**: El contribuyente podrá implementar
> un sistema de facturación electrónica a través de un proveedor de servicios de facturación
> electrónica que haya sido certificado...; y
> 3) **Facturador gratuito**: La DGII dispondrá de una facilidad tecnológica gratuita para emisión
> de comprobantes fiscales electrónicos, destinada a los contribuyentes que cumplan con los
> criterios definidos para el uso de esta herramienta..."

- Página oficial: https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/facturador-gratuito.aspx
- Portal de uso: https://fg.dgii.gov.do/ecf/PortalFG/home

### 3.2 Requisitos (FAQ oficial de la DGII, texto literal)

> "• Estar inscrito en el Registro Nacional de Contribuyentes (RNC).
> • Tener autorización para emitir Números de Comprobantes Fiscales (Alta NCF).
> • Poseer clave de acceso a la Oficina Virtual (OFV)...
> • Disponer de un computador con servicio de internet.
> • **No haber sido autorizado para emitir e-CF a través de un sistema diferente al FG.**
> • Disponer certificado digital para procesos tributarios."

Fuente: https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Preguntas%20frecuentes/Generales/Preguntas-Frecuentes-Facturador-Gratuito.pdf

### 3.3 El límite: ~150 facturas al mes (texto literal de la DGII)

> **"64. ¿Existe un límite de facturas o monto en el Facturador Gratuito?**
> El Facturador Gratuito no establece un límite de monto por factura; sin embargo, contempla un
> **volumen aproximado de emisión de hasta 150 facturas mensuales**, al estar orientado a
> contribuyentes con bajo nivel de facturación."

Confirmado también en la Comunidad de Ayuda DGII: *"a través del facturador gratuito puede emitir
mensualmente un aproximado de 150 facturas"*.
- https://ayuda.dgii.gov.do/conversations/discusiones/hay-un-lmite-de-ecf-que-puedo-emitir-por-el-facturador-gratuito/65159ff4df3a4f374f2c6b1d

Otros datos del FAQ oficial:
- **Costo: cero.** *"No, es completamente gratuito y no requiere instalación ni costos de mantenimiento."*
- La DGII otorgó **30,000 certificados digitales gratuitos** de uso exclusivo en el FG, con fecha
  límite de solicitud **antes del 30 de septiembre de 2025** (⚠️ **ya venció**; no confirmé si se
  reabrió el cupo).
- El certificado del FG **dura 1 año** y es de **uso exclusivo dentro del FG**.
- **No maneja retenciones**, salvo e-CF tipo 41 (compras) y 47 (pagos al exterior).

### 3.4 Lo que el Facturador Gratuito NO hace (aquí vive REGB ERP)

Según fuentes secundarias de proveedores (⚠️ parte interesada, pero coherente con el FAQ oficial):
no genera formatos **606/607** ni la declaración **IT-1**, no lleva contabilidad, inventario, POS
ni nómina, y hay que cargar/usar el certificado en cada emisión.
- https://galileocontabilidad.com/comparativas/galileo-vs-facturador-gratuito-dgii/
- https://micromza.com/facturador-gratuito-dgii/

### 3.5 🔴 EL DATO QUE MÁS VALE COMERCIALMENTE

**Usar el Facturador Gratuito te descalifica del incentivo fiscal.** Dos confirmaciones:

- **Ley 32-23, Art. 40, Párrafo IV** (literal): *"Quedan excluidos de los incentivos establecidos
  en este artículo aquellos contribuyentes beneficiados por la DGII en la facilidad tecnológica del
  facturador gratuito, así como los acogidos a regímenes especiales de tributación con exenciones
  del pago de impuestos."*
  (Ojo: ese párrafo está redactado dentro del art. 40, que es el de **grandes nacionales**.)
- **Comunidad de Ayuda DGII (CA4902)**: *"Quienes utilizaron el Facturador Gratuito y luego
  migraron a sistemas certificados no pueden acceder al incentivo."*
  https://ayuda.dgii.gov.do/conversations/facturacin-electrnica/ca4902-en-qu-consiste-el-incentivo-fiscal-que-se-otorgar-por-la-implementacin-de-la-facturacin-electrnica/646f82c630f12540269005aa

➡️ Para un **pequeño contribuyente** el incentivo es **RD$75,000** y para **micro/no clasificado**
**RD$25,000** (sección 5). Si se va al Facturador Gratuito, **pierde ese crédito fiscal**.
Ese es el mejor argumento de venta que existe: *"el gratis te sale caro, te cuesta RD$75,000".*

⚠️ **A verificar con un contador**: la exclusión textual del Párrafo IV está en el artículo de
grandes nacionales, no en el de MIPYMES (art. 39/41). La DGII lo interpreta como general en su
Comunidad de Ayuda, pero conviene confirmarlo formalmente antes de ponerlo en un brochure.

**Conclusión sobre el FG**: para un colmado que emite **menos de 50 facturas al mes**, el
Facturador Gratuito **cumple la ley perfectamente y cuesta RD$0**. Cualquier modelo de negocio
que dependa de cobrarle a ese cliente **solo por emitir e-CF** compite contra gratis y pierde.

---

## 4. Precios del mercado dominicano

### 4.1 Gestarux (el competidor mencionado) — precios PÚBLICOS de su web

De https://gestarux.com/ (se anuncia como *"Proveedor Autorizado por la DGII"*):

| Plan | Precio | Incluye |
|---|---|---|
| Micro | **RD$750/año** | hasta 40 facturas al **año**; RD$18.75 por factura extra |
| Básico | **RD$2,250/mes** | hasta 500 facturas/mes; RD$4.50 por extra |
| Intermedio | **RD$3,990/mes** | hasta 3,000 facturas/mes; RD$1.33 por extra |
| Corporativo | a cotizar | — |

🔴 **Discrepancia importante con lo que te contaron.** En la web de Gestarux **no aparece ningún
costo de instalación de RD$43,000**, y el tramo más bajo mensual es RD$2,250 (no RD$3,000).
**No pude confirmar el RD$43,000 de instalación ni el RD$3,000/mes en ninguna fuente pública.**
Posibles explicaciones: (a) es precio de implementación/integración a medida con FACTUSOL,
no el plan estándar; (b) incluye certificado digital, capacitación y migración; (c) el dato del
cliente mezcla conceptos. **Antes de construir la estrategia de precio sobre ese número, pedir
la cotización real en papel.** Igual el punto de fondo se sostiene: **al cliente de menos de 50
facturas/mes le están cobrando un plan diseñado para 500.**

### 4.2 Otros proveedores con precios públicos

| Proveedor | Precios | Fuente |
|---|---|---|
| **Alegra** | Emprendedor US$19/mes (ingresos hasta RD$125k/mes, 2 usuarios); Pyme US$35/mes (hasta RD$500k/mes); Pro US$69/mes (hasta RD$1.25MM/mes). Facturas **ilimitadas**, reportes DGII, POS offline, nómina | https://www.alegra.com/rdominicana/factura-electronica/ |
| **DGMax** | Starter US$35/mes (US$31 anual) 800 docs/mes; PyME US$55/mes 2,000 docs/mes; Business US$95/mes 6,000 docs/mes; Enterprise a cotizar. Usa **"límites soft"**: no bloquea al pasarse | https://dgmax.do/blog/precios-facturacion-electronica-rd |
| **Galileo** | Plan gratuito US$0/mes hasta **10 e-CF/mes**; Premium US$60/mes por empresa | https://galileocontabilidad.com/facturacion-electronica/ |
| **Rango general del mercado** | RD$0 (Facturador Gratuito) hasta ~RD$4,500/mes premium; la mayoría de PYMEs paga entre **RD$890 y RD$2,200/mes** | https://holabill.com/blog/posts/costo-facturacion-electronica-rd |

### 4.3 ¿El cobro por tramos de cantidad de facturas es el estándar?

**Es común, pero NO es el único modelo, y está en retroceso.** Tres modelos conviven:

1. **Por tramos de documentos** (Gestarux, DGMax) — el más común entre proveedores puramente e-CF.
2. **Por tramos de ingresos con facturas ilimitadas** (Alegra) — cobra por tamaño del negocio,
   no por volumen de documentos.
3. **Freemium** (Galileo: 10 e-CF/mes gratis) — para captar y luego subir.

Dos detalles que importan para posicionar REGB ERP:
- DGMax vende explícitamente sus **"límites soft"** como diferenciador → señal de que el mercado
  **odia el bloqueo por exceder el tramo**.
- Alegra vende **"facturas ilimitadas"** como diferenciador → señal de que el mercado **odia
  contar facturas**.

➡️ Hay hueco claro para: **e-CF incluido en el ERP, sin contar facturas, sin costo de instalación.**

### 4.4 Costo del certificado digital (lo paga el cliente, no tú)

- **ViaFirma / Avansi**: ~**RD$2,360/año**
- **Cámara de Comercio y Producción de Santo Domingo (Digifirma)**: ~**US$29.95/año**
- https://www.viafirma.do/certificado-procesos-tributarios/
- https://indotel.gob.do/firma-digital/entidades-de-certificacion/ (entidades autorizadas por INDOTEL)

Es un costo pequeño pero **obligatorio** (art. 26 num. 3 lo convierte en infracción no tenerlo).
Vale la pena que REGB ERP gestione ese trámite por el cliente: es fricción real para un colmadero.

---

## 5. Incentivos por adoptar e-CF

### 5.1 Los montos (Art. 41 Ley 32-23, texto literal)

> "**Articulo 41.- Monto de incentivo a MIPYMES.** El monto estipulado conforme la clasificación
> a la cual pertenece el contribuyente y que se beneficien del calendario de implementación
> establecido en el artículo 37, será de:
> 1) **RD$300,000.00** a grandes MIPYMES;
> 2) **RD$200,000.00** a medianos contribuyentes;
> 3) **RD$75,000.00** a pequeños contribuyentes; y
> 4) **RD$25,000.00** a microempresas y no clasificados."

Y para grandes nacionales, **Art. 40 Párrafo II**: tope máximo de **RD$2,000,000.00**.

### 5.2 Cómo funciona

**Art. 39**: es un **certificado de crédito fiscal** otorgado a MIPYMES (según Ley 187-17) que
hayan sido **autorizadas a emitir e-CF en el período de voluntariedad**, imputable contra:
1) Anticipos del ISR, 2) ITBIS operacional, 3) Impuesto sobre la Renta, 4) Impuesto sobre los Activos.

Condiciones adicionales (Comunidad de Ayuda DGII + Reglamento 587-24 arts. 45-47):
- La clasificación que cuenta es **la vigente al momento de promulgarse la Ley 32-23** (mayo 2023).
- El crédito se aplica **íntegro en el mismo ejercicio fiscal**; **no hay reembolso** de saldo a favor.
- Hay que estar al día en obligaciones y deberes formales, con RNC actualizado.
- Se solicita con: carta de solicitud firmada/sellada, **relación detallada de los costos de
  implementación con comprobantes de pago**, registros contables (obligatorio si se contrató un
  proveedor autorizado) y **relación de horas de trabajo** (obligatorio si es **desarrollo propio**).
- Quien usó el **Facturador Gratuito queda excluido** (ver 3.5).

Fuente: https://ayuda.dgii.gov.do/conversations/facturacin-electrnica/ca4902-en-qu-consiste-el-incentivo-fiscal-que-se-otorgar-por-la-implementacin-de-la-facturacin-electrnica/646f82c630f12540269005aa

### 5.3 ⚠️ El punto crítico no resuelto: ¿sigue abierta la ventana?

El incentivo exige haber sido autorizado **"en el período de voluntariedad"** (art. 38 y 39),
es decir, **antes** de la fecha obligatoria del grupo. Para pequeños/micro esa fecha era el
15 de mayo de 2026 y **ahora es el 15 de noviembre de 2026** por la prórroga.

**No pude confirmar** si la DGII considera que la voluntariedad (y por tanto el incentivo) se
extendió también hasta el 15 de noviembre de 2026, o si quedó congelada en el 15 de mayo de 2026.
El Aviso 06-26 **no menciona los incentivos**. **Hay que preguntarlo directamente a la DGII
(809-689-3444 / informacion@dgii.gov.do) antes de prometerle RD$75,000 a un cliente.**

Si sigue abierta: es el argumento de venta más fuerte del año, con **9 semanas de vida útil**.
Si ya cerró: el argumento pasa a ser "evita la multa y no pierdas clientes empresa".

**Nota adicional**: el crédito se calcula contra **costos de implementación comprobados**. O sea,
si el cliente paga RD$0 por su ERP, no hay mucho que acreditar. El incentivo **premia al que
factura la implementación** — lo cual, irónicamente, favorece un modelo con costo de setup visible.

---

## 6. Intermediarios: ¿hace falta un proveedor autorizado?

### 6.1 Respuesta corta: NO

El **Art. 12** (ver 3.1) reconoce **tres vías**, y la número 1 es **sistema de desarrollo propio**
autorizado directamente por la DGII. No hay obligación legal de pasar por un intermediario.

### 6.2 Qué implica ir por desarrollo propio (la ruta de REGB ERP)

**Deberes del emisor electrónico — Art. 17 (literal):**
> "1) Firmar todos los E-CF emitidos con Certificado Digital vigente y válido;
> 2) Recibir todos los E-CF de sus proveedores que sean emitidos válidamente;
> 3) Cumplir con las exigencias técnicas que la DGII disponga;
> 4) Exhibir a la DGII todas las informaciones que le sean requeridas...; y
> 5) Conservar los E-CF conforme a lo dispuesto en el Código Tributario.
> **Párrafo.- Todo emisor electrónico es a su vez receptor electrónico de E-CF.**"

⚠️ Ese párrafo es fácil de pasar por alto: **el ERP también tiene que RECIBIR e-CF**, no solo emitir.

Proceso de certificación (fuente DGII):
- Documento oficial: https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Documentaciones%20Proceso%20de%20Certificaci%C3%B3n%20FE/Proceso%20de%20Certificacion%20para%20ser%20Emisor%20Electronico.pdf
- Guía del Contribuyente No. 6: https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/facturacion/Documents/Facturaci%C3%B3n%20Electr%C3%B3nica/6%20Guia%20Facturacion%20Electronica.pdf
- Requisitos previos: estar al día, credenciales OFV, Alta NCF, certificado digital de una entidad
  autorizada por INDOTEL. En la solicitud se declara si el software es **adquirido a un proveedor
  externo o desarrollado internamente**.
- Hay un **set de pruebas** por cada tipo de e-CF antes de pasar a producción.
- Duración estimada: **2 a 6 semanas** (⚠️ dato de un proveedor, https://dgmax.do/blog/como-certificarse-emisor-electronico-dgii,
  **no oficial**; la DGII no publica un SLA que yo haya podido confirmar).

🔴 **Implicación clave para el modelo de negocio**: si cada cliente de REGB ERP se certifica como
emisor con "sistema de desarrollo propio", **cada cliente pasa por su propio set de pruebas**.
Eso es 2-6 semanas por cliente y no escala en 9 semanas.

### 6.3 La otra ruta: que REGB ERP se certifique como Proveedor de Servicios

Regulado por la **Norma General núm. 10-2021** (25/oct/2021).
https://dgii.gov.do/legislacion/normasGenerales/Documents/NG%20sobre%20Comprobantes%20Fiscales/Norma10-21.pdf

Requisitos para ser Proveedor de Servicios de Facturación Electrónica certificado:
- RNC con actividad económica relacionada a venta y/o desarrollo de aplicaciones informáticas.
- **Ser emisor electrónico** (o sea, primero certificarse uno mismo).
- **Haber certificado exitosamente al menos 3 contribuyentes como emisores electrónicos.**
- Estar al día en obligaciones tributarias y deberes formales.
- Certificado digital para procesos tributarios de un prestador autorizado por INDOTEL.
- Cumplir requisitos técnicos + formulario **FI-GDF-017**.

Guía oficial: https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/facturacion/Documents/Facturaci%C3%B3n%20Electr%C3%B3nica/Guia-Basica-Proveedor-de-Servicios-de-Facturacion-Electronica.pdf

➡️ **Hay un huevo-y-gallina**: para ser proveedor certificado necesitas haber certificado 3
contribuyentes antes. Así que la ruta es: certificarse uno mismo → certificar 3 clientes por
desarrollo propio → solicitar ser proveedor. **Eso no se hace antes del 15 de noviembre de 2026.**

### 6.4 La competencia ya está: 45 proveedores autorizados

La lista oficial de la DGII tiene **45 proveedores de servicios de facturación electrónica
autorizados** (VOXEL CARIBE, ALANUBE, GURUSOFT, INDEXA, DYNASOFT, CITRUS TECHNOLOGY, Gestarux,
entre otros).
https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/Proveedores-servicios-FE-autorizados.aspx

---

## 7. Resumen: confirmado vs. no confirmado

### ✅ Confirmado con fuente oficial (DGII / texto de ley)

| Hecho | Fuente |
|---|---|
| Ley 32-23 promulgada 16/may/2023 | PDF Ley 32-23, DGII |
| Art. 37: 12/24/36 meses por grupo | PDF Ley 32-23 |
| Pequeños/Micro/no clasificados: fecha original 15/may/2026 | Aviso DGII 06-26 |
| Prórroga automática de 6 meses → **15/nov/2026** | Aviso DGII 06-26 (PDF oficial) |
| DGII dice que no habrá otra prórroga (10/sep/2026) | Diario Libre, declaración del director |
| Sanciones: art. 27 remite al art. 257 CT = 5 a 30 salarios mínimos + cierre | Ley 32-23 + CT 11-92 |
| Penal: facturas apócrifas 1-5 años + cierre definitivo | Ley 32-23 art. 30 |
| Facturador Gratuito existe, es gratis, **~150 facturas/mes** | FAQ oficial DGII (pregunta 64) |
| Certificado digital obligatorio incluso en el FG | FAQ oficial DGII (pregunta 65) |
| Usuarios del FG quedan excluidos del incentivo | Ley 32-23 art. 40 Párr. IV + Comunidad de Ayuda DGII |
| Incentivos: RD$75k pequeños, RD$25k micro, RD$300k grandes MIPYMES, RD$200k medianos, RD$2MM grandes nacionales | Ley 32-23 arts. 40-41 |
| Se puede emitir por desarrollo propio, sin intermediario | Ley 32-23 art. 12 num. 1 |
| Ser Proveedor certificado exige haber certificado 3 contribuyentes | Norma General 10-2021 |
| 45 proveedores autorizados en la lista de la DGII | Página oficial DGII |
| Emisores autorizados: 23,686 (ene/26) → 84,003 (sep/26); >200,000 alcanzados | Diario Libre, cifras de la DGII |

### ❌ No pude confirmar

1. **Los RD$43,000 de instalación y RD$3,000/mes de Gestarux.** Su web pública muestra
   RD$750/año (micro), RD$2,250/mes (500 facturas) y RD$3,990/mes (3,000 facturas). El
   RD$43,000 no aparece en ninguna fuente pública. **Pedir la cotización real.**
2. **Si el incentivo (RD$75k / RD$25k) sigue vigente después del 15/may/2026** o si se extendió
   con la prórroga hasta el 15/nov/2026. **Esto hay que llamarlo a la DGII.**
3. **El art. 55 del Reglamento 587-24** y el corte del **31 de octubre de 2026** para comprobantes
   tipo B (solo lo vi en fuente secundaria de proveedor).
4. **El detalle de la(s) prórroga(s) de grandes locales y medianos** y su fecha oficial exacta
   (nov/2025 vs nov/2026 — la prensa de ago/2026 apunta a nov/2026).
5. **Qué salario mínimo aplica** al art. 257 (público o privado, y cuál escala) → no puedo dar el
   monto de la multa en RD$.
6. **Si la DGII reabrió el cupo de 30,000 certificados digitales gratuitos** (el plazo original
   venció el 30/sep/2025).
7. **Duración oficial del proceso de certificación de emisor**: el "2 a 6 semanas" es dato de
   proveedor, no de la DGII.
8. **Si la exclusión del Párrafo IV del art. 40 aplica formalmente a MIPYMES**, dado que está
   redactada dentro del artículo de grandes nacionales (la DGII lo interpreta como general).

---

## 8. Conclusión: ¿es urgente construir e-CF en REGB ERP?

### La respuesta con matices: SÍ es urgente, pero no por la razón obvia

**Urgencia regulatoria: ALTA y con fecha.** El 15 de noviembre de 2026 está a **9 semanas**.
El director de la DGII dijo hoy mismo que no habrá otra prórroga. Más de **110,000 contribuyentes**
todavía no se han incorporado. Todo colmado, ferretería y tienda de electrónicos de Santo Domingo
tiene este problema encima **ahora**.

**Pero: un ERP sin e-CF en noviembre de 2026 es un ERP invendible.** No es que e-CF sea una feature
nueva que agrega valor — es que **sin ella el producto queda fuera del mercado**. Un colmadero no
puede usar un sistema que le genere facturas que ya no son legales. Ese es el riesgo real: no
perder una venta adicional, sino perder **todo el pipeline**.

### Pero ojo con la trampa del modelo de negocio

Para el cliente objetivo (**menos de 50 facturas/mes**), el **Facturador Gratuito de la DGII cumple
la ley y cuesta RD$0**. Cobrar RD$3,000/mes *solo por e-CF* a ese cliente es insostenible: compite
contra gratis. Lo que Gestarux está haciendo con ese cliente es venderle un plan de 500 facturas a
alguien que emite 50.

**El valor de REGB ERP no es "emitir e-CF". Es:**
1. Que el e-CF **salga del mismo POS/inventario** donde ya se registra la venta — el FG obliga a
   teclear la factura dos veces.
2. **606/607/IT-1**, que el FG no genera.
3. **Recepción** de e-CF de proveedores (obligatorio por el art. 17 Párrafo, y el FG lo hace mal).
4. **No perder el incentivo** de RD$75,000 / RD$25,000 que el FG descalifica (⚠️ sujeto a
   confirmar si la ventana sigue abierta).
5. **Inventario, cuentas por cobrar, multi-sucursal** — nada de eso existe en el FG.

### Riesgo de calendario: no llegas al 15 de noviembre con certificación por cliente

Si cada cliente se certifica por "desarrollo propio", son **2-6 semanas de set de pruebas por
cliente** (dato no oficial). Y ser **Proveedor de Servicios certificado** exige haber certificado
antes a 3 contribuyentes — ese camino **no cabe en 9 semanas**.

### Recomendación práctica (tres carriles en paralelo)

1. **Corto plazo (ahora – noviembre 2026)**: no pelear contra el Facturador Gratuito.
   **Integrarse a su alrededor**: vender REGB ERP como el sistema de inventario/POS/reportes, y
   acompañar al cliente a inscribirse en el FG. Ingreso por el ERP, cumplimiento por el FG,
   RD$0 de riesgo regulatorio para Randy. *Costo de esto: el cliente pierde el incentivo — pesarlo.*
2. **Mediano plazo (noviembre 2026 – Q1 2027)**: certificar REGB ERP como **emisor con desarrollo
   propio** usando los primeros clientes reales (la tía de la tienda de electrónicos es candidata
   #1 — y como emite pocas facturas, la presión de volumen es baja mientras se aprende).
   Esos son los **3 contribuyentes certificados** que exige la Norma 10-2021.
3. **Largo plazo (2027)**: solicitar ser **Proveedor de Servicios de Facturación Electrónica
   autorizado**. Ahí sí se puede cobrar e-CF como servicio, y se entra a competir con los 45.

### Modelo de precio sugerido (contra Gestarux)

El mercado ya odia el cobro por tramos — DGMax vende "límites soft" y Alegra vende "ilimitado"
como diferenciadores. Posicionamiento para REGB ERP:

> **"e-CF incluido. Sin instalación. Sin contar facturas."**

Contra RD$43,000 de setup (a verificar) + RD$2,250-3,000/mes de un competidor, un ERP completo con
e-CF incluido por debajo de RD$2,500/mes y **sin costo de instalación** es una propuesta ganadora —
siempre que llegue certificado.

### Tres llamadas que hay que hacer esta semana

1. **DGII (809-689-3444)**: ¿sigue abierta la ventana del incentivo de RD$75,000/RD$25,000 tras
   la prórroga? ¿Cuánto tarda hoy realmente la certificación de emisor por desarrollo propio?
2. **Un contador**: confirmar el corte del 31/oct/2026 para comprobantes tipo B y qué salario
   mínimo aplica al art. 257.
3. **Un cliente de Gestarux**: pedir la cotización en papel para verificar el RD$43,000.

---

*Documento generado el 10 de septiembre de 2026. Todas las URLs fueron consultadas en esa fecha.
Las fechas y montos regulatorios deben reverificarse antes de usarse en material comercial o
en una decisión de cumplimiento.*
