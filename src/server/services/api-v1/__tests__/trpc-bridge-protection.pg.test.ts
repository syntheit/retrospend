/**
 * The tRPC bridge carries the account's real protection state. A v1 service
 * passes V1_GUARDED because its route already ran the guard; a caller that
 * does not (a job, a new service) is refused for a protected account, and a
 * user with no row is a sign-in problem.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProtectedAccountError } from "~/server/api/protection/guard";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { trpcSettings, V1_GUARDED } from "../trpc-bridge";

async function account(state: "OFF" | "ON") {
	const { user } = await createTestUser();
	await adminDb.$executeRaw`UPDATE "user" SET "protectionState" = ${state}::"ProtectionState" WHERE "id" = ${user.id}`;
	return { principal: { userId: user.id }, timeZone: "UTC" };
}

describe("tRPC bridge and protection", () => {
	it("lets an unprotected account through with or without the flag", async () => {
		const caller = await account("OFF");
		await expect(
			(await trpcSettings(caller)).getAiStatus(),
		).resolves.toBeDefined();
		await expect(
			(await trpcSettings(caller, V1_GUARDED)).getAiStatus(),
		).resolves.toBeDefined();
	});

	it("refuses a protected account that passes no flag", async () => {
		const caller = await account("ON");
		await expect(trpcSettings(caller)).rejects.toBeInstanceOf(
			ProtectedAccountError,
		);
	});

	it("serves a protected account whose v1 route already guarded the call", async () => {
		const caller = await account("ON");
		await expect(
			(await trpcSettings(caller, V1_GUARDED)).getAiStatus(),
		).resolves.toBeDefined();
	});

	it("rejects a user who no longer exists", async () => {
		await expect(
			trpcSettings({ principal: { userId: randomUUID() }, timeZone: "UTC" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
