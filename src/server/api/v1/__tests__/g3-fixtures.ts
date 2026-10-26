/**
 * Seeds for the G3 pg tests (people, shared expenses, payments, projects):
 * ARS home users, a Blue rate for ARS and BRL, and shares written straight
 * to the database so each test starts from a balance worked out by hand.
 */
import { dayKey } from "@retrospend/domain/time-zone";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, createTestUser } from "~/test/pg-harness";

export type TestUser = Awaited<ReturnType<typeof createTestUser>>;

export const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);

export const ref = (u: TestUser): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});

export const ars = (minor: number) => ({ minor, currency: "ARS" });

/** Blue per USD: ARS 1,355 and BRL 5, so BRL 1 = ARS 271. */
export async function seedRates() {
	for (const [currency, rate] of [
		["ARS", "1355"],
		["BRL", "5"],
	] as const) {
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: today, currency, type: "blue" } },
			create: { date: today, currency, type: "blue", rate },
			update: { rate },
		});
	}
}

/** A user whose home currency is ARS. */
export async function arsUser(): Promise<TestUser> {
	const u = await createTestUser();
	await adminDb.user.update({
		where: { id: u.user.id },
		data: { homeCurrency: "ARS" },
	});
	return u;
}

/** `payer` paid `amount`; `debtor` owes all of it. */
export async function seedShare(
	payer: ParticipantRef,
	debtor: ParticipantRef,
	amount: string,
	currency: string,
	opts: { projectId?: string; date?: string; title?: string } = {},
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: opts.title ?? "Shared",
			amount,
			currency,
			date: new Date(opts.date ?? "2026-10-08"),
			paidByType: payer.participantType,
			paidById: payer.participantId,
			createdByType: payer.participantType,
			createdById: payer.participantId,
			projectId: opts.projectId ?? null,
			splitParticipants: {
				create: [
					{ ...debtor, shareAmount: amount, verificationStatus: "ACCEPTED" },
					{ ...payer, shareAmount: "0", verificationStatus: "ACCEPTED" },
				],
			},
		},
	});
}

export async function seedProject(
	owner: TestUser,
	members: { user: TestUser; role: "EDITOR" | "CONTRIBUTOR" | "VIEWER" }[],
	currency = "ARS",
) {
	const project = await adminDb.project.create({
		data: {
			name: "Trip",
			createdById: owner.user.id,
			primaryCurrency: currency,
		},
	});
	await adminDb.projectParticipant.create({
		data: { projectId: project.id, ...ref(owner), role: "ORGANIZER" },
	});
	for (const m of members) {
		await adminDb.projectParticipant.create({
			data: { projectId: project.id, ...ref(m.user), role: m.role },
		});
	}
	return project.id;
}
