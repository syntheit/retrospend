import { describe, expect, it } from "vitest";
import type { Prisma } from "~prisma";
import { assertAnotherAdminRemains } from "../admin-guard.service";

/** A transaction whose locked admin query answers these ids. */
const txWith = (ids: string[]) =>
	({
		$queryRaw: async () => ids.map((id) => ({ id })),
	}) as unknown as Prisma.TransactionClient;

describe("assertAnotherAdminRemains", () => {
	it("refuses the last active admin", async () => {
		await expect(
			assertAnotherAdminRemains(txWith(["a"]), "a"),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("lets an admin go while another stays", async () => {
		await expect(
			assertAnotherAdminRemains(txWith(["a", "b"]), "a"),
		).resolves.toBeUndefined();
	});

	it("does not care when the target is not an active admin", async () => {
		await expect(
			assertAnotherAdminRemains(txWith(["a"]), "someone"),
		).resolves.toBeUndefined();
		await expect(
			assertAnotherAdminRemains(txWith([]), "someone"),
		).resolves.toBeUndefined();
	});
});
