#!/usr/bin/env python3
"""
Valida un e-CF o un RFCE contra el XSD OFICIAL de la DGII.

Leer un esquema a ojo no basta. Esta validacion ya encontro cuatro cosas
que la lectura no dio:

  1. `TelefonoEmisor` exige `\d{3}-\d{3}-\d{4}` CON guiones. En digitos
     corridos el documento entero se rechaza por un campo opcional.
  2. Despues de `FechaHoraFirma` el esquema pide un `<xs:any
     minOccurs="1">`: la FIRMA. Un e-CF sin firmar NO valida.
  3. Un elemento VACIO rompe la firma (ver `elementosVacios` en
     @regb/ecf-firma).
  4. El propio `RFCE 32 v.1.0.xsd` de la DGII NO COMPILA -ver abajo-.

── El XSD del resumen viene roto ─────────────────────────────────────

El archivo publicado por la DGII trae patrones que la especificacion de
XML Schema no admite, asi que ningun validador conforme puede cargarlo:

  · cuatro grupos sin captura `(?:` — XSD regex no los soporta
  · una clase de caracteres `[12][$0-9]` con un `$` colado, donde el
    esquema del e-CF completo dice `[12][0-9]`

Se parchea EN MEMORIA, minimamente y solo para poder validar. El archivo
en `supabase/xsd/` se deja tal como lo publica la DGII: es la fuente, y
falsearla escondería el problema.

── Uso ───────────────────────────────────────────────────────────────

  node scripts/generar-ecf-ejemplo.mjs > /tmp/ecf.xml
  python scripts/validar-ecf-xsd.py /tmp/ecf.xml

El esquema se elige por la etiqueta raiz del documento.
"""
import sys
from pathlib import Path

try:
    from lxml import etree
except ImportError:
    sys.exit('Hace falta lxml:  pip install lxml')

RAIZ = Path(__file__).resolve().parent.parent
XSD = RAIZ / 'supabase' / 'xsd'

POR_RAIZ = {
    'ECF': 'e-CF-32-v1.0.xsd',
    'RFCE': 'RFCE-32-v1.0.xsd',
    'ARECF': 'ARECF-v1.0.xsd',
    'ACECF': 'ACECF-v1.0.xsd',
}


def esquema_de(archivo: Path) -> etree.XMLSchema:
    """Carga el XSD, corrigiendo en memoria lo que la DGII publico mal."""
    texto = archivo.read_text(encoding='utf-8', errors='replace')
    arreglado = texto.replace('[12][$0-9]', '[12][0-9]').replace('(?:', '(')
    if arreglado != texto:
        print(f'(aviso: {archivo.name} trae patrones invalidos; se corrigen en memoria)')
    return etree.XMLSchema(etree.fromstring(arreglado.encode('utf-8')))


if len(sys.argv) < 2:
    sys.exit('Uso: python scripts/validar-ecf-xsd.py <archivo.xml>')

doc = etree.parse(sys.argv[1])
raiz = etree.QName(doc.getroot()).localname
nombre = POR_RAIZ.get(raiz)
if nombre is None:
    sys.exit(f'No se de que esquema es un documento con raiz <{raiz}>.')

esquema = esquema_de(XSD / nombre)
if esquema.validate(doc):
    print(f'OK — <{raiz}> valida contra {nombre}')
    sys.exit(0)

print(f'NO valida contra {nombre}:')
for e in esquema.error_log:
    print(f'  linea {e.line}: {e.message}')
sys.exit(1)
