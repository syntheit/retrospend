jest.mock("use-intl", () => ({ useTranslations: () => () => "" }));

import { joinList } from "./list";

const say = (key: string, values: Record<string, string> = {}) =>
	key === "two"
		? `${values.first} and ${values.second}`
		: key === "many"
			? `${values.rest}, and ${values.last}`
			: ", ";

describe("joinList", () => {
	it("joins none, one, two and many", () => {
		expect(joinList(say, [])).toBe("");
		expect(joinList(say, ["Cafe"])).toBe("Cafe");
		expect(joinList(say, ["Cafe", "Transport"])).toBe("Cafe and Transport");
		expect(joinList(say, ["A", "B", "C"])).toBe("A, B, and C");
	});
});
