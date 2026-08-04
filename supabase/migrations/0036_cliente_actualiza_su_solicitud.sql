-- ═══════════════════════════════════════════════════════════════════════
--  0036 · El cliente no podia corregir su propia solicitud
-- ═══════════════════════════════════════════════════════════════════════
--
--  La 0035 dejo `update` solo al proveedor. La accion del marketplace SI
--  intenta actualizar la solicitud abierta cuando el cliente vuelve a
--  pedir —para no abrir dos conversaciones con el mismo cliente— y ese
--  update afectaba CERO filas sin lanzar ningun error.
--
--  Resultado: el cliente cambiaba lo que queria, pulsaba, veia el mensaje
--  de "tu solicitud esta en camino" y el proveedor seguia viendo la lista
--  vieja. Los dos convencidos de cosas distintas.
--
--  Es el mismo patron que ya mordio en el kardex y en los pedidos: un
--  `update` que la RLS deja pasar sin permiso no falla, simplemente no
--  hace nada. Por eso los tests afirman el CONTEO de filas afectadas y no
--  solo la ausencia de excepcion.
--
--  Regla: el cliente puede corregir su solicitud MIENTRAS siga pendiente.
--  En cuanto el proveedor la marca como contactada, deja de poder tocarla
--  — cambiar lo pedido despues de que alguien empezo a trabajarla es como
--  se pierde el rastro de que se acordo.
-- ═══════════════════════════════════════════════════════════════════════

create policy tenant_corrige on regb.activation_requests
  for update
  using (tenant_id = auth.tenant_id() and status = 'pending')
  with check (tenant_id = auth.tenant_id() and status = 'pending');

comment on policy tenant_corrige on regb.activation_requests is
  'El cliente corrige su peticion mientras nadie la haya atendido. Despues manda el historial, no el.';
