"""Read a private protection request from stdin and write only encrypted output."""
import io
import json
import re
import secrets
import sys
from zipfile import BadZipFile, ZIP_STORED, ZipFile

LIMIT = 80 * 1024 * 1024
OUTPUT_LIMIT = 100 * 1024 * 1024
MAX_PARTS = 100


class ProtectionError(Exception):
    pass


def protect(data, password, source_password):
    import pymupdf

    if b"%PDF-" not in data[:1024]:
        raise ProtectionError("INVALID_PDF")
    try:
        with pymupdf.open(stream=data, filetype="pdf") as document:
            if not document.page_count:
                raise ProtectionError("INVALID_PDF")
            if document.xref_get_key(-1, "Encrypt")[0] != "null":
                if document.needs_pass and not source_password:
                    raise ProtectionError("PASSWORD_REQUIRED")
                access = document.authenticate(source_password)
                if not access:
                    raise ProtectionError("WRONG_PASSWORD")
                if not (access & 4 or document.permissions & pymupdf.PDF_PERM_MODIFY):
                    raise ProtectionError("RESTRICTED")
            return document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,
                                    owner_pw=secrets.token_urlsafe(29), user_pw=password)
    except (RuntimeError, ValueError, OSError) as error:
        raise ProtectionError("INVALID_PDF") from error


def protect_archive(data, password):
    try:
        with ZipFile(io.BytesIO(data)) as source:
            entries = source.infolist()
            if not entries or len(entries) > MAX_PARTS or sum(item.file_size for item in entries) > LIMIT:
                raise ProtectionError("LIMIT")
            names = {item.filename for item in entries}
            if len(names) != len(entries) or any(item.flag_bits & 1 or not re.fullmatch(r"[a-zA-Z0-9_-]+\.pdf", item.filename) for item in entries):
                raise ProtectionError("INVALID_ZIP")
            result = io.BytesIO()
            with ZipFile(result, "w", ZIP_STORED) as output:
                for entry in entries:
                    output.writestr(entry.filename, protect(source.read(entry), password, ""))
                    if result.tell() > OUTPUT_LIMIT:
                        raise ProtectionError("LIMIT")
            return result.getvalue()
    except (BadZipFile, RuntimeError, OSError) as error:
        raise ProtectionError("INVALID_ZIP") from error


def main():
    prefix = sys.stdin.buffer.read(4)
    size = int.from_bytes(prefix, "big")
    if not 0 < size <= 1024:
        raise ProtectionError("INVALID_PDF")
    metadata = json.loads(sys.stdin.buffer.read(size))
    data = sys.stdin.buffer.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ProtectionError("LIMIT")
    password = metadata["password"]
    output = (protect_archive(data, password) if metadata["format"] == "zip"
              else protect(data, password, metadata["sourcePassword"]))
    if len(output) > OUTPUT_LIMIT:
        raise ProtectionError("LIMIT")
    sys.stdout.buffer.write(output)


if __name__ == "__main__":
    try:
        main()
    except ProtectionError as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
    except ImportError:
        print("DEPENDENCIES", file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("FAILED", file=sys.stderr)
        sys.exit(2)
