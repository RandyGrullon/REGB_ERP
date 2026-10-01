/**
 * Un permiso técnico (`pos.shift.open`) dicho como lo entiende la gente
 * ("Abrir turno"). Lo usan el editor de roles y "Mi perfil": antes el
 * perfil le enseñaba al cajero las claves en crudo.
 *
 * Cubre las palabras de los 224 permisos que usan hoy los manifiestos y
 * los roles de fábrica. Una palabra nueva sin traducir sale con sus guiones
 * como espacios, no en `snake.case`.
 */
const ETIQUETA_ACCION: Record<string, string> = {
  view: 'Ver',
  create: 'Crear',
  edit: 'Editar',
  delete: 'Eliminar',
  export: 'Exportar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  adjust: 'Ajustar',
  transfer: 'Transferir',
  count: 'Contar',
  sell: 'Vender',
  void: 'Anular',
  discount: 'Descontar',
  run: 'Procesar',
  upload: 'Subir',
  review: 'Revisar',
  open: 'Abrir',
  close: 'Cerrar',
  invite: 'Invitar',
  remove: 'Quitar',
  start: 'Iniciar',
  request: 'Solicitar',
  manage: 'Gestionar',
  receive: 'Recibir',
  work: 'Trabajar',
  scan: 'Escanear',
  return: 'Devolver',
  resolve: 'Resolver',
  report: 'Reportar',
  recall: 'Retirar del mercado',
  operate: 'Operar',
  inspect: 'Inspeccionar',
  generate: 'Generar',
  execute: 'Ejecutar',
  emit: 'Emitir',
  dispatch: 'Despachar',
  deliver: 'Entregar',
  award: 'Adjudicar',
  confirm: 'Confirmar',
  consume: 'Consumir',
  override: 'Autorizar la excepción de',
  pay: 'Pagar',
  record: 'Registrar',
  submit: 'Enviar',
  max: 'Tope de',
  'edit-profile': 'Editar su perfil',
  'manage-announcements': 'Publicar anuncios',
  'request-time-off': 'Pedir vacaciones o permisos',
}

/** El objeto sobre el que actúa el permiso. */
const ETIQUETA_OBJETO: Record<string, string> = {
  cost: 'costos',
  price: 'precios',
  shift: 'turno',
  report: 'reportes',
  role: 'roles',
  member: 'miembros',
  branding: 'marca',
  trial: 'prueba',
  customers: 'clientes',
  credit: 'crédito',
  discount: 'descuento',
  invoice: 'facturas',
  payment: 'pagos',
  ncf: 'comprobantes (NCF)',
  fines: 'multas',
  assigned: 'asignado',
}

const legible = (s: string) => s.replace(/[-_]/g, ' ')

/** `inventory.cost.view` → "Ver costos"; `commissions.view.own` → "Ver (solo lo suyo)" */
export function etiquetaPermiso(perm: string): string {
  const partes = perm.split('.').slice(1)
  if (partes.length === 0) return legible(perm)

  // `.own` cierra el permiso a lo de la persona: "Ver (solo lo suyo)".
  if (partes.length > 1 && partes.at(-1) === 'own') {
    return `${etiquetaPermiso(['x', ...partes.slice(0, -1)].join('.'))} (solo lo suyo)`
  }
  // `.assigned`: solo lo que le asignaron. "Ver (solo lo asignado)".
  if (partes.length > 1 && partes.at(-1) === 'assigned') {
    return `${etiquetaPermiso(['x', ...partes.slice(0, -1)].join('.'))} (solo lo asignado)`
  }

  const accion = partes.at(-1) ?? ''
  const base = ETIQUETA_ACCION[accion] ?? legible(accion)
  if (partes.length > 1) {
    const objeto = partes
      .slice(0, -1)
      .map((p) => ETIQUETA_OBJETO[p] ?? legible(p))
      .join(' ')
    return `${base} ${objeto}`
  }
  return base
}
