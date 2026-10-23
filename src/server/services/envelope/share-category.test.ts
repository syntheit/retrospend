/** D19: your share of someone else's split takes your own category. */
import { describe, expect, it } from "vitest";
import {
	resolveShareCategories,
	type ShareForCategory,
} from "./share-category";

const MINE = [
	{ id: "c-groc", name: "Groceries" },
	{ id: "c-cafe", name: "Café" },
	{ id: "c-trip", name: "Travel" },
	{ id: "c-home", name: "Home" },
];

const share = (
	id: string,
	extra: Partial<ShareForCategory> = {},
): ShareForCategory => ({
	id,
	categoryId: null,
	categorySource: null,
	date: "2026-10-10",
	projectId: null,
	payer: "user:sam",
	title: "Things",
	creatorCategory: null,
	...extra,
});

const pick = (shares: ShareForCategory[], id: string) =>
	resolveShareCategories(shares, MINE).get(id);

describe("share categories (D19)", () => {
	it("your own pick wins over every default", () => {
		const s = share("a", {
			categoryId: "c-home",
			categorySource: "USER",
			creatorCategory: { id: "x", name: "Groceries", isMine: false },
		});
		expect(pick([s], "a")).toEqual({ categoryId: "c-home", source: "USER" });
	});

	it("a split you created in your own category keeps it", () => {
		const s = share("a", {
			creatorCategory: { id: "c-groc", name: "Groceries", isMine: true },
		});
		expect(pick([s], "a")).toEqual({ categoryId: "c-groc", source: null });
	});

	it("NAME_MATCH: the creator's category name, ignoring case and accents", () => {
		const s = share("a", {
			creatorCategory: { id: "x", name: "  CAFE ", isMine: false },
		});
		expect(pick([s], "a")).toEqual({
			categoryId: "c-cafe",
			source: "NAME_MATCH",
		});
	});

	it("PROJECT: the category you last picked in the same project", () => {
		const earlier = share("e", {
			projectId: "trip",
			payer: "user:clara",
			categoryId: "c-trip",
			categorySource: "USER",
			date: "2026-10-01",
		});
		const s = share("a", { projectId: "trip" });
		expect(pick([earlier, s], "a")).toEqual({
			categoryId: "c-trip",
			source: "PROJECT",
		});
	});

	it("PERSON: the category you last picked for something that person paid", () => {
		const older = share("o", {
			categoryId: "c-home",
			categorySource: "USER",
			date: "2026-09-01",
		});
		const newer = share("n", {
			categoryId: "c-groc",
			categorySource: "USER",
			date: "2026-09-20",
		});
		expect(pick([newer, older, share("a")], "a")).toEqual({
			categoryId: "c-groc",
			source: "PERSON",
		});
	});

	it("TITLE: the Add sheet's matcher, when you have a category of that name", () => {
		expect(pick([share("a", { title: "Whole Foods run" })], "a")).toEqual({
			categoryId: "c-groc",
			source: "TITLE",
		});
	});

	it("a guess never seeds another guess: only your own picks feed PROJECT and PERSON", () => {
		const guessed = share("g", {
			categoryId: "c-cafe",
			categorySource: "NAME_MATCH",
		});
		expect(pick([guessed, share("a")], "a")).toEqual({
			categoryId: null,
			source: null,
		});
	});

	it("with nothing to go on, the share is unresolved (Everything else, one Needs you item)", () => {
		expect(pick([share("a")], "a")).toEqual({ categoryId: null, source: null });
	});

	it("a stored category you no longer have is ignored and the defaults run again", () => {
		const s = share("a", {
			categoryId: "deleted",
			categorySource: "USER",
			title: "Whole Foods run",
		});
		expect(pick([s], "a")).toEqual({ categoryId: "c-groc", source: "TITLE" });
	});
});
