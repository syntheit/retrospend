import { normalizeDate } from "~/lib/date";
import { FigureUnavailable } from "~/server/figures/registry";
import {
	netWorthChangeFor,
	netWorthFor,
} from "~/server/services/accounts/figures";
import { loadAccountsLedger } from "~/server/services/accounts/load";
import {
	CHANGE_PARTS,
	type NotTrackedHistory,
} from "~/server/services/accounts/net-worth-change";
import {
	addDays,
	dayOf,
	endOfDay,
	valueOn,
} from "~/server/services/accounts/series";
import { homeValue, type RatePick } from "~/server/services/accounts/valuation";
import { dec, toMinor } from "~/server/services/envelope/units";
import type { Prisma } from "~prisma";

type Tx = Prisma.TransactionClient;
type Decimal = ReturnType<typeof dec>;

/** What Not tracked holds in one currency on `day`, in the home currency; null when a rate is missing. */
function notTrackedOn(
	nt: NotTrackedHistory,
	day: string,
	home: string,
	pick: RatePick,
): Decimal | null {
	const units = nt.legs
		.filter((l) => dayOf(l.date) <= day)
		.reduce((t, l) => t.add(l.amount), dec(0));
	return homeValue(
		pick,
		{ currency: nt.currency, rateType: null, storedRate: null },
		units,
		home,
		endOfDay(day),
	);
}

/**
 * Net worth, why it moved and one point a day. The headline and the change
 * are the figures registry's own (GET /figures reads the same). The series is
 * accounts and Not tracked on each day (accounts/series.ts); what people owe
 * each other has no history, so it enters every point at today's value, the
 * way the Wealth chart does it, and the last point equals net worth.
 */
export async function netWorthIn(
	tx: Tx,
	userId: string,
	span: { days: number; changeDays: number },
) {
	const ledger = await loadAccountsLedger(tx, userId);
	const { homeCurrency: home, pick } = ledger;
	const worth = await netWorthFor(tx, userId);
	const available = worth instanceof FigureUnavailable ? null : worth;
	const change = await netWorthChangeFor(tx, userId, span.changeDays);

	const sumOn = (day: string): Decimal | null => {
		let total = dec(0);
		for (const history of ledger.histories) {
			const v = valueOn(history, day, home, pick);
			if (v === null) return null;
			total = total.add(v);
		}
		for (const nt of ledger.notTracked) {
			const v = notTrackedOn(nt, day, home, pick);
			if (v === null) return null;
			total = total.add(v);
		}
		return total;
	};

	const today = dayOf(normalizeDate(new Date()));
	const todaySum = sumOn(today);
	// What people owe each other, at today's value: net worth less the places.
	const owedMinor =
		available && todaySum ? available.minor - toMinor(todaySum, home) : null;
	const series = Array.from({ length: span.days }, (_, i) => {
		const date = addDays(today, i - (span.days - 1));
		const sum = sumOn(date);
		return {
			date,
			value:
				sum === null || owedMinor === null
					? null
					: { minor: toMinor(sum, home) + owedMinor, currency: home },
		};
	});

	return {
		currency: home,
		netWorth: available,
		change: change
			? {
					days: span.changeDays,
					total: { minor: change.total, currency: change.currency },
					parts: Object.fromEntries(
						CHANGE_PARTS.map((p) => [
							p,
							{ minor: change.parts[p], currency: change.currency },
						]),
					) as Record<
						(typeof CHANGE_PARTS)[number],
						{ minor: number; currency: string }
					>,
				}
			: null,
		series,
	};
}
