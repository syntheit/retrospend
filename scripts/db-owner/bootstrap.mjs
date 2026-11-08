// The superuser's part of a start: the owner role, the handover, and the
// migrations of a brand-new install (see prisma/bootstrap and window.mjs).
import { connect, databaseName } from "./database.mjs";
import { handover, neverHandedOver } from "./handover.mjs";
import { deriveOwnerPassword, ownerUrl, urlPassword } from "./password.mjs";
import { isSuperuser, readyOwner } from "./roles.mjs";
import {
	migratorRoleName,
	removeMigratorSurely,
	withCreateWindow,
} from "./window.mjs";

/**
 * @typedef {{ status: "switched", ownerUrl: string, changedObjects: number }
 *   | { status: "unchanged", reason: "not-superuser" | "no-password" | "unreadable-password" }} BootstrapResult
 */

/**
 * Why a superuser URL cannot get the derived owner password, with the warning
 * to give: no password at all (trust authentication), or one that is not valid
 * percent-encoding. Null when it can, or when DATABASE_OWNER_PASSWORD gives the
 * owner a secret of its own.
 *
 * @param {string} databaseUrl
 * @param {string | undefined} override
 * @returns {{ reason: "no-password" | "unreadable-password", message: string } | null}
 */
function passwordProblem(databaseUrl, override) {
	if (override || urlPassword(databaseUrl)) return null;
	let spelled = false;
	try {
		spelled = new URL(databaseUrl).password !== "";
	} catch {
		// not a URL: no password to read
	}
	return spelled
		? {
				reason: "unreadable-password",
				message:
					"WARNING: the database password in DATABASE_URL is not a valid percent-encoded value, so the app keeps connecting as the superuser. Encode special characters (for example @ as %40) or set DATABASE_OWNER_PASSWORD.",
			}
		: {
				reason: "no-password",
				message:
					"WARNING: DATABASE_URL names a superuser without a password, so the app keeps connecting as the superuser. Give the database user a password, or set DATABASE_OWNER_PASSWORD to a secret of your own.",
			};
}

/**
 * Runs the whole bootstrap against `databaseUrl` when it is a superuser URL
 * with a password. Anything else is left exactly as it is: a managed Postgres
 * or a setup done by hand (not a superuser) keeps working, and a superuser
 * URL without a password (trust authentication) cannot get a derived secret
 * that is not guessable, so it keeps today's behavior with a loud warning
 * unless DATABASE_OWNER_PASSWORD gives the owner a secret of its own.
 *
 * With `whileOwnerMayCreate`, the callback runs the migrations. On a brand-new,
 * empty install (neverHandedOver) it gets the URL of a one-shot migration role
 * that holds CREATE on the database and is removed afterwards, even when the
 * callback fails (withCreateWindow); the owner never holds CREATE. On an
 * upgrade or any later start it gets the owner's URL, the owner has no CREATE,
 * and the migrations must not need it.
 *
 * @param {string} databaseUrl
 * @param {{ ownerPassword?: string, warn?: (message: string) => void, whileOwnerMayCreate?: (databaseUrl: string) => Promise<void> }} [options]
 * @returns {Promise<BootstrapResult>}
 */
export async function bootstrap(databaseUrl, options = {}) {
	const warn = options.warn ?? ((message) => console.error(message));
	const override = options.ownerPassword || undefined;
	const migrate = options.whileOwnerMayCreate;

	const admin = await connect(databaseUrl);
	try {
		if (!(await isSuperuser(admin))) {
			return { status: "unchanged", reason: "not-superuser" };
		}
		const problem = passwordProblem(databaseUrl, override);
		if (problem) {
			warn(problem.message);
			return { status: "unchanged", reason: problem.reason };
		}
		const ownerPassword =
			override ?? deriveOwnerPassword(urlPassword(databaseUrl) ?? "");
		const url = ownerUrl(databaseUrl, ownerPassword);

		// A migration role left by a start that was killed.
		const migrator = migratorRoleName(await databaseName(admin));
		await removeMigratorSurely(admin, databaseUrl, migrator);
		// Decided now, from the catalogs, before the owner is given anything.
		const fresh = migrate ? await neverHandedOver(admin) : false;

		await readyOwner(admin, url, ownerPassword, warn);

		// A brand-new install migrates as the one-shot role, before the handover;
		// an upgrade or a later start migrates as the owner, after it, with no CREATE.
		const migrated =
			fresh && migrate
				? await withCreateWindow(admin, databaseUrl, migrator, migrate)
				: false;
		const changedObjects = await handover(admin);
		if (migrate && !migrated) await migrate(url);
		return { status: "switched", ownerUrl: url, changedObjects };
	} finally {
		await admin.end().catch(() => undefined);
	}
}
