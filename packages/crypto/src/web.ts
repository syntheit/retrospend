// The web and Node build: libsodium compiled to WebAssembly (the sumo build,
// which includes Argon2id). A separate entry so the mobile app, which uses
// the native build, never bundles it, and the web only loads it when a
// protection flow runs.
import sodium from "libsodium-wrappers-sumo";
import { createPrimitives, type SodiumLike } from "./primitives";

/** The libsodium module after its WebAssembly has loaded. */
export async function loadWebSodium() {
	await sodium.ready;
	return sodium;
}

export async function createWebPrimitives() {
	return createPrimitives((await loadWebSodium()) as SodiumLike);
}
