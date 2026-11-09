/**
 * people.search reads a bounded window of candidates (E2EE lane D10): the
 * newest APP_LAYER_WINDOW ghosts and the newest APP_LAYER_WINDOW contacts. The
 * window is 3 here so a handful of rows shows the cut; an older match is not
 * found, a newer one is, whatever the name sorts like.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/services/search-fold", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/services/search-fold")>()),
	APP_LAYER_WINDOW: 3,
}));

import { createCallerFactory } from "~/server/api/trpc";
import {
	arsUser,
	ref,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { adminDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { peopleRouter } from "../people";

const as = (u: TestUser) =>
	createCallerFactory(peopleRouter)({
		session: makeSession({ id: u.user.id, name: u.user.name }),
		db: u.db,
		headers: new Headers(),
	});

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

describe("people.search window", () => {
	it("considers only the newest 3 ghosts and the newest 3 contacts", async () => {
		const me = await arsUser();
		for (let n = 1; n <= 5; n++) {
			await adminDb.shadowProfile.create({
				data: {
					createdById: me.user.id,
					name: `Cap ghost ${n}`,
					createdAt: day(n),
				},
			});
			const u = await arsUser();
			await adminDb.user.update({
				where: { id: u.user.id },
				data: { name: `Cap user ${n}`, createdAt: day(n) },
			});
			await seedShare(ref(me), ref(u), "10", "ARS");
		}
		const out = await as(me).search({ query: "cap" });
		expect(out.shadows.map((s) => s.name).sort()).toEqual([
			"Cap ghost 3",
			"Cap ghost 4",
			"Cap ghost 5",
		]);
		expect(out.users.map((u) => u.name).sort()).toEqual([
			"Cap user 3",
			"Cap user 4",
			"Cap user 5",
		]);
	});
});
