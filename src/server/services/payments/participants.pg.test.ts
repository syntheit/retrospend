/**
 * Payment headers follow their rows when the people on them are rewritten:
 * a shadow claimed, a guest session migrated to a user, an account deleted.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { claimShadowProfile } from "~/server/services/claim.service";
import { migrateGuestSessionsToUser } from "~/server/services/guest-migration.service";
import { forUser } from "~/server/services/preview";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import {
	anonymizeAndDeleteUser,
	DELETED_USER_SENTINEL,
} from "~/server/services/user-deletion.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { recordPayment } from "./record.mutation";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;
const ref = (u: TestUser): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});

/** `payer` paid 100 USD; `debtor` owes all of it. */
async function seedShare(payer: ParticipantRef, debtor: ParticipantRef, projectId?: string) {
	await adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			amount: "100",
			currency: "USD",
			date: new Date("2026-10-08"),
			paidByType: payer.participantType,
			paidById: payer.participantId,
			createdByType: payer.participantType,
			createdById: payer.participantId,
			projectId: projectId ?? null,
			splitParticipants: {
				create: [
					{ ...debtor, shareAmount: "100", verificationStatus: "ACCEPTED" },
					{ ...payer, shareAmount: "0", verificationStatus: "ACCEPTED" },
				],
			},
		},
	});
}

/** `me` records that `them` paid 40 USD (final at once). */
async function received(me: TestUser, them: ParticipantRef) {
	const result = await forUser(me.user.id).apply(recordPayment, {
		person: them,
		direction: "incoming",
		currency: "USD",
		amount: "40",
	});
	if (!result.value.recorded) throw new Error("not recorded");
	return result.value.paymentId;
}

const header = (id: string) => adminDb.payment.findUniqueOrThrow({ where: { id } });

let sofia: TestUser;

beforeAll(async () => {
	sofia = await createTestUser();
});

describe("payment headers follow participant rewrites", () => {
	it("a claimed shadow's payments name the user who claimed it", async () => {
		const shadow = await adminDb.shadowProfile.create({
			data: { createdById: sofia.user.id, name: "Paz" },
		});
		const paz: ParticipantRef = { participantType: "shadow", participantId: shadow.id };
		await seedShare(ref(sofia), paz);
		const paymentId = await received(sofia, paz);
		const claimer = await createTestUser();

		await claimShadowProfile(adminDb, shadow.id, claimer.user.id);

		expect(await header(paymentId)).toMatchObject({
			payerType: "user",
			payerId: claimer.user.id,
			payeeId: sofia.user.id,
		});
		const rows = await adminDb.settlement.findMany({ where: { paymentGroupId: paymentId } });
		expect(rows.every((r) => r.fromParticipantId === claimer.user.id)).toBe(true);
	});

	it("a migrated guest's payments name the user", async () => {
		const project = await adminDb.project.create({
			data: { name: "Trip", createdById: sofia.user.id },
		});
		const email = `${randomUUID()}@pg-test.invalid`;
		const session = await adminDb.guestSession.create({
			data: {
				name: "Guest",
				email,
				magicLinkId: randomUUID(),
				projectId: project.id,
				sessionToken: randomUUID(),
			},
		});
		const guest: ParticipantRef = { participantType: "guest", participantId: session.id };
		await adminDb.projectParticipant.create({
			data: { projectId: project.id, ...guest, role: "CONTRIBUTOR" },
		});
		await seedShare(ref(sofia), guest, project.id);
		const paymentId = await received(sofia, guest);
		const user = await createTestUser();

		await migrateGuestSessionsToUser(adminDb, user.user.id, email);

		expect(await header(paymentId)).toMatchObject({
			payerType: "user",
			payerId: user.user.id,
		});
	});

	it("a deleted account's payments are anonymized and its pending ones finalized with their rows", async () => {
		const martin = await createTestUser();
		await seedShare(ref(sofia), ref(martin));
		const result = await forUser(martin.user.id).apply(recordPayment, {
			person: ref(sofia),
			direction: "outgoing",
			currency: "USD",
			amount: "40",
		});
		if (!result.value.recorded) throw new Error("not recorded");
		const paymentId = result.value.paymentId;
		expect((await header(paymentId)).status).toBe("PROPOSED");

		await anonymizeAndDeleteUser(adminDb, martin.user.id, martin.user.email, null);

		const after = await header(paymentId);
		expect(after).toMatchObject({
			payerId: DELETED_USER_SENTINEL,
			recordedById: DELETED_USER_SENTINEL,
			payeeId: sofia.user.id,
			status: "FINALIZED",
		});
		const rows = await adminDb.settlement.findMany({ where: { paymentGroupId: paymentId } });
		expect(rows.map((r) => r.status)).toEqual(["FINALIZED"]);
	});
});
