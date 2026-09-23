/**
 * Contrato del catalogo — SIN `server-only`.
 *
 * Los tipos y las constantes que el componente cliente necesita viven
 * aqui. La consulta a la base vive en `marketplace.ts`, que si es
 * server-only. Mezclarlos arrastra el driver de Postgres al bundle del
 * navegador, y Next lo rechaza con razon.
 */

/**
 * Capturas reales de la pantalla principal del modulo.
 *
 * Las genera `pnpm capturas:marketplace` en `apps/web/public/marketplace/`:
 * `<id>.jpg` (tema oscuro) y `<id>-claro.jpg` (tema claro), 1280x800. El
 * servidor mira si existen antes de pintar, asi el navegador nunca pide
 * un 404 por cada tarjeta. `null` = no hay captura de ese tema.
 *
 * La URL trae `?v=<mtime>`: al regenerar las capturas se ven las nuevas
 * sin pelear con la cache del navegador.
 */
export interface ModuleScreenshots {
  dark: string | null
  light: string | null
}

export interface CatalogEntry {
  id: string
  name: string
  description: string
  icon: string
  category: 'core' | 'standard' | 'advanced' | 'vertical' | 'enterprise'
  requires: string[]
  recommends: string[]
  platforms: { web: boolean; desktop: boolean; mobile: boolean }
  isPublished: boolean
  /** Precio para el tier del cliente que mira. */
  installPrice: number
  monthlyPrice: number
  /**
   * Estado en este cliente. `null` = no lo tiene. `trial_expired` no existe
   * en la base: es una prueba cuya fecha ya paso (0128), que ni se ve ni se
   * cobra, y el marketplace la ofrece de nuevo.
   */
  status: 'trial' | 'trial_expired' | 'active' | 'suspended' | 'archived' | null
  enabled: boolean
  trialEndsAt: string | null
  /** Dependencias obligatorias que le faltan al cliente. */
  missingRequires: string[]
  /** Hay al menos una captura real (de cualquiera de los dos temas). */
  hasScreenshot: boolean
  screenshots: ModuleScreenshots
}

/** Ficha comercial completa — lo que hace falta para decidir una compra. */
export interface ModuleDetail extends CatalogEntry {
  tagline: string
  /** El dolor concreto que quita. Sin esto son features, no valor. */
  problem: string
  features: { titulo: string; detalle: string }[]
  audience: string[]
  /** Mockups en texto: complementan la captura, no la sustituyen. */
  screens: { titulo: string; descripcion: string; mockup: string }[]
  faq: { p: string; r: string }[]
  setupMinutes: number | null
  /** Consumo medido, si lo tiene. */
  metered: { key: string; included: number; price: number } | null
}

/** La peticion de activacion abierta del cliente (hay a lo sumo una). */
export interface SolicitudPendiente {
  modules: string[]
  createdAt: string
  /** Lo que la pantalla le enseño al pedir. */
  mensual: number
  instalacion: number
  nota: string | null
}

// ─────────────────────────────────────────────────────────────────────
//  Cotizacion con el motor de facturacion
// ─────────────────────────────────────────────────────────────────────

/** Una linea de la factura tal como la devuelve `@regb/billing`, en dolares. */
export interface LineaMotor {
  concepto: string
  detalle: string | null
  monto: number
}

export interface FacturaMotor {
  lineas: LineaMotor[]
  subtotal: number
  descuento: number
  impuesto: number
  total: number
}

/**
 * Lo que cobraria la factura con lo que el cliente marco.
 *
 * La calcula `calculateMonthly` de `@regb/billing` en el servidor -el
 * mismo motor que emite la factura-, para el tier, ciclo y pais del
 * cliente: base del plan, modulos incluidos del tier (los mas caros
 * primero), pruebas a US$0, descuento por ciclo e ITBIS. La pantalla solo
 * la pinta: el precio que se enseña es el que se cobra.
 */
export interface CotizacionMotor {
  /** `claveSeleccion` de lo que se pidio cotizar: dice si esta cotizacion sigue vigente. */
  clave: string
  /** Lo que de verdad entro en la cuenta (publicado, no lo tiene, existe en su tier). */
  modulos: string[]
  hoy: FacturaMotor
  conSeleccion: FacturaMotor
  /** Cuanto sube la mensualidad: `conSeleccion.total - hoy.total`. */
  aumento: number
  /** Instalacion de cada modulo nuevo; los que caen en los incluidos del tier, a US$0. */
  instalacion: { moduleId: string; monto: number; incluida: boolean }[]
  instalacionTotal: number
  /** Si hoy paga mensual: como quedaria la misma factura pagando anual. */
  anual: { total: number; ahorroAlAno: number } | null
  /** Lo que pagaria si se queda con lo que esta probando. `null` si no prueba nada. */
  trasPruebas: number | null
  plan: {
    ciclo: string
    /** Tasa de impuesto aplicada (0.18 = ITBIS). */
    impuesto: number
    modulosIncluidos: number
    usuariosIncluidos: number
    /** `null` = sin limite. */
    sucursalesIncluidas: number | null
  }
}

/** Llave estable de una seleccion: mismos modulos, misma llave, sin importar el orden. */
export const claveSeleccion = (ids: Iterable<string>): string => [...new Set(ids)].sort().join(',')

/**
 * Lo que el simulador trae marcado al llegar: la solicitud abierta.
 *
 * Solo lo que el cliente eligio; sus requisitos los vuelve a poner el
 * cierre de dependencias. Vive aqui porque lo usan el servidor (para
 * cotizar de entrada) y el navegador (para marcar), y tienen que coincidir.
 */
export function seleccionDesdeSolicitud(
  pendiente: SolicitudPendiente | null,
  porId: ReadonlyMap<string, CatalogEntry>,
): Set<string> {
  if (!pendiente) return new Set()
  const pedidos = pendiente.modules.filter((id) => {
    const m = porId.get(id)
    return m !== undefined && sePuedePedir(m)
  })
  const requisitos = new Set(pedidos.flatMap((id) => porId.get(id)?.requires ?? []))
  return new Set(pedidos.filter((id) => !requisitos.has(id)))
}

/** Las categorias comerciales (definen el precio), en el orden en que se muestran. */
export const CATEGORIES = [
  { id: 'core', label: 'Incluidos', hint: 'Vienen con tu plan' },
  { id: 'standard', label: 'Estándar', hint: 'La operación del día a día' },
  { id: 'advanced', label: 'Avanzados', hint: 'Finanzas, producción e inteligencia' },
  { id: 'vertical', label: 'Tu industria', hint: 'Hechos para un giro concreto' },
  { id: 'enterprise', label: 'Enterprise', hint: 'Solo para grupos empresariales' },
] as const

// ─────────────────────────────────────────────────────────────────────
//  Areas de negocio
// ─────────────────────────────────────────────────────────────────────

/**
 * El catalogo agrupado como piensa quien paga.
 *
 * "Estandar" y "Avanzado" son categorias de PRECIO: le sirven a la
 * factura, no al dueño de una ferreteria. Él piensa en "lo de vender",
 * "lo del almacen", "lo de la nomina". Esto solo agrupa la vitrina; no
 * cambia precios, dependencias ni permisos.
 */
export type AreaId =
  | 'ventas'
  | 'inventario'
  | 'finanzas'
  | 'rrhh'
  | 'produccion'
  | 'proyectos'
  | 'plataforma'
  | 'industria'

export interface Area {
  id: AreaId
  label: string
  icon: string
  hint: string
}

export const AREAS: readonly Area[] = [
  {
    id: 'ventas',
    label: 'Ventas y clientes',
    icon: 'storefront',
    hint: 'Vender en mostrador o a crédito, cotizar, cobrar y fidelizar.',
  },
  {
    id: 'inventario',
    label: 'Inventario y compras',
    icon: 'inventory_2',
    hint: 'Qué tienes, dónde está, qué pedir y a quién.',
  },
  {
    id: 'finanzas',
    label: 'Finanzas e impuestos',
    icon: 'account_balance',
    hint: 'Contabilidad, bancos, lo que te deben, lo que debes y la DGII.',
  },
  {
    id: 'rrhh',
    label: 'Recursos humanos',
    icon: 'badge',
    hint: 'Empleados, nómina con TSS, ponches y vacaciones.',
  },
  {
    id: 'produccion',
    label: 'Producción',
    icon: 'factory',
    hint: 'Recetas, órdenes de producción, calidad y mantenimiento.',
  },
  {
    id: 'proyectos',
    label: 'Proyectos y servicios',
    icon: 'view_kanban',
    hint: 'Proyectos, horas, contratos y servicio al cliente.',
  },
  {
    id: 'plataforma',
    label: 'Plataforma',
    icon: 'hub',
    hint: 'Lo que une todo: usuarios, reportes, automatizaciones e IA.',
  },
  {
    id: 'industria',
    label: 'Tu industria',
    icon: 'domain',
    hint: 'Hechos para un giro concreto. Salen bajo demanda.',
  },
]

const AREA_DE_MODULO: Record<string, AreaId> = {
  // Ventas y clientes
  pos: 'ventas',
  'sales-orders': 'ventas',
  quotes: 'ventas',
  crm: 'ventas',
  pipeline: 'ventas',
  commissions: 'ventas',
  'customer-portal': 'ventas',
  loyalty: 'ventas',
  marketing: 'ventas',
  ecommerce: 'ventas',
  'price-lists': 'ventas',
  payments: 'ventas',
  'e-sign': 'ventas',
  // Inventario y compras
  products: 'inventario',
  inventory: 'inventario',
  barcode: 'inventario',
  'lots-serials': 'inventario',
  'stock-counts': 'inventario',
  transfers: 'inventario',
  'purchase-orders': 'inventario',
  receipts: 'inventario',
  requisitions: 'inventario',
  rfq: 'inventario',
  suppliers: 'inventario',
  logistics: 'inventario',
  fleet: 'inventario',
  // Finanzas e impuestos
  accounting: 'finanzas',
  ar: 'finanzas',
  ap: 'finanzas',
  treasury: 'finanzas',
  'bank-rec': 'finanzas',
  budgets: 'finanzas',
  'cost-centers': 'finanzas',
  'fixed-assets': 'finanzas',
  multicurrency: 'finanzas',
  taxes: 'finanzas',
  'e-invoice': 'finanzas',
  'invoice-capture': 'finanzas',
  consolidation: 'finanzas',
  // Recursos humanos
  employees: 'rrhh',
  payroll: 'rrhh',
  attendance: 'rrhh',
  'time-off': 'rrhh',
  benefits: 'rrhh',
  'hr-portal': 'rrhh',
  recruiting: 'rrhh',
  performance: 'rrhh',
  training: 'rrhh',
  expenses: 'rrhh',
  // Produccion
  bom: 'produccion',
  manufacturing: 'produccion',
  mrp: 'produccion',
  quality: 'produccion',
  maintenance: 'produccion',
  shopfloor: 'produccion',
  // Proyectos y servicios
  projects: 'proyectos',
  timesheets: 'proyectos',
  resources: 'proyectos',
  'project-costing': 'proyectos',
  'field-service': 'proyectos',
  helpdesk: 'proyectos',
  contracts: 'proyectos',
}

/** Area de un modulo. Lo que no esta en el mapa cae en Plataforma, nunca se pierde. */
export function areaDe(m: Pick<CatalogEntry, 'id' | 'category'>): AreaId {
  if (m.category === 'vertical') return 'industria'
  return AREA_DE_MODULO[m.id] ?? 'plataforma'
}

// ─────────────────────────────────────────────────────────────────────
//  Paquetes por tipo de negocio
// ─────────────────────────────────────────────────────────────────────

/**
 * Paquetes por tipo de negocio.
 *
 * Un dueño de colmado no sabe si necesita "standard" o "advanced": sabe
 * que vende en mostrador y que le fia a dos clientes. Esto traduce lo
 * segundo en lo primero.
 *
 * Regla: SOLO modulos publicados. Un paquete que promete algo que todavia
 * no existe es la forma mas rapida de perder a un cliente. Aun asi la
 * vista vuelve a filtrar por `isPublished` al pintar, por si un modulo se
 * despublica sin que nadie toque esta lista.
 */
export interface Paquete {
  id: string
  nombre: string
  para: string
  icono: string
  modulos: string[]
  /** Aclaracion honesta, cuando hace falta. */
  nota?: string
}

export const PAQUETES: readonly Paquete[] = [
  {
    id: 'colmado',
    nombre: 'Colmado o minimarket',
    para: 'Vendes en mostrador, rápido y con escáner.',
    icono: 'storefront',
    modulos: ['products', 'inventory', 'pos', 'barcode'],
  },
  {
    id: 'farmacia',
    nombre: 'Farmacia o tienda con vencimientos',
    para: 'Lotes, fechas de caducidad y venta en caja.',
    icono: 'medication',
    modulos: ['products', 'inventory', 'pos', 'barcode', 'lots-serials'],
  },
  {
    id: 'ferreteria',
    nombre: 'Ferretería',
    para: 'Cotizas, vendes a crédito a contratistas y en caja.',
    icono: 'hardware',
    modulos: ['products', 'inventory', 'pos', 'quotes', 'sales-orders', 'ar', 'price-lists'],
  },
  {
    id: 'distribuidora',
    nombre: 'Distribuidora o mayorista',
    para: 'Pedidos, rutas, crédito, compras y vendedores.',
    icono: 'local_shipping',
    modulos: [
      'products',
      'inventory',
      'sales-orders',
      'ar',
      'price-lists',
      'purchase-orders',
      'receipts',
      'transfers',
      'logistics',
      'commissions',
    ],
  },
  {
    id: 'nomina',
    nombre: 'Empresa con empleados',
    para: 'Nómina con TSS, AFP e ISR, ponches y vacaciones.',
    icono: 'badge',
    modulos: ['employees', 'payroll', 'attendance', 'time-off', 'hr-portal'],
  },
  {
    id: 'taller',
    nombre: 'Taller o manufactura ligera',
    para: 'Recetas, órdenes de producción y compra de insumos.',
    icono: 'precision_manufacturing',
    modulos: ['products', 'inventory', 'bom', 'manufacturing', 'purchase-orders', 'receipts'],
  },
  {
    id: 'servicios',
    nombre: 'Servicios y proyectos',
    para: 'Agencia, consultora o contratista: horas, contratos y cobro.',
    icono: 'work',
    modulos: ['projects', 'timesheets', 'quotes', 'contracts', 'ar'],
  },
  {
    id: 'dgii',
    nombre: 'Al día con la DGII',
    para: 'Contabilidad, ITBIS, retenciones, IT-1 y NCF de proveedores.',
    icono: 'receipt_long',
    modulos: ['accounting', 'taxes', 'invoice-capture', 'ap', 'ar', 'bank-rec'],
    nota: 'La factura electrónica (e-CF) todavía está en camino; no va incluida.',
  },
]

// ─────────────────────────────────────────────────────────────────────
//  Ayudas puras
// ─────────────────────────────────────────────────────────────────────

/** Lo tiene encendido o en prueba: no hay que venderselo. */
export const estaActivo = (m: Pick<CatalogEntry, 'status'>): boolean =>
  m.status === 'active' || m.status === 'trial'

/**
 * Cierra un conjunto de modulos con sus dependencias.
 *
 * Es la pieza que evita la peor venta posible: cobrarle a alguien un
 * modulo que no va a poder usar. Se recorre en anchura porque una
 * dependencia puede arrastrar la suya. Lo que ya esta activo no se vuelve
 * a comprar.
 */
export function cerrarDependencias(
  ids: Iterable<string>,
  porId: ReadonlyMap<string, CatalogEntry>,
): { total: Set<string>; anadidos: string[] } {
  const total = new Set(ids)
  const anadidos: string[] = []
  const cola = [...total]
  while (cola.length > 0) {
    const m = porId.get(cola.shift()!)
    if (!m) continue
    for (const req of m.requires) {
      const dep = porId.get(req)
      if (!dep || total.has(req) || estaActivo(dep)) continue
      total.add(req)
      anadidos.push(req)
      cola.push(req)
    }
  }
  return { total, anadidos }
}

/** Lo que se puede pedir: publicado, no incluido en el plan y que todavia no tiene. */
export const sePuedePedir = (m: CatalogEntry): boolean =>
  m.isPublished && m.category !== 'core' && !estaActivo(m)
