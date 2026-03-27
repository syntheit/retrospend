import { describe, expect, it, vi } from "vitest";
import { logAudit } from "./audit-log";

function createMockDb() {
	return {
		auditLogEntry: {
			create: vi.fn().mockResolvedValue({ id: "audit-1" }),
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

	it("does not throw when db call fails", async () => {
		const db = createMockDb();
		db.auditLogEntry.create.mockRejectedValue(new Error("DB error"));
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			logAudit(db as never, {
				actor: { participantType: "user", participantId: "u-1" },
				action: "DELETED",
				targetType: "SHARED_TRANSACTION",
				targetId: "txn-2",
				changes: { snapshot: { amount: 100 } },
			}),
		).resolves.toBeUndefined();

		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
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
