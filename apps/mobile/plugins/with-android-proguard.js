// Keep rules for the R8-minified Android release build.
//
// WorkManager (expo-background-task's poll) opens its Room database by
// reflection: Room loads WorkDatabase_Impl and calls its no-argument
// constructor. Room 2.5's consumer rule keeps the class but not that
// constructor, so R8 full mode removes it and the app dies at startup in
// androidx.startup ("Failed to create an instance of class
// androidx.work.impl.WorkDatabase"). Debug builds and minify-off builds hide it.
//
// The rules are appended to the generated android/app/proguard-rules.pro
// (which `expo prebuild` rewrites from its template every run).
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

const MARKER = "# retrospend: keep rules (plugins/with-android-proguard.js)";

const RULES = `${MARKER}
# Room opens every generated database by reflection, through its default constructor.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
# WorkManager creates its workers (expo-background-task's poll) by reflection.
-keep class * extends androidx.work.ListenableWorker { <init>(...); }
`;

/** The rules file's text with ours added once. */
function addRules(source) {
	return source.includes(MARKER)
		? source
		: `${source.replace(/\s*$/, "\n")}\n${RULES}`;
}

module.exports = function withAndroidProguard(config) {
	return withDangerousMod(config, [
		"android",
		(mod) => {
			const file = path.join(
				mod.modRequest.platformProjectRoot,
				"app/proguard-rules.pro",
			);
			fs.writeFileSync(file, addRules(fs.readFileSync(file, "utf8")));
			return mod;
		},
	]);
};
module.exports.addRules = addRules;
module.exports.RULES = RULES;
