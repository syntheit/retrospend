/**
 * Every mapped model reads its sealed cells back as plaintext through every
 * walked operation (E2EE D11 PR 3.2, plan test 7). Rows are written as
 * plaintext, then sealed in place with raw SQL (src/test/sealed-fixture.ts),
 * and read through the app's own clients: user-class models through their
 * owner's scoped client, instance-class models through the global client.
 *
 * Expected values are the plaintexts the seeder wrote, nothing computed:
 * each read must return them, and nothing sealed at rest is read back raw.
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
import type { Keyring } from "~/server/crypto/field-crypto";
import { FIELD_MAP, type MappedModel } from "~/server/crypto/fields";
import { resetReloadsForTests } from "~/server/crypto/text-keys";
import { createUserScopedDb, db } from "~/server/db";
import { runtimeDataModel } from "~/server/db-core";
import { evictInstanceKeyring } from "~/server/services/keys/instance-key.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	newMasterKeyring,
	restoreCells,
	sealRow,
} from "~/test/sealed-fixture";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

async function resetInstanceKey() {
	evictInstanceKeyring();
	await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
	await adminDb.$executeRaw`UPDATE "app_settings" SET "instanceKeySince" = NULL`;
}
beforeAll(async () => {
	await resetInstanceKey();
	master.ring = newMasterKeyring();
});
afterAll(async () => {
	await restoreCells();
	await resetInstanceKey();
});
beforeEach(() => resetReloadsForTests());

const day = new Date("2026-11-02T12:00:00Z");
const text = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

/** Parents a seeder needs, made once per owner. */
interface Ctx {
	owner: string;
	project: () => Promise<string>;
	book: () => Promise<string>;
	envelope: () => Promise<string>;
	sharedTx: () => Promise<string>;
	shadow: () => Promise<string>;
	magicLink: () => Promise<string>;
}

const once = <T>(make: () => Promise<T>) => {
	let made: Promise<T> | undefined;
	return () => {
		made ??= make();
		return made;
	};
};

function ctxFor(owner: string): Ctx {
	const project = once(
		async () =>
			(
				await adminDb.project.create({
					data: { name: "P", createdById: owner },
				})
			).id,
	);
	const book = once(
		async () =>
			(
				await adminDb.budgetBook.create({
					data: {
						currency: "ARS",
						startDate: day,
						startMonth: 202611,
						createdById: owner,
					},
				})
			).id,
	);
	const envelope = once(
		async () =>
			(
				await adminDb.envelope.create({
					data: { bookId: await book(), name: "E", sortOrder: 0 },
				})
			).id,
	);
	const sharedTx = once(
		async () =>
			(
				await adminDb.sharedTransaction.create({
					data: {
						description: "S",
						amount: "15000",
						currency: "ARS",
						date: day,
						paidByType: "user",
						paidById: owner,
						createdByType: "user",
						createdById: owner,
						projectId: await project(),
					},
				})
			).id,
	);
	const shadow = once(
		async () =>
			(
				await adminDb.shadowProfile.create({
					data: { createdById: owner, name: "Ana" },
				})
			).id,
	);
	const magicLink = once(
		async () =>
			(
				await adminDb.magicLink.create({
					data: { projectId: await project(), createdById: owner },
				})
			).id,
	);
	return { owner, project, book, envelope, sharedTx, shadow, magicLink };
}

type Data = Record<string, unknown>;

/**
 * Fresh create data per call (unique values where the schema needs them),
 * with every mapped column set. A mapped model with no seeder fails below.
 */
const SEEDERS: Record<MappedModel, (c: Ctx) => Promise<Data>> = {
	Apikey: async (c) => ({
		id: randomUUID(),
		referenceId: c.owner,
		key: randomUUID(),
		createdAt: day,
		updatedAt: day,
		name: text("key"),
	}),
	AssetAccount: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		name: text("Savings"),
		type: "CASH",
		currency: "ARS",
		balance: "250000",
	}),
	BillingPeriod: async (c) => ({
		id: randomUUID(),
		projectId: await c.project(),
		label: text("November"),
		startDate: day,
		endDate: day,
	}),
	BudgetBook: async (c) => ({
		id: randomUUID(),
		// One personal book per user; shared books have no such limit.
		isPersonal: false,
		currency: "ARS",
		startDate: day,
		startMonth: 202611,
		createdById: c.owner,
		name: text("Home book"),
	}),
	BudgetMovement: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		month: 202611,
		amount: "5000",
		kind: "ASSIGN",
		actorUserId: c.owner,
		toEnvelopeId: await c.envelope(),
		note: text("top up"),
	}),
	Category: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		name: text("Food"),
		color: "blue",
	}),
	Envelope: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		name: text("Groceries"),
		sortOrder: 1,
	}),
	EnvelopeGroup: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		name: text("Needs"),
		sortOrder: 1,
	}),
	EnvelopeChange: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		kind: "UPDATE",
		before: {},
		actorUserId: c.owner,
		previousName: text("Old name"),
	}),
	Expense: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		title: text("Rent"),
		description: text("November"),
		location: text("Buenos Aires"),
		amount: "150000",
		currency: "ARS",
		date: day,
		amountInUSD: "100",
		exchangeRate: "1500",
		pricingSource: "MANUAL",
	}),
	ExportJob: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		kind: "project_csv",
		params: {},
		timeZone: "UTC",
		expiresAt: day,
		fileName: text("trip.csv"),
	}),
	Feedback: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		message: text("Love it"),
		pageUrl: "/",
		adminNote: text("Thanks"),
	}),
	FixRequest: async (c) => ({
		id: randomUUID(),
		transactionId: await c.sharedTx(),
		requestedByType: "user",
		requestedById: c.owner,
		askedType: "shadow",
		askedId: await c.shadow(),
		message: text("Wrong amount"),
		reply: text("Fixed"),
	}),
	GuestSession: async (c) => ({
		id: randomUUID(),
		name: text("Guest"),
		email: `${randomUUID()}@pg-test.invalid`,
		magicLinkId: await c.magicLink(),
		projectId: await c.project(),
		sessionToken: randomUUID(),
	}),
	ImportJob: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		type: "CSV",
		fileName: text("bank.csv"),
		fileSize: 1,
		fileType: "text/csv",
	}),
	IncomeRule: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		sortOrder: 0,
		name: text("Salary"),
		matchTitle: text("ACME"),
		action: "PERCENT",
		envelopeId: await c.envelope(),
	}),
	Payment: async (c) => ({
		id: randomUUID(),
		payerType: "user",
		payerId: c.owner,
		payeeType: "shadow",
		payeeId: await c.shadow(),
		amount: "7500",
		currency: "ARS",
		paidOn: day,
		recordedByType: "user",
		recordedById: c.owner,
		note: text("for dinner"),
		paymentMethod: text("Mercado Pago"),
	}),
	PaymentMethod: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		type: "bank",
		rank: 0,
		label: text("Bank"),
		identifier: text("CBU 123"),
	}),
	Project: async (c) => ({
		id: randomUUID(),
		createdById: c.owner,
		name: text("Trip"),
		description: text("Bariloche"),
	}),
	RecurringTemplate: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		name: text("Gym"),
		amount: "20000",
		currency: "ARS",
		frequency: "MONTHLY",
		nextDueDate: day,
		paymentSource: text("Visa"),
		websiteUrl: text("https://gym.example"),
	}),
	PushDevice: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		platform: "IOS",
		transport: "APNS",
		token: randomUUID(),
		addressHash: randomUUID(),
		deviceName: text("iPhone"),
	}),
	Settlement: async (c) => ({
		id: randomUUID(),
		fromParticipantType: "user",
		fromParticipantId: c.owner,
		toParticipantType: "shadow",
		toParticipantId: await c.shadow(),
		amount: "7500",
		currency: "ARS",
		projectId: await c.project(),
		note: text("cash"),
		paymentMethod: text("Efectivo"),
		rejectedReason: text("not yet"),
	}),
	ShadowProfile: async (c) => ({
		id: randomUUID(),
		createdById: c.owner,
		name: text("Luis"),
	}),
	SharedTransaction: async (c) => ({
		id: randomUUID(),
		description: text("Dinner"),
		notes: text("with wine"),
		amount: "30000",
		currency: "ARS",
		date: day,
		paidByType: "user",
		paidById: c.owner,
		createdByType: "user",
		createdById: c.owner,
		projectId: await c.project(),
	}),
	SplitParticipant: async (c) => ({
		id: randomUUID(),
		transactionId: await c.sharedTx(),
		participantType: "shadow",
		participantId: randomUUID(),
		shareAmount: "7500",
		rejectionReason: text("not mine"),
	}),
	Transfer: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		kind: "TRANSFER",
		date: day,
		fromAmount: "10000",
		fromCurrency: "ARS",
		toAmount: "10000",
		toCurrency: "ARS",
		note: text("to savings"),
	}),
	User: async () => {
		const id = randomUUID();
		return {
			id,
			name: text("Marta"),
			username: `u_${id.replaceAll("-", "")}`,
			email: `${id}@pg-test.invalid`,
		};
	},
	WealthTransfer: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		direction: "TO_WEALTH",
		date: day,
		amount: "5000",
		actorUserId: c.owner,
		note: text("to the fund"),
	}),
	Webhook: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		name: text("Zapier"),
		url: "https://hooks.example/x",
		secretCipher: "x",
		secretStart: "x",
	}),
};

type Delegate = Record<string, (args: unknown) => Promise<unknown>>;
const delegateOf = (client: unknown, model: string): Delegate =>
	(client as Record<string, Delegate>)[
		model[0]?.toLowerCase() + model.slice(1)
	] as Delegate;

const isUserClass = (model: MappedModel) =>
	Object.values(FIELD_MAP[model].columns as Record<string, string>).includes(
		"user",
	);

/** The mapped values of a row, for comparison. */
const mappedOf = (model: MappedModel, row: unknown) =>
	Object.fromEntries(
		Object.keys(FIELD_MAP[model].columns).map((c) => [c, (row as Data)[c]]),
	);

/**
 * A model that owns `model`'s row through a to-one relation, with the field
 * that lists it back (same relation name), read from the runtime data model.
 */
function parentLink(model: string) {
	const models = runtimeDataModel().models as unknown as Record<
		string,
		{
			fields: {
				name: string;
				kind: string;
				type: string;
				relationName?: string;
			}[];
		}
	>;
	return (models[model]?.fields ?? [])
		.filter((f) => f.kind === "object" && f.type !== model)
		.flatMap((f) => {
			const parent = models[f.type];
			const back = parent?.fields.find(
				(g) =>
					g.kind === "object" &&
					g.type === model &&
					g.relationName === f.relationName,
			);
			return back && parent?.fields.some((g) => g.name === "id")
				? [{ field: f.name, parent: f.type, back: back.name }]
				: [];
		});
}

describe("the seeder table", () => {
	it("has a seeder for every mapped model", () => {
		expect(Object.keys(SEEDERS).sort()).toEqual(Object.keys(FIELD_MAP).sort());
	});
});

describe.each(Object.keys(FIELD_MAP) as MappedModel[])("%s", (model) => {
	let ctx: Ctx;
	let client: unknown;
	let rowId: string;
	let plain: Record<string, string>;

	beforeAll(async () => {
		const { user } = await createTestUser();
		ctx = ctxFor(user.id);
		client = isUserClass(model) ? createUserScopedDb(user.id) : db;
		const created = (await delegateOf(adminDb, model).create({
			data: await SEEDERS[model](ctx),
		})) as Data;
		rowId = created.id as string;
		plain = await sealRow(
			master.ring as Keyring,
			FIELD_MAP[model].table,
			rowId,
		);
		expect(Object.keys(plain).sort()).toEqual(
			Object.keys(FIELD_MAP[model].columns).sort(),
		);
	});

	const d = () => delegateOf(client, model);
	const where = () => ({ id: rowId });

	it("reads plaintext through findMany, findFirst and findUnique", async () => {
		const [many] = (await d().findMany({ where: where() })) as Data[];
		expect(mappedOf(model, many)).toEqual(plain);
		expect(mappedOf(model, await d().findFirst({ where: where() }))).toEqual(
			plain,
		);
		expect(mappedOf(model, await d().findUnique({ where: where() }))).toEqual(
			plain,
		);
	});

	it("reads a select without id, and adds nothing to the result", async () => {
		const select = Object.fromEntries(
			Object.keys(FIELD_MAP[model].columns).map((c) => [c, true]),
		);
		expect(await d().findUnique({ where: where(), select })).toEqual(plain);
	});

	it("reads through a nested select from a parent row", async () => {
		const select = Object.fromEntries(
			Object.keys(FIELD_MAP[model].columns).map((c) => [c, true]),
		);
		let read = false;
		for (const link of parentLink(model)) {
			const own = (await delegateOf(adminDb, model).findUnique({
				where: where(),
				select: { [link.field]: { select: { id: true } } },
			})) as Data;
			const parentId = (own[link.field] as Data | null)?.id;
			if (typeof parentId !== "string") continue;
			const parent = (await delegateOf(client, link.parent).findFirst({
				where: { id: parentId },
				select: { [link.back]: { select } },
			})) as Data | null;
			if (!parent) continue;
			const nested = [parent[link.back]].flat() as Data[];
			expect(nested).toContainEqual(plain);
			read = true;
			break;
		}
		if (read) return;
		// No parent row: read it under a child row that points to it.
		if (model === "User") {
			await adminDb.feedback.create({
				data: { userId: rowId, message: "Hi", pageUrl: "/" },
			});
			const row = await db.feedback.findFirst({
				where: { userId: rowId },
				select: { user: { select } },
			});
			expect(row?.user).toEqual(plain);
		} else if (model === "Payment") {
			const child = (await adminDb.settlement.create({
				data: { ...(await SEEDERS.Settlement(ctx)), paymentGroupId: rowId },
			})) as Data;
			const row = await db.settlement.findUnique({
				where: { id: child.id as string },
				select: { payment: { select } },
			});
			expect(row?.payment).toEqual(plain);
		} else {
			// No relation of any model reaches it, so it cannot be read nested.
			expect(model).toBe("GuestSession");
			const models = Object.values(runtimeDataModel().models);
			expect(models.some((m) => m.fields.some((f) => f.type === model))).toBe(
				false,
			);
		}
	});

	it("reads mixed plaintext and sealed rows in one findMany", async () => {
		const data = await SEEDERS[model](ctx);
		const other = (await delegateOf(adminDb, model).create({ data })) as Data;
		const rows = (await d().findMany({
			where: { id: { in: [rowId, other.id] } },
		})) as Data[];
		const byId = new Map(rows.map((r) => [r.id, mappedOf(model, r)]));
		expect(byId.get(rowId)).toEqual(plain);
		expect(byId.get(other.id)).toEqual(mappedOf(model, data));
	});

	it("passes plaintext through create and createManyAndReturn", async () => {
		const one = await SEEDERS[model](ctx);
		expect(mappedOf(model, await d().create({ data: one }))).toEqual(
			mappedOf(model, one),
		);
		const many = await SEEDERS[model](ctx);
		const [returned] = (await d().createManyAndReturn({
			data: [many],
		})) as Data[];
		expect(mappedOf(model, returned)).toEqual(mappedOf(model, many));
	});

	it("opens the row returned by update, upsert and delete", async () => {
		expect(
			mappedOf(model, await d().update({ where: where(), data: {} })),
		).toEqual(plain);
		const create = await SEEDERS[model](ctx);
		expect(
			mappedOf(model, await d().upsert({ where: where(), create, update: {} })),
		).toEqual(plain);
		// A user row is deleted through the global client; RLS has no policy for it.
		const deleter = model === "User" ? delegateOf(db, model) : d();
		expect(mappedOf(model, await deleter.delete({ where: where() }))).toEqual(
			plain,
		);
	});
});
