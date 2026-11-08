// The phone's libsodium: native code through JSI (react-native-libsodium), the
// same API as the web build. Only this file imports it, so the Google-free
// guard and the bundle see one entry point. The namespace import is
// deliberate: the package's default export omits crypto_box_seal.
import {
	createPrimitives,
	type Primitives,
	type SodiumLike,
} from "@retrospend/crypto";
import * as sodium from "react-native-libsodium";

let primitives: Promise<Primitives> | undefined;

/** The primitives on this device. Loads the native module once. */
export function getPrimitives(): Promise<Primitives> {
	primitives ??= sodium.ready.then(() =>
		createPrimitives(sodium as SodiumLike),
	);
	return primitives;
}
