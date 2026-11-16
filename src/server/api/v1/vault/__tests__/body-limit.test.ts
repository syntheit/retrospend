import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	VAULT_MAX_BATCH_BYTES,
	VAULT_MAX_RECORD_BYTES,
	VAULT_MAX_WRITES,
} from "@retrospend/api-contract";
import {
	HEADER_BYTES,
	MAX_PLAINTEXT_BYTES,
	TAG_BYTES,
} from "@retrospend/crypto";
import { describe, expect, it } from "vitest";
import { MAX_BATCH_BYTES, MAX_WRITES } from "~/server/services/vault/validate";
import { REPO_ROOT } from "~/test/uiRules/paths";
import { VAULT_WRITES_BODY_LIMIT } from "../body-limit";

describe("the vault write body cap", () => {
	it("holds a full batch: 8 MiB of ciphertext as base64url and 500 writes of JSON", () => {
		// The longest write JSON around a ciphertext: ids of 64, entity 65535, base 2^31-2.
		const wrapper = JSON.stringify({
			writes: [
				{
					id: "i".repeat(64),
					collectionId: "c".repeat(64),
					entity: 65535,
					baseVersion: 2 ** 31 - 2,
					ciphertext: "",
				},
			],
		}).length;
		const longestBody =
			Math.ceil((VAULT_MAX_BATCH_BYTES * 4) / 3) +
			VAULT_MAX_WRITES * (wrapper - "{writes:[]}".length) +
			// each record's own rounding up to a whole character
			VAULT_MAX_WRITES * 2;
		expect(VAULT_WRITES_BODY_LIMIT).toBeGreaterThanOrEqual(longestBody);
	});

	it("stays under the proxy's body limit, so the cap is the one that answers", () => {
		const config = readFileSync(join(REPO_ROOT, "next.config.js"), "utf8");
		const mb = Number(/proxyClientMaxBodySize:\s*"(\d+)mb"/.exec(config)?.[1]);
		expect(mb).toBeGreaterThan(0);
		expect(VAULT_WRITES_BODY_LIMIT).toBeLessThan(mb * 1024 * 1024);
		// About 11.3 MB, as the plan says.
		expect(VAULT_WRITES_BODY_LIMIT).toBeGreaterThan(11_300_000);
		expect(VAULT_WRITES_BODY_LIMIT).toBeLessThan(11_400_000);
	});

	it("derives its numbers from the same limits the service enforces", () => {
		expect(VAULT_MAX_BATCH_BYTES).toBe(MAX_BATCH_BYTES);
		expect(VAULT_MAX_WRITES).toBe(MAX_WRITES);
		expect(VAULT_MAX_RECORD_BYTES).toBe(
			HEADER_BYTES + TAG_BYTES + MAX_PLAINTEXT_BYTES,
		);
	});
});
