/**
 * The one place the app's clients are composed (E2EE D11 PR 3.1): the raw
 * base and the client builder come from db-core.ts, the rings from the key
 * services. The services import `keystoreDb` from db-core, never from here,
 * so this file can use them without an import cycle.
 */
import { textKeys } from "~/server/crypto/text-keys";
import { buildClients } from "~/server/db-core";
import { findDataKeyring } from "~/server/services/keys/data-key.service";
import { findInstanceKeyring } from "~/server/services/keys/instance-key.service";

const instance = () => findInstanceKeyring();

const clients = buildClients({
	instance: textKeys({ instance }),
	user: (userId) => textKeys({ user: () => findDataKeyring(userId), instance }),
});

export const db = clients.db;

/** A user-scoped client for `userId`; see `buildClients` for what it refuses. */
export const createUserScopedDb = clients.createUserScopedDb;

export { keystoreDb } from "~/server/db-core";
