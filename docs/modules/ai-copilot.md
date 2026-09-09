# `ai-copilot` — Copiloto IA

**Que resuelve:** preguntas en espanol comun sobre los numeros del
negocio -en vez de pedirle a alguien del equipo que busque el reporte
correcto y saque el dato a mano cada vez-.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** nada · **Recomienda:** `bi`

Segundo modulo de S65-66 (F9) — **cierra F9 completa, 16/16**.

---

## El riesgo que el documento maestro senala, resuelto por construccion

El documento maestro (§11.1) llama a este modulo "el mayor riesgo de
fuga entre tenants del proyecto: consulta datos en lenguaje natural" y
pide una auditoria adversarial antes de publicarlo. La respuesta de
diseno: el copiloto NUNCA genera SQL libre ni llama a un modelo de
lenguaje real todavia -no hay integracion con ningun proveedor de IA
externo-. `emparejarPregunta()` solo compara palabras clave contra un
catalogo FIJO de cinco preguntas ya vetadas -el MISMO catalogo de
fuentes que `bi` ya audito y probo-, y esa key dispara la MISMA
`ejecutarReporte()` que `bi` ya usa. No existe ningun camino de codigo
que acepte una pregunta y la convierta en una consulta arbitraria: la
fuga entre tenants queda eliminada por construccion, no por un filtro
en tiempo de ejecucion que pudiera fallar.

## Respuestas reales, no inventadas

El "resumen" que responde el copiloto se calcula sobre datos reales
del tenant -nunca un texto generado por un modelo de lenguaje-.
Verificado en vivo con dos preguntas reales sobre
`distribuidora-caribe`: "¿Que facturas estan vencidas?" respondio
"Tienes 2 factura(s) vencida(s) por RD$39,264.00 en total" -exacto:
RD$12,064 (El Martillo) + RD$27,200 (Duarte)-; "¿Cuantos leads tengo
por estado?" respondio "1 en 'new', 1 en 'qualified'" -exacto sobre
los dos leads sembrados de `crm`-.

## Cada pregunta es un hecho historico auditable

`copilot_queries` es inmutable desde el insert -la bitacora de "que le
preguntaron al copiloto" no se puede reescribir despues-. Es el unico
modulo de todo el proyecto sin el "agujero de siempre" (0031): no
referencia ninguna otra tabla de negocio, solo registra la pregunta y
la respuesta ya calculada, asi que no hay nada que cruzar entre
tenants mas alla del aislamiento normal por `tenant_id`.

## Lo que NO hace

- No usa un modelo de lenguaje real -ni GPT, ni Claude, ni ningun
  proveedor externo-, declarado sin rodeos en el FAQ del marketplace.
- No entiende preguntas fuera del catalogo fijo de cinco temas -una
  pregunta sin ninguna palabra clave en comun queda registrada como
  `no_match`, honesto sobre no haber encontrado nada-.
- No genera resumenes ni sugerencias mas alla de la respuesta directa
  a la pregunta -el catalogo de la fase de descripcion (§5.3) los
  promete a futuro, esta version cubre las cinco preguntas fijas de
  `bi`-.
