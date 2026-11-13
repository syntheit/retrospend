// Catches: the guestSession test double answering a lookup it does not
// understand (a hash filter ignored would return the first guest of the
// project, whoever it is).
import { describe, expect, it } from "vitest";
import {
	type GuestSessionRecord,
	makeGuestSessionModel,
} from "./guest-session-double";

function model() {
	const rows = new Map<string, GuestSessionRecord>();
	let n = 0;
	const m = makeGuestSessionModel(rows, () => `g${++n}`);
	const add = (email: string, emailHash: string | null, projectId = "p1") =>
		m.create({ data: { email, emailHash, projectId } }).id;
	return { m, add };
}

describe("guestSession double findFirst", () => {
	it("matches the hash, and not another guest's", () => {
		const { m, add } = model();
		add("a@example.com", "tag:aa");
		const b = add("b@example.com", "tag:bb");
		expect(m.findFirst({ where: { emailHash: "tag:bb" } })?.id).toBe(b);
		expect(m.findFirst({ where: { emailHash: "tag:cc" } })).toBeNull();
	});

	it("matches the plaintext address ignoring case, within a project", () => {
		const { m, add } = model();
		add("a@example.com", null, "p1");
		const b = add("a@example.com", null, "p2");
		const where = {
			email: { equals: "A@Example.com", mode: "insensitive" },
			projectId: "p2",
		};
		expect(m.findFirst({ where })?.id).toBe(b);
	});

	it("refuses a plain string email filter", () => {
		const { m, add } = model();
		add("a@example.com", null);
		expect(() => m.findFirst({ where: { email: "a@example.com" } })).toThrow(
			/not supported/,
		);
	});
});
