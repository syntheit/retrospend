/**
 * The recurring templates of the parity ledger (E2EE P16): every frequency
 * and direction, one that asks for its amount, one paused, one anchored to
 * the 31st, due around the first clock.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "~prisma";
import { fixtureDb } from "../pg-harness";
import { CURRENCIES, D, DAY, type SeedContext, text } from "./seed-context";

const FREQ = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

function templateRow(
	ctx: SeedContext,
	i: number,
	id: string,
): Prisma.RecurringTemplateCreateManyInput {
	const currency = ctx.pick(CURRENCIES);
	const firstClock = ctx.clocks[0] as Date;
	return {
		id,
		userId: ctx.userId,
		name: `template ${i}`,
		amount: D(text(ctx.amountOf(currency), currency)),
		currency,
		categoryId: i % 4 === 0 ? ctx.pick(ctx.categoryIds) : null,
		frequency: FREQ[i % FREQ.length] as (typeof FREQ)[number],
		direction: i % 6 === 5 ? "IN" : "OUT",
		amountMode: i === 3 ? "ASK" : "FIXED",
		isActive: i !== 5,
		anchorDay: i === 7 ? 31 : null,
		autoPay: false,
		nextDueDate: new Date(firstClock.getTime() + ((i % 9) - 3) * DAY),
	};
}

/** The templates' ids; the profile with a currency of no rate gets one more, in it (the last id). */
export async function seedTemplates(ctx: SeedContext): Promise<string[]> {
	const ids: string[] = [];
	const rows: Prisma.RecurringTemplateCreateManyInput[] = [];
	for (let i = 0; i < ctx.size.templates; i++) {
		const id = randomUUID();
		ids.push(id);
		rows.push(templateRow(ctx, i, id));
	}
	if (ctx.profile.withMissingRate) {
		const id = randomUUID();
		ids.push(id);
		rows.push({
			id,
			userId: ctx.userId,
			name: "xqz template",
			amount: D("5"),
			currency: "XQZ",
			frequency: "MONTHLY",
			autoPay: false,
			nextDueDate: new Date((ctx.clocks[0] as Date).getTime() + 3 * DAY),
		});
	}
	await fixtureDb.recurringTemplate.createMany({ data: rows });
	return ids;
}
