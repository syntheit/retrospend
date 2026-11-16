import type { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { VaultError } from "~/server/services/vault/errors";
import { encodeProblem } from "../../errors";
import { toProblem } from "../serve";

const encoded = (error: unknown) =>
	encodeProblem(toProblem(error) as ORPCError<string, unknown>);

describe("a vault error as problem+json", () => {
	it("answers a conflict with 409 and the ids, and no bytes", () => {
		expect(encoded(new VaultError("conflict", ["a", "b"]))).toMatchObject({
			status: 409,
			code: "conflict",
			conflictIds: ["a", "b"],
		});
	});

	it("answers a missing key set with its own code", () => {
		expect(encoded(new VaultError("keys_missing"))).toMatchObject({
			status: 409,
			code: "protection_keys_missing",
		});
		expect(encoded(new VaultError("keys_missing"))).not.toHaveProperty(
			"conflictIds",
		);
	});

	it("answers a malformed batch with 400 bad_request", () => {
		expect(encoded(new VaultError("invalid_input"))).toMatchObject({
			status: 400,
			code: "bad_request",
		});
	});
});
