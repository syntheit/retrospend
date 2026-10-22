import { describe, expect, it } from "vitest";
import { autoPaymentNote, generatePaymentLink } from "../payment-links";

describe("generatePaymentLink amounts", () => {
	it("keeps crypto precision instead of rounding to cents", () => {
		const link = generatePaymentLink("crypto", "0xabc", 0.004, "", {
			currency: "ETH",
			network: "ethereum",
		});
		expect(link.instructions).toBe("Send 0.004 ETH to 0xabc");
	});

	it("uses the amount currency's minor units", () => {
		const jpy = generatePaymentLink("paypal", "bob", 1200, "", {
			amountCurrency: "JPY",
		});
		expect(jpy.url).toBe("https://paypal.me/bob/1200");
		const usd = generatePaymentLink("paypal", "bob", 12.5, "");
		expect(usd.url).toBe("https://paypal.me/bob/12.50");
	});
});

describe("autoPaymentNote", () => {
	it("formats crypto amounts without throwing", () => {
		expect(autoPaymentNote(0.004, "USDT")).toBe(
			"Retrospend: Settling 0.004 USDT",
		);
	});
});
