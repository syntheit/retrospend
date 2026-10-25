import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/storage", () => ({ deleteFile: vi.fn() }));
const removeUserExports = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("~/server/export-storage", () => ({ removeUserExports }));

import { deleteFile } from "~/server/storage";
import {
	anonymizeAndDeleteUser,
	previewAccountDeletion,
} from "../user-deletion.service";

type Fn = ReturnType<typeof vi.fn>;

/** A tx whose every model method is a lazily created vi.fn with a safe default. */
function makeTx(overrides: Record<string, Record<string, Fn>>) {
	const models: Record<string, Record<string, Fn>> = {};
	const model = (name: string) =>
		new Proxy(
			{},
			{
				get(_t, method: string) {
					models[name] ??= {};
					const existing = overrides[name]?.[method] ?? models[name][method];
					if (existing) return existing;
					const fn = vi.fn(async () => {
						if (method === "findMany") return [];
						if (method === "count") return 0;
						if (method.endsWith("Many")) return { count: 0 };
						return null;
					});
					models[name][method] = fn;
					return fn;
				},
			},
		);
	const tx = new Proxy(
		{ $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async () => []) },
		{
			get(target, prop: string) {
				if (prop in target) return target[prop as keyof typeof target];
				return model(prop);
			},
		},
	);
	return { tx, models };
}

describe("anonymizeAndDeleteUser", () => {
	it("detaches the user's ghosts from projects before the cascade deletes them", async () => {
		const shadowFindMany = vi.fn(async () => [{ id: "shadow-a" }, { id: "shadow-b" }]);
		const ppDeleteMany = vi.fn(async () => ({ count: 1 }));
		const userDelete = vi.fn(async () => ({}));
		const { tx } = makeTx({
			shadowProfile: { findMany: shadowFindMany },
			projectParticipant: { deleteMany: ppDeleteMany },
			user: { delete: userDelete },
		});
		const db = { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

		await anonymizeAndDeleteUser(db as never, "user-1", "u@example.com", null);

		expect(shadowFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { createdById: "user-1" } }),
		);
		for (const id of ["shadow-a", "shadow-b"]) {
			expect(ppDeleteMany).toHaveBeenCalledWith({
				where: { participantType: "shadow", participantId: id },
			});
		}
		// Detaching happens before the user (and its ghosts) are deleted.
		const lastDetach = Math.max(...ppDeleteMany.mock.invocationCallOrder);
		expect(lastDetach).toBeLessThan(userDelete.mock.invocationCallOrder[0]!);
	});

	it("removes the avatar and exports only after the delete committed", async () => {
		vi.mocked(deleteFile).mockClear();
		vi.mocked(deleteFile).mockResolvedValue(undefined);
		removeUserExports.mockClear();
		const userDelete = vi.fn(async () => ({}));
		const { tx } = makeTx({ user: { delete: userDelete } });
		const db = { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

		await anonymizeAndDeleteUser(db as never, "user-1", "u@x.test", "avatars/a.webp");

		expect(deleteFile).toHaveBeenCalledWith("avatars/a.webp");
		expect(removeUserExports).toHaveBeenCalledWith("user-1");
		expect(vi.mocked(deleteFile).mock.invocationCallOrder[0]!).toBeGreaterThan(
			userDelete.mock.invocationCallOrder[0]!,
		);
	});

	it("keeps the avatar and exports when the last-admin guard refuses", async () => {
		vi.mocked(deleteFile).mockClear();
		removeUserExports.mockClear();
		const { tx } = makeTx({});
		(tx as unknown as { $queryRaw: Fn }).$queryRaw.mockResolvedValue([{ id: "user-1" }]);
		const db = { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

		await expect(
			anonymizeAndDeleteUser(db as never, "user-1", "u@x.test", "avatars/a.webp"),
		).rejects.toMatchObject({ code: "FORBIDDEN" });

		expect(deleteFile).not.toHaveBeenCalled();
		expect(removeUserExports).not.toHaveBeenCalled();
	});
});

type Member = {
	id: string;
	projectId: string;
	participantType: string;
	participantId: string;
	role: string;
	joinedAt: Date;
};

/** findFirst/count over a member list, honouring the filters the service uses. */
function memberQueries(members: Member[]) {
	const matches = (m: Member, where: Record<string, unknown>) =>
		(where.projectId === undefined || m.projectId === where.projectId) &&
		(where.participantType === undefined ||
			m.participantType === where.participantType) &&
		(where.role === undefined || m.role === where.role) &&
		m.participantId !== (where.participantId as { not?: string })?.not;
	return {
		findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
			members
				.filter((m) => matches(m, where))
				.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0] ?? null,
		),
		count: vi.fn(
			async ({ where }: { where: Record<string, unknown> }) =>
				members.filter((m) => matches(m, where)).length,
		),
		findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
			where.role === "ORGANIZER" && where.participantId === "user-1"
				? [{ projectId: "p1", project: { id: "p1", name: "Trip" } }]
				: [],
		),
		update: vi.fn(async () => ({})),
	};
}

describe("organizer hand-over on account deletion", () => {
	const early = new Date("2026-01-01");
	const later = new Date("2026-02-01");

	it("never promotes a ghost; picks the registered user instead", async () => {
		const pp = memberQueries([
			{ id: "pp-ghost", projectId: "p1", participantType: "shadow", participantId: "s1", role: "EDITOR", joinedAt: early },
			{ id: "pp-bob", projectId: "p1", participantType: "user", participantId: "bob", role: "CONTRIBUTOR", joinedAt: later },
		]);
		const projectDelete = vi.fn(async () => ({}));
		const { tx } = makeTx({ projectParticipant: pp, project: { delete: projectDelete } });
		const db = { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

		await anonymizeAndDeleteUser(db as never, "user-1", "u@example.com", null);

		expect(pp.update).toHaveBeenCalledTimes(1);
		expect(pp.update).toHaveBeenCalledWith({
			where: { id: "pp-bob" },
			data: { role: "ORGANIZER" },
		});
		expect(projectDelete).not.toHaveBeenCalled();
	});

	it("deletes the project when only ghosts are left", async () => {
		const pp = memberQueries([
			{ id: "pp-ghost", projectId: "p1", participantType: "shadow", participantId: "s1", role: "EDITOR", joinedAt: early },
		]);
		const projectDelete = vi.fn(async () => ({}));
		const { tx } = makeTx({ projectParticipant: pp, project: { delete: projectDelete } });
		const db = { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

		await anonymizeAndDeleteUser(db as never, "user-1", "u@example.com", null);

		expect(pp.update).not.toHaveBeenCalled();
		expect(projectDelete).toHaveBeenCalledWith({ where: { id: "p1" } });
	});

	it("falls back to a VIEWER user before deleting the project", async () => {
		const pp = memberQueries([
			{ id: "pp-ghost", projectId: "p1", participantType: "shadow", participantId: "s1", role: "CONTRIBUTOR", joinedAt: early },
			{ id: "pp-vic", projectId: "p1", participantType: "user", participantId: "vic", role: "VIEWER", joinedAt: later },
		]);
		const { tx } = makeTx({ projectParticipant: pp });
		const db = { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

		await anonymizeAndDeleteUser(db as never, "user-1", "u@example.com", null);

		expect(pp.update).toHaveBeenCalledWith({
			where: { id: "pp-vic" },
			data: { role: "ORGANIZER" },
		});
	});

	it("preview names the registered successor, not the ghost", async () => {
		const pp = memberQueries([
			{ id: "pp-ghost", projectId: "p1", participantType: "shadow", participantId: "s1", role: "EDITOR", joinedAt: early },
			{ id: "pp-bob", projectId: "p1", participantType: "user", participantId: "bob", role: "CONTRIBUTOR", joinedAt: later },
		]);
		const { tx } = makeTx({
			projectParticipant: pp,
			user: { findUnique: vi.fn(async () => ({ name: "Bob" })) },
		});

		const preview = await previewAccountDeletion(tx as never, "user-1");

		expect(preview.projectsToTransfer).toEqual([
			{ id: "p1", name: "Trip", newOrganizerName: "Bob" },
		]);
		expect(preview.projectsToDelete).toEqual([]);
	});
});

describe("pending settlements on account deletion", () => {
	type Row = {
		id: string;
		fromParticipantId: string;
		toParticipantId: string;
		status: string;
		confirmedByPayer: boolean;
		confirmedByPayee: boolean;
	};

	function settlementModel(rows: Row[]) {
		return {
			findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
				rows.filter(
					(r) =>
						(where.fromParticipantId === undefined ||
							r.fromParticipantId === where.fromParticipantId) &&
						(where.toParticipantId === undefined ||
							r.toParticipantId === where.toParticipantId) &&
						(typeof where.status !== "string" || r.status === where.status),
				),
			),
			update: vi.fn(async () => ({})),
			delete: vi.fn(async () => ({})),
			updateMany: vi.fn(async () => ({ count: 0 })),
		};
	}

	const rows: Row[] = [
		// Payee refused this one; it must stay refused.
		{ id: "rejected-out", fromParticipantId: "user-1", toParticipantId: "bob", status: "REJECTED", confirmedByPayer: true, confirmedByPayee: false },
		{ id: "rejected-in", fromParticipantId: "bob", toParticipantId: "user-1", status: "REJECTED", confirmedByPayer: true, confirmedByPayee: false },
		{ id: "pending-out", fromParticipantId: "user-1", toParticipantId: "bob", status: "PROPOSED", confirmedByPayer: true, confirmedByPayee: false },
	];

	it("finalizes PROPOSED settlements but leaves REJECTED ones alone", async () => {
		const settlement = settlementModel(rows);
		const { tx } = makeTx({ settlement });
		const db = { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

		await anonymizeAndDeleteUser(db as never, "user-1", "u@example.com", null);

		const updatedIds = settlement.update.mock.calls.map(
			(c) => (c as unknown as [{ where: { id: string } }])[0].where.id,
		);
		expect(updatedIds).toEqual(["pending-out"]);
		expect(settlement.delete).not.toHaveBeenCalled();
	});

	it("finalizes every row of a pending payment group, offset rows included", async () => {
		// user-1 sent a full settle-up: a payment row to bob and an offset row
		// from bob (its flags point the other way: user-1 is its payee).
		const groupRows: Row[] = [
			{ id: "group-cash", fromParticipantId: "user-1", toParticipantId: "bob", status: "PROPOSED", confirmedByPayer: true, confirmedByPayee: false },
			{ id: "group-offset", fromParticipantId: "bob", toParticipantId: "user-1", status: "PROPOSED", confirmedByPayer: false, confirmedByPayee: true },
		];
		const settlement = settlementModel(groupRows);
		const { tx } = makeTx({ settlement });
		const db = { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

		await anonymizeAndDeleteUser(db as never, "user-1", "u@example.com", null);

		const updatedIds = settlement.update.mock.calls.map(
			(c) => (c as unknown as [{ where: { id: string } }])[0].where.id,
		);
		expect(updatedIds.sort()).toEqual(["group-cash", "group-offset"]);
		expect(settlement.delete).not.toHaveBeenCalled();

		const preview = await previewAccountDeletion(tx as never, "user-1");
		expect(preview.settlementsToAutoConfirm).toBe(2);
		expect(preview.settlementsToCancel).toBe(0);
	});

	it("preview does not count REJECTED settlements", async () => {
		const settlement = settlementModel(rows);
		const { tx } = makeTx({ settlement });

		const preview = await previewAccountDeletion(tx as never, "user-1");

		expect(preview.settlementsToAutoConfirm).toBe(1);
		expect(preview.settlementsToCancel).toBe(0);
	});
});
