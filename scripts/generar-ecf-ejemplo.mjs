#!/usr/bin/env node
/**
 * Escupe un e-CF 32 FIRMADO por stdout, para validarlo contra el XSD.
 *
 * Genera un certificado autofirmado al vuelo. NO sirve para la DGII
 * -alli hace falta uno de persona fisica emitido bajo la Ley 126-02-,
 * pero llena el `<xs:any minOccurs="1">` que el esquema exige despues de
 * `FechaHoraFirma` y deja comprobar que el documento firmado sigue
 * validando.
 *
 * Uso:
 *   node scripts/generar-ecf-ejemplo.mjs > /tmp/ecf.xml
 *   python scripts/validar-ecf-xsd.py /tmp/ecf.xml
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { xmlEcfConsumo } from '../packages/operations/dist/ecf-xml.js'
import { firmarEcf } from '../packages/ecf-firma/dist/index.js'

const dir = mkdtempSync(join(tmpdir(), 'ecf-ejemplo-'))
const clave = join(dir, 'clave.pem')
const cert = join(dir, 'cert.pem')
execFileSync(
  'openssl',
  ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', clave, '-out', cert, '-days', '1', '-nodes',
   '-subj', '/C=DO/O=Prueba REGB/CN=Ejemplo'],
  { stdio: 'ignore' },
)

const xml = xmlEcfConsumo({
  encf: 'E320000000001',
  tipoIngresos: '01',
  tipoPago: '1',
  emisor: {
    rnc: '131223345',
    razonSocial: 'Distribuidora Caribe SRL',
    direccion: 'Av. Estrella Sadhala 120, Santiago',
    telefono: '8095550101',
    fechaEmision: new Date('2026-09-11T00:00:00Z'),
  },
  totales: { montoGravadoTotal: 465, totalItbis: 83.7, montoTotal: 548.7 },
  lineas: [
    {
      numeroLinea: 1,
      nombre: 'Cemento gris 42.5 kg',
      indicadorFacturacion: '1',
      bienOServicio: '1',
      cantidad: 1,
      precioUnitario: 465,
      montoItem: 465,
    },
  ],
  fechaHoraFirma: new Date('2026-09-11T09:05:03Z'),
})

process.stdout.write(
  firmarEcf(xml, {
    clavePrivada: readFileSync(clave, 'utf8'),
    certificado: readFileSync(cert, 'utf8'),
  }),
)
