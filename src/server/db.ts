/**
 * The one place the app's clients are composed (E2EE D11 PR 3): the raw base,
 * the client builder and the runtime data model come from db-core.ts, the
 * rings from the key services, and the slot is the field-open extension. The
 * services import `keystoreDb` from db-core, never from here, so this file can
 * use them without an import cycle.
 */
import { env } from "~/env";
import { setEpochReader } from "~/server/crypto/epoch";
import { fieldOpenSlot } from "~/server/crypto/field-open";
import { buildModelGraph, type ModelGraph } from "~/server/crypto/model-graph";
import { sealingWanted, wireSealingSetting } from "~/server/crypto/sealing";
import {
	type KeyLoader,
	type KeyMinter,
	textKeys,
} from "~/server/crypto/text-keys";
import { buildClients, runtimeDataModel } from "~/server/db-core";
import {
	ensureUserKeyring,
	evictDataKeyring,
	findDataKeyring,
} from "~/server/services/keys/data-key.service";
import { readFieldEncryptionEpoch } from "~/server/services/keys/field-encryption-start";
import {
	evictInstanceKeyring,
	findInstanceKeyring,
	getOrCreateInstanceKeyring,
} from "~/server/services/keys/instance-key.service";

const instance: KeyLoader = (fresh) => {
	if (fresh) evictInstanceKeyring();
	return findInstanceKeyring();
};

const userLoader =
	(userId: string): KeyLoader =>
	(fresh) => {
		if (fresh) evictDataKeyring(userId);
		return findDataKeyring(userId);
	};

// The seal path's first write makes the key (PR 4 section 1); the instance
// key is the service's, whoever writes first.
const mintInstance: KeyMinter = () =>
	getOrCreateInstanceKeyring({ kind: "service" });

// DATA_KEYS_WRITE turns sealing on (sealing.ts), and every client's
// `ready()` loads the epoch through this reader (epoch.ts).
wireSealingSetting(() => sealingWanted(env.DATA_KEYS_WRITE, env.NODE_ENV));
setEpochReader(() => readFieldEncryptionEpoch());

// Built on the first query, not at import: a test that mocks the Prisma
// client imports this file without a runtime data model.
let graph: ModelGraph | undefined;
const modelGraph = () => {
	graph ??= buildModelGraph(runtimeDataModel());
	return graph;
};

const clients = buildClients(
	{
		instance: textKeys({ instance }, undefined, { instance: mintInstance }),
		user: (userId) =>
			textKeys({ user: userLoader(userId), instance }, userId, {
				user: () => ensureUserKeyring(userId),
				instance: mintInstance,
			}),
	},
	undefined,
	fieldOpenSlot(modelGraph),
);

export const db = clients.db;

/** The instance keys alone, for sealed text read outside a model call (audit JSON). */
export const instanceTextKeys = () => textKeys({ instance });

/** A user-scoped client for `userId`; see `buildClients` for what it refuses. */
export const createUserScopedDb = clients.createUserScopedDb;

export { keystoreDb } from "~/server/db-core";
