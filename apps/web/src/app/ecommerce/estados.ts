/** Etiquetas de plataforma y estado de un pedido de canal. */
export const PLATAFORMA_CANAL: Record<string, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  tiendanube: 'Tiendanube',
}

export const ESTADO_PEDIDO_CANAL: Record<string, string> = {
  received: 'Recibido',
  imported: 'Importado',
  cancelled: 'Cancelado',
}
