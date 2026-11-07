/**
 * The default currency for new expenses follows the home currency until it is
 * set apart from it. Hand-derived: a new user is USD and USD.
 *
 *   home ARS            -> default follows: ARS
 *   default EUR         -> chosen, so it stays EUR
 *   home BRL            -> default stays EUR
 *   home ARS + default USD in one write -> exactly what was asked
 *   home back to USD while default == home -> default follows back (an Undo)
 */
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { updateGeneralSettings } from "./general-settings.service";

const read = async (id: string) =>
	adminDb.user.findUniqueOrThrow({
		where: { id },
		select: { homeCurrency: true, defaultCurrency: true },
	});

describe("default currency follows the home currency", () => {
	it("moves with home while untouched, and stays once chosen", async () => {
		const { user, db } = await createTestUser();
		expect(await read(user.id)).toEqual({
			homeCurrency: "USD",
			defaultCurrency: "USD",
		});

		await updateGeneralSettings(db, user.id, { homeCurrency: "ARS" });
		expect(await read(user.id)).toEqual({
			homeCurrency: "ARS",
			defaultCurrency: "ARS",
		});

		await updateGeneralSettings(db, user.id, { defaultCurrency: "EUR" });
		await updateGeneralSettings(db, user.id, { homeCurrency: "BRL" });
		expect(await read(user.id)).toEqual({
			homeCurrency: "BRL",
			defaultCurrency: "EUR",
		});
	});

	it("a write that names both takes both as asked", async () => {
		const { user, db } = await createTestUser();
		await updateGeneralSettings(db, user.id, {
			homeCurrency: "ARS",
			defaultCurrency: "USD",
		});
		expect(await read(user.id)).toEqual({
			homeCurrency: "ARS",
			defaultCurrency: "USD",
		});
	});

	it("putting the home currency back puts a following default back", async () => {
		const { user, db } = await createTestUser();
		await updateGeneralSettings(db, user.id, { homeCurrency: "ARS" });
		await updateGeneralSettings(db, user.id, { homeCurrency: "USD" });
		expect(await read(user.id)).toEqual({
			homeCurrency: "USD",
			defaultCurrency: "USD",
		});
	});

	it("other settings leave both alone", async () => {
		const { user, db } = await createTestUser();
		await updateGeneralSettings(db, user.id, { homeCurrency: "ARS" });
		await updateGeneralSettings(db, user.id, {
			smartCurrencyFormatting: false,
		});
		expect(await read(user.id)).toEqual({
			homeCurrency: "ARS",
			defaultCurrency: "ARS",
		});
	});
});
