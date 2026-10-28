/**
 * @jest-environment node
 */
import config from "../app.config";

const { addRules, RULES } = require("../plugins/with-android-proguard");

const TEMPLATE = `# Add project specific ProGuard rules here.
-keep class com.swmansion.reanimated.** { *; }

# Add any project specific keep options here:
`;

describe("Android proguard plugin", () => {
	it("is registered", () => {
		expect(config.plugins).toContain("./plugins/with-android-proguard");
	});

	it("keeps Room's reflective constructor and WorkManager's workers", () => {
		const text = addRules(TEMPLATE) as string;
		expect(text).toContain(
			"-keep class * extends androidx.room.RoomDatabase { <init>(); }",
		);
		expect(text).toContain(
			"-keep class * extends androidx.work.ListenableWorker { <init>(...); }",
		);
		// The template's own rules stay.
		expect(text).toContain("com.swmansion.reanimated");
	});

	it("adds the rules once", () => {
		const once = addRules(TEMPLATE) as string;
		expect(addRules(once)).toBe(once);
		expect(once.split(RULES.split("\n")[0]).length).toBe(2);
	});
});
