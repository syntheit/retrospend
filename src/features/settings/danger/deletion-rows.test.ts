import settingsV2 from "@retrospend/i18n/messages/en/settingsV2.json";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { projectRows } from "./deletion-rows";

const t = createTranslator({
	locale: "en",
	messages: { settingsV2 },
	namespace: "settingsV2.delete",
});
const say = (key: string, values?: { owner: string }) =>
	(t as (k: string, v?: { owner: string }) => string)(key, values);

describe("projectRows", () => {
	it("shows the project's name and who it moves to", () => {
		expect(
			projectRows(
				{
					projectsToTransfer: [{ id: "a", name: "Bariloche", newOrganizerName: "Ana" }],
					projectsToDelete: [{ id: "b", name: "Alquiler" }],
				},
				say,
			),
		).toEqual([
			{ key: "t-a", title: "Bariloche", meta: "Moves to Ana" },
			{ key: "d-b", title: "Alquiler", meta: "Deleted, you are its only member" },
		]);
	});

	// The server gives null for a name it cannot read (its key is unavailable).
	it("words a project with no name and an organizer with no name, with no empty title or gap", () => {
		expect(
			projectRows(
				{
					projectsToTransfer: [{ id: "a", name: null, newOrganizerName: null }],
					projectsToDelete: [{ id: "b", name: null }],
				},
				say,
			),
		).toEqual([
			{ key: "t-a", title: "A project", meta: "Moves to another member" },
			{ key: "d-b", title: "A project", meta: "Deleted, you are its only member" },
		]);
	});
});
