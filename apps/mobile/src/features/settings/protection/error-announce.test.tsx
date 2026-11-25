import { createElement } from "react";
import { mount } from "../../../../test/harness";
import { FieldError } from "@/ui/TextField";
import { StepError } from "./EnableSteps";

// The two shared error lines are live regions, so TalkBack reads a new error
// out when it appears (iOS reads the alert role). Every sheet and field that
// shows one gets this from here.
jest.mock("@retrospend/api-contract", () =>
	jest.requireActual(
		"../../../../../../packages/api-contract/src/account/password-rules",
	),
);
jest.mock("@/ui/Glyph", () => ({ Glyph: () => null }));

const announced = (tree: Awaited<ReturnType<typeof mount>>) =>
	tree.root.findAll(
		(n) =>
			typeof n.type === "string" &&
			n.props.accessibilityRole === "alert" &&
			n.props.accessibilityLiveRegion === "polite",
	);

describe("error lines", () => {
	it("a field's error is a polite live region", async () => {
		expect(
			announced(await mount(createElement(FieldError, null, "Does not match"))),
		).toHaveLength(1);
	});

	it("a step's error is a polite live region, and nothing when there is no error", async () => {
		expect(
			announced(await mount(<StepError text={"Couldn't finish."} />)),
		).toHaveLength(1);
		expect(announced(await mount(<StepError text={null} />))).toHaveLength(0);
	});
});
