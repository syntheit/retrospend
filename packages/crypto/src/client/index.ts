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
	EnableFailure,
	FAILURE_CODES,
	type FailureCode,
	failureCode,
	isFinalFailure,
} from "./enable-failure";
export {
	createEnableLifecycle,
	type EnableLifecycle,
	type JobOutcome,
	type KeyDraft,
	type LifecyclePorts,
} from "./enable-lifecycle";
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
	makeNewRecoveryKey,
	type NewKeyBody,
	type NewKeyCommitBody,
	type NewKeyInput,
	type NewKeyPasswordInput,
	type NewKeyPorts,
	type OpenAnswer,
	type PreparedNewKey,
	type PreparedNewKeyFromPassword,
	prepareNewRecoveryKey,
	readOpenAnswer,
} from "./new-key";
export {
	type RecoverBeginAnswer,
	type RecoverBody,
	type RecoverInput,
	type RecoverOptions,
	type RecoverPorts,
	readRecoverBeginAnswer,
	recoverAccount,
} from "./recover";
export {
	type ConfirmGroups,
	groupMatches,
	pickConfirmGroups,
	RECOVERY_KEY_FILE_NAME,
	type RecoveryFileLabels,
	randomBelow,
	recoveryKeyFileText,
	recoveryKeyGroups,
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
