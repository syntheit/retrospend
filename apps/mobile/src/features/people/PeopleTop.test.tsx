import { PeopleTop } from "./PeopleTop";
import type { PeopleOverview } from "./source";

const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
jest.mock("@/ui/Text", () => ({
	Text: ({ children }: { children?: unknown }) =>
		require("react").createElement("Text", null, children),
}));
jest.mock("./BalanceBar", () => ({ BalanceBar: () => null }));
jest.mock("./NetAmount", () => ({ NetAmount: () => null }));

function render(people: { group: string }[]) {
	const overview = { people, owedToYou: null, youOwe: null } as unknown as PeopleOverview;
	let tree!: { toJSON(): unknown };
	act(() => {
		tree = create(<PeopleTop onPerson={jest.fn()} overview={overview} />);
	});
	return JSON.stringify(tree.toJSON());
}

describe("PeopleTop", () => {
	it("says nothing when there is no one yet, so it never claims a settlement", () => {
		expect(render([])).not.toContain("allSettled");
		expect(render([])).toBe("null");
	});

	it("says settled when people exist and nobody owes", () => {
		expect(render([{ group: "settled" }])).toContain("allSettled");
	});
});
