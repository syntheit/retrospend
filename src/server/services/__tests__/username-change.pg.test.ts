/**
 * Username change on Postgres. It is one owner-side service (the app role has
 * no access to username_history and cannot write `username` or
 * `lastUsernameChangeAt`): cooldown, availability, reservations, history and
 * the new name are checked and written in one transaction, and it edits other
 * users' reservation rows by design.
 */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { updateProfile } from "~/server/services/profile.service";
import {
	changeUsername,
	USERNAME_CHANGE_COOLDOWN_DAYS,
	USERNAME_RESERVATION_DAYS,
} from "~/server/services/username.service";
import { adminDb, createTestUser } from "~/test/pg-harness";

const DAY = 86_400_000;
const name = (label: string) => `${label}${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const stored = (id: string) =>
	adminDb.user.findUniqueOrThrow({
		where: { id },
		select: { username: true, lastUsernameChangeAt: true },
	});
const historyOf = (previousUsername: string) =>
	adminDb.usernameHistory.findUnique({ where: { previousUsername } });

describe("changeUsername", () => {
	it("writes the new name, the history row and the cooldown together", async () => {
		const { user } = await createTestUser();
		const next = name("fresh");

		await changeUsername(user.id, next);

		const after = await stored(user.id);
		expect(after.username).toBe(next);
		expect(after.lastUsernameChangeAt).not.toBeNull();
		expect(await historyOf(user.username)).toMatchObject({ userId: user.id });
	});

	it("refuses a second change inside the cooldown and allows one after it", async () => {
		const { user } = await createTestUser();
		const first = name("first");
		await changeUsername(user.id, first);

		await expect(changeUsername(user.id, name("second"))).rejects.toMatchObject(
			{ code: "TOO_MANY_REQUESTS" },
		);
		expect((await stored(user.id)).username).toBe(first);

		await adminDb.user.update({
			where: { id: user.id },
			data: {
				lastUsernameChangeAt: new Date(
					Date.now() - (USERNAME_CHANGE_COOLDOWN_DAYS + 1) * DAY,
				),
			},
		});
		const third = name("third");
		await changeUsername(user.id, third);
		expect((await stored(user.id)).username).toBe(third);
		expect(await historyOf(first)).toMatchObject({ userId: user.id });
	});

	it("refuses a name another user holds and changes nothing", async () => {
		const { user } = await createTestUser();
		const other = await createTestUser();

		await expect(
			changeUsername(user.id, other.user.username),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const after = await stored(user.id);
		expect(after.username).toBe(user.username);
		expect(after.lastUsernameChangeAt).toBeNull();
		expect(await historyOf(user.username)).toBeNull();
	});

	it("refuses a name another user released less than 90 days ago", async () => {
		const { user } = await createTestUser();
		const releaser = await createTestUser();
		const reserved = name("reserved");
		await adminDb.usernameHistory.create({
			data: {
				userId: releaser.user.id,
				previousUsername: reserved,
				changedAt: new Date(Date.now() - (USERNAME_RESERVATION_DAYS - 1) * DAY),
			},
		});

		await expect(changeUsername(user.id, reserved)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(await historyOf(reserved)).toMatchObject({
			userId: releaser.user.id,
		});
		expect((await stored(user.id)).username).toBe(user.username);
	});

	it("takes a name another user released more than 90 days ago, deleting their reservation", async () => {
		const { user } = await createTestUser();
		const releaser = await createTestUser();
		const expired = name("expired");
		await adminDb.usernameHistory.create({
			data: {
				userId: releaser.user.id,
				previousUsername: expired,
				changedAt: new Date(Date.now() - (USERNAME_RESERVATION_DAYS + 1) * DAY),
			},
		});

		await changeUsername(user.id, expired);

		expect((await stored(user.id)).username).toBe(expired);
		// The other user's row is gone, and the old name is now this user's.
		expect(await historyOf(expired)).toBeNull();
		expect(await historyOf(user.username)).toMatchObject({ userId: user.id });
	});

	it("lets a user take their own old name back", async () => {
		const { user } = await createTestUser();
		const original = user.username;
		await changeUsername(user.id, name("detour"));
		await adminDb.user.update({
			where: { id: user.id },
			data: { lastUsernameChangeAt: new Date(Date.now() - 31 * DAY) },
		});

		await changeUsername(user.id, original);

		expect((await stored(user.id)).username).toBe(original);
		expect(await historyOf(original)).toBeNull();
	});

	it("replaces a stale reservation of the name being left", async () => {
		const { user } = await createTestUser();
		const stranger = await createTestUser();
		// Someone held this name once, changed away, and the entry was never cleaned.
		await adminDb.usernameHistory.create({
			data: {
				userId: stranger.user.id,
				previousUsername: user.username,
				changedAt: new Date(Date.now() - 200 * DAY),
			},
		});

		await changeUsername(user.id, name("moved"));

		expect(await historyOf(user.username)).toMatchObject({ userId: user.id });
	});

	it("gives the name to one of two users who ask for it at once", async () => {
		const a = await createTestUser();
		const b = await createTestUser();
		const wanted = name("contested");

		const results = await Promise.allSettled([
			changeUsername(a.user.id, wanted),
			changeUsername(b.user.id, wanted),
		]);

		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const failed = results.find((r) => r.status === "rejected");
		expect(failed).toMatchObject({ reason: { code: "CONFLICT" } });
		const holders = await adminDb.user.count({ where: { username: wanted } });
		expect(holders).toBe(1);
	});

	it("applies one of two changes the same user makes at once", async () => {
		const { user } = await createTestUser();

		const results = await Promise.allSettled([
			changeUsername(user.id, name("one")),
			changeUsername(user.id, name("two")),
		]);

		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(results.find((r) => r.status === "rejected")).toMatchObject({
			reason: { code: "TOO_MANY_REQUESTS" },
		});
		expect(
			await adminDb.usernameHistory.count({ where: { userId: user.id } }),
		).toBe(1);
	});
});

describe("the same change from the app role", () => {
	it("cannot write the username or its history itself", async () => {
		const { user } = await createTestUser();
		await expect(
			userTransaction(adminDb, user.id, (tx) =>
				tx.user.update({
					where: { id: user.id },
					data: { username: name("direct") },
				}),
			),
		).rejects.toThrow(/permission denied/i);
		await expect(
			userTransaction(adminDb, user.id, (tx) =>
				tx.usernameHistory.deleteMany({}),
			),
		).rejects.toThrow(/permission denied/i);
	});
});

describe("updateProfile through a scoped client", () => {
	it("changes the username and the email, which the app role cannot write itself", async () => {
		const { user, db } = await createTestUser();
		await adminDb.account.create({
			data: {
				id: randomUUID(),
				accountId: user.id,
				providerId: "credential",
				userId: user.id,
				password: await hashPassword("Correct1horse"),
			},
		});
		const username = name("scoped");
		const email = `${randomUUID()}@pg-test.invalid`;

		const result = await updateProfile(
			db,
			{ id: user.id, username: user.username, email: user.email },
			{
				name: "Scoped Name",
				username,
				email,
				currentPassword: "Correct1horse",
			},
		);

		// The default test server has no email delivery, so the change applies at once.
		expect(result.emailChangePending).toBe(false);
		expect(result.user).toMatchObject({ name: "Scoped Name", username, email });
		expect(await historyOf(user.username)).toMatchObject({ userId: user.id });
	});

	it("refuses a new email without the right password before it changes the username", async () => {
		const { user, db } = await createTestUser();
		await adminDb.account.create({
			data: {
				id: randomUUID(),
				accountId: user.id,
				providerId: "credential",
				userId: user.id,
				password: await hashPassword("Correct1horse"),
			},
		});

		await expect(
			updateProfile(
				db,
				{ id: user.id, username: user.username, email: user.email },
				{
					username: name("never"),
					email: `${randomUUID()}@pg-test.invalid`,
					currentPassword: "Wrong1horse",
				},
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		const after = await stored(user.id);
		expect(after.username).toBe(user.username);
		expect(after.lastUsernameChangeAt).toBeNull();
	});
});
