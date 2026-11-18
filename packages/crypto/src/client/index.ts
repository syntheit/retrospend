// The client flows the web and the phone share: derive the sign-in secret,
// refuse a downgrade, change the password of a keyed account. Platform code
// fills in the ports (flow.ts) and maps KeyFlowError to its own wording.
export {
	type EnableBody,
	type EnableInput,
	type EnableOptions,
	type EnableWrap,
	type PreparedEnable,
	prepareEnable,
} from "./enable";
export {
	asKeyFlowError,
	classifyRefusal,
	type FlowPorts,
	type Kdf,
	type KeyedRecord,
	type KeyFlowCode,
	KeyFlowError,
	type LookupAnswer,
	type LookupRoute,
	lookupKdf,
	NEW_PASSWORD_PARAMS,
} from "./flow";
export {
	type ConfirmGroups,
	groupMatches,
	pickConfirmGroups,
	type RecoveryFileLabels,
	randomBelow,
	recoveryKeyFileText,
} from "./recovery-key";
export {
	type BeginAnswer,
	type CommitBody,
	type RotateInput,
	type RotateOptions,
	type RotatePorts,
	readBeginAnswer,
	rotatePassword,
} from "./rotate";
export { accountIsKeyed, deriveSignInSecret, signInSecretFor } from "./secret";
