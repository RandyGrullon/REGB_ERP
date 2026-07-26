/**
 * Contrato del catalogo — SIN `server-only`.
 *
 * Los tipos y las constantes que el componente cliente necesita viven
 * aqui. La consulta a la base vive en `marketplace.ts`, que si es
 * server-only. Mezclarlos arrastra el driver de Postgres al bundle del
 * navegador, y Next lo rechaza con razon.
 */

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
  /** Estado en este cliente. `null` = no lo tiene. */
  status: 'trial' | 'active' | 'suspended' | 'archived' | null
  enabled: boolean
  trialEndsAt: string | null
  /** Dependencias obligatorias que le faltan al cliente. */
  missingRequires: string[]
}

/** Ficha comercial completa — lo que hace falta para decidir una compra. */
export interface ModuleDetail extends CatalogEntry {
  tagline: string
  /** El dolor concreto que quita. Sin esto son features, no valor. */
  problem: string
  features: { titulo: string; detalle: string }[]
  audience: string[]
  /** Mockups en texto: no envejecen como una captura de pantalla. */
  screens: { titulo: string; descripcion: string; mockup: string }[]
  faq: { p: string; r: string }[]
  setupMinutes: number | null
  /** Consumo medido, si lo tiene. */
  metered: { key: string; included: number; price: number } | null
}

/** Las categorias, en el orden en que se muestran. */
export const CATEGORIES = [
  { id: 'core', label: 'Incluidos', hint: 'Vienen con tu plan' },
  { id: 'standard', label: 'Estandar', hint: 'La operacion del dia a dia' },
  { id: 'advanced', label: 'Avanzados', hint: 'Finanzas, produccion e inteligencia' },
  { id: 'vertical', label: 'Tu industria', hint: 'Hechos para un giro concreto' },
  { id: 'enterprise', label: 'Enterprise', hint: 'Solo para grupos empresariales' },
] as const
