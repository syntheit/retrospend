/**
 * people.createShadow on real Postgres (RLS on): an email that belongs to an
 * account is answered with that account only for someone you already share
 * expenses or a project with, including the payer of a share you owe (whose
 * split row row level security hides from you). Any other email adds a person
 * with the typed email and the answer looks the same as for an email with no
 * account. The email check is metered, 20 an hour, like /api/v1/people.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import {
	arsUser,
	ref,
	seedProject,
	seedRates,
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

describe("people.createShadow and email lookups", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let stranger: TestUser;

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, stranger] = [
			await arsUser(),
			await arsUser(),
			await arsUser(),
		];
		// Martin paid, Sofia owes, outside any project: Sofia cannot read
		// Martin's split row, only the expense.
		await seedShare(ref(martin), ref(sofia), "100", "ARS");
	});

	it("answers the account of someone you share with, even the payer you owe", async () => {
		const out = await as(sofia).createShadow({
			name: "Marty",
			email: martin.user.email,
		});
		expect(out).toMatchObject({
			participantType: "user",
			participantId: martin.user.id,
		});
		await expect(
			adminDb.shadowProfile.count({ where: { createdById: sofia.user.id } }),
		).resolves.toBe(0);
	});

	it("answers the account of someone in a project you share", async () => {
		const colleague = await arsUser();
		await seedProject(sofia, [{ user: colleague, role: "EDITOR" }]);
		const out = await as(sofia).createShadow({
			name: "Cole",
			email: colleague.user.email,
		});
		expect(out.participantType).toBe("user");
		expect(out.participantId).toBe(colleague.user.id);
	});

	it("adds a person with the typed email for any other account", async () => {
		const known = await as(sofia).createShadow({
			name: "Sam",
			email: stranger.user.email,
		});
		const unknown = await as(sofia).createShadow({
			name: "Sam",
			email: "nobody@pg-test.invalid",
		});
		expect(known.participantType).toBe("shadow");
		expect(known.email).toBe(stranger.user.email);
		expect(known.participantId).not.toBe(stranger.user.id);
		expect(known.name).toBe("Sam");
		expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort());
	});

	it("meters email checks at 20 an hour", async () => {
		const spammer = await arsUser();
		const caller = as(spammer);
		for (let i = 0; i < 20; i++)
			await caller.createShadow({ name: "P", email: `q${i}@pg-test.invalid` });
		await expect(
			caller.createShadow({ name: "P", email: "q20@pg-test.invalid" }),
		).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
		// A name alone looks nothing up.
		await expect(caller.createShadow({ name: "Plain" })).resolves.toMatchObject(
			{
				participantType: "shadow",
			},
		);
	});
});
