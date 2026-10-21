import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/storage", () => ({ deleteFile: vi.fn() }));

import { anonymizeAndDeleteUser } from "../user-deletion.service";

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
		{ $executeRaw: vi.fn(async () => 0) },
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
});
