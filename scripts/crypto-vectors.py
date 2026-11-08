"""Known-answer vectors for src/server/crypto/field-crypto.ts.

Computed with the `cryptography` package (OpenSSL), written from the format
description in the module header, not from the TypeScript. The AES-256-GCM
primitive is first checked against the NIST SP 800-38D / McGrew-Viega test
cases 13 and 14, so a wrong library cannot produce wrong vectors.

Needs the `cryptography` package.
Writes JSON to stdout: python3 scripts/crypto-vectors.py > src/server/crypto/field-crypto.vectors.json
"""

import base64
import json
import struct

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# NIST / McGrew-Viega GCM test case 13: K = 0^256, IV = 0^96, P and A empty.
k0 = bytes(32)
iv0 = bytes(12)
out = AESGCM(k0).encrypt(iv0, b"", None)
assert out.hex() == "530f8afbc74536b9a963b4f1c4cb738b", out.hex()
# Test case 14: P = 0^128.
out = AESGCM(k0).encrypt(iv0, bytes(16), None)
assert out.hex() == "cea7403d4d606b6e074ec5d3baf39d18" + "d0d1c8a799996bf0265b98b5d48ab919", out.hex()


def lp(text: str) -> bytes:
    raw = text.encode("utf-8")
    return struct.pack(">I", len(raw)) + raw


def seal(key: bytes, key_id: int, nonce: bytes, plaintext: str, table: str, column: str, row_id: str) -> str:
    aad = b"rs.k1" + struct.pack(">I", key_id) + lp(table) + lp(column) + lp(row_id)
    body = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), aad)  # ciphertext || tag
    return "\u0001k1:" + base64.b64encode(struct.pack(">I", key_id) + nonce + body).decode("ascii")


CASES = [
    {
        "name": "ascii",
        "key": bytes(range(32)),
        "keyId": 1,
        "nonce": bytes(range(0xA0, 0xAC)),
        "plaintext": "Groceries",
        "table": "Category",
        "column": "name",
        "rowId": "c0000000-0000-4000-8000-000000000001",
    },
    {
        "name": "unicode",
        "key": bytes((i * 7 + 3) % 256 for i in range(32)),
        "keyId": 4294967295,
        "nonce": bytes([0xFF] * 12),
        "plaintext": "Café \U0001F600 é שלום",
        "table": "Expense",
        "column": "title",
        "rowId": "e-1",
    },
    {
        "name": "empty",
        "key": bytes([0x11] * 32),
        "keyId": 7,
        "nonce": bytes(12),
        "plaintext": "",
        "table": "Expense",
        "column": "description",
        "rowId": "e-2",
    },
]

result = []
for case in CASES:
    result.append(
        {
            "name": case["name"],
            "keyHex": case["key"].hex(),
            "keyId": case["keyId"],
            "nonceHex": case["nonce"].hex(),
            "plaintext": case["plaintext"],
            "table": case["table"],
            "column": case["column"],
            "rowId": case["rowId"],
            "wire": seal(
                case["key"], case["keyId"], case["nonce"], case["plaintext"],
                case["table"], case["column"], case["rowId"],
            ),
        }
    )

print(json.dumps(result, indent="\t", ensure_ascii=True))
