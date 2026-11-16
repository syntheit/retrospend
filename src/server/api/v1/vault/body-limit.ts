import {
	VAULT_MAX_BATCH_BYTES,
	VAULT_MAX_WRITES,
} from "@retrospend/api-contract";
import { API_PREFIX } from "@retrospend/api-contract/common";

/** The one JSON route whose body may be large: 8 MiB of sealed records. */
export const VAULT_WRITES_PATH = `${API_PREFIX}/vault/writes`;

/**
 * JSON around one write's ciphertext: the id, the collection, the numbers, the
 * keys, quotes and a comma are about 215 bytes at their longest. Rounded up,
 * and with room for each record's base64url rounding.
 */
const PER_WRITE_OVERHEAD_BYTES = 256;

/**
 * The most bytes a POST /vault/writes body may have, counted before it is
 * parsed: the full batch's ciphertext as base64url (4 characters per 3 bytes),
 * 500 writes of JSON around it, and the wrapper. About 11.3 MB. The proxy's
 * limit (`proxyClientMaxBodySize`, next.config.js) must stay above it, which
 * the unit test pins.
 */
export const VAULT_WRITES_BODY_LIMIT =
	Math.ceil((VAULT_MAX_BATCH_BYTES * 4) / 3) +
	VAULT_MAX_WRITES * PER_WRITE_OVERHEAD_BYTES +
	1024;
