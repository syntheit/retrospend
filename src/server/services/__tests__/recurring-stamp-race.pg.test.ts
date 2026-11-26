/**
 * Template stamps that always move (stamp_moves): an edit that lands in the
 * same millisecond as the stamp a client holds still changes the stamp, so the
 * client's PATCH and its confirm are refused (409 recurring_changed) instead
 * of overwriting or booking from the edited template. The stamp S is the one
 * the client read; the second edit sets S again, as a same-millisecond edit
 * from another client does.
 */
import { contract } from "@retrospend/api-contract";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { expectBody } from "~/server/api/v1/core/__tests__/harness";
import { fixtureDb } from "~/test/pg-harness";
import {
	arsUser,
	booked,
	iso,
	STAMPED,
	setRates,
	trpcFor,
	usdTemplate,
	v1For,
} from "./recurring-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const NOW = "2026-12-01T12:00:00.000Z";
const DUE = "2026-12-01T03:00:00.000Z";
const CHANGED = "Recurring expense changed";
const S = new Date(STAMPED.getTime() + 5);

const at = (instant: string) =>
	vi.useFakeTimers({ toFake: ["Date"], now: new Date(instant) });

beforeAll(async () => {
	await setRates([
		["2026-11-01", "ARS", "blue", "1500"],
		["2026-11-30", "ARS", "blue", "1545"],
		["2026-12-01", "ARS", "official", "1050"],
	]);
});
afterEach(() => vi.useRealTimers());

/** A manual template the phone edited (stamp S) and the web edited again in the same millisecond. */
async function editedTwiceAtOnce() {
	const me = await arsUser();
	const id = await usdTemplate(me, { autoPay: false });
	for (const name of ["phone", "web"])
		await fixtureDb.recurringTemplate.update({
			where: { id },
			data: { name, updatedAt: S },
		});
	const stored = await fixtureDb.recurringTemplate.findUniqueOrThrow({
		where: { id },
	});
	return { me, id, stored };
}

describe("a recurring template edited twice in one millisecond", () => {
	it("stores a later stamp the second time", async () => {
		const { stored } = await editedTwiceAtOnce();
		expect(stored.updatedAt.getTime()).toBe(S.getTime() + 1);
	});

	it("PATCH with the first stamp is 409 recurring_changed and keeps the web's edit", async () => {
		const { me, id } = await editedTwiceAtOnce();
		const v1 = await v1For(me);
		const trpc = await trpcFor(me);
		at(NOW);
		const res = await v1("PATCH", `/recurring/${id}`, {
			name: "Lost",
			expectedUpdatedAt: iso(S),
		});
		expect(res.status).toBe(409);
		await expect(
			trpc.recurring.update({
				id,
				name: "Lost",
				expectedUpdatedAt: iso(S),
			}),
		).rejects.toMatchObject({ code: "CONFLICT", message: CHANGED });
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(row.name).toBe("web");
	});

	it("confirm with the first stamp is refused at the plan check, and the stored stamp books", async () => {
		const { me, id, stored } = await editedTwiceAtOnce();
		const trpc = await trpcFor(me);
		at(NOW);
		await expect(
			trpc.recurring.confirmAndCreate({
				id,
				dueDate: new Date(DUE),
				expectedUpdatedAt: iso(S),
			}),
		).rejects.toMatchObject({ code: "CONFLICT", message: CHANGED });
		expect(await booked(me)).toEqual([]);

		const v1 = await v1For(me);
		const done = await expectBody<{ confirmed: { expenseId: string } }>(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE,
				expectedUpdatedAt: iso(stored.updatedAt),
			}),
			contract.recurring.confirm,
		);
		expect(done.confirmed.expenseId).toBeTruthy();
		expect(await booked(me)).toHaveLength(1);
	});
});
