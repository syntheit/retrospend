/**
 * Email availability and the guest-data migration hooks on email
 * verification / direct email change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
	DATABASE_URL: "postgresql://mock",
	NODE_ENV: "test",
	BETTER_AUTH_SECRET: "secret",
	NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	SMTP_HOST: undefined as string | undefined,
}));
const mockSettings = vi.hoisted(() => ({ enableEmail: true }));
const mockMigrate = vi.hoisted(() => vi.fn());
const mockDb = vi.hoisted(() => ({
	user: { update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
	account: { findFirst: vi.fn() },
	verificationToken: { findFirst: vi.fn(), delete: vi.fn() },
}));

vi.mock("~/env", () => ({ env: mockEnv }));
vi.mock("~/server/db", () => ({
	db: mockDb as never,
	createUserScopedDb: vi.fn(() => mockDb),
}));
vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("better-auth/crypto", () => ({
	hashPassword: vi.fn(),
	verifyPassword: vi.fn().mockResolvedValue(true),
}));
vi.mock("~/server/services/settings", () => ({
	getAppSettings: vi.fn(async () => mockSettings),
}));
vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn() }));
vi.mock("~/server/storage", () => ({ getImageUrl: vi.fn(() => null) }));
vi.mock("~/server/services/username.service", () => ({
	validateAndProcessUsernameChange: vi.fn(),
}));
vi.mock("~/server/services/guest-migration.service", () => ({
	migrateGuestDataForVerifiedUser: mockMigrate,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { makeSession } from "~/test/trpc-test-utils";
import { authRouter } from "../auth";
import { profileRouter } from "../profile";

async function callAndFlush<T>(fn: () => Promise<T>): Promise<T> {
	const promise = fn();
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	mockEnv.SMTP_HOST = undefined;
	mockSettings.enableEmail = true;
});

afterEach(() => {
	vi.useRealTimers();
});

describe("isEmailDeliveryEnabled", () => {
	it("is off without SMTP", async () => {
		expect(await isEmailDeliveryEnabled()).toBe(false);
	});

	it("is off when SMTP is set but the admin turned email off", async () => {
		mockEnv.SMTP_HOST = "smtp.test";
		mockSettings.enableEmail = false;
		expect(await isEmailDeliveryEnabled()).toBe(false);
	});

	it("is on with SMTP and email enabled", async () => {
		mockEnv.SMTP_HOST = "smtp.test";
		expect(await isEmailDeliveryEnabled()).toBe(true);
	});
});

describe("auth.verifyEmail", () => {
	it("redeems a token and migrates guest data even after email was turned off", async () => {
		mockEnv.SMTP_HOST = "smtp.test";
		mockSettings.enableEmail = false;
		mockDb.verificationToken.findFirst.mockResolvedValue({
			identifier: "owner@example.com",
			token: "tok",
		});
		mockDb.user.update.mockResolvedValue({ id: "user-1" });

		const caller = createCallerFactory(authRouter)({
			session: null,
			db: mockDb as never,
			headers: new Headers(),
		});
		await callAndFlush(() => caller.verifyEmail({ token: "tok" }));

		expect(mockDb.user.update).toHaveBeenCalledWith(
			expect.objectContaining({ data: { emailVerified: true } }),
		);
		expect(mockMigrate).toHaveBeenCalledWith(mockDb, "user-1", expect.anything());
	});
});

describe("profile.update direct email change", () => {
	it("migrates guest data for the new address when email is off", async () => {
		mockDb.account.findFirst.mockResolvedValue({ password: "hash" });
		mockDb.user.findFirst.mockResolvedValue(null);
		mockDb.user.update.mockResolvedValue({
			id: "user-1",
			name: "Owner",
			username: "owner",
			email: "new@example.com",
		});

		const caller = createCallerFactory(profileRouter)({
			session: makeSession({
				id: "user-1",
				email: "old@example.com",
				username: "owner",
			}),
			db: mockDb as never,
			headers: new Headers(),
		});
		await callAndFlush(() =>
			caller.update({
				name: "Owner",
				username: "owner",
				email: "new@example.com",
				currentPassword: "pw",
			}),
		);

		expect(mockDb.user.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ email: "new@example.com" }),
			}),
		);
		expect(mockMigrate).toHaveBeenCalledWith(mockDb, "user-1");
	});

	it("does not run the migration when only the name changes", async () => {
		mockDb.user.update.mockResolvedValue({ id: "user-1" });
		const caller = createCallerFactory(profileRouter)({
			session: makeSession({
				id: "user-1",
				email: "old@example.com",
				username: "owner",
			}),
			db: mockDb as never,
			headers: new Headers(),
		});
		await callAndFlush(() =>
			caller.update({
				name: "New Name",
				username: "owner",
				email: "old@example.com",
			}),
		);
		expect(mockMigrate).not.toHaveBeenCalled();
	});
});
