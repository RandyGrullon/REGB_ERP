# `marketing` — Marketing & Campanas

**Que resuelve:** un registro formal de a quien se le envio una
promocion y de que campana vino un lead -en vez de mandar por WhatsApp
sin saber despues cuantos resultados reales dio-.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `crm` · **Recomienda:** nada

Segundo modulo de S59 (F9).

---

## Honesto sobre lo que NO hace

Este modulo no manda ningun correo ni WhatsApp de verdad -no hay
integracion con un proveedor externo todavia-. "Enviar" una campana
toma la foto de los leads que HOY cumplen el filtro de segmento
(estado y/o fuente, sobre la tabla real de `crm`) y crea un
destinatario real por cada uno, con su fecha de envio real. Declarado
sin rodeos en la pantalla de detalle y en el FAQ del marketplace,
siguiendo el mismo criterio de honestidad que `e-sign` uso para
aclarar que no es una firma con PKI certificado.

## Un bug real: "enviar ahora" no dejaba enviar

La maquina de estados original solo permitia `sent` desde
`scheduled` (`draft → scheduled → sent`), pero la pantalla de detalle
ofrece un boton "Enviar ahora" directo desde borrador. Verificado en
vivo: al hacer clic en "Enviar ahora" sobre la campana en borrador
sembrada, la pantalla no cambio -0 destinatarios, seguia en
"Borrador"-, sin ningun error visible porque las acciones de formulario
de esta app no muestran el mensaje de error en pantalla. Diagnosticado
reproduciendo la consulta exacta contra Postgres: la transicion
`draft → sent` devolvia `false`. Corregido permitiendo `sent` tambien
directo desde `draft` -enviar ahora es un flujo legitimo que no
depende de programar primero-, con la prueba unitaria reescrita para
confirmarlo. Vuelto a probar en vivo: la campana sembrada ("Promo
cemento fin de mes", segmentada por fuente `referral`) encontro
exactamente el lead que cumplia el filtro (Ferreteria El Progreso),
creo su destinatario real y quedo "Enviada".

## Abrir y hacer clic son eventos distintos

Un destinatario es inmutable en QUIEN y CUANDO se envio
(`impedir_editar_destinatario()` bloquea cambiar `campaign_id`,
`lead_id` o `sent_at`), pero `opened_at`/`clicked_at` si se pueden
rellenar despues -llegan en momentos distintos en la vida real, nunca
al mismo tiempo que el envio-. `tasaSobre()` calcula apertura y clics
con la misma formula generica, devolviendo `null` -no cero- cuando
todavia no se ha enviado nada. Verificado en vivo: apertura y clics
pasaron de "—" a 100%/0% al marcar la primera apertura, y a 100%/100%
al marcar el clic -exacto sobre 1 destinatario-. Revertido despues
-destinatario borrado, atribucion del lead limpiada, campana devuelta
a borrador- para que la demo siga teniendo una campana real por
enviar.

## Atribucion de primer toque

`alter table public.leads add column campaign_id` -legitimo porque
`marketing` SI declara `requires: ['crm']`-: el lead que llega desde
una campana queda atribuido a ella para siempre, nunca se reescribe si
ya tenia otra atribucion (`campaign_id is null` en el `update`).

## El agujero de siempre (0031)

Un destinatario valida que su campana Y su lead sean del mismo tenant.

## Lo que NO hace

- No envia correos ni WhatsApp de verdad -declarado sin rodeos, ver
  arriba-.
- No mide conversion a oportunidad ganada -la atribucion llega hasta
  el lead, no hasta el ciclo completo de `pipeline`-.
- No arma landing pages -el catalogo lo promete a futuro, pero esta
  version cubre segmentos, envio simulado y atribucion, no paginas
  publicas-.
