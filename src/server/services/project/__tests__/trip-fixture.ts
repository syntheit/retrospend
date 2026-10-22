/**
 * A small shared project on a real Postgres, for the project router
 * characterization tests and the summary pg tests. Every amount is chosen so
 * the expected figures can be derived by hand (see the table below).
 *
 * Members of "Floripa" (BRL, public): Ana (owner), Ben (editor), Cam
 * (contributor), and Sam, a person Ana added who is not on Retrospend.
 *
 * | Expense | Total     | Paid by | Split                       | Notes            |
 * |---------|-----------|---------|-----------------------------|------------------|
 * | Hotel   | BRL 300   | Ana     | Ana 100, Ben 100, Cam 100   | Cam pending      |
 * | Car     | BRL 90    | Ben     | Ana 30, Ben 30, Sam 30      |                  |
 * | Boat    | USD 50    | Cam     | Ana 20, Cam 30 (exact)      |                  |
 * | Dinner  | BRL 60    | Ana     | Ana 30, Ben 30              | locked (settled) |
 *
 * Payments: Ben paid Ana BRL 40 (finalized). Ana paid Cam USD 5, rejected,
 * so it never counts.
 */
import { createHash, randomUUID } from "node:crypto";
import { projectRouter } from "~/server/api/routers/project";
import { createCallerFactory } from "~/server/api/trpc";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type {
	ParticipantType,
	ProjectRole,
	SplitMode,
	VerificationStatus,
} from "~prisma";

const createCaller = createCallerFactory(projectRouter);

export type TestUser = Awaited<ReturnType<typeof createTestUser>>;

export async function namedUser(name: string): Promise<TestUser> {
	const created = await createTestUser();
	const user = await adminDb.user.update({
		where: { id: created.user.id },
		data: { name },
	});
	return { ...created, user };
}

/** A tRPC caller signed in as `user`, through the real procedures (RLS on). */
export function callerFor(user: TestUser["user"]) {
	return createCaller({
		db: adminDb,
		session: {
			user: {
				id: user.id,
				role: user.role,
				email: user.email,
				name: user.name,
				isActive: true,
			},
		} as never,
		headers: new Headers(),
	});
}

/** A caller with no session, optionally carrying a guest token or viewer link. */
export function anonymousCaller(headers: Record<string, string> = {}) {
	return createCaller({
		db: adminDb,
		session: null,
		headers: new Headers(headers),
	});
}

interface SplitSeed {
	type: ParticipantType;
	id: string;
	share: string;
	status?: VerificationStatus;
}

interface ExpenseSeed {
	description: string;
	amount: string;
	currency: string;
	date: string;
	paidBy: { type: ParticipantType; id: string };
	createdBy?: { type: ParticipantType; id: string };
	splitMode?: SplitMode;
	isLocked?: boolean;
	categoryId?: string;
	splits: SplitSeed[];
}

export async function seedExpense(projectId: string, seed: ExpenseSeed) {
	const createdBy = seed.createdBy ?? seed.paidBy;
	return adminDb.sharedTransaction.create({
		data: {
			description: seed.description,
			amount: seed.amount,
			currency: seed.currency,
			date: new Date(`${seed.date}T12:00:00Z`),
			splitMode: seed.splitMode ?? "EQUAL",
			isLocked: seed.isLocked ?? false,
			categoryId: seed.categoryId ?? null,
			paidByType: seed.paidBy.type,
			paidById: seed.paidBy.id,
			createdByType: createdBy.type,
			createdById: createdBy.id,
			projectId,
			splitParticipants: {
				create: seed.splits.map((s) => ({
					participantType: s.type,
					participantId: s.id,
					shareAmount: s.share,
					verificationStatus: s.status ?? "ACCEPTED",
				})),
			},
		},
	});
}

export async function addMember(
	projectId: string,
	type: ParticipantType,
	id: string,
	role: ProjectRole,
) {
	return adminDb.projectParticipant.create({
		data: { projectId, participantType: type, participantId: id, role },
	});
}

export async function seedTrip() {
	const ana = await namedUser("Ana");
	const ben = await namedUser("Ben");
	const cam = await namedUser("Cam");
	const outsider = await namedUser("Olga");

	const sam = await adminDb.shadowProfile.create({
		data: {
			createdById: ana.user.id,
			name: "Sam",
			email: `sam-${randomUUID()}@pg-test.invalid`,
		},
	});
	const project = await adminDb.project.create({
		data: {
			name: `Floripa ${randomUUID().slice(0, 6)}`,
			description: "Beach week",
			primaryCurrency: "BRL",
			visibility: "PUBLIC",
			createdById: ana.user.id,
			budgetAmount: "1000",
			budgetCurrency: "BRL",
		},
	});
	const pid = project.id;
	await addMember(pid, "user", ana.user.id, "ORGANIZER");
	await addMember(pid, "user", ben.user.id, "EDITOR");
	await addMember(pid, "user", cam.user.id, "CONTRIBUTOR");
	await addMember(pid, "shadow", sam.id, "CONTRIBUTOR");

	const travel = await adminDb.category.create({
		data: { name: "Travel", color: "blue", userId: ana.user.id },
	});

	const A = { type: "user" as const, id: ana.user.id };
	const B = { type: "user" as const, id: ben.user.id };
	const C = { type: "user" as const, id: cam.user.id };
	const S = { type: "shadow" as const, id: sam.id };

	const hotel = await seedExpense(pid, {
		description: "Hotel",
		amount: "300",
		currency: "BRL",
		date: "2026-10-09",
		paidBy: A,
		categoryId: travel.id,
		splits: [
			{ ...A, share: "100" },
			{ ...B, share: "100" },
			{ ...C, share: "100", status: "PENDING" },
		],
	});
	const car = await seedExpense(pid, {
		description: "Car",
		amount: "90",
		currency: "BRL",
		date: "2026-10-10",
		paidBy: B,
		splits: [
			{ ...A, share: "30" },
			{ ...B, share: "30" },
			{ ...S, share: "30" },
		],
	});
	const boat = await seedExpense(pid, {
		description: "Boat",
		amount: "50",
		currency: "USD",
		date: "2026-10-11",
		paidBy: C,
		splitMode: "EXACT",
		splits: [
			{ ...A, share: "20" },
			{ ...C, share: "30" },
		],
	});
	const dinner = await seedExpense(pid, {
		description: "Dinner",
		amount: "60",
		currency: "BRL",
		date: "2026-10-12",
		paidBy: A,
		isLocked: true,
		splits: [
			{ ...A, share: "30" },
			{ ...B, share: "30" },
		],
	});

	await adminDb.settlement.create({
		data: {
			fromParticipantType: "user",
			fromParticipantId: ben.user.id,
			toParticipantType: "user",
			toParticipantId: ana.user.id,
			amount: "40",
			currency: "BRL",
			status: "FINALIZED",
			projectId: pid,
		},
	});
	await adminDb.settlement.create({
		data: {
			fromParticipantType: "user",
			fromParticipantId: ana.user.id,
			toParticipantType: "user",
			toParticipantId: cam.user.id,
			amount: "5",
			currency: "USD",
			status: "REJECTED",
			projectId: pid,
		},
	});

	return {
		ana,
		ben,
		cam,
		outsider,
		sam,
		project,
		travel,
		refs: { A, B, C, S },
		expenses: { hotel, car, boat, dinner },
	};
}

export type Trip = Awaited<ReturnType<typeof seedTrip>>;

/** A guest member of the trip with a live session; returns the raw token for the header. */
export async function seedGuest(trip: Trip, name = "Gus") {
	const link = await adminDb.magicLink.create({
		data: {
			id: randomUUID(),
			projectId: trip.project.id,
			roleGranted: "CONTRIBUTOR",
			createdById: trip.ana.user.id,
		},
	});
	const token = randomUUID();
	const guest = await adminDb.guestSession.create({
		data: {
			name,
			email: `gus-${randomUUID()}@pg-test.invalid`,
			magicLinkId: link.id,
			projectId: trip.project.id,
			sessionToken: createHash("sha256").update(token).digest("hex"),
		},
	});
	await addMember(trip.project.id, "guest", guest.id, "CONTRIBUTOR");
	return { guest, token };
}

export const sortBy =
	<T>(key: (item: T) => string) =>
	(a: T, b: T) =>
		key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
