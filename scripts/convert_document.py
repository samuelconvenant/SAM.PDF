"""One-shot local conversion engine. Only the API supplies file paths."""
import os
import logging
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

LIMIT = 100 * 1024 * 1024
DEADLINE = time.monotonic() + 110

class JobError(Exception):
    pass

def check_docx(path):
    try:
        with ZipFile(path) as archive:
            parts = archive.infolist()
            names = {part.filename for part in parts}
            if (len(parts) > 2500 or len(names) != len(parts)
                    or sum(part.file_size for part in parts) > LIMIT):
                raise JobError("DOCX_LIMIT")
            if not {"[Content_Types].xml", "_rels/.rels", "word/document.xml"} <= names:
                raise JobError("INVALID_DOCX")
            for part in parts:
                name = part.filename
                lower = name.lower()
                if (name.startswith("/") or "\\" in name or ".." in PurePosixPath(name).parts
                        or part.flag_bits & 1 or lower.startswith(("word/activex/", "word/embeddings/"))
                        or "vbaproject" in lower or lower.endswith((".svg", ".html", ".htm", ".mht"))
                        or (lower.endswith(".bin") and not lower.startswith("word/printersettings/"))):
                    raise JobError("UNSUPPORTED_DOCX")
                if not lower.endswith((".rels", ".xml")):
                    continue
                if part.file_size > 16 * 1024 * 1024:
                    raise JobError("DOCX_LIMIT")
                data = archive.read(part)
                if b"<!DOCTYPE" in data.upper().replace(b"\x00", b""):
                    raise JobError("UNSUPPORTED_DOCX")
                root = ElementTree.fromstring(data)
                if name == "word/document.xml" and not root.tag.endswith("}document"):
                    raise JobError("INVALID_DOCX")
                instructions = []
                for element in root.iter():
                    tag = element.tag.rsplit("}", 1)[-1]
                    if tag in ("altChunk", "object", "control"):
                        raise JobError("UNSUPPORTED_DOCX")
                    if tag == "instrText":
                        instructions.append(element.text or "")
                    elif tag == "fldSimple":
                        instructions.extend(value for key, value in element.attrib.items() if key.endswith("}instr"))
                if re.search(r"\b(DDE(?:AUTO)?|INCLUDEPICTURE|INCLUDETEXT|DATABASE|LINK)\b", "".join(instructions), re.I):
                    raise JobError("UNSUPPORTED_DOCX")
                if lower.endswith(".rels"):
                    for link in root:
                        if link.get("TargetMode", "").lower() == "external":
                            url = link.get("Target", "").lower()
                            if not (link.get("Type", "").endswith("/hyperlink")
                                    and url.startswith(("https://", "http://", "mailto:"))):
                                raise JobError("UNSUPPORTED_DOCX")
    except (BadZipFile, ValueError, ElementTree.ParseError, OSError, RuntimeError) as error:
        raise JobError("INVALID_DOCX") from error

def read_pdf(path, require_text=False):
    import pymupdf
    try:
        with path.open("rb") as stream:
            if b"%PDF-" not in stream.read(1024):
                raise JobError("INVALID_PDF")
        with pymupdf.open(path, filetype="pdf") as document:
            if document.needs_pass or document.is_encrypted:
                raise JobError("ENCRYPTED_PDF")
            if not document.page_count:
                raise JobError("INVALID_PDF")
            if require_text and document.page_count > 100:
                raise JobError("PDF_LIMIT")
            if require_text and not any(page.get_text().strip() for page in document):
                raise JobError("OCR_REQUIRED")
    except (RuntimeError, ValueError, OSError) as error:
        raise JobError("INVALID_PDF") from error

def office_binary():
    configured = os.environ.get("SAMPDF_SOFFICE")
    if configured:
        return configured if Path(configured).is_file() else shutil.which(configured)
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    if sys.platform == "win32":
        for root in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
            if root:
                candidate = Path(root) / "LibreOffice" / "program" / "soffice.com"
                if candidate.is_file():
                    return str(candidate)
    candidate = Path("/Applications/LibreOffice.app/Contents/MacOS/soffice")
    return str(candidate) if candidate.is_file() else None

def render_word(path, directory):
    binary = office_binary()
    if not binary:
        raise JobError("OFFICE_MISSING")
    profile = directory / "profile"
    (profile / "user").mkdir(parents=True)
    (profile / "user" / "registrymodifications.xcu").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<oor:items xmlns:oor="http://openoffice.org/2001/registry">'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
        '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>'
        '</oor:items>', encoding="utf-8")
    command = [binary, f"-env:UserInstallation={profile.as_uri()}", "--headless",
               "--norestore", "--convert-to", "pdf:writer_pdf_Export", "--outdir", str(directory), str(path)]
    remaining = DEADLINE - time.monotonic()
    if remaining <= 0:
        raise JobError("TIMEOUT")
    try:
        with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, cwd=directory,
                              start_new_session=sys.platform != "win32") as engine:
            try:
                status = engine.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                if sys.platform == "win32":
                    subprocess.run(["taskkill", "/T", "/F", "/PID", str(engine.pid)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    os.killpg(engine.pid, signal.SIGKILL)
                engine.kill()
                raise JobError("TIMEOUT")
    except FileNotFoundError as error:
        raise JobError("OFFICE_MISSING") from error
    output = directory / (path.stem + ".pdf")
    if status or not output.is_file():
        raise JobError("OFFICE_FAILED")
    if output.stat().st_size > LIMIT:
        raise JobError("OUTPUT_LIMIT")
    read_pdf(output)
    output.rename(directory / "preview.pdf")

def main():
    logging.disable(logging.CRITICAL)
    direction, job = sys.argv[1:]
    directory = Path(job).resolve()
    if direction == "pdf-to-word":
        from pdf2docx import Converter
        source = directory / "source.pdf"
        output = directory / "result.docx"
        read_pdf(source, require_text=True)
        converter = Converter(str(source))
        try:
            converter.convert(str(output), multi_processing=False)
        finally:
            converter.close()
        check_docx(output)
        render_word(output, directory)
    else:
        source = directory / "source.docx"
        check_docx(source)
        render_word(source, directory)

if __name__ == "__main__":
    try:
        main()
    except JobError as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
    except ImportError:
        print("PYTHON_DEPS", file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("CONVERSION_FAILED", file=sys.stderr)
        sys.exit(2)
