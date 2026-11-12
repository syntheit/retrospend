// Parity with the float rounding money.ts had before half to even. The old
// functions are frozen here, in the test only. For seeded random amounts and
// rates, the new result equals the old one unless the exact value is a tie at
// the target scale; on a tie the new result is the even neighbor (the old one
// rounded half up, toward +infinity). Fails if the code reverts to half up,
// or if a value that is not a tie drifts.
import { describe, expect, it } from "vitest";
import { computeAmountInUSD, currencyDecimals, toMinorUnits } from "./money";
import { dec } from "./precise-decimal";

// ── The old functions, frozen ───────────────────────────────────────────────
const oldToMinor = (amount: number, decimals: number) =>
	Math.round(Number((amount * 10 ** decimals).toPrecision(15)));
const oldAmountInUSD = (amount: number, rate: number, crypto: boolean) => {
	const usd = crypto ? amount * rate : amount * (1 / rate);
	return oldToMinor(usd, 2) / 100;
};

/** A small seeded generator (LCG), so every run checks the same values. */
function seeded(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) % 2 ** 31;
		return s / 2 ** 31;
	};
}

/** A decimal string with up to `places` decimals below `max`. */
const decimalText = (rnd: () => number, max: number, places: number) =>
	(Math.floor(rnd() * max * 10 ** places) / 10 ** places).toFixed(places);

/**
 * What the new rule must give for an exact value scaled to minor units:
 * `scaled` itself rounded, the even neighbor on a tie. Derived from the rule,
 * not from the code under test.
 */
function expected(scaled: ReturnType<typeof dec>, old: number) {
	const floor = scaled.abs().floor();
	const tie = scaled.abs().minus(floor).eq(0.5);
	if (!tie) return { tie, want: old };
	const magnitude = floor.mod(2).eq(0) ? floor : floor.plus(1);
	const signed = scaled.isNeg() ? magnitude.neg() : magnitude;
	return { tie, want: signed.toNumber() + 0 };
}

describe("toMinorUnits keeps the old result except on ties", () => {
	for (const currency of ["JPY", "USD", "KWD", "CLF", "BTC"]) {
		it(currency, () => {
			const rnd = seeded(currency.charCodeAt(0));
			const d = currencyDecimals(currency);
			let ties = 0;
			for (let i = 0; i < 4000; i++) {
				// Half the draws sit exactly on a tie: one more decimal ending in 5.
				const forceTie = i % 2 === 0;
				let text = decimalText(rnd, 100_000, forceTie ? d : Math.min(d + 3, 8));
				if (forceTie)
					text = dec(text)
						.plus(dec(5).div(10 ** (d + 1)))
						.toFixed();
				if (i % 3 === 0) text = `-${text}`;
				const amount = Number(text);
				const { tie, want } = expected(
					dec(text).mul(10 ** d),
					oldToMinor(amount, d),
				);
				if (tie) ties++;
				expect(toMinorUnits(amount, currency), text).toBe(want);
			}
			expect(ties).toBeGreaterThan(1000);
		});
	}
});

describe("computeAmountInUSD keeps the old result except on ties", () => {
	it("fiat divides once, crypto multiplies", () => {
		const rnd = seeded(7);
		let ties = 0;
		for (let i = 0; i < 6000; i++) {
			const crypto = i % 4 === 0;
			const rate = decimalText(rnd, crypto ? 70_000 : 2_000, 6);
			if (dec(rate).eq(0)) continue;
			// Every third draw is a tie by construction: amount = rate x
			// (k + 0.5) / 100 for fiat, so amount / rate is k.5 cents.
			const k = Math.floor(rnd() * 10_000);
			const amount =
				i % 3 === 0 && !crypto
					? dec(rate)
							.mul(k + 0.5)
							.div(100)
							.toFixed()
					: decimalText(rnd, 100_000, 6);
			const usd = crypto ? dec(amount).mul(rate) : dec(amount).div(rate);
			const cents = usd.mul(100);
			// A float cannot tell a value within 1e-9 cents of a tie from one;
			// those near misses are where the old function was wrong anyway.
			const frac = cents.minus(cents.floor());
			if (!frac.eq(0.5) && frac.minus(0.5).abs().lt(1e-9)) continue;
			const old = oldAmountInUSD(Number(amount), Number(rate), crypto) * 100;
			const { tie, want } = expected(cents, Math.round(old));
			if (tie) ties++;
			const got = computeAmountInUSD(
				Number(amount),
				crypto ? "BTC" : "ARS",
				Number(rate),
			);
			expect(Math.round(got * 100), `${amount} at ${rate}`).toBe(want);
		}
		expect(ties).toBeGreaterThan(1000);
	});
});
