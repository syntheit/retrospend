/**
 * What `ready()` records and logs for a loader that fails (E2EE D11 PR 3.1).
 * Hand-derived expectations:
 *
 *   an error with no stable code -> failed keystore_unavailable, logged once with
 *                                   the key class and the error's name only
 *   the same cached error again  -> not logged again
 *   a keystore error with a code -> recorded with its code, not logged
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeystoreError } from "../services/keys/keystore-errors";
import { textKeys } from "./text-keys";

const USER_ID = "7f3c2a10-5b1e-4c8d-9a2f-0e6b4d1c3a99";

afterEach(() => vi.restoreAllMocks());

describe("textKeys ready()", () => {
	it("logs an error with no stable code once, without its message", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		// A driver error whose text names the user, as a failed query might.
		const cached = new TypeError(`connection lost for user ${USER_ID}`);
		const keys = textKeys({ user: () => Promise.reject(cached) });

		await keys.ready();
		await keys.ready();

		expect(keys.outcome("user")).toEqual({ failed: "keystore_unavailable" });
		expect(log).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith("Key load failed", {
			keyClass: "user",
			error: "TypeError",
			sqlstate: null,
		});
		const written = JSON.stringify(log.mock.calls);
		expect(written).not.toContain(USER_ID);
		expect(written).not.toContain("connection lost");
	});

	it("records a keystore error by its code and does not log it", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const keys = textKeys({
			instance: () =>
				Promise.reject(new KeystoreError("keystore_missing", "gone")),
		});

		await keys.ready();

		expect(keys.outcome("instance")).toEqual({ failed: "keystore_missing" });
		expect(keys.outcome("user")).toEqual({ none: true });
		expect(log).not.toHaveBeenCalled();
	});
});
