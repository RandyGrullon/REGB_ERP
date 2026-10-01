-- ═══════════════════════════════════════════════════════════════════════
--  0143 — El dueño que sale del alta tambien puede entrar
--
--  ── El defecto (encontrado probando contra Supabase de verdad) ────────
--
--  El alta de un cliente (0133) crea la invitacion Owner y le da al
--  proveedor el enlace para mandarselo a mano, porque desde REGB Control no
--  sale correo: `invitacion_para_enviar()` (0123) exige la sesion de alguien
--  DEL cliente con `users.create`, y todavia no hay nadie.
--
--  El dueño abre el enlace sin sesion -no tiene cuenta- y la app lo mandaba
--  al login. Ahi no hay salida: el registro esta cerrado (solo por
--  invitacion), el enlace de acceso solo sale para cuentas que ya existen y
--  el correo de la invitacion nunca se mando. El primer usuario de cada
--  cliente no podia entrar.
--
--  ── El arreglo ────────────────────────────────────────────────────────
--
--  Quien tiene el enlace puede pedir que el correo de la invitacion se
--  mande. A la direccion INVITADA, nunca a otra: tener el enlace no da
--  acceso; abrir ese correo es lo que abre la sesion y prueba quien es.
--
--  Dos funciones, para la Edge Function `invitar-usuario` en su camino
--  "por enlace" (sin sesion, con la llave publica):
--
--   · invitacion_por_enlace(token): a que correo y con que nombre, si la
--     invitacion esta viva. Devuelve un resultado en vez de lanzar error
--     -la funcion lo traduce a un codigo HTTP- y no dice NADA de una
--     invitacion que no este pendiente (ni el correo).
--   · invitacion_enviada_por_enlace(token): lo anota (sent_at, send_count)
--     DESPUES de que Supabase acepto el envio. La pantalla de /usuarios no
--     dice "enviada" si esto no se anoto.
--
--  La llave es el token: 256 bits, guardado solo como sha256 (0123). No se
--  enumera. Para que un enlace filtrado no sirva para bombardear el buzon
--  del invitado, un correo cada 2 minutos como mucho.
-- ═══════════════════════════════════════════════════════════════════════

create function public.invitacion_por_enlace(p_token text)
returns table (resultado text, email text, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv record;
begin
  resultado := 'invalida';
  email := null;
  nombre := null;

  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return next;
    return;
  end if;

  select i.email, i.display_name, i.status, i.expires_at, i.sent_at into v_inv
  from public.user_invitations i
  where i.token_hash = public.invitacion_hash(p_token);

  if not found then
    return next;
    return;
  end if;

  -- 'accepted' se dice como tal para que la app no ofrezca otro correo;
  -- ningun dato de la persona sale de una invitacion cerrada.
  if v_inv.status <> 'pending' then
    resultado := case v_inv.status
                   when 'revoked'  then 'revocada'
                   when 'expired'  then 'vencida'
                   when 'accepted' then 'aceptada'
                   else 'invalida'
                 end;
    return next;
    return;
  end if;
  if v_inv.expires_at <= now() then
    -- `stable`: aqui no se escribe. aceptar_invitacion() la cierra como
    -- vencida cuando alguien intente usarla.
    resultado := 'vencida';
    return next;
    return;
  end if;
  if v_inv.sent_at is not null and v_inv.sent_at > now() - interval '2 minutes' then
    resultado := 'espera';
    return next;
    return;
  end if;

  resultado := 'ok';
  email := v_inv.email;
  nombre := v_inv.display_name;
  return next;
end;
$$;

comment on function public.invitacion_por_enlace(text) is
  'Para la Edge Function invitar-usuario sin sesion: a que correo va una invitacion PENDIENTE, dado su token (sha256). Resultados: ok, espera (se mando hace < 2 min), invalida, vencida, revocada, aceptada. Solo con ok salen correo y nombre (0143).';

create function public.invitacion_enviada_por_enlace(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  update public.user_invitations
  set sent_at = now(), send_count = send_count + 1
  where token_hash = public.invitacion_hash(p_token)
    and status = 'pending'
    and expires_at > now();

  return found;
end;
$$;

comment on function public.invitacion_enviada_por_enlace(text) is
  'Anota que el correo de una invitacion salio, por su token (camino sin sesion de invitar-usuario). Solo pendientes y vivas (0143).';

-- Sin sesion por definicion: quien las usa todavia no tiene cuenta. La
-- Edge Function llama con la llave publica, o sea como `anon`.
revoke all on function public.invitacion_por_enlace(text) from public;
revoke all on function public.invitacion_enviada_por_enlace(text) from public;
grant execute on function public.invitacion_por_enlace(text) to anon, authenticated;
grant execute on function public.invitacion_enviada_por_enlace(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  Vuelta atras (down):
--    drop function public.invitacion_enviada_por_enlace(text);
--    drop function public.invitacion_por_enlace(text);
-- ═══════════════════════════════════════════════════════════════════════
