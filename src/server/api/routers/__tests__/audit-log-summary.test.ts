/**
 * Activity feed summaries for payment groups: each project feed shows its
 * own part of a payment, offsets, square-ups and reopened periods.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/storage", () => ({ getImageUrl: vi.fn() }));

import { buildActivitySummary } from "../audit-log";

const summary = (
	action: string,
	targetType: string,
	changes: Record<string, unknown>,
	periodLabel: string | null = null,
) =>
	buildActivitySummary(
		action,
		targetType,
		"Alice",
		null,
		null,
		changes,
		"Bob",
		periodLabel,
	);

describe("settlement activity summaries", () => {
	it("a single-project payment keeps the plain summary", () => {
		expect(
			summary("CREATED", "SETTLEMENT", { amount: 100, currency: "USD" }),
		).toMatchObject({ key: "activityCreatedSettlement" });
	});

	it("a project's part of a larger payment says so", () => {
		const s = summary("CREATED", "SETTLEMENT", {
			amount: 60,
			currency: "USD",
			allocatedFromTotal: 100,
		});
		expect(s.key).toBe("activityCreatedSettlementPart");
		expect(s.params).toMatchObject({ name: "Bob" });
		expect(s.params?.total).toContain("100");
	});

	it("a part with an offset reports the scope total and the offset", () => {
		const s = summary("CREATED", "SETTLEMENT", {
			amount: 20,
			offsetAmount: 30,
			currency: "USD",
		});
		expect(s.key).toBe("activityCreatedSettlementWithOffset");
		expect(s.params?.amount).toContain("50");
		expect(s.params?.offset).toContain("30");
	});

	it("an offset-only part and a square-up read as offsets", () => {
		expect(
			summary("CREATED", "SETTLEMENT", {
				amount: 0,
				offsetAmount: 30,
				currency: "USD",
			}).key,
		).toBe("activityOffsetSettlement");
		expect(
			summary("CREATED", "SETTLEMENT", {
				amount: 0,
				offsetAmount: 30,
				currency: "USD",
				squareUp: true,
			}).key,
		).toBe("activityOffsetSettlement");
	});

	it("a reopened period names the period", () => {
		expect(
			summary("PERIOD_REOPENED", "BILLING_PERIOD", {}, "March 2026"),
		).toMatchObject({
			key: "activityReopenedPeriod",
			params: { period: "March 2026" },
		});
		expect(summary("PERIOD_REOPENED", "BILLING_PERIOD", {}).key).toBe(
			"activityReopenedPeriodGeneric",
		);
	});
});
