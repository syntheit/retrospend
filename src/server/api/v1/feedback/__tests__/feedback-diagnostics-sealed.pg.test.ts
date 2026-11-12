/**
 * The diagnostics sent with feedback (E2EE D11 PR 8.2) on Postgres, in both
 * suites. They copy error report text, so in the sealed suite the column is
 * a `{ sealed }` envelope under the instance key and its own row, with the
 * text nowhere in the row; an admin reads the same diagnostics on the web
 * (tRPC) and in v1, a body moved to another row fails instead of reading, a
 * row written before sealing still reads, and a crypto-shred of the sender
 * leaves it readable (the instance key is not the sender's).
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { openField } from "~/server/crypto/field-crypto";
import { createCallerFactory } from "~/server/api/trpc";
import { feedbackRouter } from "~/server/api/routers/feedback";
import { findInstanceKeyring } from "~/server/services/keys/instance-key.service";
import { destroyDataKeys } from "~/server/services/keys/data-key.service";
import { makeSession } from "~/test/trpc-test-utils";
import { sealedSuite } from "~/test/pg-harness";
import {
	adminDb,
	asKey,
	call,
	createTestUser,
	expectBody,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const f = contract.feedback;
const a = contract.admin;

const DIAGNOSTICS = {
	appVersion: "0.5.0",
	os: "Android 15",
	device: "Pixel 8",
	recentErrors: [
		{
			kind: "crash",
			message: "boom",
			stack: "TypeError: x\n    at f (index.bundle:5:6)",
			occurredAt: "2026-11-12T15:00:00.000Z",
		},
	],
};
const TEXTS = ["Android 15", "Pixel 8", "index.bundle"];

type Made = Awaited<ReturnType<typeof createTestUser>>;
let admin: Made;
let bob: Made;
let asAdmin: Record<string, string>;
let asBob: Record<string, string>;

beforeAll(async () => {
	admin = await createTestUser({ role: "ADMIN" });
	bob = await createTestUser();
	asAdmin = await asKey(admin.user.id, ["admin"]);
	asBob = await asKey(bob.user.id, ["read", "write:settings"]);
});

const submit = async (headers: Record<string, string>, message: string) =>
	(
		await expectBody<{ id: string }>(
			await call("/feedback", {
				method: "POST",
				headers,
				body: { message, pageUrl: "app:/x", diagnostics: DIAGNOSTICS },
				idempotent: true,
			}),
			f.submit,
			201,
		)
	).id;

type Stored = { diagnostics: unknown; text: string };

const atRest = async (id: string): Promise<Stored> => {
	const [row] = await adminDb.$queryRaw<Stored[]>`
		SELECT "diagnostics", "diagnostics"::text AS "text"
		FROM "feedback" WHERE "id" = ${id}`;
	if (!row) throw new Error(`no feedback ${id}`);
	return row;
};

const put = (id: string, value: unknown) =>
	adminDb.$executeRaw`UPDATE "feedback" SET "diagnostics" = ${JSON.stringify(value)}::jsonb WHERE "id" = ${id}`;

/** The entry as the admin's v1 inbox shows it. */
async function inboxEntry(id: string) {
	const inbox = await expectBody<{
		items: { id: string; diagnostics: unknown }[];
	}>(
		await call("/admin/feedback?limit=100", { headers: asAdmin }),
		a.listFeedback,
	);
	return inbox.items.find((i) => i.id === id);
}

const trpcAs = (u: Made, role: "ADMIN" | "USER") =>
	createCallerFactory(feedbackRouter)({
		session: makeSession({ id: u.user.id, name: u.user.name, role }),
		db: u.db,
		headers: new Headers(),
	});

describe("feedback diagnostics at rest", () => {
	it("are sealed on the instance key in the sealed suite, and the admin reads them in v1", async () => {
		const id = await submit(asBob, "The sheet jumps");
		const row = await atRest(id);
		for (const text of TEXTS)
			expect(row.text.includes(text)).toBe(!sealedSuite);
		if (sealedSuite) {
			const { sealed } = row.diagnostics as { sealed: string };
			expect(Object.keys(row.diagnostics as object)).toEqual(["sealed"]);
			expect(sealed.startsWith("\u0001k1:")).toBe(true);
			const ring = await findInstanceKeyring();
			if (!ring) throw new Error("no instance key");
			expect(
				JSON.parse(
					openField(ring, sealed, {
						table: "feedback",
						column: "diagnostics",
						rowId: id,
					}),
				),
			).toMatchObject({ os: "Android 15", device: "Pixel 8" });
		}

		const entry = await inboxEntry(id);
		expect(entry?.diagnostics).toMatchObject({
			appVersion: "0.5.0",
			os: "Android 15",
			device: "Pixel 8",
		});
		const shown = entry?.diagnostics as { recentErrors: unknown[] } | undefined;
		expect(JSON.stringify(shown?.recentErrors)).toContain(
			"at index.bundle:5:6",
		);
	});

	it("are read by the web inbox, and a status or note write leaves them as stored", async () => {
		const sent = await trpcAs(bob, "USER").submit({
			message: "Desde la web",
			pageUrl: "/budget",
			category: "bug",
			diagnostics: { os: "iOS 19", device: "iPhone15,4" },
		});
		const before = await atRest(sent.id);
		for (const text of ["iOS 19", "iPhone15"])
			expect(before.text.includes(text)).toBe(!sealedSuite);

		const caller = trpcAs(admin, "ADMIN");
		const listed = (await caller.list({ limit: 100 })).items.find(
			(i) => i.id === sent.id,
		);
		expect(listed?.diagnostics).toEqual({ os: "iOS 19", device: "iPhone15,4" });
		await caller.updateStatus({ id: sent.id, status: "read" });
		await caller.addNote({ id: sent.id, note: "llamar" });
		expect(await atRest(sent.id)).toEqual(before);
		await caller.delete({ id: sent.id });
		await expect(
			adminDb.feedback.findUnique({ where: { id: sent.id } }),
		).resolves.toBeNull();
	});
});

describe("a body moved to another row", () => {
	it.runIf(sealedSuite)(
		"fails the admin's read instead of showing another entry's diagnostics",
		async () => {
			const one = await submit(asBob, "Uno");
			const two = await submit(asBob, "Dos");
			const [first, second] = [await atRest(one), await atRest(two)];
			try {
				await put(two, first.diagnostics);
				await expect(
					adminDb.feedback.findUniqueOrThrow({ where: { id: two } }),
				).rejects.toMatchObject({ code: "auth_failed" });
			} finally {
				await put(two, second.diagnostics);
			}
			await expect(
				adminDb.feedback.findUniqueOrThrow({ where: { id: two } }),
			).resolves.toMatchObject({
				diagnostics: { os: "Android 15", device: "Pixel 8" },
			});
		},
	);
});

describe("an entry written before sealing", () => {
	it("still reads as plaintext in the admin's inbox", async () => {
		const id = await submit(asBob, "Viejo");
		const sealedRow = await atRest(id);
		try {
			await put(id, { os: "iOS 18", device: "iPhone14,2" });
			expect((await inboxEntry(id))?.diagnostics).toEqual({
				os: "iOS 18",
				device: "iPhone14,2",
			});
		} finally {
			await put(id, sealedRow.diagnostics);
		}
		expect((await inboxEntry(id))?.diagnostics).toMatchObject({
			os: "Android 15",
		});
	});
});

describe("a crypto-shred of the sender", () => {
	it("leaves the instance-keyed diagnostics readable by the admin", async () => {
		const sender = await createTestUser();
		const id = await submit(
			await asKey(sender.user.id, ["read", "write:settings"]),
			"Antes de borrar",
		);
		await destroyDataKeys(sender.user.id);
		expect((await inboxEntry(id))?.diagnostics).toMatchObject({
			os: "Android 15",
			device: "Pixel 8",
		});
	});
});
