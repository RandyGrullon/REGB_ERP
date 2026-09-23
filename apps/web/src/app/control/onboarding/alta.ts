/**
 * Lo que comparten la accion de alta, el asistente (navegador) y el
 * tablero: formas, textos y el cierre de dependencias que se ENSEÑA. Nada
 * de servidor aqui: lo importa un componente cliente.
 *
 * El cierre que manda es el de la base (`regb.alta_de_cliente`, 0133);
 * este solo sirve para que el asistente muestre, antes de enviar, que
 * modulos van a entrar de arrastre.
 */

export const TIERS = ['pyme', 'mediano', 'grande'] as const
export type Tier = (typeof TIERS)[number]

export interface ModuloOfrecido {
  id: string
  name: string
  category: string
  requires: string[]
  recommends: string[]
}

export type EstadoDueno = 'invitado' | 'pendiente' | 'ya_miembro'

export type ResultadoAlta =
  | { ok: false; error: string }
  | {
      ok: true
      resultado: 'creado' | 'completado' | 'ya_existia'
      clienteId: string
      slug: string
      modulosActivados: string[]
      piezas: string[]
      dueno: {
        estado: EstadoDueno
        correo: string
        /** Solo cuando se creo la invitacion ahora: el token sale una vez. */
        enlace: string | null
        vence: string | null
      }
    }

export type ResultadoEnlace =
  { ok: false; error: string } | { ok: true; correo: string; enlace: string; vence: string }

/** Lo que el trigger ya activa en todo cliente: no se ofrece ni se cobra. */
export const esCore = (m: { category: string }) => m.category === 'core'

/**
 * Los modulos que entran si se piden `pedidos`: ellos y lo que requieren,
 * en cierre transitivo. Los core no se listan: vienen con todo cliente.
 */
export function cierreDeModulos(pedidos: string[], catalogo: ModuloOfrecido[]): string[] {
  const porId = new Map(catalogo.map((m) => [m.id, m]))
  const dentro = new Set<string>()
  const pendientes = [...pedidos]
  while (pendientes.length > 0) {
    const id = pendientes.pop()!
    if (dentro.has(id)) continue
    dentro.add(id)
    for (const r of porId.get(id)?.requires ?? []) pendientes.push(r)
  }
  return [...dentro].filter((id) => porId.has(id)).sort()
}

/** "Colmado La Esperanza SRL" -> "colmado-la-esperanza". */
export function slugDe(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(s\.?r\.?l|s\.?a\.?s?|e\.?i\.?r\.?l)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

/** Lo que el alta hizo, en palabras. Para el resultado y la bitacora visible. */
export const PIEZAS: Record<string, string> = {
  cliente: 'Cliente creado con su RNC',
  empresa: 'Empresa principal (sale en cada comprobante)',
  empresa_principal: 'Empresa existente marcada como principal',
  sucursal: 'Sucursal',
  almacen: 'Almacen predeterminado (la caja ya puede abrir turno)',
  almacen_principal: 'Almacen existente marcado como predeterminado',
  invitacion: 'Invitacion al dueño con el rol Owner',
}
