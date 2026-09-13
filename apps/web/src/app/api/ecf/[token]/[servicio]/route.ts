import { NextResponse } from 'next/server'
import {
  decidirAcuse,
  esParaEsteTenant,
  leerEcfEntrante,
  tokenValido,
  xmlAcuse,
} from '@regb/operations'
import { problemasDelCertificado, verificarFirmaEcf } from '@regb/ecf-firma'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Las tres URL que el contribuyente declara a la DGII.
 *
 * Son PUBLICAS y sin sesion: la DGII y otros emisores les pegan desde
 * internet. Es la superficie mas expuesta del ERP, asi que aqui todo se
 * hace al reves de lo habitual.
 *
 * ── De quien es lo que llega ──────────────────────────────────────────
 *
 * El tenant sale del TOKEN de la URL y de nada mas. El RNC que viene
 * dentro del XML no elige nada: quien sepa el RNC de un cliente podria
 * escribirle facturas en su cuenta. Ese RNC solo sirve DESPUES, para
 * comprobar que el documento de verdad iba para ese tenant -y si no
 * coincide, se acusa con motivo 4 y no se guarda-.
 *
 * ── Por que se responde 200 aunque el documento sea malo ──────────────
 *
 * El acuse de recibo NO es un codigo HTTP: es un documento. Un e-CF con
 * la firma rota se contesta con `Estado 1` y `CodigoMotivoNoRecibido 2`,
 * en un 200. Devolver 400 dejaria al emisor sin el acuse que la norma le
 * debe, y la DGII exige ese acuse en el paso 9 de la certificacion.
 *
 * Solo hay codigos de error HTTP para lo que NO es un documento: token
 * invalido, servicio inexistente, cuerpo ilegible.
 *
 * ── Lo que NO se ha probado ───────────────────────────────────────────
 *
 * ⚠️ Nadie ha mandado un e-CF real aqui. La forma del acuse sale del
 * `ARECF v1.0.xsd` oficial; lo que la DGII acepte de verdad, no se sabe.
 */

const SERVICIOS = ['recepcion', 'aprobacion', 'autenticacion'] as const

interface Ruta {
  tenant_id: string
  rnc: string
  ambiente: string
}

/** El acuse viaja como XML, siempre. */
function xml(cuerpo: string, status = 200): NextResponse {
  return new NextResponse(cuerpo, {
    status,
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** `DD-MM-AAAA HH:mm:ss`, el formato que piden todos los esquemas. */
function fechaHoraDgii(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/**
 * Traduce el token a un tenant.
 *
 * Se valida la FORMA antes de ir a la base: un token de seis letras no
 * merece una consulta, y responder distinto segun exista o no la fila
 * convertiria este endpoint en un oraculo para adivinar tokens.
 */
async function resolver(token: string): Promise<Ruta | null> {
  if (!tokenValido(token)) return null
  const [fila] = await db()<Ruta[]>`select * from public.ecf_tenant_por_token(${token})`
  return fila ?? null
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string; servicio: string }> },
) {
  const { token, servicio } = await params
  if (!(SERVICIOS as readonly string[]).includes(servicio)) {
    return NextResponse.json({ error: 'Servicio no existe.' }, { status: 404 })
  }

  const ruta = await resolver(token)
  // Mismo 404 para "token mal formado", "token que no existe" y "servicio
  // que no existe": no se le dice a quien prueba si acerto a medias.
  if (ruta === null) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })

  if (servicio === 'autenticacion') return autenticacion()

  const cuerpo = await leerXmlDelCuerpo(req)
  if (cuerpo === null) {
    return NextResponse.json({ error: 'No vino ningun XML.' }, { status: 400 })
  }

  return servicio === 'recepcion' ? recibir(ruta, cuerpo) : aprobar(ruta, cuerpo)
}

/**
 * Tope del cuerpo entrante.
 *
 * 4 MB es holgado para un e-CF -el mas grande que hemos generado ronda
 * los 3 KB, y uno con cientos de lineas y su firma no pasa de unos
 * cientos de KB-. Sin tope, un POST de 500 MB a una ruta PUBLICA se
 * carga entero en memoria y tumba el servidor de todos los clientes:
 * la ruta esta abierta a internet y no hace falta ni credencial para
 * intentarlo.
 */
const MAX_CUERPO = 4 * 1024 * 1024

/**
 * El XML llega en `multipart/form-data`, campo `xml` — igual que se
 * manda. Se acepta tambien el cuerpo crudo porque no todo emisor sigue
 * la norma y rechazar por la envoltura seria perder una factura buena.
 */
async function leerXmlDelCuerpo(req: Request): Promise<string | null> {
  const tipo = req.headers.get('content-type') ?? ''

  // Se mira `content-length` ANTES de leer nada: rechazar despues de
  // haberlo cargado en memoria no evita el daño.
  const largo = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(largo) && largo > MAX_CUERPO) return null

  try {
    if (tipo.includes('multipart/form-data')) {
      const fd = await req.formData()
      const campo = fd.get('xml')
      if (typeof campo === 'string') return campo.length > MAX_CUERPO ? null : campo || null
      if (campo instanceof File) {
        // Segunda comprobacion: un emisor puede mentir en content-length,
        // o mandarlo troceado sin el.
        if (campo.size > MAX_CUERPO) return null
        return (await campo.text()) || null
      }
      return null
    }
    const crudo = await req.text()
    return crudo.length > MAX_CUERPO ? null : crudo || null
  } catch {
    return null
  }
}

/**
 * Recepcion: un e-CF que OTRO nos emite.
 *
 * El orden de las comprobaciones es el de `decidirAcuse()` y no es
 * decorativo: sin poder leer el XML no se puede saber el RNC ni si es
 * duplicado.
 */
async function recibir(ruta: Ruta, xmlEntrante: string): Promise<NextResponse> {
  const datos = leerEcfEntrante(xmlEntrante)

  // Sin e-NCF ni emisor no hay ni como archivarlo ni a quien acusarle.
  //
  // Y NO se puede devolver un ARECF: el esquema exige `eNCF` de 9, 11 o
  // 13 caracteres y `RNCEmisor` de 9 u 11 digitos, asi que un acuse con
  // esos campos vacios no valida. Mandar un acuse invalido es peor que
  // no mandarlo -el emisor cree que tiene acuse y no lo tiene-, asi que
  // aqui si toca un error HTTP: no hay documento que devolver.
  if (datos.encf === null || datos.rncEmisor === null) {
    return NextResponse.json(
      { error: 'El documento no trae eNCF o RNCEmisor: no se puede acusar.' },
      { status: 400 },
    )
  }

  // El RNC del tenant sale de su empresa por defecto. Si no tiene una
  // cargada llega vacio, y entonces `esParaEsteTenant` daria false para
  // TODO: se rechazaria cada e-CF legitimo con motivo 4 -"RNC comprador
  // no corresponde"- que es justo el motivo equivocado, porque el
  // problema es nuestro y no del emisor.
  if (ruta.rnc === '') {
    return NextResponse.json(
      { error: 'Esta cuenta no tiene RNC configurado: no puede recibir e-CF.' },
      { status: 503 },
    )
  }

  const sql = db()

  // El certificado viaja DENTRO del documento, en X509Data.
  //
  // Verificar la firma contra ese certificado prueba que el documento NO
  // SE TOCO despues de firmarse. Eso es TODO lo que prueba: cualquiera
  // se genera un autofirmado en diez segundos, firma con el, y la
  // verificacion da true. La firma es integridad, no identidad —
  // confundirlas es leer como resuelto algo que no lo esta.
  //
  // Por eso ademas se mira el certificado en si: vigencia, si lo
  // respalda alguien, y si la identidad que declara es la del emisor que
  // dice ser el documento. Esto ultimo cierra el caso de un
  // contribuyente con certificado LEGITIMO firmando facturas en nombre
  // de otro.
  //
  // Cuanto se exige depende del ambiente del tenant: en los de prueba de
  // la DGII circulan autofirmados y rechazarlos impediria certificarse.
  const cert = certificadoDelDocumento(xmlEntrante)
  const problemas =
    cert === null
      ? [{ codigo: 'ilegible' as const, detalle: 'sin certificado' }]
      : problemasDelCertificado(cert, {
          ahora: new Date(),
          nivel: ruta.ambiente === 'ecf' ? 'produccion' : 'pruebas',
          rncEsperado: datos.rncEmisor,
        })

  const firmaValida =
    cert !== null && problemas.length === 0 && verificarFirmaEcf(xmlEntrante, cert)

  const rncCompradorCorrecto =
    datos.rncComprador !== null &&
    esParaEsteTenant(datos.rncComprador, { tenantId: ruta.tenant_id, rncTenant: ruta.rnc })

  // ── Duplicado: lo decide el INSERT, no un SELECT previo ───────────────
  //
  //  Antes se consultaba primero y se insertaba despues. Entre las dos
  //  cosas cabe otra peticion: esta es una URL PUBLICA y el emisor
  //  reintenta solo cuando la red le falla, asi que dos copias del mismo
  //  e-CF llegando a la vez no es un caso rebuscado. Las dos veian la
  //  tabla vacia y las dos contestaban "recibido"; el `on conflict`
  //  evitaba la fila repetida -no habia dano en los datos- pero el
  //  emisor se quedaba sin su acuse de duplicado, que es justo lo que le
  //  dice que pare de reintentar.
  //
  //  `on conflict do nothing returning id` resuelve las dos cosas de una:
  //  si devuelve fila, este e-CF es nuevo; si no devuelve nada, ya
  //  estaba. Es atomico, asi que de dos peticiones simultaneas exactamente
  //  una se lleva el "recibido".
  //
  //  Solo se archiva lo que se acusaria como recibido: guardar lo
  //  rechazado llenaria la cuenta del cliente de basura que cualquiera
  //  puede mandarle a una URL publica. Por eso los dos caminos que NO
  //  archivan siguen consultando -ahi no hay carrera que perder, porque
  //  el documento se rechaza igual y el SELECT solo elige el motivo-.
  let duplicado: boolean
  if (!firmaValida) {
    // La firma manda sobre el duplicado en `decidirAcuse`: no hace falta
    // ni preguntar, y asi un documento sin firma valida no toca la base.
    duplicado = false
  } else if (!rncCompradorCorrecto) {
    // Aqui si importa: el motivo 3 -duplicado- gana al 4 -RNC que no
    // corresponde-. Se consulta, sin insertar.
    const [previo] = await sql<{ id: string }[]>`
      select id from public.ecf_recibidos
      where tenant_id = ${ruta.tenant_id} and rnc_emisor = ${datos.rncEmisor} and encf = ${datos.encf}`
    duplicado = previo !== undefined
  } else {
    const [guardado] = await sql<{ id: string }[]>`
      insert into public.ecf_recibidos
        (tenant_id, encf, rnc_emisor, monto_total, acuse_estado, xml)
      values (${ruta.tenant_id}, ${datos.encf}, ${datos.rncEmisor},
              ${datos.montoTotal}, 0, ${xmlEntrante})
      on conflict (tenant_id, rnc_emisor, encf) do nothing
      returning id`
    duplicado = guardado === undefined
  }

  const acuse = decidirAcuse({
    xmlValido: true,
    firmaValida,
    duplicado,
    rncCompradorCorrecto,
  })

  return xml(
    xmlAcuse(
      {
        rncEmisor: datos.rncEmisor,
        rncComprador: ruta.rnc,
        encf: datos.encf,
        fechaHora: fechaHoraDgii(new Date()),
      },
      acuse,
    ),
  )
}

/** El certificado que el emisor metio en su propia firma. */
function certificadoDelDocumento(xmlFirmado: string): string | null {
  const m = /<(?:\w+:)?X509Certificate>([\s\S]*?)<\/(?:\w+:)?X509Certificate>/.exec(xmlFirmado)
  const b64 = m?.[1]?.replace(/\s+/g, '')
  if (!b64) return null
  const lineas = b64.match(/.{1,64}/g) ?? []
  return `-----BEGIN CERTIFICATE-----\n${lineas.join('\n')}\n-----END CERTIFICATE-----\n`
}

/**
 * Aprobacion comercial: alguien acepta o rechaza un e-CF que NOSOTROS
 * emitimos. Es del negocio, no del formato.
 *
 * ── Lo que esta funcion hacia mal, y encontro una revision ────────────
 *
 * Escribia el resultado en `ecf_emitidos.estado` -la columna del
 * veredicto FISCAL de la DGII, 0 a 4- usando los valores 1 y 2 de la
 * aprobacion comercial. Dos semanticas en una columna, y ambas con los
 * mismos numeros: un 2 ahi hacia que `esValidoFiscalmente()` devolviera
 * false para una factura que la DGII habia ACEPTADO.
 *
 * Y no verificaba nada del remitente: ni firma, ni de quien venia. La
 * aprobacion comercial (ACECF) es un documento FIRMADO; aqui solo se
 * sacaban dos regex.
 *
 * Ahora: columna propia (0102), firma obligatoria, y el documento tiene
 * que decir que el emisor somos nosotros.
 *
 * `Estado` aqui es 1 aceptado y 2 rechazado -otra numeracion distinta de
 * las otras dos del mismo formato-.
 */
async function aprobar(ruta: Ruta, xmlEntrante: string): Promise<NextResponse> {
  const datos = leerEcfEntrante(xmlEntrante)
  const estado = /<(?:\w+:)?Estado>\s*([12])\s*<\/(?:\w+:)?Estado>/.exec(xmlEntrante)?.[1]

  // Una sola respuesta para TODO lo que no prospera.
  //
  // Antes se distinguia 200 de 404 segun el e-NCF existiera, y como el
  // e-NCF es correlativo eso convertia la ruta en un enumerador: pidiendo
  // E32...0001 en adelante se aprendia cuantas facturas lleva emitidas el
  // cliente. Ahora quien no acierta no se entera de por que.
  const sinNovedad = () => NextResponse.json({ recibido: true })

  if (datos.encf === null || estado === undefined) return sinNovedad()

  // La aprobacion comercial es un documento firmado. Sin firma valida no
  // se toca nada: cualquiera podria rechazarle las facturas a un cliente.
  const cert = certificadoDelDocumento(xmlEntrante)
  if (cert === null || !verificarFirmaEcf(xmlEntrante, cert)) return sinNovedad()

  // El ACECF nombra al emisor del comprobante que aprueba. Ese emisor
  // somos nosotros: si el documento dice otro RNC, no es para esta
  // cuenta. Es la misma comprobacion que ya hacia `recibir()` con el
  // comprador, aplicada al otro lado.
  if (
    datos.rncEmisor === null ||
    !esParaEsteTenant(datos.rncEmisor, { tenantId: ruta.tenant_id, rncTenant: ruta.rnc })
  ) {
    return sinNovedad()
  }

  const motivo = etiquetaSuelta(xmlEntrante, 'DetalleMotivoRechazo')

  // Se escribe en la columna de la aprobacion COMERCIAL, nunca en la del
  // estado fiscal. Y solo si no habia decision previa: la primera manda,
  // para que nadie la cambie despues mandando otro documento.
  await db()`
    update public.ecf_emitidos
    set aprobacion_comercial = ${estado === '1' ? 'aceptado' : 'rechazado'},
        aprobado_en          = now(),
        motivo_rechazo       = ${estado === '1' ? null : motivo},
        updated_at           = now()
    where tenant_id = ${ruta.tenant_id}
      and encf = ${datos.encf}
      and aprobacion_comercial is null`

  return sinNovedad()
}

/** Una etiqueta suelta del documento, sin construir regex al vuelo. */
function etiquetaSuelta(xml: string, nombre: string): string | null {
  const fin = xml.indexOf(`</${nombre}>`)
  if (fin === -1) return null
  const abre = xml.lastIndexOf(`${nombre}>`, fin - 1)
  if (abre === -1 || abre >= fin) return null
  const v = xml.slice(abre + nombre.length + 1, fin).trim()
  return v === '' ? null : v
}

/**
 * Autenticacion: nuestro propio servicio semilla → token, para que
 * terceros se autentiquen CONTRA NOSOTROS.
 *
 * Todavia no emite tokens. Se declara la URL y contesta 501 en vez de
 * 404 a proposito: la diferencia entre "esto no existe" y "esto existe y
 * aun no funciona" es justo lo que alguien depurando necesita saber.
 */
function autenticacion(): NextResponse {
  return NextResponse.json(
    { error: 'El servicio de autenticacion de terceros todavia no esta implementado.' },
    { status: 501 },
  )
}

/** La DGII comprueba que la URL responde antes de aceptar la postulacion. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; servicio: string }> },
) {
  const { token, servicio } = await params
  if (!(SERVICIOS as readonly string[]).includes(servicio)) {
    return NextResponse.json({ error: 'Servicio no existe.' }, { status: 404 })
  }
  const ruta = await resolver(token)
  if (ruta === null) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })

  // No se devuelve NADA del cliente: ni su RNC ni su nombre. Que la URL
  // conteste ya dice lo unico que hace falta.
  return NextResponse.json({ servicio, listo: servicio !== 'autenticacion' })
}
