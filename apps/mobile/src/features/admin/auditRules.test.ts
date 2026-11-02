import { eventLabel, keyLabel, metadataFacts } from "./auditRules";

describe("audit rules", () => {
	it("labels event types and keys", () => {
		expect(eventLabel("FAILED_LOGIN")).toBe("Failed login");
		expect(keyLabel("adminUsername")).toBe("Admin username");
	});
	it("turns metadata into rows and drops null and empty values", () => {
		expect(
			metadataFacts({ adminUsername: "dani", roles: ["a", "b"], gone: null, empty: [] }),
		).toEqual([
			{ label: "Admin username", value: "dani" },
			{ label: "Roles", value: "a, b" },
		]);
		expect(metadataFacts(null)).toEqual([]);
	});
});
