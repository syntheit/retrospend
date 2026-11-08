/**
 * Undo of a name change sends the previous stored name back through
 * profile.update, and an old name may hold a control character. The write
 * takes it and stores the name without the characters userText refuses.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));
vi.mock("~/server/db", () => ({ db: {}, createUserScopedDb: vi.fn() }));
vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn() }));

import { updateProfile } from "../profile.service";

const current = { id: "u1", username: "dana", email: "dana@example.com" };

function fakeDb() {
	const update = vi.fn(async ({ data }: { data: { name?: string } }) => ({
		id: "u1",
		name: data.name ?? "Dana",
		username: "dana",
		email: "dana@example.com",
	}));
	return { db: { user: { update } } as never, update };
}

describe("updateProfile name", () => {
	it("stores a name as typed, without trimming or folding", async () => {
		const { db, update } = fakeDb();
		await updateProfile(db, current, { name: "  Dana Ñ LOPEZ " });
		expect(update.mock.calls[0]?.[0].data.name).toBe("  Dana Ñ LOPEZ ");
	});

	it("takes the previous stored name back with a control character, cleaned", async () => {
		const { db, update } = fakeDb();
		await updateProfile(db, current, { name: "Da\u000bna\u0001" });
		expect(update.mock.calls[0]?.[0].data.name).toBe("Dana");
	});

	it("refuses a name that is nothing but controls", async () => {
		const { db, update } = fakeDb();
		await expect(
			updateProfile(db, current, { name: "\u000b\u0001" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(update).not.toHaveBeenCalled();
	});
});
