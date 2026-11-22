"""Emit a genuine DOCX and scanned-only PDF for the browser suite."""
import base64
from io import BytesIO
import json
import struct
import zlib

from docx import Document
from docx.shared import Inches
import pymupdf

def png_chunk(name, content):
    data = name + content
    return struct.pack(">I", len(content)) + data + struct.pack(">I", zlib.crc32(data))

def fixtures():
    image = (b"\x89PNG\r\n\x1a\n"
             + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 80, 45, 8, 2, 0, 0, 0))
             + png_chunk(b"IDAT", zlib.compress((b"\0" + b"\x24\x5f\x92" * 80) * 45))
             + png_chunk(b"IEND", b""))
    docx = Document()
    docx.add_heading("SamPDF conversion sample", level=1)
    docx.add_paragraph("Editable paragraph with real document text.")
    table = docx.add_table(rows=2, cols=2, style="Table Grid")
    for cell, value in zip((cell for row in table.rows for cell in row.cells), ("Item", "Quantity", "Copper", "12")):
        cell.text = value
    docx.add_picture(BytesIO(image), width=Inches(1.3))
    docx.add_page_break()
    docx.add_heading("Second page", level=2)
    docx.add_paragraph("The preview should keep this page addressable.")
    word_file = BytesIO()
    docx.save(word_file)
    with pymupdf.open() as scanned:
        scanned.new_page().insert_image(pymupdf.Rect(20, 20, 120, 90), stream=image)
        return {"docx": word_file.getvalue(), "scan": scanned.tobytes()}

print(json.dumps({key: base64.b64encode(value).decode() for key, value in fixtures().items()}))
