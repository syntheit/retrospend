// The two rules every key flow shares (src/client/flow.ts): which refusals mean
// "ask again, nothing was learned", and which sends may have committed. Enable,
// Make new key and recovery all import them, so this table is the one place
// they are pinned.
import { describe, expect, it } from "vitest";
import { couldNotAsk, type KeyFlowCode, mayHaveCommitted } from "../src/client";

describe("couldNotAsk", () => {
	it("is no answer, a server failure and a rate limit, and nothing else", () => {
		const yes: KeyFlowCode[] = ["unavailable", "serverError", "rateLimited"];
		const no: KeyFlowCode[] = [
			"wrongPassword",
			"sessionNotFresh",
			"notFound",
			"conflict",
			"malformed",
			"failed",
			"unconfirmed",
		];
		for (const code of yes) expect(couldNotAsk(code), code).toBe(true);
		for (const code of no) expect(couldNotAsk(code), code).toBe(false);
	});
});

describe("mayHaveCommitted", () => {
	it("a missing answer and a server failure may have committed, on the first send too", () => {
		for (const code of ["unavailable", "serverError"] as const) {
			expect(mayHaveCommitted(code, 0), code).toBe(true);
			expect(mayHaveCommitted(code, 2), code).toBe(true);
		}
	});

	it("a conflict or a reused key counts only after an earlier send", () => {
		for (const code of ["conflict", "keyReused"] as const) {
			expect(mayHaveCommitted(code, 0), code).toBe(false);
			expect(mayHaveCommitted(code, 1), code).toBe(true);
		}
	});

	it("a refusal that is an answer (a rate limit, a bad password, a bad request) did not commit", () => {
		for (const code of [
			"rateLimited",
			"wrongPassword",
			"failed",
			"malformed",
			"tokenExpired",
			"wrongRecoveryKey",
		] as const) {
			expect(mayHaveCommitted(code, 0), code).toBe(false);
			expect(mayHaveCommitted(code, 3), code).toBe(false);
		}
	});
});
