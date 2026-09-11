import { describe, expect, it } from 'vitest'
import {
  URL_DEV,
  escaparHtml,
  esEnlaceSeguroParaAbrir,
  esNavegacionInterna,
  explicarFallo,
  mismaPagina,
  normalizarBase,
  paginaDeError,
  resolverUrlBase,
  urlDePaginaDeError,
  urlDeTicket,
} from './servidor'

/**
 * Aqui se prueba la frontera de la ventana de la caja.
 *
 * Dos cosas distintas y las dos caras: que el escritorio sepa a donde
 * conectarse, y que NADA que no sea el ERP entre en esa ventana ni salga
 * por la impresora. La ventana carga una pagina remota con la sesion del
 * cajero delante; la comparacion de origenes es lo unico que la separa de
 * un sitio ajeno.
 */

describe('Normalizar la direccion del servidor', () => {
  it('quita la barra final: `${base}/pos` no puede quedar con doble barra', () => {
    expect(normalizarBase('http://localhost:3100/')).toBe('http://localhost:3100')
    expect(normalizarBase('https://erp.midominio.do///')).toBe('https://erp.midominio.do')
  })

  it('perdona los espacios de un copiar y pegar', () => {
    expect(normalizarBase('  http://localhost:3100  ')).toBe('http://localhost:3100')
  })

  it('rechaza lo que no sea http o https', () => {
    // Un `file:` convertiria la caja en un visor de archivos del equipo.
    expect(normalizarBase('file:///C:/erp')).toBeNull()
    expect(normalizarBase('javascript:alert(1)')).toBeNull()
    expect(normalizarBase('no es una url')).toBeNull()
    expect(normalizarBase('   ')).toBeNull()
  })
})

describe('Decidir contra que servidor habla la caja', () => {
  it('la variable de entorno manda sobre lo configurado', () => {
    expect(
      resolverUrlBase({
        env: 'https://demo.regb.do',
        configurada: 'https://otro.regb.do',
        empaquetada: true,
      }),
    ).toBe('https://demo.regb.do')
  })

  it('si el entorno trae basura se cae a lo configurado, no se rompe', () => {
    expect(
      resolverUrlBase({ env: 'chiripa', configurada: 'https://erp.midominio.do', empaquetada: true }),
    ).toBe('https://erp.midominio.do')
  })

  it('en desarrollo cae en el puerto donde corre apps/web', () => {
    expect(resolverUrlBase({ empaquetada: false })).toBe(URL_DEV)
    expect(URL_DEV).toBe('http://localhost:3100')
  })

  it('empaquetada y sin configurar NO inventa un localhost', () => {
    // Preferimos una pantalla que diga "falta configurar" a una que
    // reintente para siempre contra una direccion que nadie escribio.
    expect(resolverUrlBase({ empaquetada: true })).toBeNull()
  })
})

describe('Que entra en la ventana de la caja', () => {
  const base = 'http://localhost:3100'

  it('deja pasar el propio ERP', () => {
    expect(esNavegacionInterna(`${base}/pos`, base)).toBe(true)
    expect(esNavegacionInterna(`${base}/pos/ticket/9?x=1`, base)).toBe(true)
  })

  it('NO se deja enganar por un prefijo: 31000 no es 3100', () => {
    // Este es el bug clasico de comparar con `startsWith`. Un puerto o un
    // dominio que empiece igual entraria en la ventana con las cookies
    // del cajero delante.
    expect(esNavegacionInterna('http://localhost:31000/pos', base)).toBe(false)
    expect(esNavegacionInterna('https://erp.midominio.do.evil.com/', 'https://erp.midominio.do')).toBe(
      false,
    )
  })

  it('distingue http de https aunque el dominio sea el mismo', () => {
    expect(esNavegacionInterna('http://erp.midominio.do/pos', 'https://erp.midominio.do')).toBe(false)
  })

  it('sin servidor configurado no entra nada', () => {
    expect(esNavegacionInterna(`${base}/pos`, null)).toBe(false)
  })

  it('lo que no es una URL no pasa', () => {
    expect(esNavegacionInterna('about:blank', base)).toBe(false)
    expect(esNavegacionInterna('javascript:alert(1)', base)).toBe(false)
    expect(esNavegacionInterna('', base)).toBe(false)
  })
})

describe('Que se manda al papel', () => {
  const base = 'http://localhost:3100'

  it('una ruta del ERP se vuelve absoluta', () => {
    expect(urlDeTicket('/pos/ticket/123', base)).toBe('http://localhost:3100/pos/ticket/123')
  })

  it('una absoluta del mismo ERP se acepta tal cual', () => {
    expect(urlDeTicket(`${base}/pos/ticket/123`, base)).toBe('http://localhost:3100/pos/ticket/123')
  })

  it('NO imprime nada de fuera del ERP', () => {
    // Sin este filtro, un script inyectado en la pagina podria vaciar el
    // rollo imprimiendo un sitio cualquiera, en silencio.
    expect(urlDeTicket('https://otro-sitio.com/lo-que-sea', base)).toBeNull()
    expect(urlDeTicket('file:///C:/Windows/win.ini', base)).toBeNull()
  })

  it('la URL protocolo-relativa no se cuela', () => {
    // `//otro.com/x` parece una ruta, pero `new URL` la resuelve contra
    // OTRO dominio. Es la forma mas facil de saltarse un filtro ingenuo.
    expect(urlDeTicket('//otro-sitio.com/x', base)).toBeNull()
  })

  it('sin servidor no hay nada que imprimir', () => {
    expect(urlDeTicket('/pos/ticket/1', null)).toBeNull()
  })
})

describe('Ya estamos en esa pantalla', () => {
  const base = 'http://localhost:3100'

  it('reconoce la misma ruta aunque cambie la query', () => {
    // Importa porque recargar el POS a mitad de un cobro borra el carrito.
    expect(mismaPagina(`${base}/pos?turno=3`, base, '/pos')).toBe(true)
  })

  it('una ruta distinta si es distinta', () => {
    expect(mismaPagina(`${base}/inventory`, base, '/pos')).toBe(false)
  })

  it('la pantalla de error no cuenta como estar en la caja', () => {
    expect(mismaPagina('data:text/html,algo', base, '/pos')).toBe(false)
  })
})

describe('Que se le entrega al sistema operativo', () => {
  it('paginas web y contactos, si', () => {
    expect(esEnlaceSeguroParaAbrir('https://dgii.gov.do')).toBe(true)
    expect(esEnlaceSeguroParaAbrir('http://dgii.gov.do')).toBe(true)
    expect(esEnlaceSeguroParaAbrir('mailto:soporte@regb.do')).toBe(true)
    expect(esEnlaceSeguroParaAbrir('tel:8095550000')).toBe(true)
  })

  it('archivos y protocolos raros, no', () => {
    // `shell.openExternal` se lo pasa al sistema tal cual, y el sistema
    // sabe abrir mucho mas que paginas.
    expect(esEnlaceSeguroParaAbrir('file:///C:/Windows/System32')).toBe(false)
    expect(esEnlaceSeguroParaAbrir('smb://servidor/carpeta')).toBe(false)
    expect(esEnlaceSeguroParaAbrir('javascript:alert(1)')).toBe(false)
    expect(esEnlaceSeguroParaAbrir('cualquier cosa')).toBe(false)
  })
})

describe('Explicar el fallo en cristiano', () => {
  it('traduce los codigos que de verdad salen en un local', () => {
    expect(explicarFallo('ERR_CONNECTION_REFUSED')).toContain('no este encendido')
    expect(explicarFallo('ERR_NAME_NOT_RESOLVED')).toContain('DNS')
    expect(explicarFallo('ERR_INTERNET_DISCONNECTED')).toContain('conexion de red')
    expect(explicarFallo('ERR_CERT_DATE_INVALID')).toContain('certificado')
  })

  it('lo que no conoce lo deja pasar en vez de tragarselo', () => {
    expect(explicarFallo('ERR_RARO_NUEVO')).toBe('ERR_RARO_NUEVO')
    expect(explicarFallo('')).toBe('No se pudo cargar la pagina.')
  })
})

describe('La pantalla de error', () => {
  const datos = { base: 'http://localhost:3100', rutaInicio: '/pos', segundosReintento: 10 }

  it('dice en espanol y sin rodeos que el problema es el servidor', () => {
    const html = paginaDeError(datos)
    expect(html).toContain('No se pudo conectar con el servidor de REGB ERP')
    expect(html).toContain('http://localhost:3100')
  })

  it('tranquiliza sobre lo unico que asusta: las ventas ya cobradas', () => {
    expect(paginaDeError(datos)).toContain('no se pierden')
  })

  it('ofrece reintentar y dice cada cuanto lo hace solo', () => {
    const html = paginaDeError(datos)
    expect(html).toContain('Reintentar ahora')
    expect(html).toContain('cada 10 segundos')
    // El boton lleva a la ruta de arranque, no a la raiz.
    expect(html).toContain('href="http://localhost:3100/pos"')
  })

  it('sin servidor configurado cambia el mensaje y NO ofrece reintentar', () => {
    const html = paginaDeError({ ...datos, base: null })
    expect(html).toContain('no sabe a que servidor conectarse')
    expect(html).toContain('REGB_URL')
    expect(html).not.toContain('Reintentar ahora')
  })

  it('muestra el motivo tecnico cuando lo hay', () => {
    expect(paginaDeError({ ...datos, detalle: 'El servidor no acepto la conexion.' })).toContain(
      'El servidor no acepto la conexion.',
    )
  })

  it('escapa lo que venga de fuera: la direccion la escribe un tercero', () => {
    const html = paginaDeError({ ...datos, detalle: '<img src=x onerror="alert(1)">' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('no pide ni un recurso de la red', () => {
    // Se muestra justo cuando la red no funciona: una fuente o un logo
    // remoto la dejarian a medio pintar.
    const html = paginaDeError(datos)
    expect(html).not.toMatch(/(src|href)="https?:\/\/(?!localhost)/)
    expect(html).not.toContain('<script')
  })
})

describe('Empaquetar la pantalla de error', () => {
  it('va como data: para no tocar el disco cuando algo ya fallo', () => {
    const url = urlDePaginaDeError('<p>hola</p>')
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length))).toBe('<p>hola</p>')
  })
})

describe('Escapar HTML', () => {
  it('cubre los cinco de siempre', () => {
    expect(escaparHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })
})
