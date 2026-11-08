// Runs the known-answer vectors against one libsodium build. Web (vitest),
// mobile (jest) and the on-device benchmark screen all call this, so a native
// build that disagrees with the others is caught where it runs. The expected
// values come from other implementations (see the vectors file), never from
// the code under test.
import formatVectors from "../vectors/format.vectors.json";
import vectors from "../vectors/primitives.vectors.json";
import {
	canonicalJson,
	decodeSealed,
	encodeSealed,
	type Json,
	openRecord,
	type RecordContext,
	sealRecordWithNonce,
} from "./format";
import { fromHex, toHex } from "./hex";
import type { Primitives } from "./primitives";

/** Names of the vectors that failed; empty means every primitive matched. */
export function runKnownAnswerTests(p: Primitives): string[] {
	const failed: string[] = [];
	const check = (name: string, run: () => string, expected: string) => {
		let got: string;
		try {
			got = run();
		} catch {
			got = "threw";
		}
		if (got !== expected) failed.push(name);
	};

	for (const v of vectors.aead) {
		const key = fromHex(v.key);
		const nonce = fromHex(v.nonce);
		check(
			`aead encrypt: ${v.name}`,
			() => toHex(p.aeadEncrypt(key, nonce, fromHex(v.plaintext), v.aad)),
			v.ciphertext,
		);
		check(
			`aead decrypt: ${v.name}`,
			() => toHex(p.aeadDecrypt(key, nonce, fromHex(v.ciphertext), v.aad)),
			v.plaintext,
		);
	}
	for (const v of vectors.argon2id) {
		check(
			`argon2id: ${v.name}`,
			() =>
				toHex(
					p.argon2id(
						fromHex(v.password),
						fromHex(v.salt),
						{ memoryKiB: v.memoryKiB, passes: v.passes },
						v.length,
					),
				),
			v.output,
		);
	}
	for (const v of vectors.kdf) {
		check(
			`kdf: ${v.name}`,
			() =>
				toHex(
					p.kdfDerive(fromHex(v.masterKey), v.subkeyId, v.context, v.length),
				),
			v.output,
		);
	}
	for (const v of vectors.blake2b as {
		name: string;
		message: string;
		key?: string;
		length: number;
		output: string;
	}[]) {
		check(
			`blake2b: ${v.name}`,
			() =>
				toHex(
					p.blake2b(
						fromHex(v.message),
						v.length,
						v.key ? fromHex(v.key) : undefined,
					),
				),
			v.output,
		);
	}
	for (const v of vectors.boxSeed) {
		check(
			`box seed: ${v.name}`,
			() => {
				const pair = p.boxKeypairFromSeed(fromHex(v.seed));
				return `${toHex(pair.publicKey)}:${toHex(pair.privateKey)}`;
			},
			`${v.publicKey}:${v.privateKey}`,
		);
	}
	for (const v of vectors.seal) {
		check(
			`seal open: ${v.name}`,
			() =>
				toHex(
					p.sealOpen(
						fromHex(v.ciphertext),
						fromHex(v.publicKey),
						fromHex(v.privateKey),
					),
				),
			v.plaintext,
		);
	}
	for (const v of formatVectors.records) {
		const ctx: RecordContext = v.context;
		const recordKey = { keyId: fromHex(v.keyId), key: fromHex(v.key) };
		check(
			`format seal: ${v.name}`,
			() =>
				toHex(
					sealRecordWithNonce(
						p,
						recordKey,
						ctx,
						v.schemaVersion,
						v.record as { [key: string]: Json },
						fromHex(v.nonce),
					),
				),
			v.sealed,
		);
		check(
			`format open: ${v.name}`,
			() => {
				const opened = openRecord(
					p,
					() => recordKey.key,
					ctx,
					decodeSealed(v.base64url),
				);
				return `${opened.schemaVersion}:${canonicalJson(opened.record)}`;
			},
			`${v.schemaVersion}:${v.canonicalJson}`,
		);
		check(
			`format base64url: ${v.name}`,
			() => encodeSealed(fromHex(v.sealed)),
			v.base64url,
		);
	}
	return failed;
}
