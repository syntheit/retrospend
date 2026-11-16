import * as z from "zod";
import { v1 } from "../common/meta";
import { timestampSchema } from "../core";

const TAG = ["Vault"];

/**
 * The sealed record store (E2EE F7b). The server holds the bytes a client
 * sealed and never opens them, so every field here is shape: ids, an entity
 * number, a version and base64url ciphertext. Sizes mirror what
 * @retrospend/crypto's format allows (a header and tag of 58 bytes, 64-byte
 * buckets, at most 1 MiB of plaintext); the server's tests pin these numbers
 * against the library, so a format change fails there first.
 */

/** Most writes in one POST. */
export const VAULT_MAX_WRITES = 500;

/** Most ciphertext in one POST, in bytes, before base64url. */
export const VAULT_MAX_BATCH_BYTES = 8 * 1024 * 1024;

/** One sealed record: 58 bytes of header and tag plus up to 1 MiB of plaintext. */
export const VAULT_MAX_RECORD_BYTES = 58 + 1024 * 1024;

/** Longest unpadded base64url text of one record. */
export const VAULT_MAX_CIPHERTEXT_CHARS = Math.ceil(
	(VAULT_MAX_RECORD_BYTES * 4) / 3,
);

/** Most records a page returns, and the page size when none is asked for. */
export const VAULT_MAX_LIMIT = 1000;
export const VAULT_DEFAULT_LIMIT = 500;

const vaultIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * Unpadded base64url of a sealed record. A text whose length leaves one stray
 * character cannot be base64, so it is refused before any decoding.
 */
export const vaultCiphertextSchema = z
	.string()
	.min(1)
	.max(VAULT_MAX_CIPHERTEXT_CHARS)
	.regex(/^[A-Za-z0-9_-]+$/)
	.refine((text) => text.length % 4 !== 1, {
		message: "Not unpadded base64url",
	});

export const vaultWriteSchema = z
	.object({
		id: vaultIdSchema.meta({ description: "Client-made record id." }),
		collectionId: vaultIdSchema,
		entity: z.int().min(1).max(0xffff).meta({
			description:
				"The clients' entity number, stored as given and never interpreted.",
		}),
		baseVersion: z
			.int()
			.min(0)
			.max(2 ** 31 - 2)
			.meta({
				description:
					"The version you read; 0 creates the record. The write becomes baseVersion + 1, the version it was sealed for.",
			}),
		ciphertext: vaultCiphertextSchema.nullable().meta({
			description:
				"The sealed record as unpadded base64url, or null to delete it (a tombstone).",
		}),
	})
	.meta({ id: "VaultWrite" });

export const vaultWritesSchema = z
	.object({
		writes: z.array(vaultWriteSchema).min(1).max(VAULT_MAX_WRITES),
	})
	.meta({ id: "VaultWrites" });

export const vaultWriteResultSchema = z
	.object({ id: vaultIdSchema, version: z.int().min(1) })
	.meta({ id: "VaultWriteResult" });

export const vaultWritesResultSchema = z
	.object({ results: z.array(vaultWriteResultSchema) })
	.meta({ id: "VaultWritesResult" });

export const vaultChangesQuerySchema = z.object({
	cursor: z.string().min(1).max(512).optional().meta({
		description:
			"The cursor of the last page you applied. Omit it for the first pull.",
	}),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(VAULT_MAX_LIMIT)
		.default(VAULT_DEFAULT_LIMIT),
});

export const vaultRecordSchema = z
	.object({
		id: vaultIdSchema,
		collectionId: vaultIdSchema,
		entity: z.int(),
		version: z.int().min(1),
		ciphertext: vaultCiphertextSchema.nullable().meta({
			description: "Null for a deleted record.",
		}),
		deletedAt: timestampSchema.nullable(),
	})
	.meta({ id: "VaultRecord" });

export const vaultChangesSchema = z
	.object({
		records: z.array(vaultRecordSchema),
		cursor: z.string(),
		hasMore: z.boolean(),
	})
	.meta({ id: "VaultChanges" });

export type VaultWriteDto = z.infer<typeof vaultWriteSchema>;
export type VaultWritesDto = z.infer<typeof vaultWritesSchema>;
export type VaultChangesDto = z.infer<typeof vaultChangesSchema>;
export type VaultChangesQuery = z.infer<typeof vaultChangesQuerySchema>;

/**
 * Pull and push a protected account's sealed records (E2EE F7b). Only a
 * signed-in session may (scope `vault`), and both routes stay reachable once
 * protection is on. Nothing here opens a record.
 */
export const vaultContract = {
	changes: v1
		.route({
			method: "GET",
			path: "/vault/changes",
			operationId: "getVaultChanges",
			tags: TAG,
			summary: "Sealed records changed after a cursor",
			description:
				"Records (live and deleted) in commit order after `cursor`, at most `limit` and about 4 MiB of ciphertext per page, at least one when any remain. A record written again comes again at its new version, so apply records by id. Page until `hasMore` is false; the last cursor is the next pull's start. A cursor the server can no longer honor (another epoch after a restore) answers 410 sync_reset_required: drop the local copy and pull from the start. A bad cursor is 400. An account without keys reads an empty page. Needs the `vault` session scope: a web session has it, a mobile session with read, write:expenses and write:money stored has it, a token, API key or device session never does.",
		})
		.meta({ scope: "vault" })
		.input(vaultChangesQuerySchema)
		.output(vaultChangesSchema),
	writes: v1
		.route({
			method: "POST",
			path: "/vault/writes",
			operationId: "writeVaultRecords",
			tags: TAG,
			summary: "Store a batch of sealed records",
			description:
				"1 to 500 writes, at most 8 MiB of ciphertext in all, all or nothing. A stale base version or a taken id is 409 conflict with `conflictIds` and nothing stored. A write that is already stored exactly (same version and bytes) answers as applied, so a retry is safe. An account without protection keys is 409 protection_keys_missing. A body over about 11.3 MB is 413. Limited to 30 batches a minute per account. The event vault.changed carries record ids only.",
		})
		.meta({ scope: "vault", event: "vault.changed" })
		.input(vaultWritesSchema)
		.output(vaultWritesResultSchema),
};
