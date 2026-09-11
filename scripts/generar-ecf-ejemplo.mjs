#!/usr/bin/env node
/**
 * Escupe un e-CF 32 de ejemplo por stdout, para validarlo contra el XSD.
 *
 * La firma es de mentira: solo llena el `<xs:any>` obligatorio que el
 * esquema exige. Firmar de verdad necesita el certificado digital del
 * contribuyente.
 */
import { xmlEcfConsumo } from '../packages/operations/dist/ecf-xml.js'

const FIRMA_DE_MENTIRA =
  '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
  '<ds:SignatureValue>dcp79qEJEMPLONOVALIDO</ds:SignatureValue></ds:Signature>'

process.stdout.write(
  xmlEcfConsumo({
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
    comprador: { rnc: null, razonSocial: null },
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
    firma: FIRMA_DE_MENTIRA,
  }),
)
