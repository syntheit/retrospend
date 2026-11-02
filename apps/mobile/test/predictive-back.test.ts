/**
 * @jest-environment node
 */
import config from "../app.config";

const {
	setAttribute,
	valuesXml,
	NAME,
} = require("../plugins/with-predictive-back");

describe("predictive back plugin", () => {
	it("is registered", () => {
		expect(config.plugins).toContain("./plugins/with-predictive-back");
	});

	it("points the manifest flag at a per-version resource", () => {
		const manifest = {
			manifest: {
				application: [
					{ $: { "android:enableOnBackInvokedCallback": "false" } },
				],
			},
		};
		const out = setAttribute(manifest);
		expect(out.manifest.application[0].$).toEqual({
			"android:enableOnBackInvokedCallback": `@bool/${NAME}`,
		});
	});

	it("writes false by default and true for Android 16", () => {
		expect(valuesXml("false")).toContain(`<bool name="${NAME}">false</bool>`);
		expect(valuesXml("true")).toContain(`<bool name="${NAME}">true</bool>`);
	});
});
