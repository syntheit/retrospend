/**
 * A webhook's url is user text sealed with the instance key (E2EE D11
 * Revision 3 PR 2), because the worker opens it on the global client. With
 * sealing on, a master key and the instance key made here:
 *
 *   created and edited url                        -> `\u0001k1:` at rest, the plain url on the owner's list
 *   a delivery to a sealed url                    -> arrives at the host named in it
 *   six sealed webhooks of three users, one host  -> at most PER_HOST_ATTEMPTS sends at once
 *   two urls swapped between webhooks (AAD)       -> both fail `url_unreadable`, a third webhook in the batch delivers
 *   a failure on attempt 9 of 10                  -> FAILED, counted: the 5th terminal failure switches the webhook off
 *   a url sealed under a key id the ring lacks    -> `url_unreadable` with backoff, the owner's list fails
 *                                                    `encrypted_text_unavailable`; with the cell back it is delivered
 *   the instance key row gone (keystore_lost)     -> the owner's list and read fail, a delete still succeeds
 *   a plaintext url (legacy row, or sealing off)  -> delivers, and reads as it is
 *   an event for a webhook whose url is damaged   -> still fanned out, then `url_unreadable`
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	FieldCryptoError,
	Keyring,
	openField,
	sealField,
} from "~/server/crypto/field-crypto";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { setSealingForTests } from "~/server/crypto/sealing";
import { resetReloadsForTests } from "~/server/crypto/text-keys";
import { createUserScopedDb } from "~/server/db";
import type { Caller } from "~/server/services/api-v1/caller";
import { evictInstanceKeyring } from "~/server/services/keys/instance-key.service";
import {
	adminDb,
	createTestUser,
	openTransactionsEnded,
} from "~/test/pg-harness";
import {
	instanceKeyring,
	sealedFile,
	storedValue,
	unsealAll,
	writeCell,
} from "~/test/sealed-fixture";
import { MAX_ATTEMPTS, PER_HOST_ATTEMPTS } from "./schedule";
import { encryptSecret } from "./secret";
import {
	createWebhook,
	deleteWebhook,
	getWebhook,
	listWebhookPage,
	updateWebhook,
} from "./service";
import { pickDue, processDueDeliveries, runWebhookWorker } from "./worker";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

const SEALED = "\u0001k1:";
const NOW = new Date("2026-11-01T15:00:00Z");
const HOUR = 3_600_000;
const resolve = async () => ["127.0.0.1"];

describe("a webhook url sealed with the instance key", () => {
	let server: Server;
	let port: number;
	let running = 0;
	let peak = 0;
	let hosts: string[] = [];

	sealedFile(master);

	beforeAll(async () => {
		setSealingForTests(() => true);
		server = createServer((req, res) => {
			running += 1;
			peak = Math.max(peak, running);
			hosts.push(String(req.headers.host).split(":")[0] as string);
			setTimeout(() => {
				running -= 1;
				res.statusCode = 204;
				res.end();
			}, 40);
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		port = (server.address() as AddressInfo).port;
	});

	afterAll(async () => {
		setSealingForTests();
		await adminDb.webhookDelivery.deleteMany({});
		await adminDb.webhook.deleteMany({ where: { id: { in: made } } });
		await unsealAll();
		await new Promise<void>((r) => server.close(() => r()));
	});

	beforeEach(async () => {
		// The worker takes any due delivery, other files' leftovers included.
		await adminDb.webhookDelivery.deleteMany({});
		running = 0;
		peak = 0;
		hosts = [];
		resetReloadsForTests();
	});

	const made: string[] = [];
	const urlFor = (host: string) => `http://${host}:${port}/hook`;
	const sweep = (now = NOW) =>
		processDueDeliveries({ now, allowPrivate: true, resolve });

	function caller(userId: string): Caller {
		return {
			db: createUserScopedDb(userId),
			principal: {
				kind: "web",
				userId,
				role: "USER",
				scopes: [],
				sessionScopes: [],
				tokenId: "test",
				expiresAt: null,
				clientId: null,
			},
		};
	}

	/** A webhook made through the service, as its owner makes one. */
	async function create(userId: string, host: string) {
		const { webhook } = await createWebhook(
			caller(userId),
			{ name: host, url: urlFor(host), eventTypes: [] },
			{ allowPrivate: true, resolve },
		);
		made.push(webhook.id);
		return webhook;
	}

	/** A webhook row written on the owner's scoped client, as the extension seals it. */
	async function hook(userId: string, host: string) {
		const row = await createUserScopedDb(userId).webhook.create({
			data: {
				id: randomUUID(),
				userId,
				name: host,
				url: urlFor(host),
				eventTypes: [],
				secretCipher: encryptSecret("whsec_test"),
				secretStart: "whsec_test",
			},
			select: { id: true },
		});
		made.push(row.id);
		return row.id;
	}

	async function pending(userId: string, webhookId: string, attempts = 0) {
		const event = await adminDb.apiEvent.create({
			data: {
				userId,
				actorUserId: userId,
				type: "expense.created",
				payload: { ids: {}, amounts: [], truncated: false },
				fannedOutAt: NOW,
			},
		});
		const row = await adminDb.webhookDelivery.create({
			data: {
				webhookId,
				userId,
				eventId: event.id,
				eventType: "expense.created",
				nextAttemptAt: NOW,
				attempts,
			},
		});
		return row.id;
	}

	const delivery = (id: string) =>
		adminDb.webhookDelivery.findUniqueOrThrow({ where: { id } });

	async function ring() {
		return instanceKeyring(master.ring as Keyring);
	}

	async function storedUrl(webhookId: string): Promise<string> {
		return (await storedValue("webhook", "url", webhookId)) as string;
	}

	describe("writes and reads", () => {
		it("seals a created url and a sent delivery reaches the host in it", async () => {
			const { user } = await createTestUser();
			const hook = await create(user.id, "created.sealed.test");

			const stored = await storedUrl(hook.id);
			expect(stored.startsWith(SEALED)).toBe(true);
			expect(stored).not.toContain("created.sealed.test");
			expect(
				openField(await ring(), stored, {
					table: "webhook",
					column: "url",
					rowId: hook.id,
				}),
			).toBe(urlFor("created.sealed.test"));
			expect(hook.url).toBe(urlFor("created.sealed.test"));
			const listed = await listWebhookPage(caller(user.id), { limit: 10 });
			expect(listed.items.map((i) => i.url)).toEqual([
				urlFor("created.sealed.test"),
			]);

			const id = await pending(user.id, hook.id);
			expect(await sweep()).toBe(1);

			expect(hosts).toEqual(["created.sealed.test"]);
			expect(await delivery(id)).toMatchObject({
				status: "SUCCEEDED",
				attempts: 1,
				lastError: null,
			});
		});

		it("seals an edited url again, under the same row id", async () => {
			const { user } = await createTestUser();
			const { id } = await create(user.id, "before.sealed.test");
			const first = await storedUrl(id);

			const updated = await updateWebhook(
				caller(user.id),
				{ id, url: urlFor("after.sealed.test") },
				{ allowPrivate: true, resolve },
			);

			expect(updated.url).toBe(urlFor("after.sealed.test"));
			const stored = await storedUrl(id);
			expect(stored.startsWith(SEALED)).toBe(true);
			expect(stored).not.toBe(first);
			expect(
				(await getWebhook(caller(user.id), id)).url,
				"read back with the owner's client",
			).toBe(urlFor("after.sealed.test"));
			const queued = await pending(user.id, id);
			await sweep();
			expect(hosts).toEqual(["after.sealed.test"]);
			expect((await delivery(queued)).status).toBe("SUCCEEDED");
		});

		it("delivers and reads a plaintext url, a legacy row or sealing off", async () => {
			const { user } = await createTestUser();
			setSealingForTests(() => false);
			let plain: string;
			try {
				plain = (await create(user.id, "legacy.plain.test")).id;
			} finally {
				setSealingForTests(() => true);
			}
			expect(await storedUrl(plain)).toBe(urlFor("legacy.plain.test"));

			const listed = await listWebhookPage(caller(user.id), { limit: 10 });
			expect(listed.items[0]?.url).toBe(urlFor("legacy.plain.test"));
			const id = await pending(user.id, plain);
			await sweep();
			expect(hosts).toEqual(["legacy.plain.test"]);
			expect((await delivery(id)).status).toBe("SUCCEEDED");
			// A sealed webhook of the same user opens beside it.
			const sealed = await create(user.id, "next.sealed.test");
			expect((await storedUrl(sealed.id)).startsWith(SEALED)).toBe(true);
			const both = await listWebhookPage(caller(user.id), { limit: 10 });
			expect(both.items.map((i) => i.url).sort()).toEqual(
				[urlFor("legacy.plain.test"), urlFor("next.sealed.test")].sort(),
			);
		});
	});

	describe("the worker", () => {
		it("still limits sealed webhooks to PER_HOST_ATTEMPTS sends at once to one host", async () => {
			const ids: string[] = [];
			for (let u = 0; u < 3; u++) {
				const { user } = await createTestUser();
				for (let n = 0; n < 2; n++) {
					const id = await hook(user.id, "shared.sealed.test");
					ids.push(id);
					await pending(user.id, id);
				}
			}
			expect((await storedUrl(ids[0] as string)).startsWith(SEALED)).toBe(true);

			expect(await sweep()).toBe(6);

			expect(hosts).toHaveLength(6);
			expect(peak).toBe(PER_HOST_ATTEMPTS);
		});

		it("hands the opened url and its host on with each delivery", async () => {
			const { user } = await createTestUser();
			const id = await hook(user.id, "Once.Sealed.Test.");
			await pending(user.id, id);
			await pending(user.id, id);

			const due = await pickDue(NOW);

			expect(due).toHaveLength(2);
			expect(due.map((d) => d.url)).toEqual([
				urlFor("Once.Sealed.Test."),
				urlFor("Once.Sealed.Test."),
			]);
			expect(due.map((d) => d.host)).toEqual([
				"once.sealed.test",
				"once.sealed.test",
			]);
			// The name and the url are not part of the row the worker holds.
			expect(due[0]?.webhook).not.toHaveProperty("url");
			expect(due[0]?.webhook).not.toHaveProperty("name");
		});

		describe("a url that cannot be opened", () => {
			async function swapped() {
				const { user: ana } = await createTestUser();
				const { user: beto } = await createTestUser();
				const { user: cleo } = await createTestUser();
				const a = await hook(ana.id, "ana.swap.test");
				const b = await hook(beto.id, "beto.swap.test");
				const c = await hook(cleo.id, "cleo.swap.test");
				const urlA = await storedUrl(a);
				const urlB = await storedUrl(b);
				await writeCell("webhook", "url", a, urlB);
				await writeCell("webhook", "url", b, urlA);
				return {
					a,
					b,
					c,
					forA: await pending(ana.id, a),
					forB: await pending(beto.id, b),
					forC: await pending(cleo.id, c),
				};
			}

			it("fails only the deliveries of the damaged webhooks, as url_unreadable", async () => {
				const w = await swapped();
				const logged = vi.spyOn(console, "error").mockImplementation(() => {});

				expect(await sweep()).toBe(3);

				expect(await delivery(w.forC)).toMatchObject({
					status: "SUCCEEDED",
					lastError: null,
				});
				for (const id of [w.forA, w.forB])
					expect(await delivery(id)).toMatchObject({
						status: "PENDING",
						attempts: 1,
						lastError: "url_unreadable",
						lastStatusCode: null,
						nextAttemptAt: new Date(NOW.getTime() + 60_000),
					});
				expect(hosts).toEqual(["cleo.swap.test"]);
				// The failure names the cell and the code, never the text.
				expect(logged).toHaveBeenCalledWith("Sealed text could not be opened", {
					table: "webhook",
					column: "url",
					code: "auth_failed",
				});
				logged.mockRestore();
			});

			it("fails the owner's own read with auth_failed, not a fallback", async () => {
				const w = await swapped();
				const logged = vi.spyOn(console, "error").mockImplementation(() => {});
				const owner = (await adminDb.webhook.findUniqueOrThrow({
					where: { id: w.a },
					select: { userId: true },
				})) as { userId: string };

				const failure = await getWebhook(caller(owner.userId), w.a).catch(
					(e: unknown) => e,
				);

				expect(failure).toBeInstanceOf(FieldCryptoError);
				expect((failure as FieldCryptoError).code).toBe("auth_failed");
				logged.mockRestore();
			});

			it("counts the terminal failure, and the fifth switches the webhook off", async () => {
				const { user } = await createTestUser();
				const id = await hook(user.id, "count.swap.test");
				const other = await hook(user.id, "other.swap.test");
				await writeCell("webhook", "url", id, await storedUrl(other));
				await adminDb.$executeRaw`UPDATE "webhook" SET "consecutiveFailures" = 4 WHERE "id" = ${id}`;
				const last = await pending(user.id, id, MAX_ATTEMPTS - 1);
				const logged = vi.spyOn(console, "error").mockImplementation(() => {});

				await sweep();

				expect(await delivery(last)).toMatchObject({
					status: "FAILED",
					attempts: MAX_ATTEMPTS,
					lastError: "url_unreadable",
					nextAttemptAt: null,
				});
				expect(
					await adminDb.webhook.findUniqueOrThrow({
						where: { id },
						select: {
							enabled: true,
							consecutiveFailures: true,
							disabledReason: true,
						},
					}),
				).toEqual({
					enabled: false,
					consecutiveFailures: 5,
					disabledReason: "too_many_failures",
				});
				logged.mockRestore();
			});

			it("fans an event out to a webhook whose url is damaged, then settles it", async () => {
				const { user } = await createTestUser();
				const id = await hook(user.id, "fan.swap.test");
				const other = await hook(user.id, "fan.other.test");
				await writeCell("webhook", "url", id, await storedUrl(other));
				await adminDb.webhook.deleteMany({ where: { id: other } });
				await adminDb.apiEvent.create({
					data: {
						userId: user.id,
						actorUserId: user.id,
						type: "expense.created",
						payload: { ids: {}, amounts: [], truncated: false },
					},
				});
				const logged = vi.spyOn(console, "error").mockImplementation(() => {});

				await openTransactionsEnded();
				let rows: Awaited<ReturnType<typeof delivery>>[] = [];
				for (let i = 0; i < 60 && rows.length === 0; i++) {
					await runWebhookWorker({
						now: new Date(),
						allowPrivate: true,
						resolve,
					});
					rows = await adminDb.webhookDelivery.findMany({
						where: { webhookId: id },
					});
					if (rows.length === 0) await new Promise((r) => setTimeout(r, 100));
				}
				// Fanned out with the url unread; the sweep that follows settles it.
				expect(rows).toHaveLength(1);
				await sweep(new Date(Date.now() + 60_000));
				rows = await adminDb.webhookDelivery.findMany({
					where: { webhookId: id },
				});
				expect(rows[0]).toMatchObject({
					status: "PENDING",
					attempts: 1,
					lastError: "url_unreadable",
				});
				expect(hosts).toEqual([]);
				logged.mockRestore();
			});
		});

		describe("a url sealed under a key the instance ring lacks", () => {
			it("backs the delivery off as url_unreadable, fails the owner's list, and delivers once the cell is back", async () => {
				const { user } = await createTestUser();
				const { user: other } = await createTestUser();
				const id = await hook(user.id, "stranger.key.test");
				const fine = await hook(other.id, "fine.key.test");
				const original = await storedUrl(id);
				await writeCell(
					"webhook",
					"url",
					id,
					sealField(
						new Keyring([{ id: 7, key: randomBytes(32) }]),
						urlFor("stranger.key.test"),
						{ table: "webhook", column: "url", rowId: id },
					),
				);
				const queued = await pending(user.id, id);
				const meant = await pending(other.id, fine);
				const logged = vi.spyOn(console, "error").mockImplementation(() => {});

				expect(await sweep()).toBe(2);

				expect(await delivery(queued)).toMatchObject({
					status: "PENDING",
					attempts: 1,
					lastError: "url_unreadable",
				});
				expect((await delivery(meant)).status).toBe("SUCCEEDED");
				expect(hosts).toEqual(["fine.key.test"]);
				const failure = await listWebhookPage(caller(user.id), {
					limit: 10,
				}).catch((e: unknown) => e);
				expect(textUnavailableProblem(failure)).toBe(
					"encrypted_text_unavailable",
				);
				logged.mockRestore();

				await writeCell("webhook", "url", id, original);
				resetReloadsForTests();
				expect(await sweep(new Date(NOW.getTime() + HOUR))).toBe(1);
				expect(await delivery(queued)).toMatchObject({
					status: "SUCCEEDED",
					attempts: 2,
				});
				expect(hosts).toEqual(["fine.key.test", "stranger.key.test"]);
			});
		});
	});

	describe("with the instance key row gone (keystore_lost)", () => {
		it("fails the owner's list and read, yet deletes the webhook", async () => {
			const { user } = await createTestUser();
			const id = await hook(user.id, "gone.key.test");
			const rows = await adminDb.$queryRaw<
				{ keyId: number; wrappedKey: string; masterKeyId: bigint }[]
			>`SELECT "keyId", "wrappedKey", "masterKeyId" FROM keystore."instance_text_key"`;
			await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
			evictInstanceKeyring();
			const logged = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				for (const read of [
					() => listWebhookPage(caller(user.id), { limit: 10 }),
					() => getWebhook(caller(user.id), id),
				]) {
					const failure = await read().catch((e: unknown) => e);
					expect(textUnavailableProblem(failure)).toBe(
						"encrypted_text_unavailable",
					);
				}

				await expect(deleteWebhook(caller(user.id), id)).resolves.toEqual({
					ok: true,
				});
			} finally {
				for (const k of rows)
					await adminDb.$executeRaw`
						INSERT INTO keystore."instance_text_key" ("keyId", "wrappedKey", "masterKeyId")
						VALUES (${k.keyId}, ${k.wrappedKey}, ${k.masterKeyId})`;
				evictInstanceKeyring();
				resetReloadsForTests();
				logged.mockRestore();
			}
			expect(await adminDb.webhook.count({ where: { id } })).toBe(0);
		});
	});
});
