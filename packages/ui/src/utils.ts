import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Combina clases resolviendo conflictos de Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
