/**
 * Unit tests for the read-side permission helpers that power the
 * `canEdit`/`canDelete` flags on transaction lists (person view, verification
 * queue, and the main transactions page).
 *
 * These flags MUST agree with the authoritative write-side guard
 * `assertCanModifyTransaction`: an ORGANIZER/EDITOR of a project can edit and
 * delete ANY expense in it; a CONTRIBUTOR only their own; a VIEWER / non-member
 * none; standalone expenses stay creator-only; locked expenses are never
 * editable.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
	addProject,
	addProjectParticipant,
	createStatefulDb,
} from "./test-utils";
import { buildCallerRoleMap, deriveCanModify } from "./project-permissions";

type Db = ReturnType<typeof createStatefulDb>;

describe("buildCallerRoleMap", () => {
	let db: Db;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("returns the caller's role for each project they belong to", async () => {
		const p1 = addProject(db, { createdById: "alice" });
		const p2 = addProject(db, { createdById: "bob" });
		addProjectParticipant(db, {
			projectId: p1.id,
			participantType: "user",
			participantId: "alice",
			role: "ORGANIZER",
		});
		addProjectParticipant(db, {
			projectId: p2.id,
			participantType: "user",
			participantId: "alice",
			role: "EDITOR",
		});

		const map = await buildCallerRoleMap(
			db as never,
			[{ participantType: "user", participantId: "alice" }],
			[p1.id, p2.id],
		);

		expect(map.get(p1.id)).toBe("ORGANIZER");
		expect(map.get(p2.id)).toBe("EDITOR");
	});

	it("omits projects the caller is not a member of (role stays undefined)", async () => {
		const p1 = addProject(db, { createdById: "alice" });
		// Alice is NOT a participant of p1 (e.g. a cross-project expense she only
		// shares a split on). Her role must be undefined so she is not granted edit.
		const map = await buildCallerRoleMap(
			db as never,
			[{ participantType: "user", participantId: "alice" }],
			[p1.id],
		);
		expect(map.get(p1.id)).toBeUndefined();
	});

	it("is alias-aware: a role held under any alias identity is returned", async () => {
		const project = addProject(db, { createdById: "alice" });
		// The caller's ORGANIZER membership was recorded under their pre-claim
		// SHADOW identity, not their canonical user ref.
		addProjectParticipant(db, {
			projectId: project.id,
			participantType: "shadow",
			participantId: "shadow-1",
			role: "ORGANIZER",
		});

		const map = await buildCallerRoleMap(
			db as never,
			[
				{ participantType: "user", participantId: "alice" },
				{ participantType: "shadow", participantId: "shadow-1" },
			],
			[project.id],
		);

		expect(map.get(project.id)).toBe("ORGANIZER");
	});

	it("keeps the highest-ranked role when aliases hold different roles", async () => {
		const project = addProject(db, { createdById: "alice" });
		addProjectParticipant(db, {
			projectId: project.id,
			participantType: "user",
			participantId: "alice",
			role: "CONTRIBUTOR",
		});
		addProjectParticipant(db, {
			projectId: project.id,
			participantType: "shadow",
			participantId: "shadow-1",
			role: "EDITOR",
		});

		const map = await buildCallerRoleMap(
			db as never,
			[
				{ participantType: "user", participantId: "alice" },
				{ participantType: "shadow", participantId: "shadow-1" },
			],
			[project.id],
		);

		expect(map.get(project.id)).toBe("EDITOR");
	});

	it("returns an empty map when there are no project ids", async () => {
		const map = await buildCallerRoleMap(
			db as never,
			[{ participantType: "user", participantId: "alice" }],
			[],
		);
		expect(map.size).toBe(0);
	});
});

describe("deriveCanModify", () => {
	const P = "project-1";
	const roleMap = (role?: string): Map<string, string> =>
		role ? new Map([[P, role]]) : new Map();

	it("ORGANIZER can modify any project expense, even ones they didn't create", () => {
		expect(
			deriveCanModify({
				isLocked: false,
				projectId: P,
				isCreator: false,
				roleMap: roleMap("ORGANIZER"),
			}),
		).toBe(true);
	});

	it("EDITOR can modify any project expense, even ones they didn't create", () => {
		expect(
			deriveCanModify({
				isLocked: false,
				projectId: P,
				isCreator: false,
				roleMap: roleMap("EDITOR"),
			}),
		).toBe(true);
	});

	it("CONTRIBUTOR can modify only their own project expense", () => {
		expect(
			deriveCanModify({
				isLocked: false,
				projectId: P,
				isCreator: true,
				roleMap: roleMap("CONTRIBUTOR"),
			}),
		).toBe(true);
		expect(
			deriveCanModify({
				isLocked: false,
				projectId: P,
				isCreator: false,
				roleMap: roleMap("CONTRIBUTOR"),
			}),
		).toBe(false);
	});

	it("VIEWER cannot modify any project expense", () => {
		expect(
			deriveCanModify({
				isLocked: false,
				projectId: P,
				isCreator: true,
				roleMap: roleMap("VIEWER"),
			}),
		).toBe(false);
	});

	it("a non-member (no role) cannot modify a project expense", () => {
		expect(
			deriveCanModify({
				isLocked: false,
				projectId: P,
				isCreator: false,
				roleMap: roleMap(undefined),
			}),
		).toBe(false);
	});

	it("locked (settled) project expense cannot be modified even by ORGANIZER", () => {
		expect(
			deriveCanModify({
				isLocked: true,
				projectId: P,
				isCreator: false,
				roleMap: roleMap("ORGANIZER"),
			}),
		).toBe(false);
	});

	it("standalone expense: only the creator can modify (role ignored)", () => {
		expect(
			deriveCanModify({
				isLocked: false,
				projectId: null,
				isCreator: true,
				roleMap: new Map(),
			}),
		).toBe(true);
		expect(
			deriveCanModify({
				isLocked: false,
				projectId: null,
				isCreator: false,
				roleMap: new Map(),
			}),
		).toBe(false);
	});

	it("locked standalone expense cannot be modified even by its creator", () => {
		expect(
			deriveCanModify({
				isLocked: true,
				projectId: null,
				isCreator: true,
				roleMap: new Map(),
			}),
		).toBe(false);
	});
});
