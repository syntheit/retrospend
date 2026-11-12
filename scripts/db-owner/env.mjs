// The environments of the processes a start runs: the migration tools get the
// system variables and Prisma's, the app gets the names it reads. Neither ever
// holds the database superuser's credentials. (A start with a superuser URL
// holds them only in the entrypoint's shell, and in the one process that
// bootstraps.)

/** The shell and the platform: what every process of a start needs. */
const SYSTEM_ENV_NAMES = [
	"PATH",
	"HOME",
	"TZ",
	"LANG",
	"LC_ALL",
	"NODE_OPTIONS",
	"NODE_EXTRA_CA_CERTS",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
];

/** Environment variables the app process may see; see buildAppEnv. */
export const APP_ENV_NAMES = [
	...SYSTEM_ENV_NAMES,
	"HOSTNAME",
	"PORT",
	"NODE_ENV",
	"NEXT_TELEMETRY_DISABLED",
	"NEXT_RUNTIME",
	// What the app reads (src/env.js and the other process.env readers)
	"DATABASE_URL",
	"AUTH_SECRET",
	"BETTER_AUTH_SECRET",
	"SIDECAR_URL",
	"WORKER_URL",
	"IMPORTER_URL",
	"WORKER_API_KEY",
	"PUBLIC_URL",
	"TRUSTED_ORIGINS",
	"SHOW_LANDING_PAGE",
	"ENABLE_LEGAL_PAGES",
	"DEFAULT_TIME_ZONE",
	"OPENROUTER_API_KEY",
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USER",
	"SMTP_PASSWORD",
	"EMAIL_FROM",
	"UPLOAD_DIR",
	"EXPORT_DIR",
	"UNSUBSCRIBE_SECRET",
	"PUSH_ENDPOINT_ALLOW_HOSTS",
	"DATA_MASTER_KEY",
	"DATA_MASTER_KEY_FILE",
	"RECURRING_AUTO_POST",
	"APNS_KEY_ID",
	"APNS_TEAM_ID",
	"APNS_BUNDLE_ID",
	"APNS_KEY",
	"APNS_KEY_FILE",
	"VAPID_PUBLIC_KEY",
	"VAPID_PRIVATE_KEY",
	"VAPID_SUBJECT",
	"FCM_PROJECT_ID",
	"FCM_SERVICE_ACCOUNT",
	"FCM_SERVICE_ACCOUNT_FILE",
	"ANDROID_APP_CERT_SHA256",
	"SECURITY_CONTACT",
];

/** What the migration and grants tools may see besides the system's. */
const TOOL_ENV_NAMES = [
	...SYSTEM_ENV_NAMES,
	"USER",
	"TMPDIR",
	"LD_LIBRARY_PATH",
];

/** Any variable starting with one of these reaches the app too. */
const APP_ENV_PREFIXES = ["NEXT_PUBLIC_", "LC_"];
const TOOL_ENV_PREFIXES = ["PRISMA_", "LC_"];

/** Set by the base image or by us; dropping them is not worth a warning. */
const QUIET_DROPS = new Set([
	"NODE_VERSION",
	"YARN_VERSION",
	"PWD",
	"OLDPWD",
	"SHLVL",
	"_",
	"DATABASE_OWNER_PASSWORD",
	"POSTGRES_USER",
	"POSTGRES_PASSWORD",
	"POSTGRES_DB_NAME",
	"POSTGRES_DB",
]);

/**
 * Splits an environment into what a process may see (the listed names and
 * prefixes) and the names of everything else.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string[]} names
 * @param {string[]} prefixes
 * @returns {{ kept: Record<string, string>, others: string[] }}
 */
function selectEnv(env, names, prefixes) {
	/** @type {Record<string, string>} */
	const kept = {};
	/** @type {string[]} */
	const others = [];
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined) continue;
		if (names.includes(name) || prefixes.some((p) => name.startsWith(p))) {
			kept[name] = value;
		} else {
			others.push(name);
		}
	}
	return { kept, others };
}

/**
 * The environment the app gets: only names the app reads, with DATABASE_URL
 * set to the owner's URL. The superuser's URL, POSTGRES_PASSWORD and anything
 * else the container was given for the entrypoint never reach the app, so code
 * that runs in the app cannot read the superuser's credentials from its own
 * environment or /proc/self/environ.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} databaseUrl the URL the app should use
 * @returns {{ env: Record<string, string>, dropped: string[] }}
 */
export function buildAppEnv(env, databaseUrl) {
	const { kept, others } = selectEnv(env, APP_ENV_NAMES, APP_ENV_PREFIXES);
	kept.DATABASE_URL = databaseUrl;
	return {
		env: kept,
		dropped: others.filter((name) => !QUIET_DROPS.has(name)).sort(),
	};
}

/**
 * The environment of `prisma migrate deploy` and the grants file: system
 * variables, Prisma's own settings, and DATABASE_URL set to `databaseUrl` (the
 * one to migrate with). POSTGRES_PASSWORD, the superuser's URL and the app's
 * secrets are not in it.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} databaseUrl
 * @returns {Record<string, string>}
 */
export function buildToolEnv(env, databaseUrl) {
	const { kept } = selectEnv(env, TOOL_ENV_NAMES, TOOL_ENV_PREFIXES);
	kept.DATABASE_URL = databaseUrl;
	return kept;
}

/** @param {string} value */
export function shellQuote(value) {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * A line for the entrypoint to eval: it puts `env -i NAME=value ...` in front
 * of the positional parameters (the command to run), so `exec "$@"` starts
 * the app with exactly this environment.
 *
 * @param {Record<string, string>} env
 */
export function shellExecPrefix(env) {
	const assignments = Object.entries(env)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, value]) => shellQuote(`${name}=${value}`));
	return `set -- env -i ${assignments.join(" ")} "$@"`;
}
