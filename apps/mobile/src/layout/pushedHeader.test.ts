import { HEADER_TITLE_FACE, pushedHeader } from "./pushedHeader";

// A native large title would otherwise be the system font while the body is
// DM Sans; the header takes the app's semibold face.
describe("header title face", () => {
	it("is DM Sans semibold for the large and the inline title", () => {
		expect(HEADER_TITLE_FACE.headerLargeTitleStyle.fontFamily).toBe(
			"DMSans_600SemiBold",
		);
		expect(HEADER_TITLE_FACE.headerTitleStyle.fontFamily).toBe(
			"DMSans_600SemiBold",
		);
	});

	it("reaches every pushed settings page", () => {
		const header = pushedHeader({ bg: "#000", fg: "#fff" }, false);
		expect(header.headerLargeTitleStyle).toBe(
			HEADER_TITLE_FACE.headerLargeTitleStyle,
		);
	});
});
