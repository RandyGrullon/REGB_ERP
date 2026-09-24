import { defineModule } from '@regb/module-registry'

/**
 * Ordenes de compra — modulo 45 del catalogo (§5.4).
 *
 * Cierra el ciclo por el otro lado: hasta ahora el inventario solo se
 * cargaba con ajustes manuales. Con esto una entrada real de mercancia
 * queda documentada —a que proveedor, a que costo, cuando— y ese costo
 * es el que promedia el inventario de verdad (packages/operations/src/
 * costing.ts, el mismo trigger que ya usan los ajustes).
 *
 * Alcance deliberado: NO incluye requisiciones internas, cotizacion a
 * multiples proveedores ni cuentas por pagar — esos son los modulos 42-44
 * y una fase aparte. Aqui solo vive lo que un colmado o una ferreteria
 * necesitan de verdad: pedirle a un proveedor, y recibir lo que llega
 * (completo o por partes) dejando el costo correcto.
 */
export default defineModule({
  id: 'purchase-orders',
  name: 'Órdenes de compra',
  description: 'Pedidos a proveedores con recepción parcial y costo real de entrada.',
  icon: 'local_shipping',
  category: 'standard',
  version: '0.1.0',

  navSection: 'inventario',
  navOrder: 45,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['products'],
  // Sin inventario la orden igual sirve para llevar la cuenta de que se
  // pidio, pero recibir no puede entrar mercancia a ningun almacen.
  recommends: ['inventory'],

  permissions: [
    'purchase-orders.view',
    'purchase-orders.create',
    'purchase-orders.edit',
    'purchase-orders.confirm',
    'purchase-orders.receive',
    'purchase-orders.cancel',
    'purchase-orders.suppliers.manage',
    'purchase-orders.export',
  ],

  routes: [
    { path: '/compras', label: 'Órdenes de compra', perm: 'purchase-orders.view' },
    {
      path: '/compras/proveedores',
      label: 'Proveedores',
      perm: 'purchase-orders.suppliers.manage',
      icon: 'local_shipping',
    },
    { path: '/compras/:id', label: 'Detalle', perm: 'purchase-orders.view', hidden: true },
  ],

  dashboardWidgets: ['po-pending-receipt', 'po-top-suppliers'],
  reports: ['purchases-by-supplier', 'receiving-variance'],

  events: {
    emits: [
      'purchase-orders.order.confirmed',
      'purchase-orders.receipt.posted',
      'purchase-orders.order.cancelled',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'create'],
})
