/**
 * Lectura y validacion de CSV para el modulo `imports` (§5.1 core 11).
 *
 * Logica pura, sin base: la corre la accion de servidor de /importar.
 * Esta aqui y no en la accion para que una vista previa en el navegador
 * pueda usar la MISMA regla el dia que exista (hoy no hay paso previo).
 */

export type Delimitador = ',' | ';'

/**
 * El separador del archivo, leido de la linea de encabezados: `;` si hay
 * mas punto y coma que comas fuera de comillas, `,` si no.
 *
 * Un archivo usa UNO. Antes se cortaba por los dos a la vez y el CSV de
 * un Excel en espanol -separado por `;`, con `1.234,56` sin comillas
 * porque la coma no es su separador- partia cada precio en dos columnas.
 */
export function detectarDelimitador(text: string): Delimitador {
  let comas = 0
  let puntoYComas = 0
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') inQuotes = !inQuotes
    else if (!inQuotes && c === '\n') break
    else if (!inQuotes && c === ',') comas++
    else if (!inQuotes && c === ';') puntoYComas++
  }
  return puntoYComas > comas ? ';' : ','
}

/** Parser tolerante a comillas, separador dentro de comillas y CRLF. */
export function parseCsv(
  text: string,
  delimitador: Delimitador = detectarDelimitador(text),
): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      inQuotes = true
    } else if (c === delimitador) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

export interface ImportError {
  row: number
  column: string
  message: string
  /**
   * Sin valor (o `rejected`): la fila se rechazo. `skipped`: la fila era
   * buena pero su codigo ya existia y el producto no se toco. Lo anota la
   * accion al insertar, no esta validacion: solo la base sabe que existe.
   */
  kind?: 'rejected' | 'skipped'
}

export interface ProductDraft {
  sku: string
  name: string
  category: string | null
  unit: string
  price: number
  cost: number | null
  /** Tal cual lo lee el escaner; null si la fila no trae. */
  barcode: string | null
  /**
   * Tasa de ITBIS como fraccion: 0, 0.16 o 0.18. `null` = la fila no dijo
   * nada, y la base pone la tasa por defecto del cliente (0118).
   */
  taxRate: number | null
}

/**
 * Lo que una columna del CSV puede llenar. `exempt` no es un campo del
 * producto: es otra forma de decir "tasa 0", y se resuelve en `taxRate`.
 */
export type ProductField = keyof ProductDraft | 'exempt'

/** Una fila que paso la validacion, con su linea del archivo. */
export interface ProductRow extends ProductDraft {
  line: number
}

export interface ValidationResult {
  valid: ProductRow[]
  errors: ImportError[]
  /** Encabezados que el archivo trae y el mapeo no reconocio. */
  ignored: string[]
  /**
   * Filas de datos rechazadas. No es `errors.length`: si falta una columna
   * obligatoria hay uno o dos mensajes y caen TODAS las filas.
   */
  rejectedRows: number
  /** Como se leyeron los numeros de este archivo, y por que. */
  numberFormat: FormatoArchivo
}

/** Nombres de columna que se aceptan para cada campo, en varios idiomas. */
export const PRODUCT_COLUMNS: Record<ProductField, string[]> = {
  sku: ['sku', 'codigo', 'código', 'code', 'referencia'],
  name: ['name', 'nombre', 'descripcion', 'descripción', 'producto'],
  category: ['category', 'categoria', 'categoría', 'rubro'],
  unit: ['unit', 'unidad', 'medida', 'uom'],
  price: ['price', 'precio', 'pvp', 'precio venta'],
  cost: ['cost', 'costo', 'precio compra'],
  // "Codigo de barras" normalizado no es "codigo": el sku no se confunde.
  barcode: ['codigo de barras', 'código de barras', 'barcode', 'cod barras', 'ean', 'upc', 'gtin'],
  taxRate: [
    'itbis',
    'tasa',
    'tasa itbis',
    'tasa de itbis',
    'impuesto',
    'tax',
    'tax rate',
    'tax_rate',
  ],
  exempt: ['exento', 'exenta', 'exento de itbis', 'exempt'],
}

function normalizaCabecera(h: string): string {
  return h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** El mapeo generico: el primer encabezado que casa con un alias gana. */
function mapearCabeceras<K extends string>(
  headers: string[],
  columnas: Record<K, string[]>,
): { mapping: Partial<Record<K, number>>; ignored: string[] } {
  const mapping: Partial<Record<K, number>> = {}
  const ignored: string[] = []
  const campos = Object.keys(columnas) as K[]

  headers.forEach((raw, i) => {
    const h = normalizaCabecera(raw)
    const campo = campos.find((k) => columnas[k].some((alias) => normalizaCabecera(alias) === h))
    if (campo && mapping[campo] === undefined) mapping[campo] = i
    else if (!campo) ignored.push(raw.trim())
  })

  return { mapping, ignored }
}

/** Mapea los encabezados del archivo a los campos del producto. */
export function mapHeaders(headers: string[]): {
  mapping: Partial<Record<ProductField, number>>
  ignored: string[]
} {
  return mapearCabeceras(headers, PRODUCT_COLUMNS)
}

// ═══════════════════════════════════════════════════════════════════════
//  Codigo de barras e ITBIS
//
//  No pasan por la regla de los numeros a proposito:
//   · un codigo de barras es TEXTO -"0012345678905" pierde su cero si se
//     lee como numero, y "7.46E+12" ya perdio digitos en Excel-;
//   · una tasa solo puede ser 0, 16% o 18%, asi que "0,18" no es ambiguo y
//     no debe decidir como se leen los precios del archivo.
// ═══════════════════════════════════════════════════════════════════════

/** Las tasas de ITBIS que existen en RD. Cualquier otra es un error de digitacion. */
export const TASAS_ITBIS = [0, 0.16, 0.18] as const

export type LecturaTasa = { ok: true; tasa: number } | { ok: false; motivo: string }
export type LecturaExento = { ok: true; exento: boolean } | { ok: false; motivo: string }
export type LecturaCodigo = { ok: true; codigo: string | null } | { ok: false; motivo: string }

const sinAcentos = (t: string): string =>
  t.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const pct = (tasa: number): string => `${Math.round(tasa * 100)}%`

/**
 * "18%", "18", "0.18", "0,18", "16%", "0", "exento". Vacia devuelve null:
 * la fila no dijo nada y manda la tasa por defecto del cliente.
 */
export function leerTasaItbis(raw: string): LecturaTasa | null {
  const t = sinAcentos(raw)
  if (t === '') return null
  if (/^exent[oa](?: de itbis)?$/.test(t)) return { ok: true, tasa: 0 }

  const invalida: LecturaTasa = {
    ok: false,
    motivo: `La tasa de ITBIS "${raw.trim()}" no es valida: usa 18%, 16%, 0 o "exento".`,
  }
  const m = /^(\d{1,3}(?:[.,]\d{1,4})?)\s*(%?)$/.exec(t)
  if (!m) return invalida
  let v = Number(m[1]!.replace(',', '.'))
  // "18" y "18%" son porcentaje; "0.18" ya es fraccion. Una tasa no pasa
  // de 1, asi que no hay forma ambigua.
  if (m[2] === '%' || v > 1) v = v / 100
  const tasa = TASAS_ITBIS.find((x) => Math.abs(x - v) < 1e-9)
  return tasa === undefined ? invalida : { ok: true, tasa }
}

const SI = new Set(['si', 's', 'x', 'yes', 'y', '1', 'true', 'verdadero', 'exento', 'exenta'])
const NO = new Set(['no', 'n', '0', 'false', 'falso'])

/** La columna "exento": si/no, x, 1/0. Vacia devuelve null. */
export function leerExento(raw: string): LecturaExento | null {
  const t = sinAcentos(raw)
  if (t === '') return null
  if (SI.has(t)) return { ok: true, exento: true }
  if (NO.has(t)) return { ok: true, exento: false }
  return { ok: false, motivo: `"${raw.trim()}" no se entiende como exento: escribe si o no.` }
}

/**
 * Espacio duro de Excel (NBSP y el angosto). Se arma con fromCharCode: el
 * caracter literal en el codigo lo rechaza el lint (no-irregular-whitespace).
 */
const ESPACIO_DURO = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g')

/** Un codigo de barras tal cual lo lee el escaner: numeros, letras y guiones. */
export function leerCodigoDeBarras(raw: string): LecturaCodigo {
  const t = raw.replace(ESPACIO_DURO, ' ').trim()
  if (t === '') return { ok: true, codigo: null }
  if (/^\d+(?:[.,]\d+)?e\+?\d+$/i.test(t)) {
    return {
      ok: false,
      motivo: `"${t}" es un codigo de barras que Excel convirtio en notacion cientifica y ya perdio digitos. Formatea esa columna como Texto en Excel y vuelve a exportar el CSV.`,
    }
  }
  if (!/^[0-9A-Za-z-]{3,64}$/.test(t)) {
    return {
      ok: false,
      motivo: `"${t}" no parece un codigo de barras: solo numeros, letras y guiones, sin espacios.`,
    }
  }
  return { ok: true, codigo: t }
}

// ═══════════════════════════════════════════════════════════════════════
//  La regla de los numeros
//
//  Antes, "1,234" con una sola coma se leia como europeo: 1.234, y la
//  columna numeric(12,2) lo guardaba como RD$1.23. Sin error. La regla
//  de ahora, en una frase: SE LEE LO INEQUIVOCO, Y LO AMBIGUO SOLO SE
//  RESUELVE COMO SEPARADOR DE MILES Y SOLO SI EL ARCHIVO LO RESPALDA.
//  Lo demas se rechaza con su motivo. Tabla completa en
//  docs/modules/imports.md.
//
//  Ambiguo es exactamente una forma: UN solo separador, 1 a 3 digitos
//  antes (sin cero a la izquierda) y EXACTAMENTE 3 despues -"1,234",
//  "1.234", "12.500"-. Cualquier otra forma dice por si misma cual es el
//  separador decimal: un separador de miles va seguido siempre de 3
//  digitos, y el decimal aparece una sola vez.
// ═══════════════════════════════════════════════════════════════════════

/**
 * `rd`: coma de miles y punto decimal (1,234.56), lo habitual en RD.
 * `eu`: punto de miles y coma decimal (1.234,56), lo que escribe Excel en
 * espanol.
 */
export type FormatoNumero = 'rd' | 'eu'

export type LecturaNumero =
  /** `demuestra`: el formato que esta celda prueba por si sola, si alguno. */
  | { tipo: 'numero'; valor: number; demuestra: FormatoNumero | null }
  | { tipo: 'ambiguo'; separador: ',' | '.'; comoMiles: number; comoDecimal: number }
  | { tipo: 'invalido' }

export type ResultadoNumero =
  { ok: true; valor: number } | { ok: false; motivo: 'invalido' | 'ambiguo' }

const INVALIDO: LecturaNumero = { tipo: 'invalido' }
/** RD$, US$, $, DOP, USD, con o sin espacio: "RD $ 215" tambien. */
const MONEDA = /(?:RD|US)?\s*\$|\b(?:DOP|USD)\b/gi
/** Primer grupo de un numero con separador de miles: 1 a 3 digitos, sin 0 delante. */
const PRIMER_GRUPO = /^[1-9]\d{0,2}$/

const sinMenosCero = (n: number): number => (n === 0 ? 0 : n)

function milesBienPuestos(t: string, miles: string): boolean {
  const grupos = t.split(miles)
  return PRIMER_GRUPO.test(grupos[0]!) && grupos.slice(1).every((g) => /^\d{3}$/.test(g))
}

/**
 * Lee UNA celda sin mirar el resto del archivo. Quita moneda y espacios de
 * los bordes; entiende el signo menos (tambien el tipografico) y los
 * parentesis contables como negativo. Un espacio ENTRE digitos no se
 * junta ("12 34" no es 1234): se rechaza.
 */
export function leerNumero(raw: string): LecturaNumero {
  let t = raw
    .replace(/[\u00a0\u202f]/g, ' ') // espacio duro de Excel
    .replace(/\u2212/g, '-') // signo menos tipografico
    .replace(MONEDA, ' ')
    .trim()

  let negativo = false
  const parentesis = /^\((.*)\)$/.exec(t)
  if (parentesis) {
    negativo = true
    t = parentesis[1]!.trim()
  }
  if (t.startsWith('-')) {
    if (negativo) return INVALIDO
    negativo = true
    t = t.slice(1).trim()
  }
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return INVALIDO

  const signo = negativo ? -1 : 1
  const numero = (texto: string, demuestra: FormatoNumero | null): LecturaNumero => ({
    tipo: 'numero',
    valor: sinMenosCero(signo * Number(texto)),
    demuestra,
  })

  const tieneComa = t.includes(',')
  const tienePunto = t.includes('.')
  if (!tieneComa && !tienePunto) return numero(t, null)

  // Los dos separadores: el ULTIMO es el decimal y va una sola vez.
  if (tieneComa && tienePunto) {
    const decimal = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.'
    const miles = decimal === ',' ? '.' : ','
    const [entero, fraccion, ...sobra] = t.split(decimal) as [string, string, ...string[]]
    if (sobra.length > 0 || !/^\d+$/.test(fraccion) || !milesBienPuestos(entero, miles)) {
      return INVALIDO
    }
    return numero(`${entero.split(miles).join('')}.${fraccion}`, decimal === '.' ? 'rd' : 'eu')
  }

  const sep = tieneComa ? ',' : '.'
  const partes = t.split(sep)

  // Repetido solo puede ser de miles: "1,234,567" o "1.234.567".
  if (partes.length > 2) {
    if (!milesBienPuestos(t, sep)) return INVALIDO
    return numero(partes.join(''), sep === ',' ? 'rd' : 'eu')
  }

  const [izq, der] = partes as [string, string]
  if (der === '') return INVALIDO
  if (PRIMER_GRUPO.test(izq) && der.length === 3) {
    return {
      tipo: 'ambiguo',
      separador: sep,
      comoMiles: sinMenosCero(signo * Number(izq + der)),
      comoDecimal: sinMenosCero(signo * Number(`${izq}.${der}`)),
    }
  }
  // Una vez y sin forma de miles: es el decimal. "215.00", "12,50", "0,500".
  return numero(`${izq || '0'}.${der}`, sep === '.' ? 'rd' : 'eu')
}

/**
 * Lo ambiguo se acepta SOLO leido como separador de miles, y solo si en el
 * formato del archivo ese separador ES el de miles: "1,234" en un archivo
 * `rd`, "1.234" en uno `eu`. Nunca se lee como tres decimales -el precio
 * y el costo guardan dos-, y en un archivo `mixto` no se acepta ninguno.
 */
export function resolverLectura(
  lectura: LecturaNumero,
  formato: FormatoNumero | 'mixto',
): ResultadoNumero {
  if (lectura.tipo === 'numero') return { ok: true, valor: lectura.valor }
  if (lectura.tipo === 'invalido') return { ok: false, motivo: 'invalido' }
  const esDeMiles =
    (formato === 'rd' && lectura.separador === ',') ||
    (formato === 'eu' && lectura.separador === '.')
  return esDeMiles ? { ok: true, valor: lectura.comoMiles } : { ok: false, motivo: 'ambiguo' }
}

/** Una celda suelta. `formato` es el del archivo; por defecto, el de RD. */
export function parseNumero(raw: string, formato: FormatoNumero | 'mixto' = 'rd'): ResultadoNumero {
  return resolverLectura(leerNumero(raw), formato)
}

export interface CeldaNumerica {
  valor: string
  linea: number
  /** `price`/`cost` en productos; `qty`/`unitCost` en existencias. */
  columna: 'price' | 'cost' | 'qty' | 'unitCost'
}

export interface FormatoArchivo {
  formato: FormatoNumero | 'mixto'
  /** Primera celda que prueba punto decimal (formato RD). */
  rd: CeldaNumerica | null
  /** Primera celda que prueba coma decimal (formato europeo). */
  eu: CeldaNumerica | null
  /** Ninguna celda probaba nada: decidio el separador del CSV. */
  porDelimitador: boolean
}

/**
 * El formato del ARCHIVO, no de la columna: un archivo sale de un solo
 * Excel, asi que una coma decimal en el costo dice como leer el precio.
 * Si ninguna celda lo prueba, el separador del CSV: `,` -> RD, `;` -> el
 * de Excel en espanol.
 */
export function formatoDelArchivo(
  celdas: CeldaNumerica[],
  delimitador: Delimitador,
): FormatoArchivo {
  let rd: CeldaNumerica | null = null
  let eu: CeldaNumerica | null = null
  for (const c of celdas) {
    const l = leerNumero(c.valor)
    if (l.tipo !== 'numero' || l.demuestra === null) continue
    if (l.demuestra === 'rd') rd ??= c
    else eu ??= c
  }
  if (rd && eu) return { formato: 'mixto', rd, eu, porDelimitador: false }
  if (rd) return { formato: 'rd', rd, eu: null, porDelimitador: false }
  if (eu) return { formato: 'eu', rd: null, eu, porDelimitador: false }
  return { formato: delimitador === ';' ? 'eu' : 'rd', rd: null, eu: null, porDelimitador: true }
}

function mensajeAmbiguo(
  raw: string,
  l: Extract<LecturaNumero, { tipo: 'ambiguo' }>,
  f: FormatoArchivo,
): string {
  const miles = Math.abs(l.comoMiles)
  const [alto, bajo] = [Math.trunc(miles / 1000), String(miles % 1000).padStart(3, '0')]
  const cita = (c: CeldaNumerica) => `linea ${c.linea}: "${c.valor}"`

  let porque = ''
  if (f.formato === 'mixto' && f.rd && f.eu) {
    porque = ` Este archivo mezcla punto decimal (${cita(f.rd)}) y coma decimal (${cita(f.eu)}).`
  } else if (f.formato === 'eu') {
    porque = f.eu
      ? ` Este archivo usa coma decimal (${cita(f.eu)}).`
      : ' El archivo viene separado por punto y coma, como lo exporta Excel en espanol, y ahi la coma es decimal.'
  } else {
    porque = f.rd
      ? ` Este archivo usa punto decimal (${cita(f.rd)}), pero un monto con tres decimales casi siempre es un punto de miles.`
      : ' En RD el punto es decimal, pero hay quien lo usa de miles (RD$1.500).'
  }
  const conDecimales = f.formato === 'eu' ? `${alto}.${bajo},00` : `${alto},${bajo}.00`

  return (
    `"${raw}" es ambiguo: puede ser ${l.comoMiles} o ${Math.trunc(l.comoDecimal)} con ` +
    `${Number(bajo)} milesimas.${porque} No adivinamos: escribelo sin separador de miles ` +
    `(${miles}) o con sus decimales (${conDecimales}).`
  )
}

/**
 * Valida las filas contra el mapeo. Devuelve las buenas Y las malas: el
 * usuario ve exactamente que fila fallo y por que antes de confirmar.
 */
export function validateProducts(
  rows: string[][],
  headers: string[],
  /** El separador del CSV: decide el formato de los numeros si ninguna celda lo prueba. */
  opciones: { delimitador?: Delimitador } = {},
): ValidationResult {
  const { mapping, ignored } = mapHeaders(headers)
  const valid: ProductRow[] = []
  const errors: ImportError[] = []
  const vistos = new Set<string>()
  const celdaDe = (row: string[], idx: number | undefined) =>
    idx === undefined ? '' : (row[idx] ?? '').trim()
  const lineaDe = (i: number) => i + 2 // +1 por encabezado, +1 porque los humanos cuentan desde 1

  // Primera pasada: como escribe los numeros ESTE archivo. Cuentan todas
  // las filas, tambien las que luego se rechacen por otra cosa.
  const celdas: CeldaNumerica[] = []
  rows.forEach((row, i) => {
    for (const columna of ['price', 'cost'] as const) {
      const valor = celdaDe(row, mapping[columna])
      if (valor !== '') celdas.push({ valor, linea: lineaDe(i), columna })
    }
  })
  const numberFormat = formatoDelArchivo(celdas, opciones.delimitador ?? ',')
  const numeroDe = lectorDeNumeros(numberFormat)
  /** Codigo de barras -> linea donde aparecio primero. */
  const barrasVistas = new Map<string, number>()

  if (mapping.sku === undefined) {
    errors.push({ row: 0, column: 'sku', message: 'Falta la columna del codigo (sku/codigo).' })
  }
  if (mapping.name === undefined) {
    errors.push({ row: 0, column: 'name', message: 'Falta la columna del nombre.' })
  }
  if (errors.length > 0) return { valid, errors, ignored, rejectedRows: rows.length, numberFormat }

  rows.forEach((row, i) => {
    const linea = lineaDe(i)
    const celda = (idx: number | undefined) => celdaDe(row, idx)

    const sku = celda(mapping.sku)
    const name = celda(mapping.name)

    if (sku === '') {
      errors.push({ row: linea, column: 'sku', message: 'El codigo no puede ir vacio.' })
      return
    }
    if (vistos.has(sku.toLowerCase())) {
      errors.push({ row: linea, column: 'sku', message: `El codigo "${sku}" se repite.` })
      return
    }
    if (name === '') {
      errors.push({ row: linea, column: 'name', message: 'El nombre no puede ir vacio.' })
      return
    }

    const precioRaw = celda(mapping.price)
    const precio = precioRaw === '' ? 0 : numeroDe(precioRaw, linea, 'price')
    if (typeof precio !== 'number') {
      errors.push(precio)
      return
    }
    if (precio < 0) {
      errors.push({ row: linea, column: 'price', message: 'El precio no puede ser negativo.' })
      return
    }

    const costoRaw = celda(mapping.cost)
    const costo = costoRaw === '' ? null : numeroDe(costoRaw, linea, 'cost')
    if (costo !== null && typeof costo !== 'number') {
      errors.push(costo)
      return
    }
    // Antes pasaba y el check (cost >= 0) de la base revertia la
    // importacion ENTERA con un error de servidor.
    if (costo !== null && costo < 0) {
      errors.push({ row: linea, column: 'cost', message: 'El costo no puede ser negativo.' })
      return
    }

    const barras = leerCodigoDeBarras(celda(mapping.barcode))
    if (!barras.ok) {
      errors.push({ row: linea, column: 'barcode', message: barras.motivo })
      return
    }
    // El indice unico (tenant, barcode) tumbaria la importacion ENTERA:
    // el repetido se rechaza aqui, en su fila. El que choca con un
    // producto que ya esta en la base lo rechaza la accion, que la conoce.
    const previa = barras.codigo === null ? undefined : barrasVistas.get(barras.codigo)
    if (previa !== undefined) {
      errors.push({
        row: linea,
        column: 'barcode',
        message: `El codigo de barras "${barras.codigo}" se repite (ya esta en la linea ${previa}).`,
      })
      return
    }

    const tasa = leerTasaItbis(celda(mapping.taxRate))
    if (tasa && !tasa.ok) {
      errors.push({ row: linea, column: 'taxRate', message: tasa.motivo })
      return
    }
    const exento = leerExento(celda(mapping.exempt))
    if (exento && !exento.ok) {
      errors.push({ row: linea, column: 'exempt', message: exento.motivo })
      return
    }

    let taxRate: number | null = tasa && tasa.ok ? tasa.tasa : null
    if (exento && exento.ok) {
      // Dos columnas que se contradicen: no se elige una, se pregunta.
      if (exento.exento && taxRate !== null && taxRate > 0) {
        errors.push({
          row: linea,
          column: 'exempt',
          message: `La fila dice exento pero trae tasa ${pct(taxRate)}: deja solo una de las dos.`,
        })
        return
      }
      if (!exento.exento && taxRate === 0) {
        errors.push({
          row: linea,
          column: 'exempt',
          message:
            'La fila dice que no es exento pero trae tasa 0: si es exento pon "si"; si no, pon su tasa (18% o 16%).',
        })
        return
      }
      if (exento.exento) taxRate = 0
    }

    vistos.add(sku.toLowerCase())
    if (barras.codigo !== null) barrasVistas.set(barras.codigo, linea)
    valid.push({
      line: linea,
      sku,
      name,
      category: celda(mapping.category) || null,
      unit: celda(mapping.unit) || 'unidad',
      price: precio,
      cost: costo,
      barcode: barras.codigo,
      taxRate,
    })
  })

  // Una fila, a lo sumo un error: aqui errores y filas rechazadas coinciden.
  return { valid, errors, ignored, rejectedRows: errors.length, numberFormat }
}

/**
 * El numero de una celda, o el rechazo de la fila con su motivo. Comparte
 * el formato del ARCHIVO: productos y existencias leen igual.
 */
function lectorDeNumeros(
  numberFormat: FormatoArchivo,
): (raw: string, linea: number, column: CeldaNumerica['columna']) => number | ImportError {
  return (raw, linea, column) => {
    const lectura = leerNumero(raw)
    const r = resolverLectura(lectura, numberFormat.formato)
    if (r.ok) return r.valor
    const message =
      lectura.tipo === 'ambiguo'
        ? mensajeAmbiguo(raw, lectura, numberFormat)
        : `"${raw}" no es un numero.`
    return { row: linea, column, message }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Existencias iniciales
//
//  codigo + almacen + cantidad + costo unitario. Cada fila buena es un
//  `adjustment_in` CON costo: sin costo, el promedio nace contra un monton
//  fantasma de costo cero (docs/modules/inventory.md, "La trampa que
//  subvaloro el inventario"). Aqui solo se lee; la accion resuelve el
//  producto, el almacen y el costo del catalogo, que viven en la base.
// ═══════════════════════════════════════════════════════════════════════

export interface StockDraft {
  /** SKU o codigo de barras del producto. */
  sku: string
  /** Nombre o codigo del almacen; null = el predeterminado. */
  warehouse: string | null
  qty: number
  /** null = hereda el costo del catalogo, si lo tiene. */
  unitCost: number | null
}

export interface StockRow extends StockDraft {
  line: number
}

export const STOCK_COLUMNS: Record<keyof StockDraft, string[]> = {
  sku: ['sku', 'codigo', 'código', 'code', 'referencia', 'codigo de barras', 'código de barras'],
  warehouse: ['almacen', 'almacén', 'warehouse', 'bodega', 'deposito', 'depósito'],
  qty: ['cantidad', 'qty', 'quantity', 'existencia', 'existencias', 'stock', 'unidades'],
  unitCost: ['costo unitario', 'costo', 'cost', 'unit cost', 'unit_cost', 'precio compra'],
}

export interface StockValidation {
  valid: StockRow[]
  errors: ImportError[]
  ignored: string[]
  rejectedRows: number
  numberFormat: FormatoArchivo
}

export function mapStockHeaders(headers: string[]): {
  mapping: Partial<Record<keyof StockDraft, number>>
  ignored: string[]
} {
  return mapearCabeceras(headers, STOCK_COLUMNS)
}

export function validateStock(
  rows: string[][],
  headers: string[],
  opciones: { delimitador?: Delimitador } = {},
): StockValidation {
  const { mapping, ignored } = mapStockHeaders(headers)
  const valid: StockRow[] = []
  const errors: ImportError[] = []
  const vistos = new Map<string, number>()
  const celdaDe = (row: string[], idx: number | undefined) =>
    idx === undefined ? '' : (row[idx] ?? '').trim()
  const lineaDe = (i: number) => i + 2

  const celdas: CeldaNumerica[] = []
  rows.forEach((row, i) => {
    for (const columna of ['qty', 'unitCost'] as const) {
      const valor = celdaDe(row, mapping[columna])
      if (valor !== '') celdas.push({ valor, linea: lineaDe(i), columna })
    }
  })
  const numberFormat = formatoDelArchivo(celdas, opciones.delimitador ?? ',')
  const numeroDe = lectorDeNumeros(numberFormat)

  if (mapping.sku === undefined) {
    errors.push({ row: 0, column: 'sku', message: 'Falta la columna del codigo (sku/codigo).' })
  }
  if (mapping.qty === undefined) {
    errors.push({ row: 0, column: 'qty', message: 'Falta la columna de la cantidad.' })
  }
  if (errors.length > 0) return { valid, errors, ignored, rejectedRows: rows.length, numberFormat }

  rows.forEach((row, i) => {
    const linea = lineaDe(i)
    const celda = (idx: number | undefined) => celdaDe(row, idx)

    const sku = celda(mapping.sku)
    if (sku === '') {
      errors.push({ row: linea, column: 'sku', message: 'El codigo no puede ir vacio.' })
      return
    }
    const warehouse = celda(mapping.warehouse) || null
    const clave = `${sku.toLowerCase()}|${(warehouse ?? '').toLowerCase()}`
    const previa = vistos.get(clave)
    if (previa !== undefined) {
      errors.push({
        row: linea,
        column: 'sku',
        message: `El codigo "${sku}" se repite en el mismo almacen (ya esta en la linea ${previa}).`,
      })
      return
    }

    const qtyRaw = celda(mapping.qty)
    if (qtyRaw === '') {
      errors.push({ row: linea, column: 'qty', message: 'Falta la cantidad.' })
      return
    }
    const qty = numeroDe(qtyRaw, linea, 'qty')
    if (typeof qty !== 'number') {
      errors.push(qty)
      return
    }
    if (qty <= 0) {
      errors.push({
        row: linea,
        column: 'qty',
        message:
          'La cantidad debe ser mayor que cero: este archivo carga existencias. Para sacar mercancia usa un ajuste.',
      })
      return
    }

    const costoRaw = celda(mapping.unitCost)
    const unitCost = costoRaw === '' ? null : numeroDe(costoRaw, linea, 'unitCost')
    if (unitCost !== null && typeof unitCost !== 'number') {
      errors.push(unitCost)
      return
    }
    if (unitCost !== null && unitCost < 0) {
      errors.push({ row: linea, column: 'unitCost', message: 'El costo no puede ser negativo.' })
      return
    }

    vistos.set(clave, linea)
    valid.push({ line: linea, sku, warehouse, qty, unitCost })
  })

  return { valid, errors, ignored, rejectedRows: errors.length, numberFormat }
}
