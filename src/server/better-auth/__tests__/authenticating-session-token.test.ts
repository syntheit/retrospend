import { describe, expect, it } from "vitest";
import { authenticatingSessionToken } from "../scoped-sessions";

const SECURE = "__Secure-better-auth.session_token";
const PLAIN = "better-auth.session_token";

/** The token a two-factor password check is charged to: only the one better-auth reads. */
describe("authenticatingSessionToken", () => {
	it("reads only the configured cookie name, never a decoy under the other name", () => {
		const headers = new Headers({
			cookie: `${PLAIN}=decoy.sig; ${SECURE}=victim.sig`,
		});
		expect(authenticatingSessionToken(headers, SECURE)).toBe("victim");
		expect(authenticatingSessionToken(headers, PLAIN)).toBe("decoy");
	});

	it("takes the first cookie of the name, as better-auth's parser does", () => {
		const headers = new Headers({
			cookie: `${SECURE}=first.sig; ${SECURE}=second.sig`,
		});
		expect(authenticatingSessionToken(headers, SECURE)).toBe("first");
	});

	it("answers null when the configured cookie is absent, even if the other name is present", () => {
		const headers = new Headers({ cookie: `${PLAIN}=decoy.sig` });
		expect(authenticatingSessionToken(headers, SECURE)).toBeNull();
	});
});
