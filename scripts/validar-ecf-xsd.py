#!/usr/bin/env python3
"""
Valida un e-CF generado contra el XSD OFICIAL de la DGII.

Existe porque leer un esquema a ojo no basta. Esta validacion encontro
dos cosas que la lectura no dio:

  1. `TelefonoEmisor` exige `\d{3}-\d{3}-\d{4}` CON guiones. En digitos
     corridos el documento entero se rechaza por un campo opcional.
  2. Despues de `FechaHoraFirma` el esquema pide un `<xs:any
     minOccurs="1">`: la FIRMA DIGITAL. Un e-CF sin firmar NO valida,
     por perfecto que este el resto. La firma no es un paso posterior:
     es un hijo obligatorio del documento.

No corre en `gate:f0` a proposito: necesita Python con lxml, y no todo
el que toca este repo lo tiene. Es una verificacion de contrato con la
DGII, no una prueba unitaria — se corre cuando se toca el generador o
cuando la DGII publica un XSD nuevo (los de las notas de credito y
debito cambiaron en abril de 2026).

Uso:
  node scripts/generar-ecf-ejemplo.mjs > /tmp/ecf.xml
  python scripts/validar-ecf-xsd.py /tmp/ecf.xml
"""
import sys
from pathlib import Path

try:
    from lxml import etree
except ImportError:
    sys.exit('Hace falta lxml:  pip install lxml')

RAIZ = Path(__file__).resolve().parent.parent
XSD = RAIZ / 'supabase' / 'xsd' / 'e-CF-32-v1.0.xsd'

if len(sys.argv) < 2:
    sys.exit('Uso: python scripts/validar-ecf-xsd.py <archivo.xml>')

esquema = etree.XMLSchema(etree.parse(str(XSD)))
doc = etree.parse(sys.argv[1])

if esquema.validate(doc):
    print(f'OK — {sys.argv[1]} valida contra {XSD.name}')
    sys.exit(0)

print(f'NO valida contra {XSD.name}:')
for e in esquema.error_log:
    print(f'  linea {e.line}: {e.message}')
sys.exit(1)
