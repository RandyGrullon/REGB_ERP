# `api-webhooks` — API & Webhooks

**Que resuelve:** llaves de API propias y webhooks salientes reales
-en vez de que cada integracion a la medida necesite que alguien del
equipo copie datos a mano hacia el sistema externo del cliente-.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** nada · **Recomienda:** nada

Unico modulo de S64 (F9).

---

## La llave se ve completa una sola vez

Generada con `crypto.randomBytes`, solo su hash SHA-256 se guarda -el
mismo `createHash('sha256')` de `node:crypto` que ya uso `e-sign` para
su rastro de firma-. El valor completo se devuelve UNA vez, en la
respuesta de la accion que la crea, y nunca vuelve a mostrarse -ni
siquiera al propio tenant-. La pantalla lo maneja con un componente
cliente minimo (`useActionState`, el primer uso de un componente
interactivo en toda la app fuera de la navegacion) para revelarlo
justo despues de crearla, sin guardar el texto plano en ningun lado.
Una llave revocada es terminal -`impedir_reactivar_llave()` lo impide
a nivel de base de datos, no solo en la UI-.

## Los webhooks SI llaman de verdad

A diferencia de `ecommerce` o `marketing`, que deliberadamente no
llaman a ningun proveedor externo, aqui la URL la configuro el propio
tenant para SU propio sistema -no hay un tercero que suplantar-, asi
que `enviarPrueba()` hace una llamada HTTP real con `fetch()`, firma el
payload con HMAC-SHA256 usando el secreto del endpoint, y registra el
codigo de respuesta real. Consume el mismo `event_outbox` que ya usa
`automations` -mismo patron de solo lectura, su propia bitacora en
`webhook_deliveries`, nunca toca `processed_at`-.

## Verificado en vivo con una llamada real

Crear una llave mostro el valor completo (`regb_j9Anelr...`) una sola
vez; recargar la pagina ya solo mostraba el prefijo. Probar el endpoint
sembrado (`https://httpbin.org/post`, un eco publico usado aqui como
conveniencia de demo) devolvio un **200 real**, registrado en
`webhook_deliveries`. Revertido despues -llave de prueba borrada,
entrega borrada- para que la demo siga teniendo un endpoint real listo
para probarse.

## Un problema real de infraestructura durante la verificacion

A mitad de la prueba en vivo, Docker Desktop volvio a fallar con el
mismo bloqueo de archivo (`dockerInference`) documentado en el commit
de `shopfloor` semanas atras en esta misma sesion. Resuelto con el
mismo procedimiento: matar los procesos de Docker, `wsl --shutdown`,
renombrar la carpeta `Docker\run` completa, relanzar Docker Desktop y
arrancar `regb-test-db` de nuevo -sin perder ningun dato: la llave
creada antes del corte seguia ahi al reconectar-.

## El agujero de siempre (0031)

Una entrega valida que su endpoint Y su evento sean del mismo tenant.

## Lo que NO hace

- No expone todavia un endpoint REST real que aplique el limite por
  minuto contra trafico entrante -se guarda como configuracion, no se
  hace cumplir-.
- No reintenta una entrega fallida automaticamente -"Probar" es una
  accion manual, no hay reintento con backoff propio-.
- No firma con rotacion de secretos -el secreto del endpoint se genera
  una vez al crearlo y no cambia despues-.
