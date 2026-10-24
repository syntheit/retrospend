/**
 * The People list for someone who only owes. Martin pays for a dinner and
 * splits it with Sofia outside any project. Row level security lets Sofia
 * read her own split row and the expense, but not Martin's split row (that
 * policy is "your own row, or you own the expense, or you share its
 * project"). The list used to take people only from the split rows it could
 * read, so Sofia never saw Martin in it, although she owes him: the payer is
 * on the expense itself, which she can read.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	ars,
	arsUser,
	ref,
	seedRates,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { SharedTransactionService } from "~/server/services/shared-expenses/transaction.service";
import { peopleOverview } from "./overview";

describe("People list: the payer of a share you owe", () => {
	let sofia: TestUser;
	let martin: TestUser;

	beforeAll(async () => {
		await seedRates();
		[sofia, martin] = [await arsUser(), await arsUser()];
		await new SharedTransactionService(martin.db, ref(martin)).create({
			amount: 180,
			currency: "ARS",
			description: "Dinner",
			date: new Date("2026-10-08"),
			paidBy: ref(martin),
			splitWith: [ref(martin), ref(sofia)],
			splitMode: "EQUAL",
		});
	});

	it("lists the person who paid, with what you owe them", async () => {
		const overview = await peopleOverview(sofia.db, sofia.user.id);
		const martins = overview.people.filter(
			(p) => p.person.id === martin.user.id,
		);
		expect(martins).toHaveLength(1);
		expect(martins[0]).toMatchObject({ group: "owe", net: ars(-9000) });
		expect(overview.youOwe).toEqual(ars(9000));
	});

	it("lists the other side too", async () => {
		const overview = await peopleOverview(martin.db, martin.user.id);
		const sofias = overview.people.filter((p) => p.person.id === sofia.user.id);
		expect(sofias).toHaveLength(1);
		expect(sofias[0]).toMatchObject({ group: "owed", net: ars(9000) });
	});
});
