import { periodoFiscal } from '@regb/operations'

/** "agosto de 2026" → "Agosto de 2026": solo la primera letra, no cada palabra. */
export function periodoLegible(p: string): string {
  const t = new Date(`${p.slice(0, 4)}-${p.slice(4, 6)}-01T12:00:00`).toLocaleDateString('es-DO', {
    month: 'long',
    year: 'numeric',
  })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Los períodos que se ofrecen para elegir: el que viene y los 18 de
 * atrás, del más nuevo al más viejo, en AAAAMM y contados en RD. Un
 * `<select>` en vez de `<input type="month">`: ese control lo dibuja el
 * navegador en SU idioma, y en un Chrome en inglés decía "August 2026".
 * Si el período pedido quedó fuera (un enlace viejo), se agrega.
 */
export function opcionesDePeriodo(hoy: Date, elegido: string): { valor: string; texto: string }[] {
  const actual = periodoFiscal(hoy)
  const anio = Number(actual.slice(0, 4))
  const mes = Number(actual.slice(4, 6))
  const lista: string[] = []
  for (let i = -1; i <= 18; i++) {
    const d = new Date(Date.UTC(anio, mes - 1 - i, 15))
    lista.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  if (!lista.includes(elegido)) lista.push(elegido)
  return lista
    .sort((a, b) => b.localeCompare(a))
    .map((valor) => ({ valor, texto: periodoLegible(valor) }))
}
