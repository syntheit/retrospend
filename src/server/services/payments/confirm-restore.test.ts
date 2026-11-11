/**
 * openAuditChanges: a confirm's `previous` keeps the payment text as stored,
 * and is opened when served, by the rules of a model read. Hand-derived:
 *
 *   plaintext previous                    -> unchanged, no key loaded
 *   header method and row text sealed     -> opened under payment/<id> and settlement/<row id>
 *   a cell sealed for another row         -> FieldCryptoError auth_failed (never null)
 *   sealed, no master key                 -> TextUnavailableError master_key_missing
 *   an entry with no previous             -> unchanged
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FieldAad,
	FieldCryptoError,
	Keyring,
	sealField,
} from "~/server/crypto/field-crypto";
import { TextUnavailableError } from "~/server/crypto/field-open";
import { resetReloadsForTests, textKeys } from "~/server/crypto/text-keys";
import { DataKeyError } from "../keys/data-key.service";
import { openAuditChanges } from "./confirm-restore";

const ring = new Keyring([{ id: 1, key: randomBytes(32) }]);
const aad = (table: string, column: string, rowId: string): FieldAad => ({
	table,
	column,
	rowId,
});

const row = (id: string, text: Record<string, string | null>) => ({
	id,
	amount: "18000",
	status: "PROPOSED",
	...text,
});

const entry = (previous: Record<string, unknown>) => ({
	amount: 18000,
	currency: "ARS",
	paymentGroupId: "pay1",
	previous: {
		amount: "18000",
		paidOn: "2026-10-20",
		rateType: null,
		rate: null,
		rateCurrency: null,
		ledger: "[]",
		...previous,
	},
});

beforeEach(() => {
	resetReloadsForTests();
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("openAuditChanges", () => {
	it("passes plaintext through without loading a key", async () => {
		const load = vi.fn(async () => ring);
		const changes = entry({
			paymentMethod: "Mercado Pago",
			rows: [row("s1", { note: "Octubre", paymentMethod: "Mercado Pago" })],
		});
		expect(await openAuditChanges(textKeys({ instance: load }), changes)).toEqual(
			changes,
		);
		expect(load).not.toHaveBeenCalled();
	});

	it("opens the header method and each row's text under their own cells", async () => {
		const changes = entry({
			paymentMethod: sealField(
				ring,
				"Mercado Pago",
				aad("payment", "paymentMethod", "pay1"),
			),
			rows: [
				row("s1", {
					note: sealField(ring, "Octubre", aad("settlement", "note", "s1")),
					paymentMethod: sealField(
						ring,
						"Mercado Pago",
						aad("settlement", "paymentMethod", "s1"),
					),
					rejectedReason: null,
				}),
				row("s2", { note: "Plain", paymentMethod: null }),
			],
		});
		const opened = await openAuditChanges(
			textKeys({ instance: async () => ring }),
			changes,
		);
		expect(opened?.previous).toMatchObject({
			paymentMethod: "Mercado Pago",
			amount: "18000",
			rows: [
				{
					id: "s1",
					note: "Octubre",
					paymentMethod: "Mercado Pago",
					rejectedReason: null,
				},
				{ id: "s2", note: "Plain", paymentMethod: null },
			],
		});
		expect(JSON.stringify(opened)).not.toContain("\\u0001");
		// The stored entry is not changed in place.
		expect((changes.previous.rows[0] as { note: string }).note).toMatch(
			/^\u0001k1:/,
		);
	});

	it("fails on a cell sealed for another row, never hiding it", async () => {
		const changes = entry({
			paymentMethod: null,
			rows: [
				row("s1", {
					note: sealField(ring, "Octubre", aad("settlement", "note", "s2")),
				}),
			],
		});
		const failure = await openAuditChanges(
			textKeys({ instance: async () => ring }),
			changes,
		).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(FieldCryptoError);
		expect((failure as FieldCryptoError).code).toBe("auth_failed");
	});

	it("fails with the recorded code when there is no key to open with", async () => {
		const changes = entry({
			paymentMethod: sealField(
				ring,
				"Mercado Pago",
				aad("payment", "paymentMethod", "pay1"),
			),
			rows: [row("s1", { note: null })],
		});
		const failure = await openAuditChanges(
			textKeys({
				instance: async () => {
					throw new DataKeyError("master_key_missing");
				},
			}),
			changes,
		).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(TextUnavailableError);
		expect((failure as TextUnavailableError).code).toBe("master_key_missing");
	});

	it("leaves entries without a confirm's previous alone", async () => {
		const keys = textKeys({ instance: async () => ring });
		expect(await openAuditChanges(keys, null)).toBeNull();
		const other = { amount: 10, currency: "ARS", reason: "x" };
		expect(await openAuditChanges(keys, other)).toBe(other);
	});
});
