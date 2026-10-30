import { StatusText } from "./StatusText";

const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

function lines(wrap: boolean): number | undefined {
	let tree:
		| {
				root: {
					findByType(t: string): { props: { numberOfLines?: number } };
				};
		  }
		| undefined;
	act(() => {
		tree = create(
			<StatusText label="Overdue since Oct 3" tone="attention" wrap={wrap} />,
		);
	});
	return tree?.root.findByType("Text").props.numberOfLines;
}

describe("StatusText", () => {
	it("stays on one line by default", () => {
		expect(lines(false)).toBe(1);
	});

	it("wraps under the title when asked, for big text sizes", () => {
		expect(lines(true)).toBeUndefined();
	});
});
