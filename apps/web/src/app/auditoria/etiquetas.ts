/**
 * Nombres en castellano para la bitacora. La base guarda tablas y columnas
 * en ingles (`pos_shifts`, `counted_cash`); el dueño que abre Auditoria
 * quiere leer "Turno de caja · Efectivo contado". Lo que no este aqui sale
 * con los guiones bajos como espacios: legible, aunque no bonito.
 */

const ENTIDAD: Record<string, string> = {
  accounts: 'Cuenta contable',
  bank_accounts: 'Cuenta bancaria',
  bank_statement_imports: 'Estado de cuenta importado',
  bank_statement_lines: 'Línea de estado de cuenta',
  benefit_enrollments: 'Inscripción a beneficio',
  benefit_loans: 'Préstamo a empleado',
  bill_of_materials: 'Lista de materiales',
  bom_lines: 'Línea de lista de materiales',
  branches: 'Sucursal',
  categories: 'Categoría',
  chat_channels: 'Canal de chat',
  chat_messages: 'Mensaje de chat',
  companies: 'Empresa',
  cost_centers: 'Centro de costo',
  customer_invoices: 'Factura a cliente',
  customer_payments: 'Cobro',
  customers: 'Cliente',
  cycle_count_lines: 'Línea de conteo',
  employees: 'Empleado',
  equipment: 'Equipo',
  exchange_rates: 'Tasa de cambio',
  expenses: 'Gasto',
  fixed_assets: 'Activo fijo',
  goods_receipt_lines: 'Línea de recepción',
  goods_receipts: 'Recepción de mercancía',
  hr_announcements: 'Anuncio',
  journal_entries: 'Asiento contable',
  leads: 'Prospecto',
  memberships: 'Acceso de usuario',
  ncf_sequences: 'Secuencia de NCF',
  opportunities: 'Oportunidad',
  payment_links: 'Link de cobro',
  payroll_periods: 'Período de nómina',
  pos_sales: 'Venta en caja',
  pos_shifts: 'Turno de caja',
  price_lists: 'Lista de precios',
  product_lots: 'Lote',
  products: 'Producto',
  project_budgets: 'Presupuesto de proyecto',
  project_costs: 'Costo de proyecto',
  project_milestones: 'Hito de proyecto',
  project_tasks: 'Tarea de proyecto',
  purchase_orders: 'Orden de compra',
  purchase_requisitions: 'Requisición',
  quote_lines: 'Línea de cotización',
  quotes: 'Cotización',
  recruiting_positions: 'Vacante',
  roles: 'Rol',
  rfqs: 'Solicitud de cotización',
  sales_orders: 'Pedido',
  service_orders: 'Orden de servicio',
  stock_movements: 'Movimiento de inventario',
  supplier_invoices: 'Factura de proveedor',
  supplier_payments: 'Pago a proveedor',
  supplier_returns: 'Devolución a proveedor',
  suppliers: 'Proveedor',
  tenant_settings: 'Configuración',
  tenants: 'Cuenta',
  tickets: 'Ticket de soporte',
  time_off_requests: 'Solicitud de ausencia',
  transfer_orders: 'Transferencia',
  user_invitations: 'Invitación',
  user_profiles: 'Perfil de usuario',
  warehouses: 'Almacén',
  work_orders: 'Orden de producción',
}

const CAMPO: Record<string, string> = {
  active: 'activo',
  address: 'dirección',
  barcode: 'código de barras',
  cancelled_at: 'anulado el',
  category: 'categoría',
  category_id: 'categoría',
  closed_at: 'cerrado el',
  code: 'código',
  company_id: 'empresa',
  confirmed_at: 'confirmado el',
  cost: 'costo',
  counted_cash: 'efectivo contado',
  credit_limit: 'límite de crédito',
  currency: 'moneda',
  deleted_at: 'borrado el',
  department: 'departamento',
  description: 'descripción',
  discount: 'descuento',
  email: 'correo',
  expected_cash: 'efectivo esperado',
  expires_at: 'vence el',
  is_active: 'activo',
  is_default: 'por defecto',
  legal_name: 'razón social',
  logo_url: 'logo',
  name: 'nombre',
  next_number: 'próximo número',
  notes: 'notas',
  number: 'número',
  order_date: 'fecha',
  payment_terms: 'condiciones de pago',
  permissions: 'permisos',
  phone: 'teléfono',
  price: 'precio',
  reorder_point: 'punto de reorden',
  scope: 'alcance',
  sku: 'código',
  status: 'estado',
  subtotal: 'subtotal',
  supplier_ncf: 'NCF del proveedor',
  tax: 'ITBIS',
  tax_id: 'RNC',
  tax_rate: 'tasa de ITBIS',
  total: 'total',
  trade_name: 'nombre comercial',
  tracks_stock: 'lleva inventario',
  unit: 'unidad',
  variance: 'diferencia',
  visible_modules: 'módulos visibles',
  warehouse_id: 'almacén',
}

const legible = (s: string) => s.replace(/_/g, ' ')

export const nombreEntidad = (t: string) => ENTIDAD[t] ?? legible(t)
export const nombreCampo = (c: string) => CAMPO[c] ?? legible(c)

/** Estados que la base guarda en ingles. */
const ESTADO: Record<string, string> = {
  active: 'activo',
  approved: 'aprobado',
  cancelled: 'anulado',
  closed: 'cerrado',
  confirmed: 'confirmado',
  draft: 'borrador',
  open: 'abierto',
  paid: 'pagado',
  partial: 'parcial',
  pending: 'pendiente',
  posted: 'contabilizado',
  received: 'recibido',
  rejected: 'rechazado',
  sent: 'enviado',
  void: 'anulado',
  voided: 'anulado',
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/

/** Un valor del antes/después, corto y sin JSON crudo. */
export function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'string' && ESTADO[v]) return ESTADO[v]
  if (typeof v === 'string' && FECHA_ISO.test(v)) {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('es-DO', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...(v.length > 10 ? { hour: '2-digit', minute: '2-digit' } : { timeZone: 'UTC' }),
      })
    }
  }
  if (Array.isArray(v)) return `${v.length} elemento${v.length === 1 ? '' : 's'}`
  if (typeof v === 'object')
    return `${Object.keys(v).length} ajuste${Object.keys(v).length === 1 ? '' : 's'}`
  const s = String(v)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}
