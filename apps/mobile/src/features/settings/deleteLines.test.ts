import { createTranslator } from "use-intl";
import { loadMessages } from "@/lib/i18n";
import { projectLines } from "./deleteLines";

const translator = createTranslator({
	locale: "en",
	messages: loadMessages("en"),
	namespace: "mobile.settings.delete",
});
const t = translator as unknown as Parameters<typeof projectLines>[1];

describe("projectLines", () => {
	it("names the project and who takes it over", () => {
		expect(
			projectLines(
				{
					projectsToTransfer: [{ id: "a", name: "Bariloche", newOrganizerName: "Ana" }],
					projectsToDelete: [{ id: "b", name: "Alquiler" }],
				},
				t,
			),
		).toEqual([
			"Bariloche goes to Ana",
			"Alquiler is deleted, nobody else can run it",
		]);
	});

	// The server gives null for a name it cannot read (its key is unavailable).
	it("words a project with no name, and an organizer with no name, instead of leaving a gap", () => {
		expect(
			projectLines(
				{
					projectsToTransfer: [{ id: "a", name: null, newOrganizerName: null }],
					projectsToDelete: [{ id: "b", name: null }],
				},
				t,
			),
		).toEqual([
			"A project goes to another member",
			"A project is deleted, nobody else can run it",
		]);
	});
});
