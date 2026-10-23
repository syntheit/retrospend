/**
 * Settings v2 saves one field at a time: a write names only what changed,
 * so an Undo or a quick second change never sends another field's older
 * value (the home currency, the username). Admins cannot delete their own
 * account, whatever the page shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";

const mockDb = vi.hoisted(() => ({}) as ReturnType<typeof createMockDb>);
const usernames = vi.hoisted(() => ({ validate: vi.fn() }));

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));
vi.mock("~/server/db", () => ({
	db: mockDb as never,
	createUserScopedDb: vi.fn(() => mockDb),
}));
vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("~/server/lib/email-delivery", () => ({
	isEmailDeliveryEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/server/services/username.service", () => ({
	validateAndProcessUsernameChange: usernames.validate,
}));

import { createCallerFactory } from "~/server/api/trpc";
import {
	callAndFlush,
	makeAdminSession,
	makeSession,
} from "~/test/trpc-test-utils";
import { profileRouter } from "../profile";
import { settingsRouter } from "../settings";
import { userRouter } from "../user";

const ctx = (session = makeSession({ id: "user-1", username: "sofi" })) => ({
	session,
	db: mockDb as never,
	headers: new Headers(),
});

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	Object.assign(mockDb, createMockDb(), {
		account: { findFirst: vi.fn().mockResolvedValue(null) },
	});
	mockDb.user.update.mockResolvedValue({ id: "user-1" });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("settings.updateGeneral", () => {
	const caller = () => createCallerFactory(settingsRouter)(ctx());

	it("writes only the field it is given, never the home currency", async () => {
		await callAndFlush(() =>
			caller().updateGeneral({ smartCurrencyFormatting: false }),
		);
		const data = mockDb.user.update.mock.calls[0]?.[0].data;
		expect(data).toEqual({ smartCurrencyFormatting: false });
	});

	it("still writes the home currency when that is the change", async () => {
		await callAndFlush(() => caller().updateGeneral({ homeCurrency: "ARS" }));
		expect(mockDb.user.update.mock.calls[0]?.[0].data).toEqual({
			homeCurrency: "ARS",
		});
	});
});

describe("profile.update", () => {
	const caller = () => createCallerFactory(profileRouter)(ctx());

	it("a name change sends no username, so it can never revert one", async () => {
		await callAndFlush(() => caller().update({ name: "Sofía" }));
		expect(usernames.validate).not.toHaveBeenCalled();
		const data = mockDb.user.update.mock.calls[0]?.[0].data;
		expect(data).toMatchObject({ name: "Sofía" });
		expect(data.username).toBeUndefined();
		expect(data).not.toHaveProperty("email");
	});

	it("a username change is checked and written alone", async () => {
		await callAndFlush(() => caller().update({ username: "Sofia2" }));
		expect(usernames.validate).toHaveBeenCalledWith(
			mockDb,
			"user-1",
			"sofi",
			"sofia2",
		);
		const data = mockDb.user.update.mock.calls[0]?.[0].data;
		expect(data).toMatchObject({ username: "sofia2" });
		expect(data.name).toBeUndefined();
	});
});

describe("user.deleteAccount", () => {
	it("refuses an admin before it checks the password", async () => {
		const caller = createCallerFactory(userRouter)(
			ctx(makeAdminSession({ id: "admin-1" })),
		);
		await expect(
			callAndFlush(() => caller.deleteAccount({ password: "whatever" })),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		const db = mockDb as unknown as { account: { findFirst: unknown } };
		expect(db.account.findFirst).not.toHaveBeenCalled();
	});
});
