import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		BETTER_AUTH_SECRET: z.string().min(1),
		DATABASE_URL: z.url(),
		SIDECAR_URL: z.url().default("http://retrospend-sidecar:8080"),
		WORKER_API_KEY: z.string().min(1).optional(),

		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		PUBLIC_URL: z.url().optional(),
		TRUSTED_ORIGINS: z.string().optional(),
		OPENROUTER_API_KEY: z.string().optional(),
		SMTP_HOST: z.string().optional(),
		SMTP_PORT: z.coerce.number().optional(),
		SMTP_USER: z.string().optional(),
		SMTP_PASSWORD: z.string().optional(),
		EMAIL_FROM: z.string().optional(),

		UPLOAD_DIR: z.string().default("./uploads"),
		// Finished API exports. Never under UPLOAD_DIR, whose files /api/images
		// serves without sign-in. Defaults to the OS temp dir.
		EXPORT_DIR: z.string().optional(),

		// Used to sign one-click unsubscribe tokens in notification emails
		UNSUBSCRIBE_SECRET: z.string().optional(),

		// Push endpoint hosts allowed although they are IP literals or
		// localhost names (a LAN ntfy server), comma-separated.
		PUSH_ENDPOINT_ALLOW_HOSTS: z.string().optional(),

		// The server master key that wraps per-user data keys: 64 hex characters
		// (optionally `<id>:<hex>` entries), or a path to a file holding it. A
		// malformed value stops the server at start (src/server/crypto/master-key.ts).
		DATA_MASTER_KEY: z.string().optional(),
		DATA_MASTER_KEY_FILE: z.string().optional(),
		// Seal user text on write (E2EE D11). Development and tests only until
		// sealing is released (src/server/crypto/release.ts); the server will
		// not start with it on unless the master key, the key store grants and
		// every category's name index are in place.
		DATA_KEYS_WRITE: z
			.enum(["true", "false"])
			.default("false")
			.transform((v) => v === "true"),
		// Post due "pay automatically" recurring items every 15 minutes
		// (recurring-auto-post.ts). Unset: on in production only, so dev,
		// tests and e2e never post their seeded templates.
		RECURRING_AUTO_POST: z.enum(["true", "false"]).optional(),

		// Push senders. A sender with missing settings is off; nothing else
		// changes. See docs/self-hosting for how to get each value.
		APNS_KEY_ID: z.string().optional(),
		APNS_TEAM_ID: z.string().optional(),
		APNS_BUNDLE_ID: z.string().optional(),
		// The .p8 key text (newlines may be written as \n), or a path to it.
		APNS_KEY: z.string().optional(),
		APNS_KEY_FILE: z.string().optional(),
		VAPID_PUBLIC_KEY: z.string().optional(),
		VAPID_PRIVATE_KEY: z.string().optional(),
		VAPID_SUBJECT: z.string().optional(),
		FCM_PROJECT_ID: z.string().optional(),
		// The Google service account JSON, or a path to it.
		FCM_SERVICE_ACCOUNT: z.string().optional(),
		FCM_SERVICE_ACCOUNT_FILE: z.string().optional(),

		// More SHA-256 fingerprint(s) of the Android app's signing certificate,
		// comma-separated, besides the release key. Served in
		// /.well-known/assetlinks.json so the phone trusts the app for this
		// domain (app links, password manager autofill).
		ANDROID_APP_CERT_SHA256: z.string().optional(),
		// Where to report a vulnerability, comma-separated mailto: or https:
		// links. Served in /.well-known/security.txt.
		SECURITY_CONTACT: z.string().optional(),
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:1997"),
		NEXT_PUBLIC_SHOW_LANDING_PAGE: z.enum(["true", "false"]).default("false"),
		NEXT_PUBLIC_ENABLE_LEGAL_PAGES: z.enum(["true", "false"]).default("true"),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		BETTER_AUTH_SECRET:
			process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET,
		DATABASE_URL: process.env.DATABASE_URL,
		SIDECAR_URL:
			process.env.SIDECAR_URL ??
			process.env.WORKER_URL ??
			process.env.IMPORTER_URL,
		WORKER_API_KEY: process.env.WORKER_API_KEY,
		NEXT_PUBLIC_SHOW_LANDING_PAGE:
			process.env.SHOW_LANDING_PAGE ??
			process.env.NEXT_PUBLIC_SHOW_LANDING_PAGE,
		NEXT_PUBLIC_ENABLE_LEGAL_PAGES:
			process.env.ENABLE_LEGAL_PAGES ??
			process.env.NEXT_PUBLIC_ENABLE_LEGAL_PAGES,
		NODE_ENV: process.env.NODE_ENV,
		NEXT_PUBLIC_APP_URL:
			process.env.PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL,
		PUBLIC_URL: process.env.PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL,
		TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
		OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
		SMTP_HOST: process.env.SMTP_HOST,
		SMTP_PORT: process.env.SMTP_PORT,
		SMTP_USER: process.env.SMTP_USER,
		SMTP_PASSWORD: process.env.SMTP_PASSWORD,
		EMAIL_FROM: process.env.EMAIL_FROM,

		UPLOAD_DIR: process.env.UPLOAD_DIR,
		EXPORT_DIR: process.env.EXPORT_DIR,
		UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET,
		PUSH_ENDPOINT_ALLOW_HOSTS: process.env.PUSH_ENDPOINT_ALLOW_HOSTS,
		DATA_MASTER_KEY: process.env.DATA_MASTER_KEY,
		DATA_MASTER_KEY_FILE: process.env.DATA_MASTER_KEY_FILE,
		DATA_KEYS_WRITE: process.env.DATA_KEYS_WRITE,
		RECURRING_AUTO_POST: process.env.RECURRING_AUTO_POST,
		APNS_KEY_ID: process.env.APNS_KEY_ID,
		APNS_TEAM_ID: process.env.APNS_TEAM_ID,
		APNS_BUNDLE_ID: process.env.APNS_BUNDLE_ID,
		APNS_KEY: process.env.APNS_KEY,
		APNS_KEY_FILE: process.env.APNS_KEY_FILE,
		VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
		VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
		VAPID_SUBJECT: process.env.VAPID_SUBJECT,
		FCM_PROJECT_ID: process.env.FCM_PROJECT_ID,
		FCM_SERVICE_ACCOUNT: process.env.FCM_SERVICE_ACCOUNT,
		FCM_SERVICE_ACCOUNT_FILE: process.env.FCM_SERVICE_ACCOUNT_FILE,
		ANDROID_APP_CERT_SHA256: process.env.ANDROID_APP_CERT_SHA256,
		SECURITY_CONTACT: process.env.SECURITY_CONTACT,
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
});
