/**
 * Notifications are worded when they are read (E2EE D11 PR 8.4): the row
 * keeps ids, codes and minor amounts, never a name or a sentence. Both
 * readers, /api/v1/notifications and the tRPC list, word each kind in the
 * reader's current language, with the actor's current name and "Someone"
 * once that person is gone. Run in the sealed suite too, where names are
 * sealed under the instance key and the batched lookup has to open them.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { notificationRouter } from "~/server/api/routers/notification";
import { createCallerFactory } from "~/server/api/trpc";
import type { ActorRef, Notice } from "~/server/services/notification-text";
import { createNotification } from "~/server/services/notifications";
import { makeSession } from "~/test/trpc-test-utils";
import type { NotificationType } from "~prisma";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	fixtureDb,
} from "../../core/__tests__/harness";

const sendEmail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("~/server/mailer", () => ({ sendEmail }));
vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type Row = {
	type: string;
	title: string;
	body: string;
	data: Record<string, unknown> | null;
};

/** The money formatter joins code and number with a no-break space. */
const plain = (text: string) => text.replaceAll(" ", " ");

// Hand-derived (ARS has 2 decimals): 12,345.50 is 1_234_550 minor, 49,382.00
// is 4_938_200, 1,000 is 100_000 and 1,500 is 150_000. es-AR groups with
// dots and separates decimals with a comma.
const ars = { minor: 1_234_550, currency: "ARS" };
const arsTotal = { minor: 4_938_200, currency: "ARS" };
const edit = {
	amount: {
		from: { minor: 100_000, currency: "ARS" },
		to: { minor: 150_000, currency: "ARS" },
	},
	payer: true,
};

interface Case {
	kind: Notice["kind"];
	type: NotificationType;
	extra?: Partial<Notice>;
	actor?: "ana" | "gus";
	en: [title: string, body: string];
	es: [title: string, body: string];
	changes?: { en: string; es: string };
}

// One row per kind that has a caller (the 13 createNotification sites make
// these 18 kinds; projectInvite and guestResume are email only).
const CASES: Case[] = [
	{
		kind: "expenseSplit",
		type: "EXPENSE_SPLIT",
		extra: { amount: { money: ars }, total: arsTotal },
		en: [
			"New shared expense",
			"Ana split an expense with you, your share is ARS 12,345.50 of ARS 49,382",
		],
		es: [
			"Nuevo gasto compartido",
			"Ana dividió un gasto con vos, tu parte es ARS 12.345,50 de ARS 49.382",
		],
	},
	{
		kind: "expenseEdited",
		type: "EXPENSE_EDITED",
		extra: { changes: edit },
		en: ["Expense updated", "Ana updated an expense you share"],
		es: ["Gasto actualizado", "Ana actualizó un gasto que compartís"],
		changes: {
			en: "amount: ARS 1,000 to ARS 1,500, payer changed",
			es: "monto: ARS 1.000 a ARS 1.500, quien pagó modificado",
		},
	},
	{
		kind: "expenseDeleted",
		type: "EXPENSE_DELETED",
		extra: { amount: { money: ars } },
		en: ["Expense deleted", "Ana deleted an expense of ARS 12,345.50"],
		es: ["Gasto eliminado", "Ana eliminó un gasto de ARS 12.345,50"],
	},
	{
		kind: "paymentRecordedByPayee",
		type: "SETTLEMENT_CONFIRMED",
		extra: { amount: { money: ars, currencies: 2 } },
		en: [
			"Payment recorded",
			"Ana recorded receiving your payment of ARS 12,345.50 across 2 currencies",
		],
		es: [
			"Pago registrado",
			"Ana registró que recibió tu pago de ARS 12.345,50 en 2 monedas",
		],
	},
	{
		kind: "settlementReceived",
		type: "SETTLEMENT_RECEIVED",
		extra: { amount: { money: ars } },
		en: ["Settlement received", "Ana sent you a settlement of ARS 12,345.50"],
		es: [
			"Liquidación recibida",
			"Ana te envió una liquidación de ARS 12.345,50",
		],
	},
	{
		kind: "settlementConfirmed",
		type: "SETTLEMENT_CONFIRMED",
		extra: { amount: { money: ars, offset: true } },
		en: [
			"Settlement confirmed",
			"Ana confirmed your settlement with an offset of ARS 12,345.50",
		],
		es: [
			"Liquidación confirmada",
			"Ana confirmó tu liquidación con una compensación de ARS 12.345,50",
		],
	},
	{
		kind: "settlementRejected",
		type: "SETTLEMENT_REJECTED",
		en: ["Settlement rejected", "Ana rejected your settlement"],
		es: ["Liquidación rechazada", "Ana rechazó tu liquidación"],
	},
	{
		kind: "settlementReminder",
		type: "PAYMENT_REMINDER",
		extra: { amount: { money: ars } },
		en: [
			"Settlement reminder",
			"Ana is reminding you about a settlement of ARS 12,345.50",
		],
		es: [
			"Recordatorio de liquidación",
			"Ana te recuerda una liquidación de ARS 12.345,50",
		],
	},
	{
		kind: "balanceReminder",
		type: "PAYMENT_REMINDER",
		en: ["Payment reminder", "Ana reminded you about an outstanding balance"],
		es: ["Recordatorio de pago", "Ana te recordó un saldo pendiente"],
	},
	{
		kind: "squaredUp",
		type: "SETTLEMENT_RECEIVED",
		extra: { amount: { money: ars, offset: true } },
		en: [
			"Project balances offset",
			"Ana offset ARS 12,345.50 across your project balances, no money moved",
		],
		es: [
			"Saldos de proyectos saldados",
			"Ana saldó tus saldos de proyectos con una compensación de ARS 12.345,50, no se movió plata",
		],
	},
	{
		kind: "periodClosed",
		type: "PERIOD_CLOSED",
		en: ["Period closed", "Ana closed a period in a project you are in"],
		es: ["Período cerrado", "Ana cerró un período en un proyecto en el que estás"],
	},
	{
		kind: "addedToProject",
		type: "PARTICIPANT_ADDED",
		en: ["Added to project", "Ana added you to a project"],
		es: ["Sumado a un proyecto", "Ana te sumó a un proyecto"],
	},
	{
		kind: "ownershipTransferred",
		type: "PARTICIPANT_ADDED",
		en: ["Ownership transferred", "Ana transferred a project to you"],
		es: ["Propiedad transferida", "Ana te transfirió un proyecto"],
	},
	{
		kind: "profileClaimed",
		type: "PARTICIPANT_ADDED",
		actor: "gus",
		en: [
			"Profile claimed",
			"Gus joined a project and claimed a profile there",
		],
		es: [
			"Perfil reclamado",
			"Gus se unió a un proyecto y reclamó un perfil ahí",
		],
	},
	{
		kind: "fixRequested",
		type: "VERIFICATION_REQUEST",
		en: ["Fix requested", "Ana asked you to fix an expense"],
		es: ["Corrección solicitada", "Ana te pidió que corrijas un gasto"],
	},
	{
		kind: "fixAccepted",
		type: "EXPENSE_EDITED",
		en: ["Fix accepted", "Ana will fix the expense you asked about"],
		es: [
			"Corrección aceptada",
			"Ana va a corregir el gasto por el que preguntaste",
		],
	},
	{
		kind: "fixDeclined",
		type: "EXPENSE_EDITED",
		en: ["Fix declined", "Ana will not change the expense you asked about"],
		es: [
			"Corrección rechazada",
			"Ana no va a cambiar el gasto por el que preguntaste",
		],
	},
	{
		kind: "splitCorrected",
		type: "EXPENSE_EDITED",
		en: ["Expense corrected", "Ana added a correction to an expense you share"],
		es: [
			"Gasto corregido",
			"Ana agregó una corrección a un gasto que compartís",
		],
	},
];

async function user(name: string, language = "en") {
	const made = await createTestUser();
	await fixtureDb.user.update({
		where: { id: made.user.id },
		data: { name },
	});
	await adminDb.user.update({ where: { id: made.user.id }, data: { language } });
	return made.user.id;
}

async function guest(name: string) {
	const row = await adminDb.guestSession.create({
		data: {
			name,
			email: `${name.toLowerCase()}@pg-test.invalid`,
			magicLinkId: "ml-84",
			projectId: "p-84",
			sessionToken: `tok-${Math.random()}`,
		},
	});
	return row.id;
}

const tag = (kind: string) => `tx-${kind}`;

/** What /api/v1/notifications returns for the user. */
async function viaV1(userId: string): Promise<Row[]> {
	const page = await expectBody<{ items: Row[] }>(
		await call("/notifications?limit=100", { headers: await asMobile(userId) }),
		contract.notifications.list,
	);
	return page.items;
}

/** What the tRPC list returns for the user. */
async function viaTrpc(userId: string): Promise<Row[]> {
	const caller = createCallerFactory(notificationRouter)({
		session: makeSession({ id: userId }),
		db: adminDb,
		headers: new Headers(),
	} as never);
	return (await caller.list({ limit: 50 })).items as unknown as Row[];
}

const readers = { v1: viaV1, trpc: viaTrpc };
const byTag = (rows: Row[], kind: string) =>
	rows.find((r) => r.data?.transactionId === tag(kind));

describe("notifications are worded at read time", () => {
	let ana: string;
	let gus: string;
	let sofia: string;
	const actors = () =>
		({ ana: { type: "user", id: ana }, gus: { type: "guest", id: gus } }) as Record<
			"ana" | "gus",
			ActorRef
		>;

	beforeAll(async () => {
		ana = await user("Ana");
		gus = await guest("Gus");
		sofia = await user("Sofía");
		for (const c of CASES)
			await createNotification({
				userId: sofia,
				type: c.type,
				notice: {
					kind: c.kind,
					actor: actors()[c.actor ?? "ana"],
					...c.extra,
				},
				data: { transactionId: tag(c.kind) },
			});
	});

	it("keeps no name and no sentence in the row", async () => {
		const rows = await adminDb.notification.findMany({
			where: { userId: sofia },
		});
		expect(rows).toHaveLength(CASES.length);
		for (const row of rows) {
			expect(row.title).toBe("");
			expect(row.body).toBe("");
		}
		const stored = JSON.stringify(rows.map((r) => r.data));
		expect(stored).not.toMatch(/Ana|Gus|Sofía/);
		// The edit summary is a sentence: it is made when read, not kept.
		expect(stored).not.toContain("payer changed");
		const edited = rows.find(
			(r) => (r.data as { notice: { kind: string } }).notice.kind === "expenseEdited",
		);
		expect(edited?.data).toEqual({
			transactionId: tag("expenseEdited"),
			notice: { kind: "expenseEdited", actor: { type: "user", id: ana }, changes: edit },
		});
	});

	for (const [name, read] of Object.entries(readers)) {
		it(`${name}: words every kind in English, then in Spanish after the reader's language changes`, async () => {
			const en = await read(sofia);
			expect(en).toHaveLength(CASES.length);
			for (const c of CASES) {
				const row = byTag(en, c.kind);
				expect(row?.type, c.kind).toBe(c.type);
				expect([row?.title, plain(row?.body ?? "")], c.kind).toEqual(c.en);
				expect(row?.data?.notice, c.kind).toBeUndefined();
				expect(row?.data?.transactionId).toBe(tag(c.kind));
				const changes = row?.data?.changes;
				expect(
					typeof changes === "string" ? plain(changes) : changes,
					c.kind,
				).toEqual(c.changes?.en);
			}

			await adminDb.user.update({
				where: { id: sofia },
				data: { language: "es-AR" },
			});
			const es = await read(sofia);
			for (const c of CASES) {
				const row = byTag(es, c.kind);
				expect([row?.title, plain(row?.body ?? "")], c.kind).toEqual(c.es);
				const changes = row?.data?.changes;
				expect(
					typeof changes === "string" ? plain(changes) : changes,
					c.kind,
				).toEqual(c.changes?.es);
			}
			await adminDb.user.update({
				where: { id: sofia },
				data: { language: "en" },
			});
		});
	}

	for (const [name, read] of Object.entries(readers)) {
		it(`${name}: shows the actor's current name, and Someone once the account or guest is gone`, async () => {
			const reader = await user("Reader");
			const bea = await user("Bea");
			const guestId = await guest("Gil");
			const shadow = await adminDb.shadowProfile.create({
				data: { createdById: bea, name: "Dana" },
			});
			const send = (id: string, actor: ActorRef) =>
				createNotification({
					userId: reader,
					type: "PERIOD_CLOSED",
					notice: { kind: "periodClosed", actor },
					data: { periodId: id },
				});
			await send("by-bea", { type: "user", id: bea });
			await send("by-gil", { type: "guest", id: guestId });
			await send("by-dana", { type: "shadow", id: shadow.id });
			await send("by-nobody", { type: "user", id: "DELETED_USER" });
			const body = async (id: string) =>
				(await read(reader)).find((r) => r.data?.periodId === id)?.body;

			expect(await body("by-bea")).toBe("Bea closed a period in a project you are in");
			expect(await body("by-gil")).toBe("Gil closed a period in a project you are in");
			expect(await body("by-dana")).toBe("Dana closed a period in a project you are in");
			expect(await body("by-nobody")).toBe(
				"Someone closed a period in a project you are in",
			);

			await fixtureDb.user.update({
				where: { id: bea },
				data: { name: "Beatriz" },
			});
			await fixtureDb.shadowProfile.update({
				where: { id: shadow.id },
				data: { name: "Daniela" },
			});
			expect(await body("by-bea")).toBe(
				"Beatriz closed a period in a project you are in",
			);
			expect(await body("by-dana")).toBe(
				"Daniela closed a period in a project you are in",
			);

			// A guest session goes with its 90 days or its owner's sign-up.
			await adminDb.guestSession.delete({ where: { id: guestId } });
			await adminDb.user.delete({ where: { id: bea } });
			expect(await body("by-gil")).toBe(
				"Someone closed a period in a project you are in",
			);
			expect(await body("by-bea")).toBe(
				"Someone closed a period in a project you are in",
			);
			// Another reader's language does not leak in.
			await adminDb.user.update({
				where: { id: reader },
				data: { language: "es" },
			});
			expect(await body("by-bea")).toBe(
				"Alguien cerró un período en un proyecto en el que participas",
			);
		});
	}

	for (const [name, read] of Object.entries(readers)) {
		it(`${name}: a row from before keeps its stored text and its stored summary`, async () => {
			const reader = await user("Old reader", "es-AR");
			await adminDb.notification.create({
				data: {
					userId: reader,
					type: "EXPENSE_EDITED",
					title: "Expense updated",
					body: "Ana updated an expense you share",
					data: { transactionId: "legacy", changes: "amount: ARS 1,000 to ARS 1,500" },
				},
			});
			const [row] = await read(reader);
			expect(row).toMatchObject({
				title: "Expense updated",
				body: "Ana updated an expense you share",
				data: { transactionId: "legacy", changes: "amount: ARS 1,000 to ARS 1,500" },
			});
		});
	}

	it("uses the reader's number format when the language stays", async () => {
		const reader = await user("Formatter");
		await adminDb.user.update({
			where: { id: reader },
			data: { numberFormat: "dot_comma" },
		});
		await createNotification({
			userId: reader,
			type: "EXPENSE_DELETED",
			notice: {
				kind: "expenseDeleted",
				actor: { type: "user", id: ana },
				amount: { money: ars },
			},
		});
		const [row] = await viaTrpc(reader);
		expect(plain(row?.body ?? "")).toBe("Ana deleted an expense of ARS 12.345,50");
		const [viaApi] = await viaV1(reader);
		expect(plain(viaApi?.body ?? "")).toBe("Ana deleted an expense of ARS 12.345,50");
	});

	it("still words the email at send time, with the actor's name", async () => {
		const reader = await user("Mailer");
		sendEmail.mockClear();
		await createNotification({
			userId: reader,
			type: "EXPENSE_DELETED",
			notice: {
				kind: "expenseDeleted",
				actor: { type: "user", id: ana },
				amount: { money: { minor: 450_000, currency: "ARS" } },
			},
		});
		const sent = sendEmail.mock.calls as unknown as [string, string, string][];
		expect(sent).toHaveLength(1);
		expect(sent[0]?.[1]).toBe("Retrospend: Expense deleted");
		expect(plain(sent[0]?.[2] ?? "")).toContain(
			"Ana deleted an expense of ARS 4,500",
		);
	});
});
