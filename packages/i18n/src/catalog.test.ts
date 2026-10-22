import { describe, expect, it } from "vitest";
import { assembleCatalog, mergeMessageCatalogs } from "./catalog";

describe("mergeMessageCatalogs", () => {
	it("keeps English leaves that are missing from a localized catalog", () => {
		const english = {
			common: { save: "Save", cancel: "Cancel" },
			page: { title: "Settings" },
		};
		const localized = {
			common: { save: "Enregistrer" },
		};

		expect(mergeMessageCatalogs(english, localized)).toEqual({
			common: { save: "Enregistrer", cancel: "Cancel" },
			page: { title: "Settings" },
		});
	});

	it("lets localized leaves and namespaces override the fallback", () => {
		const english = {
			status: "Status",
			page: { title: "Settings" },
		};
		const localized = {
			status: "Statut",
			page: { title: "Paramètres" },
		};

		expect(mergeMessageCatalogs(english, localized)).toEqual(localized);
	});

	it("does not mutate either input", () => {
		const english = { common: { save: "Save", cancel: "Cancel" } };
		const localized = { common: { save: "Guardar" } };

		mergeMessageCatalogs(english, localized);

		expect(english).toEqual({
			common: { save: "Save", cancel: "Cancel" },
		});
		expect(localized).toEqual({ common: { save: "Guardar" } });
	});
});

describe("assembleCatalog", () => {
	it("adds each feature file under its own namespace", () => {
		const shared = { common: { save: "Save" } };
		const features = { budget: { title: "Budget" } };

		expect(assembleCatalog(shared, features)).toEqual({
			common: { save: "Save" },
			budget: { title: "Budget" },
		});
	});

	it("rejects a feature namespace the shared catalog already has", () => {
		expect(() =>
			assembleCatalog({ budget: { title: "Budget" } }, { budget: {} }),
		).toThrow('Message namespace "budget"');
	});
});
