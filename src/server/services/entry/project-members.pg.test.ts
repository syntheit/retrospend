/**
 * The Add expense sheet's project people on real Postgres. A 7-person
 * project (you and six others: Ana and Beto on Retrospend, four shadows)
 * plus Eva, who left on Oct 10. The project list loads five participants
 * for faces; the sheet's read returns all six others on Oct 20, and seven
 * on Oct 5, when Eva was still a member.
 */
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { listProjects } from "../project/project-read.service";
import { entryProjectMembers } from "./project-members";

async function sevenPersonProject() {
	const you = await createTestUser();
	const ana = await createTestUser();
	const beto = await createTestUser();
	const project = await adminDb.project.create({
		data: { name: "Viaje grande", createdById: you.user.id },
	});
	const join = (
		participantType: "user" | "shadow",
		participantId: string,
		extra: { role?: "ORGANIZER" | "CONTRIBUTOR"; leftOn?: Date } = {},
	) =>
		adminDb.projectParticipant.create({
			data: {
				projectId: project.id,
				participantType,
				participantId,
				role: extra.role ?? "CONTRIBUTOR",
				leftOn: extra.leftOn ?? null,
			},
		});
	await join("user", you.user.id, { role: "ORGANIZER" });
	await join("user", ana.user.id);
	await join("user", beto.user.id);
	for (const name of ["Caro", "Dani", "Fede", "Gabi", "Eva"]) {
		const s = await adminDb.shadowProfile.create({
			data: { createdById: you.user.id, name },
		});
		await join(
			"shadow",
			s.id,
			name === "Eva" ? { leftOn: new Date("2026-10-10") } : {},
		);
	}
	return { you, project };
}

describe("entry.projectMembers", () => {
	it("returns every member on the day, without you, past the list's five", async () => {
		const { you, project } = await sevenPersonProject();

		// The list keeps five participants for faces: not enough for a split.
		const listed = (await listProjects(adminDb, you.user.id)).find(
			(p) => p.id === project.id,
		);
		expect(listed?.participants).toHaveLength(5);

		const on20 = await entryProjectMembers(
			adminDb,
			you.user.id,
			project.id,
			"2026-10-20",
		);
		// Seven people: you plus six others; Eva left on Oct 10.
		expect(on20).toHaveLength(6);
		expect(on20.filter((m) => m.participantType === "user")).toHaveLength(2);
		expect(
			on20
				.filter((m) => m.participantType === "shadow")
				.map((m) => m.name)
				.sort(),
		).toEqual(["Caro", "Dani", "Fede", "Gabi"]);
		expect(on20.some((m) => m.participantId === you.user.id)).toBe(false);
		expect(on20.some((m) => m.name === "Eva")).toBe(false);

		const on5 = await entryProjectMembers(
			adminDb,
			you.user.id,
			project.id,
			"2026-10-05",
		);
		expect(on5).toHaveLength(7);
		expect(on5.some((m) => m.name === "Eva")).toBe(true);
	});

	it("is closed to people outside the project", async () => {
		const { project } = await sevenPersonProject();
		const stranger = await createTestUser();
		await expect(
			entryProjectMembers(adminDb, stranger.user.id, project.id, "2026-10-20"),
		).rejects.toThrow();
	});
});
