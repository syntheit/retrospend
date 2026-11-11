/**
 * The "made again by hand" check when a deleted recurring template is
 * restored (recurring-delete.mutation.ts), on real Postgres. It used to be
 * `name equals ... mode insensitive` in SQL, which is an unescaped ILIKE; the
 * names are now compared in the app, as the client opened them on read
 * (field-open.ts), so a stored name may be sealed. SQL still narrows by user, active, amount, currency, frequency
 * and direction.
 *
 * Case by case (ARS home, a monthly 8,000.00): case is ignored, trim and
 * accents are not, and `%`, `_` and backslash are literal. That last part is
 * a deliberate change: under ILIKE "Gym 50%" conflicted with "Gym 50% off",
 * "Rent_A" with "Rent-A", and `A\B` did not conflict with `a\b`. Another
 * amount, frequency, direction or an inactive twin does not count.
 * Each case runs for a plaintext and for a sealed name on both sides.
 * Preview equals the result, and a sealed twin whose key is lost refuses the
 * restore instead of letting it through.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Keyring } from "~/server/crypto/field-crypto";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { evictDataKeyring } from "~/server/services/keys/data-key.service";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { sealedFile, sealText } from "~/test/sealed-fixture";
import { arsUser, seedArsRates } from "../accounts/test-fixtures";
import {
	deleteRecurring,
	restoreRecurring,
	type TemplateSnapshot,
} from "../recurring-delete.mutation";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));
sealedFile(master);

beforeAll(seedArsRates);

type Fields = {
	amount?: string;
	frequency?: "MONTHLY" | "YEARLY";
	direction?: "IN" | "OUT";
	isActive?: boolean;
};

async function template(
	userId: string,
	name: string,
	sealed: boolean,
	f: Fields = {},
) {
	const id = crypto.randomUUID();
	await adminDb.recurringTemplate.create({
		data: {
			id,
			userId,
			name,
			amount: f.amount ?? "8000",
			currency: "ARS",
			frequency: f.frequency ?? "MONTHLY",
			direction: f.direction ?? "OUT",
			nextDueDate: new Date("2027-01-15T12:00:00Z"),
			isActive: f.isActive ?? true,
		},
	});
	if (sealed)
		await sealText(
			master.ring as Keyring,
			{ table: "recurring_template", column: "name", rowId: id },
			name,
		);
	return id;
}

/** Deletes a template through the mutation and returns its snapshot. */
async function deleted(userId: string, name: string, sealed: boolean) {
	const id = await template(userId, name, sealed);
	const done = await forUser(userId).apply(deleteRecurring, {
		templateId: id,
	});
	return done.value as TemplateSnapshot;
}

const restore = (userId: string, t: TemplateSnapshot) =>
	forUser(userId).apply(restoreRecurring, { template: t });

describe.each([
	["plaintext names", false],
	["sealed names", true],
] as const)("restore twin check, %s", (_label, sealed) => {
	it("refuses a template made again by hand, ignoring case", async () => {
		const u = (await arsUser()).user.id;
		const snap = await deleted(u, "Streamly", sealed);
		await template(u, "STREAMLY", sealed);
		await expect(restore(u, snap)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(1);
	});

	it("does not trim or fold accents: Streamly, Streamly with a space and Streamlý are three", async () => {
		const u = (await arsUser()).user.id;
		const snap = await deleted(u, "Streamly", sealed);
		await template(u, "Streamly ", sealed);
		await template(u, "Streamlý", sealed);
		await restore(u, snap);
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(3);
	});

	it("is not a twin when the amount, frequency, direction or activity differ", async () => {
		const u = (await arsUser()).user.id;
		const snap = await deleted(u, "Streamly", sealed);
		await template(u, "streamly", sealed, { amount: "8001" });
		await template(u, "streamly", sealed, { frequency: "YEARLY" });
		await template(u, "streamly", sealed, { direction: "IN" });
		await template(u, "streamly", sealed, { isActive: false });
		await restore(u, snap);
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(5);
	});

	it("pattern characters are literal: % _ and backslash", async () => {
		const u = (await arsUser()).user.id;
		// Not twins (they were under ILIKE): the pattern characters match only themselves.
		const gym = await deleted(u, "Gym 50%", sealed);
		await template(u, "Gym 50% off", sealed);
		const rent = await deleted(u, "Rent_A", sealed);
		await template(u, "Rent-A", sealed);
		await restore(u, gym);
		await restore(u, rent);
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(4);
		// Twins: the same characters, any case.
		const v = (await arsUser()).user.id;
		const back = await deleted(v, "A\\B", sealed);
		await template(v, "a\\b", sealed);
		await expect(restore(v, back)).rejects.toMatchObject({ code: "CONFLICT" });
		const w = (await arsUser()).user.id;
		const pct = await deleted(w, "Gym 50%", sealed);
		await template(w, "GYM 50%", sealed);
		await expect(restore(w, pct)).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("another user's template of the same name is not a twin", async () => {
		const u = (await arsUser()).user.id;
		const other = (await arsUser()).user.id;
		const snap = await deleted(u, "Streamly", sealed);
		await template(other, "Streamly", sealed);
		await restore(u, snap);
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(1);
	});

	it("an inactive snapshot restores even beside a twin", async () => {
		const u = (await arsUser()).user.id;
		const snap = { ...(await deleted(u, "Streamly", sealed)), isActive: false };
		await template(u, "Streamly", sealed);
		await restore(u, snap);
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(2);
	});
});

describe("restore twin check, mixed names", () => {
	it("a sealed snapshot meets a plaintext twin, and the reverse", async () => {
		const u = (await arsUser()).user.id;
		const sealedSnap = await deleted(u, "Gym", true);
		const twin = await template(u, "gym", false);
		await expect(restore(u, sealedSnap)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await adminDb.recurringTemplate.delete({ where: { id: twin } });
		await restore(u, sealedSnap);

		const v = (await arsUser()).user.id;
		const plainSnap = await deleted(v, "Gym", false);
		await template(v, "GYM", true);
		await expect(restore(v, plainSnap)).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("restoring writes the name the delete read, opened, under the same row id", async () => {
		const u = (await arsUser()).user.id;
		const snap = await deleted(u, "Gym", true);
		// The snapshot comes from a client read, which opened it; PR 4 seals writes.
		expect(snap.name).toBe("Gym");
		await restore(u, snap);
		const row = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: snap.id },
		});
		expect(row.name).toBe("Gym");
	});

	it("the preview equals the result and writes nothing", async () => {
		const u = (await arsUser()).user.id;
		const snap = await deleted(u, "Gym", true);
		const preview = await forUser(u).preview(restoreRecurring, {
			template: snap,
		});
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(0);
		const applied = await restore(u, snap);
		expect(applied.changes).toEqual(preview.changes);
		expect(applied.unchanged).toEqual(preview.unchanged);
		expect(applied.undo).toMatchObject({ mutation: "recurring.delete" });
		// The undo of the restore deletes it again.
		await forUser(u).apply(deleteRecurring, { templateId: snap.id });
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(0);
	});

	it("a sealed twin whose key is lost is an error, never a silent pass", async () => {
		const u = (await arsUser()).user.id;
		const snap = await deleted(u, "Gym", false);
		await template(u, "Gym", true);
		await adminDb.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${u}`;
		evictDataKeyring(u);
		vi.spyOn(console, "error").mockImplementation(() => {});
		// A figure reads the template first, and carries the error as its cause.
		// The first try is retryable while the keys reload in the background.
		const first = await restore(u, snap).catch((e: unknown) => e);
		expect(textUnavailableProblem(first)).toBe("key_rotated");
		await vi.waitFor(async () => {
			const again = await restore(u, snap).catch((e: unknown) => e);
			expect(textUnavailableProblem(again)).toBe("encrypted_text_unavailable");
		});
		vi.restoreAllMocks();
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(1);
	});
});
