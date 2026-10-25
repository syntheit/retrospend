/**
 * Characterization of the project router's read procedures on a real
 * Postgres, written before their logic moved out of routers/project.ts so the
 * move is pinned as behavior-neutral. Values come from the hand-derived trip
 * in trip-fixture.ts.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	anonymousCaller,
	callerFor,
	seedGuest,
	seedTrip,
	sortBy,
	type Trip,
} from "./trip-fixture";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

const byName = sortBy<{ name: string }>((p) => p.name);

let trip: Trip;

beforeAll(async () => {
	trip = await seedTrip();
});

describe("project.list", () => {
	it("lists the trip for a member with its totals and my role", async () => {
		const [p, ...rest] = await callerFor(trip.ana.user).list({});
		expect(rest).toEqual([]);
		expect(Object.keys(p ?? {}).sort()).toEqual(
			[
				"_count",
				"autoAcceptSplits",
				"billingClosePermission",
				"billingCloseReminderDays",
				"billingAutoClose",
				"billingCycleDays",
				"billingCycleLength",
				"billingPeriods",
				"budgetAmount",
				"budgetCurrency",
				"createdAt",
				"createdById",
				"currentBillingPeriod",
				"description",
				"excludeFromAnalytics",
				"id",
				"imagePath",
				"isSettled",
				"myRole",
				"name",
				"participants",
				"primaryCurrency",
				"status",
				"totalSpent",
				"updatedAt",
				"visibility",
			].sort(),
		);
		expect(p).toMatchObject({
			id: trip.project.id,
			myRole: "ORGANIZER",
			// Today's figure sums every currency together: 300 + 90 + 50 + 60.
			totalSpent: 500,
			isSettled: false,
			excludeFromAnalytics: false,
			currentBillingPeriod: null,
			_count: { participants: 4, sharedTransactions: 4 },
		});
		const people = [...(p?.participants ?? [])].sort(byName);
		expect(people.map((x) => [x.name, x.role, x.email])).toEqual([
			["Ana", "ORGANIZER", null],
			["Ben", "EDITOR", null],
			["Cam", "CONTRIBUTOR", null],
			["Sam", "CONTRIBUTOR", trip.sam.email],
		]);
	});

	it("hides a ghost's email from a contributor who did not add them", async () => {
		const [p] = await callerFor(trip.cam.user).list({});
		expect(p?.myRole).toBe("CONTRIBUTOR");
		expect(p?.participants.find((x) => x.name === "Sam")?.email).toBeNull();
	});

	it("filters by status and shows nothing to an outsider", async () => {
		await expect(
			callerFor(trip.ana.user).list({ status: "ARCHIVED" }),
		).resolves.toEqual([]);
		await expect(callerFor(trip.outsider.user).list({})).resolves.toEqual([]);
	});
});

describe("project.detail", () => {
	it("returns members, category stats and review counts", async () => {
		const d = await callerFor(trip.ana.user).detail({ id: trip.project.id });
		expect(Object.keys(d).sort()).toEqual(
			[
				"autoAcceptSplits",
				"billingClosePermission",
				"billingCloseReminderDays",
				"billingAutoClose",
				"billingCycleDays",
				"billingCycleLength",
				"billingPeriods",
				"budgetAmount",
				"budgetCurrency",
				"categoryStats",
				"createdAt",
				"createdById",
				"currentBillingPeriod",
				"description",
				"excludeFromAnalytics",
				"id",
				"imagePath",
				"myParticipantId",
				"myParticipantType",
				"myRole",
				"name",
				"participants",
				"pendingVerificationCount",
				"primaryCurrency",
				"status",
				"totalSpent",
				"unseenChangesCount",
				"updatedAt",
				"visibility",
			].sort(),
		);
		expect(d).toMatchObject({
			totalSpent: 500,
			unseenChangesCount: 0,
			pendingVerificationCount: 1,
			myRole: "ORGANIZER",
			myParticipantType: "user",
			myParticipantId: trip.ana.user.id,
			excludeFromAnalytics: false,
			currentBillingPeriod: null,
			billingPeriods: [],
		});
		expect(
			[...d.categoryStats].sort(byName).map((c) => [c.name, c.total, c.count]),
		).toEqual([
			["Travel", 300, 1],
			["Uncategorized", 200, 3],
		]);
		expect(
			[...d.participants]
				.sort(byName)
				.map((p) => [p.name, p.participantType, p.email]),
		).toEqual([
			["Ana", "user", null],
			["Ben", "user", null],
			["Cam", "user", null],
			["Sam", "shadow", trip.sam.email],
		]);
	});

	it("hides ghost emails from a contributor and refuses an outsider", async () => {
		const d = await callerFor(trip.cam.user).detail({ id: trip.project.id });
		expect(d.myRole).toBe("CONTRIBUTOR");
		expect(d.participants.find((p) => p.name === "Sam")?.email).toBeNull();
		await expect(
			callerFor(trip.outsider.user).detail({ id: trip.project.id }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("serves a guest of this project only", async () => {
		const { guest, token } = await seedGuest(trip);
		const d = await anonymousCaller({ "x-guest-token": token }).detail({
			id: trip.project.id,
		});
		expect(d).toMatchObject({
			myRole: "CONTRIBUTOR",
			myParticipantType: "guest",
			myParticipantId: guest.id,
		});
		expect(d.participants.find((p) => p.name === "Gus")?.email).toBe(
			guest.email,
		);
		expect(d.participants.find((p) => p.name === "Sam")?.email).toBeNull();
		await adminDb.projectParticipant.deleteMany({
			where: { participantType: "guest", participantId: guest.id },
		});
	});
});

describe("project.listExpenses", () => {
	it("pages expenses newest first with status and permissions", async () => {
		const r = await callerFor(trip.ana.user).listExpenses({
			projectId: trip.project.id,
		});
		expect(r).toMatchObject({ total: 4, page: 1, limit: 20 });
		expect(
			r.transactions.map((t) => [
				t.description,
				t.amount,
				t.currency,
				t.status,
				t.canEdit,
				t.paidBy.name,
				t.paidBy.isMe,
			]),
		).toEqual([
			["Dinner", 60, "BRL", "settled", false, "Ana", true],
			["Boat", 50, "USD", "active", true, "Cam", false],
			["Car", 90, "BRL", "active", true, "Ben", false],
			["Hotel", 300, "BRL", "pending", true, "Ana", true],
		]);
		const hotel = r.transactions[3];
		expect(hotel?.category).toMatchObject({ name: "Travel", color: "blue" });
		expect(
			[...(hotel?.splitParticipants ?? [])]
				.sort(byName)
				.map((s) => [s.name, s.shareAmount, s.verificationStatus]),
		).toEqual([
			["Ana", 100, "ACCEPTED"],
			["Ben", 100, "ACCEPTED"],
			["Cam", 100, "PENDING"],
		]);
	});

	it("lets a contributor edit only their own expenses, and pages", async () => {
		const r = await callerFor(trip.cam.user).listExpenses({
			projectId: trip.project.id,
			page: 2,
			limit: 3,
		});
		expect(r).toMatchObject({ total: 4, page: 2, limit: 3 });
		expect(r.transactions.map((t) => [t.description, t.canEdit])).toEqual([
			["Hotel", false],
		]);
		const all = await callerFor(trip.cam.user).listExpenses({
			projectId: trip.project.id,
		});
		expect(
			all.transactions.filter((t) => t.canEdit).map((t) => t.description),
		).toEqual(["Boat"]);
	});
});

describe("project.publicPageView", () => {
	it("shows totals and names without emails, balances or payments", async () => {
		const d = await anonymousCaller().publicPageView({ id: trip.project.id });
		expect(d?.name).toBe(trip.project.name);
		expect(d?.myRole).toBeNull();
		expect(d?.expenseCount).toBe(4);
		// BRL 300 + 90 + 60 and USD 50: one line per currency, never summed across them.
		expect(d?.total).toHaveLength(2);
		expect(d?.total).toEqual(
			expect.arrayContaining([
				{ minor: 45_000, currency: "BRL" },
				{ minor: 5_000, currency: "USD" },
			]),
		);
		expect(d?.myShare).toEqual([]);
		expect(d?.payments).toEqual([]);
		for (const m of d?.members ?? []) {
			expect(m.withMe).toEqual([]);
			expect(m.isMe).toBe(false);
		}
		const text = JSON.stringify(d);
		expect(text).not.toContain("@");
	});

	it("lists read-only rows with nobody's share", async () => {
		const d = await anonymousCaller().publicPageView({ id: trip.project.id });
		expect(d?.expenses.map((e) => e.title).sort()).toEqual(
			["Boat", "Car", "Dinner", "Hotel"].sort(),
		);
		for (const e of d?.expenses ?? []) {
			expect(e.share).toBeNull();
			expect(e.mine).toBe(false);
		}
	});

	it("returns null for a private project", async () => {
		const priv = await adminDb.project.create({
			data: { name: "Private", createdById: trip.ana.user.id },
		});
		await expect(
			anonymousCaller().publicPageView({ id: priv.id }),
		).resolves.toBeNull();
	});
});

const refKey = (r: { participantType: string; participantId: string }) =>
	`${r.participantType}:${r.participantId}`;

describe("group balances", () => {
	it("settlementPlan settles each currency with the fewest payments", async () => {
		const { A, B, C, S } = trip.refs;
		const k = (r: { type: string; id: string }) => `${r.type}:${r.id}`;
		const plan = await callerFor(trip.ben.user).settlementPlan({
			projectId: trip.project.id,
		});
		expect(plan.participantCount).toBe(4);
		const steps = (cur: string) =>
			(plan.byCurrency[cur]?.plan ?? [])
				.map((s) => [refKey(s.from), refKey(s.to), s.amount])
				.sort();
		// BRL nets: Ana 360 - 160 - 40 = 160, Ben 90 - 160 + 40 = -30, Cam -100, Sam -30.
		expect(steps("BRL")).toEqual(
			[
				[k(B), k(A), 30],
				[k(C), k(A), 100],
				[k(S), k(A), 30],
			].sort(),
		);
		// USD nets: Ana -20, Cam 50 - 30 = 20. The rejected USD 5 never counts.
		expect(steps("USD")).toEqual([[k(A), k(C), 20]]);
	});

	it("participantBalances flattens paid, share and net per currency", async () => {
		const { A, B, C, S } = trip.refs;
		const k = (r: { type: string; id: string }) => `${r.type}:${r.id}`;
		const r = await callerFor(trip.ana.user).participantBalances({
			projectId: trip.project.id,
		});
		expect(r.participantCount).toBe(4);
		expect(
			r.balances
				.map((b) => [
					b.currency,
					refKey(b.participant),
					b.totalPaid,
					b.fairShare,
					b.netBalance,
				])
				.sort(),
		).toEqual(
			[
				["BRL", k(A), 360, 160, 160],
				["BRL", k(B), 90, 160, -30],
				["BRL", k(C), 0, 100, -100],
				["BRL", k(S), 0, 30, -30],
				["USD", k(A), 0, 20, -20],
				["USD", k(C), 50, 30, 20],
			].sort(),
		);
	});

	it("balancesFromPerspective gives pairwise nets and redacts emails", async () => {
		const r = await callerFor(trip.cam.user).balancesFromPerspective({
			projectId: trip.project.id,
			perspective: { participantType: "user", participantId: trip.ana.user.id },
		});
		const nets = Object.fromEntries(
			r.statements.map((s) => [s.counterpart.name, s.netByCurrency]),
		);
		// Ben: Hotel +100, Car -30, Dinner +30, he paid Ana 40: 60.
		expect(nets.Ben).toEqual({ BRL: 60 });
		// Cam: Hotel +100 BRL; Boat -20 USD.
		expect(nets.Cam).toEqual({ BRL: 100, USD: -20 });
		expect(r.perspective.name).toBe("Ana");
		for (const s of r.statements) {
			if (s.counterpart.participantType === "shadow") {
				expect(s.counterpart.email).toBeNull();
			}
		}
	});

	it("refuses a non-member", async () => {
		await expect(
			callerFor(trip.outsider.user).settlementPlan({
				projectId: trip.project.id,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("project.rebalanceableExpenses", () => {
	it("offers unlocked expenses the newcomer is not in", async () => {
		const r = await callerFor(trip.ana.user).rebalanceableExpenses({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.outsider.user.id,
		});
		expect(
			r.map((e) => [
				e.description,
				e.amount,
				e.eligible,
				e.currentParticipantCount,
				e.hasAllOtherMembers,
			]),
		).toEqual([
			["Boat", 50, false, 2, false],
			["Car", 90, true, 3, false],
			["Hotel", 300, true, 3, false],
		]);
	});

	it("marks an expense with every other member as split with everyone", async () => {
		// Sam is already in Car; for Sam, the other members are Ana, Ben and Cam,
		// and only Hotel has all three.
		const r = await callerFor(trip.ana.user).rebalanceableExpenses({
			projectId: trip.project.id,
			participantType: "shadow",
			participantId: trip.sam.id,
		});
		expect(r.map((e) => [e.description, e.hasAllOtherMembers])).toEqual([
			["Boat", false],
			["Hotel", true],
		]);
	});

	it("needs an editor", async () => {
		await expect(
			callerFor(trip.cam.user).rebalanceableExpenses({
				projectId: trip.project.id,
				participantType: "shadow",
				participantId: trip.sam.id,
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
