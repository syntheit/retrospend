/**
 * The WEALTH page settings row is written by two things: the order save
 * (sort and custom order) and the settings toggles. Concurrent writes each
 * keep the other's keys: the row is locked while it is read and written.
 */
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { updatePageSettings } from "../user-settings";
import { getAccountOrder, setAccountOrder } from "./order";
import { openAccount } from "./test-fixtures";

describe("concurrent writes to the WEALTH settings row", () => {
	it("keeps the sort, the order and a settings toggle when they race", async () => {
		for (let round = 0; round < 5; round++) {
			const { user } = await createTestUser();
			const a = await openAccount(user.id, "A", "CASH", "USD", 100);
			const b = await openAccount(user.id, "B", "CASH", "USD", 200);

			await Promise.all([
				setAccountOrder(adminDb, user.id, { sort: "custom" }),
				setAccountOrder(adminDb, user.id, { order: [b, a] }),
				updatePageSettings(adminDb, user.id, "WEALTH", {
					showHistoryChart: false,
				}),
			]);

			expect(await getAccountOrder(adminDb, user.id)).toEqual({
				sort: "custom",
				order: [b, a],
			});
			const row = await adminDb.userPageSetting.findUniqueOrThrow({
				where: { userId_page: { userId: user.id, page: "WEALTH" } },
			});
			expect(row.settings).toMatchObject({ showHistoryChart: false });
		}
	});

	it("creates the row on the first write, once, when writers race for it", async () => {
		const { user } = await createTestUser();
		await Promise.all([
			setAccountOrder(adminDb, user.id, { sort: "name" }),
			updatePageSettings(adminDb, user.id, "WEALTH", {
				showCurrencyExposure: false,
			}),
		]);
		const rows = await adminDb.userPageSetting.findMany({
			where: { userId: user.id, page: "WEALTH" },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.settings).toMatchObject({
			sort: "name",
			showCurrencyExposure: false,
		});
	});
});
