# `crm` — CRM / Leads

**Que resuelve:** captura de leads con un puntaje explicable,
asignacion automatica en round-robin entre vendedores activos, y una
linea de tiempo de interacciones que nunca se edita despues.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** ninguno · **Recomienda:** `pipeline`

Primer modulo de F9 (Ventas avanzado, BI e inteligencia).

---

## Un puntaje que cualquiera puede explicar

`puntuarLead()` es una regla fija, no un modelo de IA: 40 puntos por
tener email, 20 por tener telefono, y el resto segun la calidad de la
fuente -un referido vale 40, un evento 30, el sitio web 20, un frio
apenas 10-. Nunca pasa de 100. Verificado en vivo con dos leads
sembrados: "Ferreteria El Progreso" (email + telefono + referido =
100) y "Constructora Vega Real" (email + telefono + evento = 90) -los
dos numeros calzan exactamente con la formula, no son arbitrarios-.

## Asignacion automatica que no siempre favorece al mismo

`asignarRoundRobin()` reparte los leads sin asignar entre vendedores
activos, retomando la vuelta desde el ULTIMO vendedor que recibio uno
-la accion busca ese ultimo lead asignado y calcula su indice en la
lista, en vez de reiniciar siempre desde el primero-. Verificado en
vivo: el lead sembrado sin asignar se repartio correctamente al unico
vendedor activo del tenant demo, y se revirtio despues para que la
demo siga teniendo un pendiente real que asignar.

## La linea de tiempo es un hecho historico

Cada actividad (`lead_activities`) es inmutable desde el primer
insert, igual que un reporte de avance de `manufacturing` o una
inspeccion de `quality`: se registra una vez y no se corrige editando
la fila.

## Maquina de estados con dos salidas terminales

`transicionValidaLead()`: `new → contacted → qualified → converted`,
con `disqualified` alcanzable desde `new`, `contacted` o `qualified`
-nunca desde `converted`-. Verificado en vivo: `new → contacted`
avanzo correctamente sobre el lead sembrado, revertido despues.

## El agujero de siempre (0031)

Una actividad valida que su lead sea del mismo tenant.

## Lo que NO hace

- No tiene deduplicacion de leads repetidos -dos leads con el mismo
  correo o telefono no se detectan ni se fusionan automaticamente-.
- El puntaje se calcula UNA vez, al crear el lead -no se recalcula si
  despues se agrega un telefono que faltaba-.
- No tiene enriquecimiento externo (buscar la empresa en una base de
  datos de terceros): los datos son los que quien captura el lead
  escribe a mano.
