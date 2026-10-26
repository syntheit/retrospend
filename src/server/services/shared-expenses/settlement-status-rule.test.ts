import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BALANCE_SETTLEMENT_STATUSES } from "./balance";

/**
 * Every view that turns settlements into a balance must count the same
 * statuses (see BALANCE_SETTLEMENT_STATUSES in balance.ts). They used to
 * disagree: project views counted only FINALIZED while the People view and the
 * settle-up cap also counted PROPOSED, so a pending payment cleared a debt in
 * one place and not in the other.
 */
const BALANCE_QUERY_FILES = [
	"src/server/services/shared-expenses/balance.ts",
	"src/server/services/shared-expenses/balances-perspective.service.ts",
	"src/server/services/project/ledger.ts",
	"src/server/services/project/project-read.service.ts",
	"src/server/services/shared-expenses/billing-period-settle.ts",
];

describe("project delete", () => {
	// Deleting a project moves its expenses AND its settlements to the direct
	// (project-less) bucket. If only one of them moved (or one cascaded away),
	// the direct bucket would show a phantom balance.
	it("treats expenses and settlements the same way", () => {
		const schema = readFileSync(
			join(process.cwd(), "prisma/schema.prisma"),
			"utf8",
		);
		const relation = (model: string) => {
			const body = schema.slice(schema.indexOf(`model ${model} {`));
			return body
				.slice(0, body.indexOf("\n}"))
				.split("\n")
				.find((l) => /^\s+project\s+Project\?/.test(l));
		};
		expect(relation("SharedTransaction")).toContain("onDelete: SetNull");
		expect(relation("Settlement")).toContain("onDelete: SetNull");
	});
});

describe("settlement status rule", () => {
	it("counts PROPOSED and FINALIZED, never REJECTED", () => {
		expect([...BALANCE_SETTLEMENT_STATUSES].sort()).toEqual([
			"FINALIZED",
			"PROPOSED",
		]);
	});

	it.each(BALANCE_QUERY_FILES)(
		"every settlement query in %s filters with BALANCE_SETTLEMENT_STATUSES",
		(file) => {
			const source = readFileSync(join(process.cwd(), file), "utf8");
			const marker = "settlement.findMany({";
			let from = source.indexOf(marker);
			expect(from).toBeGreaterThanOrEqual(0);
			while (from >= 0) {
				// The where clause sits at the top of the call.
				const where = source.slice(from, from + 400);
				expect(where).toContain("BALANCE_SETTLEMENT_STATUSES");
				expect(where).not.toMatch(/status:\s*"FINALIZED"/);
				from = source.indexOf(marker, from + marker.length);
			}
		},
	);
});
