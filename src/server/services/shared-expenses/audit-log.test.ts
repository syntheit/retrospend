import { describe, expect, it, vi } from "vitest";
import { logAudit, logAuditMany } from "./audit-log";

function createMockDb() {
	return {
		auditLogEntry: {
			create: vi.fn().mockResolvedValue({ id: "audit-1" }),
			createMany: vi.fn().mockResolvedValue({ count: 2 }),
		},
	};
}

describe("logAudit", () => {
	it("creates an audit log entry with all fields", async () => {
		const db = createMockDb();
		await logAudit(db as never, {
			actor: { participantType: "user", participantId: "user-1" },
			action: "CREATED",
			targetType: "SHARED_TRANSACTION",
			targetId: "txn-1",
			changes: { description: "Dinner", amount: 50 },
			context: { ip: "127.0.0.1" },
			projectId: "project-1",
		});

		expect(db.auditLogEntry.create).toHaveBeenCalledWith({
			data: {
				actorType: "user",
				actorId: "user-1",
				action: "CREATED",
				targetType: "SHARED_TRANSACTION",
				targetId: "txn-1",
				changes: { description: "Dinner", amount: 50 },
				context: { ip: "127.0.0.1" },
				projectId: "project-1",
			},
		});
	});

	it("handles optional fields as undefined", async () => {
		const db = createMockDb();
		await logAudit(db as never, {
			actor: { participantType: "guest", participantId: "guest-1" },
			action: "VERIFIED",
			targetType: "SPLIT_PARTICIPANT",
			targetId: "sp-1",
		});

		expect(db.auditLogEntry.create).toHaveBeenCalledWith({
			data: {
				actorType: "guest",
				actorId: "guest-1",
				action: "VERIFIED",
				targetType: "SPLIT_PARTICIPANT",
				targetId: "sp-1",
				changes: undefined,
				context: undefined,
				projectId: undefined,
			},
		});
	});

	it("throws when the db call fails, so a missing record is never silent", async () => {
		const db = createMockDb();
		db.auditLogEntry.create.mockRejectedValue(new Error("DB error"));

		await expect(
			logAudit(db as never, {
				actor: { participantType: "user", participantId: "u-1" },
				action: "DELETED",
				targetType: "SHARED_TRANSACTION",
				targetId: "txn-2",
				changes: { snapshot: { amount: 100 } },
			}),
		).rejects.toThrow("DB error");
	});

	it("stores edit diffs in the expected format", async () => {
		const db = createMockDb();
		await logAudit(db as never, {
			actor: { participantType: "user", participantId: "user-1" },
			action: "EDITED",
			targetType: "SHARED_TRANSACTION",
			targetId: "txn-1",
			changes: {
				amount: { old: 50, new: 55 },
				description: { old: "Dinner", new: "Dinner at Sotto" },
			},
		});

		const call = db.auditLogEntry.create.mock.calls[0]![0];
		expect(call.data.changes).toEqual({
			amount: { old: 50, new: 55 },
			description: { old: "Dinner", new: "Dinner at Sotto" },
		});
	});
});

describe("logAuditMany", () => {
	const entry = (id: string) => ({
		actor: { participantType: "user" as const, participantId: "__system__" },
		action: "AUTO_VERIFIED" as const,
		targetType: "SPLIT_PARTICIPANT" as const,
		targetId: id,
		projectId: "project-1",
	});

	it("writes every entry in one insert, without reading any back", async () => {
		const db = createMockDb();
		await logAuditMany(db as never, [entry("sp-1"), entry("sp-2")]);

		expect(db.auditLogEntry.create).not.toHaveBeenCalled();
		expect(db.auditLogEntry.createMany).toHaveBeenCalledTimes(1);
		expect(db.auditLogEntry.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({ targetId: "sp-1", actorId: "__system__" }),
				expect.objectContaining({ targetId: "sp-2", projectId: "project-1" }),
			],
		});
	});

	it("writes nothing for no entries", async () => {
		const db = createMockDb();
		await logAuditMany(db as never, []);
		expect(db.auditLogEntry.createMany).not.toHaveBeenCalled();
	});

	it("throws when the insert fails", async () => {
		const db = createMockDb();
		db.auditLogEntry.createMany.mockRejectedValue(new Error("DB error"));
		await expect(logAuditMany(db as never, [entry("sp-1")])).rejects.toThrow(
			"DB error",
		);
	});
});
