import { describe, expect, it } from "vitest";
import { Prisma } from "~prisma";
import { AUTO_POST_GRACE_MS, recurringItems } from "./activity";

const BA = "America/Argentina/Buenos_Aires";
// 2026-10-21 15:00 in Buenos Aires (UTC-3).
const now = new Date("2026-10-21T18:00:00.000Z");

const template = (
	id: string,
	nextDueDate: string,
	o: Partial<{ autoPay: boolean; ask: boolean; dir: "IN" | "OUT" }> = {},
) => ({
	id,
	name: `Item ${id}`,
	amount: new Prisma.Decimal("41500.5"),
	currency: "ARS",
	direction: o.dir ?? ("OUT" as const),
	amountMode: o.ask ? ("ASK" as const) : ("FIXED" as const),
	autoPay: o.autoPay ?? false,
	nextDueDate: new Date(nextDueDate),
});

describe("recurring Needs you items", () => {
	it("overdue, due today and later in the viewer's calendar", () => {
		const items = recurringItems(
			[
				template("old", "2026-10-19T12:00:00.000Z"),
				// Oct 21 01:00 UTC is still Oct 20 in Buenos Aires: overdue there.
				template("edge", "2026-10-21T01:00:00.000Z"),
				template("today", "2026-10-21T12:00:00.000Z"),
				template("later", "2026-10-22T12:00:00.000Z"),
			],
			now,
			BA,
		);
		expect(items.map((i) => [i.id, i.type, i.date, i.attention])).toEqual([
			["recurring.overdue:old", "recurring.overdue", "2026-10-19", true],
			["recurring.overdue:edge", "recurring.overdue", "2026-10-20", true],
			["recurring.due:today", "recurring.due", "2026-10-21", false],
		]);
	});

	it("carries the amount in minor units, the title, direction and ask", () => {
		const [income] = recurringItems(
			[template("pay", "2026-10-21T12:00:00.000Z", { dir: "IN", ask: true })],
			now,
			BA,
		);
		expect(income).toMatchObject({
			entity: { kind: "recurring", id: "pay" },
			amount: { minor: 4_150_050, currency: "ARS" },
			title: "Item pay",
			direction: "in",
			askAmount: true,
			actions: [
				{ entity: "recurring", id: "confirm" },
				{ entity: "recurring", id: "editAmount" },
				{ entity: "recurring", id: "skip" },
			],
		});
	});

	it("an automatic fixed item waits for the sidecar for an hour, then needs you", () => {
		const justDue = new Date(now.getTime() - AUTO_POST_GRACE_MS + 60_000);
		const stuck = new Date(now.getTime() - AUTO_POST_GRACE_MS - 60_000);
		const items = recurringItems(
			[
				template("auto", justDue.toISOString(), { autoPay: true }),
				template("stuck", stuck.toISOString(), { autoPay: true }),
				template("askAuto", justDue.toISOString(), {
					autoPay: true,
					ask: true,
				}),
			],
			now,
			BA,
		);
		expect(items.map((i) => i.id).sort()).toEqual([
			"recurring.due:askAuto",
			"recurring.due:stuck",
		]);
	});
});
