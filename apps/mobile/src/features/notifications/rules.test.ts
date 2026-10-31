import {
	groupByDay,
	leadOf,
	pushTarget,
	sentenceOf,
	targetOf,
	unreadCount,
	withNextPage,
	withRead,
} from "./rules";
import type { InboxData, InboxNotification } from "./source";

function note(over: Partial<InboxNotification> = {}): InboxNotification {
	return {
		id: "n1",
		type: "EXPENSE_SPLIT",
		title: "New shared expense",
		body: "Lucía split 'Dinner' with you",
		data: null,
		isRead: false,
		createdAt: "2026-10-30T15:00:00.000Z",
		...over,
	};
}

describe("targetOf", () => {
	it("opens the expense for a split or an edit", () => {
		expect(
			targetOf(
				note({
					data: { transactionId: "t1", actorType: "user", actorId: "u1" },
				}),
			),
		).toEqual({ kind: "entry", id: "shared:t1" });
		expect(
			targetOf(note({ type: "EXPENSE_EDITED", data: { transactionId: "t2" } })),
		).toEqual({ kind: "entry", id: "shared:t2" });
	});

	it("falls back to the person, then the People hub, without an expense id", () => {
		expect(
			targetOf(note({ data: { actorType: "user", actorId: "u1" } })),
		).toEqual({ kind: "person", type: "user", id: "u1" });
		expect(targetOf(note({ data: { other: "x" } }))).toEqual({
			kind: "people",
		});
	});

	it("opens the person for a deleted expense, who is gone from Activity", () => {
		expect(
			targetOf(
				note({
					type: "EXPENSE_DELETED",
					data: { transactionId: "t1", actorType: "shadow", actorId: "s1" },
				}),
			),
		).toEqual({ kind: "person", type: "shadow", id: "s1" });
	});

	it("opens the sender of a payment and the receiver of an answer", () => {
		expect(
			targetOf(
				note({
					type: "SETTLEMENT_RECEIVED",
					data: { fromParticipantType: "user", fromParticipantId: "u9" },
				}),
			),
		).toEqual({ kind: "person", type: "user", id: "u9" });
		expect(
			targetOf(
				note({
					type: "PAYMENT_REMINDER",
					data: { fromParticipantType: "guest", fromParticipantId: "g1" },
				}),
			),
		).toEqual({ kind: "person", type: "guest", id: "g1" });
		expect(
			targetOf(
				note({
					type: "SETTLEMENT_CONFIRMED",
					data: { toParticipantType: "user", toParticipantId: "u2" },
				}),
			),
		).toEqual({ kind: "person", type: "user", id: "u2" });
		expect(
			targetOf(
				note({
					type: "SETTLEMENT_REJECTED",
					data: { toParticipantType: "user", toParticipantId: "u3" },
				}),
			),
		).toEqual({ kind: "person", type: "user", id: "u3" });
	});

	it("opens the project, and the People hub for a fix request", () => {
		expect(
			targetOf(note({ type: "PERIOD_CLOSED", data: { projectId: "p1" } })),
		).toEqual({ kind: "project", id: "p1" });
		expect(
			targetOf(note({ type: "PARTICIPANT_ADDED", data: { projectId: "p2" } })),
		).toEqual({ kind: "project", id: "p2" });
		expect(
			targetOf(note({ type: "VERIFICATION_REQUEST", data: { x: "y" } })),
		).toEqual({ kind: "people" });
	});

	it("opens nothing when the note names nothing, and ignores a made-up participant type", () => {
		expect(targetOf(note({ type: "PERIOD_CLOSED", data: null }))).toBeNull();
		expect(targetOf(note({ type: "PERIOD_CLOSED", data: {} }))).toBeNull();
		expect(
			targetOf(
				note({
					type: "EXPENSE_DELETED",
					data: { actorType: "admin", actorId: "u1" },
				}),
			),
		).toEqual({ kind: "people" });
	});
});

describe("pushTarget", () => {
	it("opens the shared expense a push names", () => {
		expect(
			pushTarget({
				type: "shared_expense.created",
				entity: { type: "shared_expense", id: "t1" },
			}),
		).toEqual({ kind: "entry", id: "shared:t1" });
		expect(
			pushTarget({ type: "shared_expense.updated", entity: null }),
		).toEqual({ kind: "activity" });
	});

	it("opens the same place as before for the others", () => {
		expect(pushTarget({ type: "fix_request.created", entity: null })).toEqual({
			kind: "activity",
		});
		expect(pushTarget({ type: "payment.recorded", entity: null })).toEqual({
			kind: "people",
		});
		expect(pushTarget({ type: "recurring.due", entity: null })).toEqual({
			kind: "home",
		});
	});
});

describe("leadOf", () => {
	const people = [{ key: "user:u1", name: "Lucía", imageUrl: null }];
	const projects = [{ id: "p1", name: "Trip", imageUrl: null }];

	it("leads with the person's face", () => {
		expect(
			leadOf(
				note({ data: { actorType: "user", actorId: "u1" } }),
				people,
				projects,
			),
		).toEqual({ kind: "face", person: people[0] });
	});

	it("leads with the project's cover when no person is named", () => {
		expect(
			leadOf(
				note({ type: "PERIOD_CLOSED", data: { projectId: "p1" } }),
				people,
				projects,
			),
		).toEqual({ kind: "cover", project: projects[0] });
	});

	it("has no lead for someone the phone does not know", () => {
		expect(
			leadOf(
				note({ data: { actorType: "user", actorId: "zz" } }),
				people,
				projects,
			),
		).toBeNull();
	});
});

describe("sentenceOf", () => {
	it("is the body, or the title when there is none", () => {
		expect(sentenceOf(note())).toBe("Lucía split 'Dinner' with you");
		expect(sentenceOf(note({ body: "  " }))).toBe("New shared expense");
	});
});

describe("groupByDay", () => {
	const now = new Date(2026, 9, 31, 10, 0);
	const at = (day: number, hour: number) =>
		new Date(2026, 9, day, hour, 0).toISOString();

	it("puts a run of the same day together, words today and yesterday", () => {
		const days = groupByDay(
			[
				note({ id: "a", createdAt: at(31, 9) }),
				note({ id: "b", createdAt: at(31, 8) }),
				note({ id: "c", createdAt: at(30, 22) }),
				note({ id: "d", createdAt: at(12, 7) }),
			],
			now,
		);
		expect(
			days.map((d) => [d.day, d.relative, d.items.map((n) => n.id)]),
		).toEqual([
			["2026-10-31", "today", ["a", "b"]],
			["2026-10-30", "yesterday", ["c"]],
			["2026-10-12", null, ["d"]],
		]);
	});

	it("is empty with no notifications", () => {
		expect(groupByDay([], now)).toEqual([]);
	});
});

describe("the inbox after a change", () => {
	const inbox = (): InboxData => ({
		items: [
			note({ id: "a" }),
			note({ id: "b" }),
			note({ id: "c", isRead: true }),
		],
		nextCursor: "next",
		people: [],
		projects: [],
	});

	it("counts the unread", () => {
		expect(unreadCount(inbox().items)).toBe(2);
	});

	it("marks some read, or all", () => {
		const some = withRead(inbox(), ["a"]);
		expect(some.items.map((n) => n.isRead)).toEqual([true, false, true]);
		expect(unreadCount(some.items)).toBe(1);
		expect(unreadCount(withRead(inbox(), null).items)).toBe(0);
	});

	it("does not touch the data it was given", () => {
		const before = inbox();
		withRead(before, null);
		expect(unreadCount(before.items)).toBe(2);
	});

	it("adds the next page without repeating a row", () => {
		const next = withNextPage(inbox(), {
			items: [note({ id: "c" }), note({ id: "d" })],
			nextCursor: null,
		});
		expect(next.items.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
		expect(next.nextCursor).toBeNull();
	});
});
