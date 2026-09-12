import { describe, expect, it, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ClienteDgii,
  DOMINIO_ECF,
  DOMINIO_FC,
  RUTAS,
  cuerpoEnvio,
  leerRespuestaEnvio,
  leerSemilla,
  leerToken,
  tokenVigente,
  urlEcf,
  urlFc,
  type Fetch,
} from './transporte.js'

let credencial = { clavePrivada: '', certificado: '' }

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ecf-transp-'))
  const clave = join(dir, 'clave.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', clave, '-out', cert, '-days', '1', '-nodes',
     '-subj', '/C=DO/O=Prueba/CN=Prueba'],
    { stdio: 'ignore' },
  )
  credencial = { clavePrivada: readFileSync(clave, 'utf8'), certificado: readFileSync(cert, 'utf8') }
})

const SEMILLA = '<?xml version="1.0"?><SemillaModel><valor>abc123</valor><fecha>2026-09-11</fecha></SemillaModel>'

/** Un `fetch` de mentira que apunta lo que le piden y contesta a medida. */
function fetchFalso(respuestas: Record<string, () => Response>) {
  const llamadas: { url: string; metodo: string; auth: string | null }[] = []
  const f: Fetch = async (entrada, init) => {
    const url = String(entrada)
    const headers = new Headers(init?.headers)
    llamadas.push({ url, metodo: init?.method ?? 'GET', auth: headers.get('Authorization') })
    const clave = Object.keys(respuestas).find((k) => url.includes(k))
    if (!clave) throw new Error(`fetch inesperado: ${url}`)
    return respuestas[clave]!()
  }
  return { f, llamadas }
}

const jsonOk = (o: unknown) => () => new Response(JSON.stringify(o), { status: 200 })

describe('Los dos dominios, que es la trampa numero uno', () => {
  it('el e-CF y el resumen NO van al mismo sitio', () => {
    expect(DOMINIO_ECF).toBe('https://ecf.dgii.gov.do')
    expect(DOMINIO_FC).toBe('https://fc.dgii.gov.do')
    expect(DOMINIO_ECF).not.toBe(DOMINIO_FC)
  })

  it('la URL lleva el ambiente en el camino', () => {
    expect(urlEcf('testecf', RUTAS.semilla)).toBe(
      'https://ecf.dgii.gov.do/testecf/autenticacion/api/autenticacion/semilla',
    )
    expect(urlEcf('ecf', RUTAS.recepcionEcf)).toContain('/ecf/recepcion/api/facturaselectronicas')
  })

  it('el resumen va al dominio de facturas de consumo', () => {
    expect(urlFc('certecf', RUTAS.recepcionResumen)).toBe(
      'https://fc.dgii.gov.do/certecf/recepcionfc/api/recepcion/ecf',
    )
  })
})

describe('Leer lo que la DGII contesta', () => {
  it('saca el valor de la semilla', () => {
    expect(leerSemilla(SEMILLA)).toBe('abc123')
  })

  it('una semilla sin valor devuelve null en vez de cadena vacia', () => {
    expect(leerSemilla('<SemillaModel></SemillaModel>')).toBeNull()
  })

  it('lee el token con su fecha de expiracion', () => {
    const t = leerToken({ token: 'jwt.abc', expira: '2026-09-11T10:00:00Z' })
    expect(t?.valor).toBe('jwt.abc')
    expect(t?.expira.toISOString()).toBe('2026-09-11T10:00:00.000Z')
  })

  it('sin fecha utilizable asume una hora, no eterno', () => {
    const t = leerToken({ token: 'jwt.abc' })
    expect(t).not.toBeNull()
    expect(t!.expira.getTime()).toBeGreaterThan(Date.now())
  })

  it('sin token devuelve null', () => {
    expect(leerToken({ expira: 'x' })).toBeNull()
    expect(leerToken(null)).toBeNull()
    expect(leerToken('texto')).toBeNull()
  })

  it('la respuesta del envio NO dice aceptado: trae un trackId', () => {
    const r = leerRespuestaEnvio({ trackId: 'abc-123', error: null, mensaje: 'Recibido' })
    expect(r.trackId).toBe('abc-123')
    expect(r.mensaje).toBe('Recibido')
  })

  it('tolera el trackid en minusculas', () => {
    expect(leerRespuestaEnvio({ trackid: 'x-1' }).trackId).toBe('x-1')
  })

  it('una respuesta ilegible se reporta como error, no explota', () => {
    expect(leerRespuestaEnvio(null).error).toBe('respuesta ilegible')
  })
})

describe('La vigencia del token', () => {
  const ahora = new Date('2026-09-11T09:00:00Z')

  it('uno de una hora sirve', () => {
    expect(tokenVigente({ valor: 'x', expira: new Date('2026-09-11T10:00:00Z') }, ahora)).toBe(true)
  })

  it('uno vencido no sirve', () => {
    expect(tokenVigente({ valor: 'x', expira: new Date('2026-09-11T08:59:00Z') }, ahora)).toBe(false)
  })

  it('uno que expira en diez segundos TAMPOCO sirve', () => {
    // Entre pedir el token y que la DGII procese el envio pasa tiempo.
    expect(tokenVigente({ valor: 'x', expira: new Date('2026-09-11T09:00:10Z') }, ahora)).toBe(false)
  })
})

describe('El cuerpo del envio', () => {
  it('es multipart con un campo llamado xml, no el XML en el cuerpo', () => {
    const fd = cuerpoEnvio('<ECF/>', '131223345E320000000001.xml')
    expect(fd.get('xml')).toBeInstanceOf(Blob)
    expect((fd.get('xml') as File).name).toBe('131223345E320000000001.xml')
  })
})

describe('El cliente, contra un fetch de mentira', () => {
  it('autentica en dos pasos: pide semilla, la firma, la cambia por token', async () => {
    const { f, llamadas } = fetchFalso({
      'autenticacion/semilla': () => new Response(SEMILLA, { status: 200 }),
      validarsemilla: jsonOk({ token: 'jwt.abc', expira: '2099-01-01T00:00:00Z' }),
    })
    const c = new ClienteDgii({ ambiente: 'testecf', credencial, fetch: f })
    const t = await c.obtenerToken()

    expect(t.valor).toBe('jwt.abc')
    expect(llamadas).toHaveLength(2)
    expect(llamadas[0]!.metodo).toBe('GET')
    expect(llamadas[1]!.metodo).toBe('POST')
  })

  it('reusa el token en vez de pedir uno por factura', async () => {
    const { f, llamadas } = fetchFalso({
      'autenticacion/semilla': () => new Response(SEMILLA, { status: 200 }),
      validarsemilla: jsonOk({ token: 'jwt.abc', expira: '2099-01-01T00:00:00Z' }),
    })
    const c = new ClienteDgii({ ambiente: 'testecf', credencial, fetch: f })
    await c.obtenerToken()
    await c.obtenerToken()
    await c.obtenerToken()
    expect(llamadas).toHaveLength(2) // dos, no seis
  })

  it('un e-CF completo va al dominio ecf', async () => {
    const { f, llamadas } = fetchFalso({
      'autenticacion/semilla': () => new Response(SEMILLA, { status: 200 }),
      validarsemilla: jsonOk({ token: 'jwt.abc', expira: '2099-01-01T00:00:00Z' }),
      facturaselectronicas: jsonOk({ trackId: 'T-1' }),
    })
    const c = new ClienteDgii({ ambiente: 'testecf', credencial, fetch: f })
    const r = await c.enviar('<ECF/>', 'x.xml', false)

    expect(r.trackId).toBe('T-1')
    const envio = llamadas.at(-1)!
    expect(envio.url).toContain('ecf.dgii.gov.do')
    expect(envio.auth).toBe('Bearer jwt.abc')
  })

  it('un resumen va al OTRO dominio', async () => {
    const { f, llamadas } = fetchFalso({
      'autenticacion/semilla': () => new Response(SEMILLA, { status: 200 }),
      validarsemilla: jsonOk({ token: 'jwt.abc', expira: '2099-01-01T00:00:00Z' }),
      'recepcionfc/api': jsonOk({ trackId: 'T-2' }),
    })
    const c = new ClienteDgii({ ambiente: 'testecf', credencial, fetch: f })
    await c.enviar('<ECF/>', 'x.xml', true)
    expect(llamadas.at(-1)!.url).toContain('fc.dgii.gov.do')
  })

  it('un error HTTP con cuerpo conserva el motivo de la DGII', async () => {
    const { f } = fetchFalso({
      'autenticacion/semilla': () => new Response(SEMILLA, { status: 200 }),
      validarsemilla: jsonOk({ token: 'jwt.abc', expira: '2099-01-01T00:00:00Z' }),
      facturaselectronicas: () =>
        new Response(JSON.stringify({ error: 'eNCF no autorizado' }), { status: 400 }),
    })
    const c = new ClienteDgii({ ambiente: 'testecf', credencial, fetch: f })
    const r = await c.enviar('<ECF/>', 'x.xml', false)
    expect(r.error).toBe('eNCF no autorizado')
    expect(r.trackId).toBeNull()
  })

  it('un error HTTP sin cuerpo al menos dice el codigo', async () => {
    const { f } = fetchFalso({
      'autenticacion/semilla': () => new Response(SEMILLA, { status: 200 }),
      validarsemilla: jsonOk({ token: 'jwt.abc', expira: '2099-01-01T00:00:00Z' }),
      facturaselectronicas: () => new Response('no es json', { status: 503 }),
    })
    const c = new ClienteDgii({ ambiente: 'testecf', credencial, fetch: f })
    expect((await c.enviar('<ECF/>', 'x.xml', false)).error).toBe('HTTP 503')
  })

  it('si la semilla viene sin valor, se dice claro', async () => {
    const { f } = fetchFalso({
      'autenticacion/semilla': () => new Response('<SemillaModel/>', { status: 200 }),
    })
    const c = new ClienteDgii({ ambiente: 'testecf', credencial, fetch: f })
    await expect(c.obtenerToken()).rejects.toThrow(/sin <valor>/)
  })

  it('la consulta de resultado va por trackId y con el token', async () => {
    const { f, llamadas } = fetchFalso({
      'autenticacion/semilla': () => new Response(SEMILLA, { status: 200 }),
      validarsemilla: jsonOk({ token: 'jwt.abc', expira: '2099-01-01T00:00:00Z' }),
      consultaresultado: jsonOk({ estado: 1 }),
    })
    const c = new ClienteDgii({ ambiente: 'testecf', credencial, fetch: f })
    await c.consultarResultado('T-1')
    const q = llamadas.at(-1)!
    expect(q.url).toContain('trackid=T-1')
    expect(q.auth).toBe('Bearer jwt.abc')
  })
})
