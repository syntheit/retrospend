import { Text } from "react-native";
import { ChangeList } from "./ChangeList";

// One "What this changes" block: the heading, the lines that moved, one
// sentence for what stays and one for what could not be checked. It says
// nothing until the dry run is in, and gives a reason in place of lines.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("./TextAction", () => {
	const { Text } = require("react-native");
	return {
		TextAction: ({ label }: { label: string }) => (
			<Text>{`action:${label}`}</Text>
		),
	};
});
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string, values?: Record<string, string>) =>
		values ? `${key}:${Object.values(values).join("|")}` : key,
}));

interface TestNode {
	props: Record<string, unknown>;
	findAllByType(type: unknown): TestNode[];
}

function words(element: React.ReactElement): string[] {
	let tree: { root: TestNode } | undefined;
	act(() => {
		tree = create(element);
	});
	if (!tree) throw new Error("did not render");
	return tree.root.findAllByType(Text).map((n) => String(n.props.children));
}

describe("ChangeList", () => {
	it("shows nothing before there is anything to check", () => {
		expect(words(<ChangeList status="idle" />)).toEqual([]);
	});

	it("shows nothing until the dry run is in", () => {
		expect(words(<ChangeList status="loading" />)).toEqual([]);
	});

	it("lays out the lines, then one sentence for what stays and what could not be checked", () => {
		const out = words(
			<ChangeList
				changes={[{ key: "a", label: "Left", value: "$10 to $5" }]}
				status="ready"
				stays={["Net worth", "Net worth", "Holds"]}
				unavailable={["Rate"]}
			/>,
		);
		expect(out).toContain("Left");
		expect(out).toContain("$10 to $5");
		expect(out).toContain("nothingElse:Net worth, Holds unavailable:Rate");
	});

	it("says no change to what it checked when nothing moved", () => {
		const out = words(<ChangeList status="ready" stays={["Net worth"]} />);
		expect(out).toContain("noneChange:Net worth");
	});

	it("says it changes nothing when there is nothing to say", () => {
		expect(words(<ChangeList status="ready" />)).toContain("nothing");
	});

	it("gives a reason in place of the lines, with Try again", () => {
		const out = words(
			<ChangeList message="Offline" onRetry={() => undefined} status="ready" />,
		);
		expect(out).toEqual(["title", "Offline", "action:retry"]);
	});

	it("shows a share group under its own heading", () => {
		const out = words(
			<ChangeList
				groups={[
					{
						key: "s",
						title: "Whose share",
						rows: [{ key: "x", label: "You", value: "$5" }],
						note: "Told",
					},
				]}
				status="ready"
			/>,
		);
		expect(out).toEqual(
			expect.arrayContaining(["Whose share", "You", "$5", "Told"]),
		);
	});
});
