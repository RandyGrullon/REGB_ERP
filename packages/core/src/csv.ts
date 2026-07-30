/**
 * Lectura y validacion de CSV para el modulo `imports` (§5.1 core 11).
 *
 * Logica pura y compartida: la misma validacion corre en el navegador
 * (vista previa antes de subir) y en el servidor (la que manda). Que el
 * cliente valide es cortesia; que el servidor valide es la regla.
 */

/** Parser tolerante a comillas, comas dentro de comillas y CRLF. */
export function parseCsv(text: string): string[][] {
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
    } else if (c === ',' || c === ';') {
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
}

export interface ProductDraft {
  sku: string
  name: string
  category: string | null
  unit: string
  price: number
  cost: number | null
}

export interface ValidationResult {
  valid: ProductDraft[]
  errors: ImportError[]
  /** Encabezados que el archivo trae y el mapeo no reconocio. */
  ignored: string[]
}

/** Nombres de columna que se aceptan para cada campo, en varios idiomas. */
export const PRODUCT_COLUMNS: Record<keyof ProductDraft, string[]> = {
  sku: ['sku', 'codigo', 'código', 'code', 'referencia'],
  name: ['name', 'nombre', 'descripcion', 'descripción', 'producto'],
  category: ['category', 'categoria', 'categoría', 'rubro'],
  unit: ['unit', 'unidad', 'medida', 'uom'],
  price: ['price', 'precio', 'pvp', 'precio venta'],
  cost: ['cost', 'costo', 'precio compra'],
}

function normalizaCabecera(h: string): string {
  return h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Mapea los encabezados del archivo a los campos del producto. */
export function mapHeaders(headers: string[]): {
  mapping: Partial<Record<keyof ProductDraft, number>>
  ignored: string[]
} {
  const mapping: Partial<Record<keyof ProductDraft, number>> = {}
  const ignored: string[] = []

  headers.forEach((raw, i) => {
    const h = normalizaCabecera(raw)
    const campo = (Object.keys(PRODUCT_COLUMNS) as (keyof ProductDraft)[]).find((k) =>
      PRODUCT_COLUMNS[k].some((alias) => normalizaCabecera(alias) === h),
    )
    if (campo && mapping[campo] === undefined) mapping[campo] = i
    else if (!campo) ignored.push(raw.trim())
  })

  return { mapping, ignored }
}

/** Numero tolerante a "1,234.56", "1.234,56" y al simbolo de moneda. */
function parseNumero(raw: string): number | null {
  const limpio = raw.replace(/[^\d.,-]/g, '').trim()
  if (limpio === '') return null

  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')
  let normalizado = limpio

  if (ultimaComa > ultimoPunto) {
    // Formato europeo: 1.234,56
    normalizado = limpio.replace(/\./g, '').replace(',', '.')
  } else {
    normalizado = limpio.replace(/,/g, '')
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/**
 * Valida las filas contra el mapeo. Devuelve las buenas Y las malas: el
 * usuario ve exactamente que fila fallo y por que antes de confirmar.
 */
export function validateProducts(rows: string[][], headers: string[]): ValidationResult {
  const { mapping, ignored } = mapHeaders(headers)
  const valid: ProductDraft[] = []
  const errors: ImportError[] = []
  const vistos = new Set<string>()

  if (mapping.sku === undefined) {
    errors.push({ row: 0, column: 'sku', message: 'Falta la columna del codigo (sku/codigo).' })
  }
  if (mapping.name === undefined) {
    errors.push({ row: 0, column: 'name', message: 'Falta la columna del nombre.' })
  }
  if (errors.length > 0) return { valid, errors, ignored }

  rows.forEach((row, i) => {
    const linea = i + 2 // +1 por encabezado, +1 porque los humanos cuentan desde 1
    const celda = (idx: number | undefined) => (idx === undefined ? '' : (row[idx] ?? '').trim())

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
    const precio = precioRaw === '' ? 0 : parseNumero(precioRaw)
    if (precio === null) {
      errors.push({ row: linea, column: 'price', message: `"${precioRaw}" no es un numero.` })
      return
    }
    if (precio < 0) {
      errors.push({ row: linea, column: 'price', message: 'El precio no puede ser negativo.' })
      return
    }

    const costoRaw = celda(mapping.cost)
    const costo = costoRaw === '' ? null : parseNumero(costoRaw)
    if (costoRaw !== '' && costo === null) {
      errors.push({ row: linea, column: 'cost', message: `"${costoRaw}" no es un numero.` })
      return
    }

    vistos.add(sku.toLowerCase())
    valid.push({
      sku,
      name,
      category: celda(mapping.category) || null,
      unit: celda(mapping.unit) || 'unidad',
      price: precio,
      cost: costo,
    })
  })

  return { valid, errors, ignored }
}
