# `quality` — Control de calidad

**Que resuelve:** planes de inspeccion con criterios explicitos,
resultado real de inspeccion -no binario-, no conformidades que solo
se cierran pasando por un CAPA, y un CAPA que solo se cierra despues
de verificar que la correccion funciono.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** ninguno · **Recomienda:**
`manufacturing`

---

## Resultado de inspeccion no binario

`resultadoInspeccion()` no reduce una inspeccion a aprobada/reprobada:
un criterio marcado como **critico** que reprueba, reprueba la
inspeccion ENTERA sin importar cuantos otros criterios pasen; un
criterio **menor** reprobado la deja **condicional** -aprobada con
salvedad, no reprobada de plano-. Verificado en vivo con el plan
sembrado "Recepcion de cemento" (dos criterios, uno critico: "empaque
sin humedad"): la inspeccion real registrada con ese criterio
reprobado dio `failed`, y una segunda inspeccion de prueba con ambos
criterios aprobados dio `passed` -confirmado en el widget de tasa de
aprobacion, que paso de 0% a 50%-.

## Deliberadamente sin requerir `manufacturing`

A diferencia de `mrp` (que si exige `manufacturing`), `quality` no lo
exige: una inspeccion de recepcion es util para cualquier distribuidor
que reciba mercancia, fabrique o no. Solo lo RECOMIENDA, para quien ya
tiene control de calidad en proceso o final sobre sus propias ordenes
de produccion.

## Una no conformidad no se cierra directo

`transicionValidaNoConformidad()` define la maquina de estados: `open
→ investigating | dismissed`, `investigating → capa_created |
dismissed`, `capa_created → closed`. No existe un atajo de
`investigating` a `closed`: declarar resuelto un defecto sin pasar por
un CAPA con causa raiz y accion correctiva seria fingir que se
corrigio. Crear el CAPA (`crearCapa()`) mueve la no conformidad a
`capa_created` en el MISMO paso -no son dos acciones separadas que
puedan quedar desincronizadas-.

## Un CAPA no se cierra sin verificar

`transicionValidaCapa()` exige `open → in_progress → verified →
closed`, sin saltos: cerrar sin verificar seria declarar exito sin
comprobarlo. Cerrar un CAPA (`transicionarCapa()`) tambien cierra su
no conformidad en la MISMA transaccion -el cierre de uno implica el
cierre del otro, no dos pasos manuales que alguien podria olvidar-.

Verificado en vivo el ciclo completo sobre la no conformidad sembrada
(cemento con el empaque mojado, en `investigating`): creado el CAPA
-`capa_created` confirmado en la no conformidad-, avanzado
`open → in_progress → verified → closed`, con la no conformidad
cerrandose sola en el mismo paso que el CAPA. Revertido despues -el
CAPA borrado, la no conformidad devuelta a `investigating`- para que
la no conformidad sembrada siga siendo un problema real por resolver,
no uno ya resuelto de antemano.

## Inmutabilidad: hecho historico vs. maquina de estados

Una inspeccion y sus resultados por criterio son un hecho historico
-inmutable desde el primer insert, igual que `production_reports` de
`manufacturing`-. Una no conformidad y un CAPA SI son editables
mientras siguen en curso, y se congelan solo al llegar a un estado
terminal (`closed`/`dismissed` para la no conformidad, `closed` para
el CAPA) -el mismo patron de `traffic_fines` en `fleet`, no el de
"campo por campo" de `bom`/`manufacturing`-.

## El agujero de siempre (0031), seis veces

Seis tablas nuevas, seis triggers de referencia cruzada: un criterio
valida que su plan sea del mismo tenant; una inspeccion valida su plan
Y su producto; un resultado valida su inspeccion; una no conformidad
valida su inspeccion (si tiene una); un CAPA valida su no conformidad;
un certificado valida su producto.

## Lo que NO hace

- No tiene deteccion automatica de tendencias ni Pareto de defectos
  recurrentes -cada no conformidad se analiza por separado-.
- No liga un plan de inspeccion a una recepcion o a una orden de
  produccion especifica: la inspeccion se registra por su cuenta, y
  quien la hace decide a que producto corresponde.
- Los certificados de calidad (`quality_certificates`) son un registro
  vivo simple -numero, entidad emisora, vigencia- sin flujo de
  renovacion ni alerta de vencimiento propia todavia.
