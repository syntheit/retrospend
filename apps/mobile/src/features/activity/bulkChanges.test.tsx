import type { PreviewDto } from "@/features/entry/preview";
import { BulkChanges } from "./BulkChanges";
import { mergeDeletePreviews } from "./bulk";

// The totals of a multi-expense delete are sums of one-by-one answers, so each
// reads with the approximate mark; one expense is the server's exact answer.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/auth/session", () => require("../budget/harness").sessionMock);
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
jest.mock("use-intl", () => require("../budget/harness").intlMock);

const ars = (minor: number) => ({ minor, currency: "ARS" });
const row = (delta: number): PreviewDto => ({
	changes: [
		{
			id: "spent",
			currency: "ARS",
			before: ars(10_000),
			after: ars(10_000 + delta),
			delta: ars(delta),
			figureAfter: [],
		},
	],
	unchanged: [],
	unavailable: [],
});

function texts(diff: PreviewDto, summed: boolean): string[] {
	let tree!: { toJSON(): unknown };
	act(() => {
		tree = create(
			<BulkChanges state={{ status: "ready", diff }} summed={summed} />,
		);
	});
	const out: string[] = [];
	const walk = (node: unknown) => {
		const n = node as { children?: unknown[] };
		for (const child of n.children ?? []) {
			if (typeof child === "string") out.push(child);
			else walk(child);
		}
	};
	walk(tree.toJSON());
	return out;
}

describe("BulkChanges", () => {
	it("marks a summed figure with the approximate sign", () => {
		const lines = texts(mergeDeletePreviews([row(-500), row(-300)]), true);
		expect(lines.some((l) => l.startsWith("≈ ") && l.includes("8"))).toBe(true);
	});

	it("shows one expense's answer exactly", () => {
		const lines = texts(mergeDeletePreviews([row(-500)]), false);
		expect(lines.some((l) => l.includes("≈"))).toBe(false);
		expect(lines.some((l) => l.includes("5"))).toBe(true);
	});
});
