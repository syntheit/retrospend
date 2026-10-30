import { MoneyAmount } from "./Money";

// A tile figure has to fit its box at any text size: the line stretches to
// the width it must fit and shrinks, never clips.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const fontScale = { current: 1 };
jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/lib/money", () => ({
	useFormatMoney: () => ({
		format: (m: { minor: number; currency: string }) =>
			`${m.currency} ${m.minor}`,
		pair: () => ({ original: "x", home: null }),
	}),
}));
jest.mock("@/lib/rateTypes", () => ({
	useRateTypeName: () => (k: string) => k,
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
	__esModule: true,
	default: () => ({
		width: 390,
		height: 844,
		scale: 3,
		fontScale: fontScale.current,
	}),
}));

interface Found {
	props: Record<string, unknown> & { style?: Record<string, unknown> };
}

function render(scale: number) {
	fontScale.current = scale;
	let tree:
		| { root: { findAll(m: (n: Found) => boolean): Found[] } }
		| undefined;
	act(() => {
		tree = create(
			<MoneyAmount
				align="left"
				size="section"
				value={{ minor: 125211878, currency: "USD" }}
			/>,
		);
	});
	const root = tree?.root;
	return {
		box: root?.findAll((n) => n.props.style?.alignItems !== undefined)[0],
		text: root?.findAll((n) => n.props.adjustsFontSizeToFit === true)[0],
	};
}

describe.each([1, 2])("MoneyAmount at text scale %s", (scale) => {
	it("stretches its line and shrinks to fit", () => {
		const { box, text } = render(scale);
		expect(box?.props.style).toMatchObject({
			alignItems: "stretch",
			minWidth: 0,
		});
		expect(text?.props).toMatchObject({
			numberOfLines: 1,
			ellipsizeMode: "clip",
		});
	});
});
