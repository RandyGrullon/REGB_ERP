---
name: pricing-calc
description: Calcula y simula el precio de un cliente de Nexus ERP — tier, módulos, usuarios, sucursales, consumo y descuentos — y genera la propuesta comercial en markdown. Úsalo cuando se pida cotizar un cliente, simular un cambio de plan, comparar tiers o calcular cuánto costaría activar módulos.
---

# Calculadora de precios de Nexus ERP

## Datos que necesitas (si faltan, asume y dilo)

| Dato               | Default si no lo dan                                   |
| ------------------ | ------------------------------------------------------ |
| Nombre del cliente | "Cliente"                                              |
| Empleados          | deduce el tier                                         |
| Tier               | por empleados: ≤25 pyme · 26-200 mediano · >200 grande |
| Usuarios del ERP   | 40% de los empleados                                   |
| Sucursales         | 1                                                      |
| Empresas (RNC)     | 1                                                      |
| Módulos deseados   | los del giro del negocio                               |
| Ciclo de pago      | mensual                                                |
| Storage            | dentro del incluido                                    |

## Tabla base (§6.2)

|                     |  PYME | MEDIANO | GRANDE |
| ------------------- | ----: | ------: | -----: |
| Instalación         |   500 |   3.500 | 15.000 |
| Base mensual        |    79 |     399 |  1.500 |
| Usuarios incluidos  |     5 |      25 |    100 |
| Usuario extra /mes  |     9 |       7 |      5 |
| Sucursales incl.    |     1 |       5 |      ∞ |
| Sucursal extra /mes |    25 |      20 |      0 |
| Empresas incl.      |     1 |       3 |      ∞ |
| Empresa extra /mes  |   n/a |      90 |      0 |
| Storage incl.       | 10 GB |  100 GB |   1 TB |
| GB extra            |  0.50 |    0.40 |   0.25 |
| Módulos incluidos   |     0 |       5 |     15 |

## Precio de módulos (§6.3)

| Categoría         | Instalación pyme/med/gra | Mensual pyme/med/gra |
| ----------------- | ------------------------ | -------------------- |
| core (15 módulos) | 0/0/0                    | 0/0/0                |
| estándar          | 150/600/1.800            | 19/69/190            |
| avanzado          | 400/1.500/4.000          | 45/160/420           |
| vertical          | 600/2.200/6.000          | 59/210/550           |
| enterprise        | —/—/12.000               | —/—/900              |

## Fórmula

```
base_tier
+ Σ mensual_módulos_activos
+ max(0, usuarios − incluidos) × precio_usuario
+ max(0, sucursales − incluidas) × precio_sucursal
+ max(0, empresas − incluidas) × precio_empresa
+ max(0, storage − incluido) × precio_gb
+ consumos medidos
− módulos incluidos por tier (descuenta LOS MÁS CAROS primero)
− descuento por ciclo (anual −15% · bianual −20% · trianual −25%)
+ ITBIS 18% si el tenant es de RD
```

Redondeo a 2 decimales solo al final. Muestra siempre el desglose línea por línea.

## Formato de salida

```markdown
# Propuesta — <Cliente>

**Perfil:** <N> empleados · <M> usuarios · <S> sucursales → tier **<TIER>**

## Inversión inicial (una sola vez)

| Concepto | Detalle | USD |
| Instalación <TIER> | … | X |
| Instalación módulo … | … | X |
| **TOTAL INSTALACIÓN** | | **US$ X** |

## Mensualidad

| Concepto | Detalle | USD |
… todas las líneas …
| **TOTAL MENSUAL** | | **US$ X** |

## Qué incluye

(lista de módulos activos con una línea cada uno)

## Comparativa de ciclos

| Ciclo | Mensual | Ahorro anual |
| Mensual | X | — |
| Anual −15% | X | US$ X |
| Trianual −25% | X | US$ X |

## Alternativas

- Tier inferior: qué pierde, cuánto ahorra
- Tier superior: qué gana, cuánto cuesta
```

## Verificación obligatoria

Antes de entregar, comprueba tu motor contra los 3 casos de §6.5 del documento maestro:

- Colmado La Esperanza → instalación **US$ 950**, mensual **US$ 123.25**
- Distribuidora Caribe → instalación **US$ 8.300**, mensual **US$ 906**
- Grupo Quisqueya → instalación **US$ 74.400**, mensual **US$ 3.946**

Si tu cálculo no reproduce esos números, revisa la fórmula antes de cotizar.
