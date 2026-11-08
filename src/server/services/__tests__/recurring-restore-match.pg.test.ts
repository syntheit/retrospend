/**
 * The "made again by hand" check when a deleted recurring template is
 * restored (recurring-delete.mutation.ts), on real Postgres. It used to be
 * `name equals ... mode insensitive` in SQL; the names are now compared in
 * the app after opening them, so a name may be ciphertext. SQL still narrows
 * by user, active, amount, currency, frequency and direction.
 *
 * Behavior kept from the SQL, case by case (ARS home, a monthly 8,000.00):
 * case is ignored, trim and accents are not (`lower(name) = lower(value)`),
 * another amount, frequency, direction or an inactive twin does not count.
 * Each case runs for a plaintext and for a sealed name on both sides.
 * Preview equals the result, and a restore with no keyring refuses a sealed
 * twin instead of letting it through.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	FieldCryptoError,
	Keyring,
	sealField,
} from "~/server/crypto/field-crypto";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { arsUser, seedArsRates } from "../accounts/test-fixtures";
import {
	deleteRecurring,
	restoreRecurring,
	type TemplateSnapshot,
} from "../recurring-delete.mutation";

const keyring = new Keyring([{ id: 1, key: Buffer.alloc(32, 7) }]);

beforeAll(seedArsRates);

const seal = (text: string, id: string) =>
	sealField(keyring, text, {
		table: "recurringTemplate",
		column: "name",
		rowId: id,
	});

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
			name: sealed ? seal(name, id) : name,
			amount: f.amount ?? "8000",
			currency: "ARS",
			frequency: f.frequency ?? "MONTHLY",
			direction: f.direction ?? "OUT",
			nextDueDate: new Date("2027-01-15T12:00:00Z"),
			isActive: f.isActive ?? true,
		},
	});
	return id;
}

/** Deletes a template through the mutation and returns its snapshot. */
async function deleted(userId: string, name: string, sealed: boolean) {
	const id = await template(userId, name, sealed);
	const done = await forUser(userId, keyring).apply(deleteRecurring, {
		templateId: id,
	});
	return done.value as TemplateSnapshot;
}

const restore = (userId: string, t: TemplateSnapshot, withKeyring = true) =>
	forUser(userId, withKeyring ? keyring : undefined).apply(restoreRecurring, {
		template: t,
	});

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

	it("restoring keeps the sealed name as it was, readable under the same row id", async () => {
		const u = (await arsUser()).user.id;
		const snap = await deleted(u, "Gym", true);
		await restore(u, snap);
		const row = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: snap.id },
		});
		expect(row.name).toBe(snap.name);
		expect(row.name.startsWith("\u0001")).toBe(true);
	});

	it("the preview equals the result and writes nothing", async () => {
		const u = (await arsUser()).user.id;
		const snap = await deleted(u, "Gym", true);
		const preview = await forUser(u, keyring).preview(restoreRecurring, {
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
		await forUser(u, keyring).apply(deleteRecurring, { templateId: snap.id });
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(0);
	});

	it("a sealed twin with no keyring is an error, never a silent pass", async () => {
		const u = (await arsUser()).user.id;
		const snap = await deleted(u, "Gym", false);
		await template(u, "Gym", true);
		await expect(restore(u, snap, false)).rejects.toBeInstanceOf(
			FieldCryptoError,
		);
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: u } }),
		).resolves.toBe(1);
	});
});
