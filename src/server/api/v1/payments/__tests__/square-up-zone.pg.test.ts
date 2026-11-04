/**
 * The day a v1 square up is dated, through the real route (user-scoped
 * database, the zone middleware). The instant 2026-11-03T02:00Z is Nov 3 in
 * Tokyo and UTC but still Nov 2, 23:00 in Buenos Aires (UTC-3). A request
 * with an x-timezone header is dated in that zone even when another is
 * saved; one without it in the saved zone.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	arsUser,
	ref,
	seedProject,
	seedShare,
	type TestUser,
} from "../../__tests__/g3-fixtures";
import { asMobile, call, expectBody } from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const INSTANT = new Date("2026-11-03T02:00:00Z");
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";

afterEach(() => {
	vi.useRealTimers();
});

// Trip: Ann paid ARS 100 that Bob owes. Rent: Bob paid ARS 100 that Ann owes.
async function pair(): Promise<{ ann: TestUser; bob: TestUser }> {
	const [ann, bob] = [await arsUser(), await arsUser()];
	await adminDb.user.update({
		where: { id: ann.user.id },
		data: { timeZone: BUENOS_AIRES },
	});
	const trip = await seedProject(ann, [{ user: bob, role: "EDITOR" }]);
	const rent = await seedProject(bob, [{ user: ann, role: "EDITOR" }]);
	await seedShare(ref(ann), ref(bob), "100", "ARS", { projectId: trip });
	await seedShare(ref(bob), ref(ann), "100", "ARS", { projectId: rent });
	return { ann, bob };
}

async function squaredDay(zoneHeader?: string) {
	const { ann, bob } = await pair();
	const headers = {
		...(await asMobile(ann.user.id)),
		...(zoneHeader ? { "x-timezone": zoneHeader } : {}),
	};
	vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
	const done = await expectBody<{ id: string }>(
		await call("/payments/square-up", {
			method: "POST",
			headers,
			body: { person: { type: "user", id: bob.user.id }, currency: "ARS" },
			idempotent: randomUUID(),
		}),
		contract.payments.squareUp,
		201,
	);
	const row = await adminDb.payment.findUniqueOrThrow({
		where: { id: done.id },
		select: { paidOn: true },
	});
	return row.paidOn.toISOString().slice(0, 10);
}

describe("POST /payments/square-up day", () => {
	it("dates the offsets on the saved zone's day without a zone header: Nov 2", async () => {
		expect(await squaredDay()).toBe("2026-11-02");
	});

	it("lets the request's zone win over the saved one: Tokyo is Nov 3", async () => {
		expect(await squaredDay("Asia/Tokyo")).toBe("2026-11-03");
	});
});
