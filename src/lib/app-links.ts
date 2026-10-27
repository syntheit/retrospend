/**
 * The two files that tie the mobile apps to this domain, so the phone's
 * password manager offers saved sign-ins inside the app:
 * Apple's apple-app-site-association (webcredentials only) and Android's
 * Digital Asset Links (get_login_creds).
 */

const APPLE_TEAM_ID = "6NHZWHQX37";
const BUNDLE_ID = "app.retrospend";
const ANDROID_PACKAGE = "app.retrospend";

export function appleAppSiteAssociation() {
	return { webcredentials: { apps: [`${APPLE_TEAM_ID}.${BUNDLE_ID}`] } };
}

/** The fingerprints from a comma-separated setting, upper-cased, blanks dropped. */
export function certFingerprints(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(",")
		.map((value) => value.trim().toUpperCase())
		.filter(Boolean);
}

/**
 * Without a fingerprint the list is empty: Android cannot verify the app
 * yet, and a statement with no fingerprint would be invalid.
 */
export function assetLinks(raw: string | undefined) {
	const fingerprints = certFingerprints(raw);
	if (fingerprints.length === 0) return [];
	return [
		{
			relation: ["delegate_permission/common.get_login_creds"],
			target: {
				namespace: "android_app",
				package_name: ANDROID_PACKAGE,
				sha256_cert_fingerprints: fingerprints,
			},
		},
	];
}

/** Plain JSON, never a redirect: Apple and Google both refuse one. */
export function jsonFile(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
