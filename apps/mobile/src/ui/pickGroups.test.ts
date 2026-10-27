import { filterGroups, type PickGroup } from "./pickGroups";

const row = (
	id: string,
	label: string,
	detail?: string,
	keywords?: string[],
) => ({ id, label, detail, keywords, lead: null, selected: false });

const groups: PickGroup[] = [
	{
		key: "yours",
		heading: "Yours",
		rows: [row("ARS", "ARS", "peso argentino", ["Argentine Peso"])],
	},
	{ key: "recent", heading: "Recent", rows: [] },
	{
		key: "all",
		heading: "All",
		rows: [
			row("EUR", "EUR", "euro"),
			row("BRL", "BRL", "real brasileño", ["Brazilian Real"]),
		],
	},
];

const ids = (found: PickGroup[]) =>
	found.flatMap((g) => g.rows.map((r) => r.id));

describe("filterGroups", () => {
	it("keeps every group with rows when nothing is typed", () => {
		expect(filterGroups(groups, "").map((g) => g.key)).toEqual([
			"yours",
			"all",
		]);
	});

	it("matches the code, the shown name or the English name, ignoring accents", () => {
		expect(ids(filterGroups(groups, "arg"))).toEqual(["ARS"]);
		expect(ids(filterGroups(groups, "brasileno"))).toEqual(["BRL"]);
		expect(ids(filterGroups(groups, "brazil"))).toEqual(["BRL"]);
		expect(ids(filterGroups(groups, "eu"))).toEqual(["EUR"]);
	});

	it("drops groups with no match", () => {
		expect(filterGroups(groups, "zzz")).toEqual([]);
	});
});
