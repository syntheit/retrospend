import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, userTransaction } = vi.hoisted(() => {
	const tx = { name: "rls-tx" };
	const userTransaction = vi.fn(
		async (_db: unknown, _userId: string, work: (t: unknown) => unknown) =>
			work(tx),
	);
	return { tx, userTransaction };
});

vi.mock("~/server/db", () => ({ db: { name: "global" } }));
vi.mock("~/server/db-tx", () => ({ userTransaction }));
vi.mock("./registry", async (importOriginal) => {
	const original = await importOriginal<typeof import("./registry")>();
	return {
		...original,
		figures: original.createFiguresRegistry([
			{
				id: "balance.withPerson",
				scope: ["personId"],
				compute: async (db: unknown, scope: { personId?: string }) =>
					db === tx && scope.personId === "martin"
						? { minor: 500, currency: "ARS" }
						: null,
			},
		]),
	};
});

const { readFigures } = await import("./read");

describe("readFigures", () => {
	beforeEach(() => {
		userTransaction.mockClear();
	});

	it("reads inside a userTransaction for that user", async () => {
		const readings = await readFigures("user-1", ["balance.withPerson"], {
			personId: "martin",
		});

		expect(userTransaction).toHaveBeenCalledWith(
			{ name: "global" },
			"user-1",
			expect.any(Function),
		);
		expect(readings.get("balance.withPerson")).toEqual([
			{ minor: 500, currency: "ARS" },
		]);
	});

	it("fails on an unknown id before opening a transaction", async () => {
		await expect(readFigures("user-1", ["netWorth"])).rejects.toThrow(
			'no figure is registered as "netWorth"',
		);
		expect(userTransaction).not.toHaveBeenCalled();
	});
});
