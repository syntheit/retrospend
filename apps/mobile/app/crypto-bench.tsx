import type { ComponentType } from "react";

// Development only (flags.ts). Metro folds the condition, so a release build
// leaves the screen out of the bundle: scripts/check-release-bundle.sh greps
// for its name.
const bench: { CryptoBench: ComponentType } | null =
	__DEV__ || process.env.EXPO_PUBLIC_GALLERY === "1"
		? require("@/dev/CryptoBench")
		: null;

export default function CryptoBenchRoute() {
	return bench ? <bench.CryptoBench /> : null;
}
