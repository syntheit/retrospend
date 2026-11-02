/**
 * The two files that tie the mobile apps to this domain: Apple's
 * apple-app-site-association (universal links for the paths the app has
 * screens for, and webcredentials so the password manager offers saved
 * sign-ins) and Android's Digital Asset Links (app links, and
 * get_login_creds for the same autofill).
 *
 * Only retrospend.app and dev.retrospend.app are listed in the app's
 * associated domains and intent filters (apps/mobile/app.config.ts), so
 * links to a self-hosted server on another domain keep opening the browser.
 */

const APPLE_TEAM_ID = "6NHZWHQX37";
const BUNDLE_ID = "app.retrospend";
const ANDROID_PACKAGE = "app.retrospend";

/**
 * SHA-256 fingerprint of the certificate the release APK is signed with
 * (scripts/android-release.sh, the F-Droid repo). A fingerprint is public.
 * ANDROID_APP_CERT_SHA256 adds more, such as a Play signing key.
 */
export const RELEASE_CERT_SHA256 =
	"DD:1A:59:EA:15:13:19:6F:B9:68:F8:DF:C9:7D:1D:88:27:8C:5B:60:EE:13:F9:39:AE:52:66:DE:44:73:1F:61";

/**
 * The first path segments the app opens (the same list as WEB_LINK_PATHS in
 * apps/mobile/src/surfaces/links.ts, which a test keeps equal).
 */
export const APP_LINK_PATHS = [
	"projects",
	"people",
	"entries",
	"notifications",
	"home",
	"activity",
	"budget",
	"wealth",
] as const;

export function appleAppSiteAssociation() {
	const appID = `${APPLE_TEAM_ID}.${BUNDLE_ID}`;
	return {
		applinks: {
			details: [
				{
					appIDs: [appID],
					components: APP_LINK_PATHS.flatMap((path) => [
						{ "/": `/${path}` },
						{ "/": `/${path}/*` },
					]),
				},
			],
		},
		webcredentials: { apps: [appID] },
	};
}

/** The fingerprints from a comma-separated setting, upper-cased, blanks dropped. */
export function certFingerprints(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(",")
		.map((value) => value.trim().toUpperCase())
		.filter(Boolean);
}

/** The release key first, then any the setting adds, each once. */
export function assetLinks(raw: string | undefined) {
	const fingerprints = [
		...new Set([RELEASE_CERT_SHA256, ...certFingerprints(raw)]),
	];
	return [
		{
			relation: [
				"delegate_permission/common.get_login_creds",
				"delegate_permission/common.handle_all_urls",
			],
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
