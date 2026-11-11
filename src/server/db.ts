/**
 * The one place the app's clients are composed (E2EE D11 PR 3): the raw base,
 * the client builder and the runtime data model come from db-core.ts, the
 * rings from the key services, and the slot is the field-open extension. The
 * services import `keystoreDb` from db-core, never from here, so this file can
 * use them without an import cycle.
 */
import { fieldOpenSlot } from "~/server/crypto/field-open";
import { buildModelGraph, type ModelGraph } from "~/server/crypto/model-graph";
import { type KeyLoader, textKeys } from "~/server/crypto/text-keys";
import { buildClients, runtimeDataModel } from "~/server/db-core";
import {
	evictDataKeyring,
	findDataKeyring,
} from "~/server/services/keys/data-key.service";
import {
	evictInstanceKeyring,
	findInstanceKeyring,
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

// Built on the first query, not at import: a test that mocks the Prisma
// client imports this file without a runtime data model.
let graph: ModelGraph | undefined;
const modelGraph = () => {
	graph ??= buildModelGraph(runtimeDataModel());
	return graph;
};

const clients = buildClients(
	{
		instance: textKeys({ instance }),
		user: (userId) => textKeys({ user: userLoader(userId), instance }, userId),
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
