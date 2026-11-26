/**
 * Shared set-up for the M6 PR0 characterization tests (the Wealth writes as
 * they behave before the device owns any of them). ARS home with the
 * preferred rate Blue 1 USD = 1,545 ARS and Official 1 USD = 1,050 ARS, on a
 * clock pinned at an instant where the UTC day and the Tokyo day differ.
 *
 * The clock reads 2026-03-10T16:00Z: it is Mar 10 in UTC and in Buenos Aires
 * (13:00), and already Mar 11 (01:00) in Tokyo. The rates sit on Feb 20, so
 * the latest-on-or-before rule finds them for every day the tests use and
 * the shared test database's other rates (dated later) are never read.
 */
import { adminDb, createTestUser } from "~/test/pg-harness";
import { seedArsRatesOn } from "./test-fixtures";

export const PIN_INSTANT = new Date("2026-03-10T16:00:00Z");
export const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
export const TOKYO = "Asia/Tokyo";
/** The UTC calendar day of PIN_INSTANT, and the next one (Tokyo's day). */
export const MAR_10 = new Date("2026-03-10T00:00:00Z");
export const MAR_11 = new Date("2026-03-11T00:00:00Z");

const RATE_DAY = new Date("2026-02-20T00:00:00Z");

export const CHARACTERIZATION_RATES = [
	[RATE_DAY, "blue", "1545"],
	[RATE_DAY, "official", "1050"],
] as const;

/** Seeds the two ARS rates; returns the function that removes them again. */
export const seedCharacterizationRates = () =>
	seedArsRatesOn(CHARACTERIZATION_RATES);

/** An ARS-home user who lives in `timeZone`. */
export async function userIn(timeZone: string) {
	const created = await createTestUser();
	await adminDb.user.update({
		where: { id: created.user.id },
		data: { homeCurrency: "ARS", timeZone },
	});
	return created;
}
