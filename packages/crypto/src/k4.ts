// The wraps of a key to a public key, for device approval and trusted contact
// recovery (K4) only. They return a bare account key with no proof of who
// sealed it; read the requirement at the top of public-wraps.ts before using
// them. Kept out of the production entry on purpose, and a test checks that.
export { unwrapKeyFromPublic, wrapKeyToPublic } from "./public-wraps";
