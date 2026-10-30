import { TextField } from "./TextField";

// The sign-in and connect screens use TextField, so a password manager must
// still find the fields: the autofill hints, the keyboard and the return key
// reach the native input, and a busy screen makes it read-only.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/theme/fonts", () => ({ fontFamilyFor: () => "DM Sans" }));

function input(props: Parameters<typeof TextField>[0]) {
	let tree: { root: TestNode } | undefined;
	act(() => {
		tree = create(<TextField {...props} />);
	});
	const found = tree?.root.findAll(
		(n) =>
			typeof n.props.accessibilityLabel === "string" &&
			"onChangeText" in n.props,
	)[0];
	if (!found) throw new Error("no input");
	return found.props;
}

describe("TextField autofill", () => {
	it("passes the hints a password manager keys on", () => {
		const onSubmit = jest.fn();
		const props = input({
			label: "Email",
			value: "",
			onChangeText: jest.fn(),
			autoComplete: "username",
			textContentType: "username",
			inputMode: "email",
			keyboardType: "email-address",
			returnKeyType: "go",
			onSubmitEditing: onSubmit,
		});
		expect(props.autoComplete).toBe("username");
		expect(props.textContentType).toBe("username");
		expect(props.importantForAutofill).toBe("yes");
		expect(props.inputMode).toBe("email");
		expect(props.returnKeyType).toBe("go");
		expect(props.onSubmitEditing).toBe(onSubmit);
		expect(props.editable).toBe(true);
	});

	it("is read-only while disabled and does not offer autofill by default", () => {
		const props = input({
			label: "Name",
			value: "",
			onChangeText: jest.fn(),
			disabled: true,
		});
		expect(props.editable).toBe(false);
		expect(props.importantForAutofill).toBe("auto");
		expect(props.returnKeyType).toBe("done");
	});
});
