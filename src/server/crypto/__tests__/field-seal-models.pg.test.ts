/**
 * Every mapped model seals what it writes (E2EE D11 PR 4.2, plan section 7):
 * with `sealing()` on, each write operation through the app's own clients
 * (user-class models through their owner's scoped client, instance-class
 * models through the global client) stores `\u0001k1:` ciphertext, and the
 * stored cell opens under its own (table, column, row id) with the key its
 * class names, never the other class's. Expected values are the plaintexts
 * written, read back raw and opened here, not computed by the code under test.
 */
import { randomUUID } from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { z } from "zod";
import { type Keyring, openField } from "~/server/crypto/field-crypto";
import { FIELD_MAP, type MappedModel } from "~/server/crypto/fields";
import { ID_DEFAULT, newCuid } from "~/server/crypto/row-id";
import { setSealingForTests } from "~/server/crypto/sealing";
import { resetReloadsForTests } from "~/server/crypto/text-keys";
import { createUserScopedDb, db } from "~/server/db";
import {
	type Ctx,
	ctxFor,
	type Data,
	delegateOf,
	SEEDERS,
	text,
} from "~/test/mapped-seeders";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	instanceKeyring,
	sealedFile,
	storedValue,
	unsealAll,
	userKeyring,
} from "~/test/sealed-fixture";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

sealedFile(master);
beforeAll(() => setSealingForTests(() => true));
afterAll(async () => {
	setSealingForTests();
	await unsealAll();
});
beforeEach(() => resetReloadsForTests());

const columnsOf = (model: MappedModel) =>
	Object.entries(
		FIELD_MAP[model].columns as Record<string, "user" | "instance">,
	);
const isUserClass = (model: MappedModel) =>
	columnsOf(model).some(([, cls]) => cls === "user");
const mappedOf = (model: MappedModel, row: unknown) =>
	Object.fromEntries(columnsOf(model).map(([c]) => [c, (row as Data)[c]]));

/** New text for every mapped column, plus a fresh name index for a category name. */
function newTexts(model: MappedModel): Data {
	const data: Data = Object.fromEntries(
		columnsOf(model).map(([c]) => [c, text(c)]),
	);
	if (model === "Category") data.nameIndex = `t:${randomUUID()}`;
	return data;
}

/** One set of parent rows per owner (a user has one personal book). */
const contexts = new Map<string, Ctx>();
const contextOf = (owner: string) => {
	const ctx = contexts.get(owner) ?? ctxFor(owner);
	contexts.set(owner, ctx);
	return ctx;
};

/** Seeder data with no id where the model's default makes one, so the seal path assigns it. */
async function seed(model: MappedModel, owner: string): Promise<Data> {
	const data = await SEEDERS[model](contextOf(owner));
	if (ID_DEFAULT[model] === "cuid") delete data.id;
	return { ...data, ...newTexts(model) };
}

const rowIds = async (model: MappedModel) =>
	new Set(
		(
			await adminDb.$queryRawUnsafe<{ id: string }[]>(
				`SELECT "id" FROM "${FIELD_MAP[model].table}"`,
			)
		).map((r) => r.id),
	);

/** Each mapped cell of the row is sealed at rest and opens to `plain` with its class's key only. */
async function expectSealed(
	model: MappedModel,
	owner: string,
	rowId: string,
	plain: Data,
) {
	const { table } = FIELD_MAP[model];
	const user = await userKeyring(owner, master.ring as Keyring);
	const instance = await instanceKeyring(master.ring as Keyring);
	for (const [column, cls] of columnsOf(model)) {
		const stored = (await storedValue(table, column, rowId)) as string;
		expect(stored.startsWith("\u0001k1:")).toBe(true);
		const aad = { table, column, rowId };
		const [own, other] = cls === "user" ? [user, instance] : [instance, user];
		expect(openField(own, stored, aad)).toBe(plain[column]);
		expect(() => openField(other, stored, aad)).toThrow();
	}
}

describe.each(Object.keys(FIELD_MAP) as MappedModel[])("%s", (model) => {
	let owner: string;
	let client: unknown;
	const d = () => delegateOf(client, model);

	beforeAll(async () => {
		owner = (await createTestUser()).user.id;
		client = isUserClass(model) ? createUserScopedDb(owner) : db;
	});

	it("seals a create under the id it is stored with, and reads it back", async () => {
		const data = await seed(model, owner);
		const row = (await d().create({ data })) as Data;
		const id = row.id as string;
		if (ID_DEFAULT[model] === "cuid")
			expect(z.cuid().safeParse(id).success).toBe(true);
		else expect(id).toBe(data.id);
		expect(mappedOf(model, row)).toEqual(mappedOf(model, data));
		await expectSealed(model, owner, id, data);
	});

	it("seals every row of createMany and createManyAndReturn", async () => {
		const many = [await seed(model, owner), await seed(model, owner)];
		const before = await rowIds(model);
		await d().createMany({ data: many });
		const added = [...(await rowIds(model))].filter((id) => !before.has(id));
		expect(added).toHaveLength(2);
		const plains = new Set(many.map((m) => JSON.stringify(mappedOf(model, m))));
		for (const id of added) {
			const read = mappedOf(model, await d().findUnique({ where: { id } }));
			expect(plains.has(JSON.stringify(read))).toBe(true);
			await expectSealed(model, owner, id, read);
		}
		const data = await seed(model, owner);
		const [row] = (await d().createManyAndReturn({ data: [data] })) as Data[];
		expect(mappedOf(model, row)).toEqual(mappedOf(model, data));
		await expectSealed(model, owner, row?.id as string, data);
	});

	it("seals an update and both halves of an upsert under the row's id", async () => {
		const row = (await d().create({ data: await seed(model, owner) })) as Data;
		const id = row.id as string;
		const changed = newTexts(model);
		expect(
			mappedOf(model, await d().update({ where: { id }, data: changed })),
		).toEqual(mappedOf(model, changed));
		await expectSealed(model, owner, id, changed);

		// The create half takes the where's id when its data names none.
		const fresh = newCuid();
		const { id: _ignored, ...create } = await seed(model, owner);
		await d().upsert({ where: { id: fresh }, create, update: {} });
		await expectSealed(model, owner, fresh, create);
		const updated = newTexts(model);
		await d().upsert({ where: { id: fresh }, create, update: updated });
		await expectSealed(model, owner, fresh, updated);
	});
});

describe("sealed cells are bound to their rows", () => {
	it("fails both reads after two rows' ciphertext is swapped, also with a warm cache", async () => {
		const me = (await createTestUser()).user.id;
		const scoped = createUserScopedDb(me);
		const swap = async (
			client: unknown,
			model: MappedModel,
			column: string,
			make: () => Promise<Data>,
		) => {
			const a = (await delegateOf(client, model).create({
				data: await make(),
			})) as Data;
			const b = (await delegateOf(client, model).create({
				data: await make(),
			})) as Data;
			const ids = [a.id as string, b.id as string];
			await delegateOf(client, model).findMany({ where: { id: { in: ids } } });
			const { table } = FIELD_MAP[model];
			const [x, y] = await Promise.all(
				ids.map((id) => storedValue(table, column, id)),
			);
			await adminDb.$executeRawUnsafe(
				`UPDATE "${table}" SET "${column}" = $1 WHERE "id" = $2`,
				y,
				ids[0],
			);
			await adminDb.$executeRawUnsafe(
				`UPDATE "${table}" SET "${column}" = $1 WHERE "id" = $2`,
				x,
				ids[1],
			);
			for (const id of ids)
				await expect(
					delegateOf(client, model).findUnique({ where: { id } }),
				).rejects.toMatchObject({ code: "auth_failed" });
		};
		await swap(scoped, "Expense", "title", () => seed("Expense", me));
		await swap(db, "SharedTransaction", "description", () =>
			seed("SharedTransaction", me),
		);
		await swap(db, "SharedTransaction", "receiptUrl", () =>
			seed("SharedTransaction", me),
		);
	});
});

describe("nested writes", () => {
	it("seals nested creates under their own new ids and a nested update under its where id", async () => {
		const me = (await createTestUser()).user.id;
		const data = await seed("SharedTransaction", me);
		const child = {
			participantType: "shadow",
			participantId: randomUUID(),
			shareAmount: "15000",
			rejectionReason: "not mine",
		};
		const created = await db.sharedTransaction.create({
			data: { ...data, splitParticipants: { create: [child] } } as never,
			include: { splitParticipants: true },
		});
		const [participant] = created.splitParticipants;
		expect(participant?.rejectionReason).toBe("not mine");
		const childId = participant?.id as string;
		expect(z.cuid().safeParse(childId).success).toBe(true);
		await expectSealed("SplitParticipant", me, childId, {
			rejectionReason: "not mine",
		});
		await expectSealed("SharedTransaction", me, created.id, data);

		await db.sharedTransaction.update({
			where: { id: created.id },
			data: {
				splitParticipants: {
					update: {
						where: { id: childId },
						data: { rejectionReason: "wrong amount" },
					},
				},
			},
		});
		await expectSealed("SplitParticipant", me, childId, {
			rejectionReason: "wrong amount",
		});
	});
});
