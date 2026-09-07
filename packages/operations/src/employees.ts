import { roundBankers } from '@regb/core'

/**
 * Empleados — §5.6, modulo 61 (F7/S36).
 *
 * Dos piezas de logica pura: el organigrama -armar el arbol de jefe a
 * subordinado a partir de una lista plana, sin que un dato sucio (un jefe
 * que en realidad es su propio subordinado) cuelgue el sistema- y la
 * antiguedad -la base de "cuantos anos lleva" que payroll va a necesitar
 * el dia que calcule prestaciones laborales, no reinventada alli-.
 */

export interface EmployeeNode {
  id: string
  name: string
  managerId: string | null
}

export interface OrgNode {
  id: string
  name: string
  reports: OrgNode[]
}

/**
 * Arma el organigrama como arbol. Un empleado sin jefe -o cuyo jefe no
 * esta en la lista- es raiz. Un ciclo (A jefe de B, B jefe de A) no
 * cuelga la funcion: el empleado que cierra el ciclo se trata como raiz
 * en vez de repetirse infinitamente, porque un dato sucio no debe tumbar
 * el reporte -debe verse raro, no romper la pantalla-.
 */
export function buildOrgChart(employees: EmployeeNode[]): OrgNode[] {
  const porId = new Map(employees.map((e) => [e.id, e]))
  const hijosDe = new Map<string, EmployeeNode[]>()
  const tieneJefeValido = new Set<string>()

  for (const e of employees) {
    if (e.managerId && porId.has(e.managerId) && e.managerId !== e.id) {
      const lista = hijosDe.get(e.managerId) ?? []
      lista.push(e)
      hijosDe.set(e.managerId, lista)
      tieneJefeValido.add(e.id)
    }
  }

  const construir = (e: EmployeeNode, enCamino: Set<string>): OrgNode => {
    if (enCamino.has(e.id)) {
      // Ciclo detectado: se corta aqui, sin repetir esta rama otra vez.
      return { id: e.id, name: e.name, reports: [] }
    }
    const siguienteCamino = new Set(enCamino).add(e.id)
    const hijos = (hijosDe.get(e.id) ?? []).map((h) => construir(h, siguienteCamino))
    return { id: e.id, name: e.name, reports: hijos }
  }

  const visitados = new Set<string>()
  const marcarVisitados = (n: OrgNode) => {
    visitados.add(n.id)
    n.reports.forEach(marcarVisitados)
  }

  const arbol = employees
    .filter((e) => !tieneJefeValido.has(e.id))
    .map((r) => construir(r, new Set()))
  arbol.forEach(marcarVisitados)

  // Un ciclo mas largo (A jefe de B, B jefe de A) no deja a nadie como
  // raiz genuina, y sin esto los dos desaparecerian del reporte -un dato
  // sucio debe verse raro, no borrar gente del organigrama-.
  for (const e of employees) {
    if (!visitados.has(e.id)) {
      const nodo = construir(e, new Set())
      arbol.push(nodo)
      marcarVisitados(nodo)
    }
  }

  return arbol
}

/** Anos completos de antiguedad -no redondea hacia arriba: 11 meses son 0 anos, no 1-. */
export function yearsOfService(hireDate: Date, asOf: Date): number {
  let anos = asOf.getFullYear() - hireDate.getFullYear()
  const aniversarioEsteAno = new Date(asOf.getFullYear(), hireDate.getMonth(), hireDate.getDate())
  if (asOf < aniversarioEsteAno) anos -= 1
  return Math.max(0, anos)
}

/** Dias completos de antiguedad, para calculos mas finos que "anos". */
export function daysOfService(hireDate: Date, asOf: Date): number {
  const MS_DIA = 86_400_000
  const inicio = Date.UTC(hireDate.getFullYear(), hireDate.getMonth(), hireDate.getDate())
  const corte = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
  return Math.max(0, Math.round((corte - inicio) / MS_DIA))
}

/** Salario proporcional a los dias trabajados de un mes de 30 dias -base tipica de nomina dominicana-. */
export function proratedSalary(monthlySalary: number, daysWorked: number): number {
  return roundBankers((monthlySalary / 30) * Math.min(30, Math.max(0, daysWorked)), 2)
}
