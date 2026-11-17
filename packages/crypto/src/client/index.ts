// The client flows the web and the phone share: derive the sign-in secret,
// refuse a downgrade, change the password of a keyed account. Platform code
// fills in the ports (flow.ts) and maps KeyFlowError to its own wording.
export {
	asKeyFlowError,
	classifyRefusal,
	type FlowPorts,
	type Kdf,
	type KeyedRecord,
	type KeyFlowCode,
	KeyFlowError,
	NEW_PASSWORD_PARAMS,
	readKdf,
} from "./flow";
export {
	type BeginAnswer,
	type CommitBody,
	type RotateInput,
	type RotateOptions,
	type RotatePorts,
	rotatePassword,
} from "./rotate";
export { accountIsKeyed, deriveSignInSecret, signInSecretFor } from "./secret";
