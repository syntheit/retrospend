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
	enableFailureFor,
	FAILURE_CODES,
	type FailureCode,
	failureCode,
	isFinalFailure,
} from "./enable-failure";
export {
	createEnableCallbacks,
	type EnableCallbacks,
	type EnablePorts,
	type EnableRequest,
	type EnableSignInStep,
} from "./enable-flow";
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
	couldNotAsk,
	type FlowPorts,
	type Kdf,
	type KeyedRecord,
	type KeyFlowCode,
	KeyFlowError,
	type LookupAnswer,
	type LookupRoute,
	lookupKdf,
	mayHaveCommitted,
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
	createNewKeyCallbacks,
	type NewKeyCallbacks,
	type NewKeyFlowPorts,
} from "./new-key-flow";
export {
	NEW_KEY_INITIAL_STATE,
	type NewKeyAction,
	type NewKeyState,
	type NewKeyStep,
	type NewKeyView,
	newKeyFieldsLocked,
	newKeyReducer,
	newKeyView,
} from "./new-key-model";
export {
	beginRecovery,
	finishRecovery,
	type RecoverBeginAnswer,
	type RecoverBody,
	type RecoverInput,
	type RecoverOptions,
	type RecoverPorts,
	type RecoveryDraft,
	type RecoveryLink,
	readRecoverBeginAnswer,
	readRecoveryLink,
	recoverAccount,
} from "./recover";
export {
	cleanGroup,
	GROUP_COUNT,
	GROUP_LENGTH,
	keyComplete,
	passwordsAlike,
	pasteGroups,
	type RecoverAction,
	type RecoverState,
	type RecoverStep,
	type RecoverView,
	recoverFieldsLocked,
	recoverInitialState,
	recoverKeyText,
	recoverReducer,
	recoverView,
} from "./recover-model";
export {
	blocksRecoveryScreen,
	endsRecoveryHandle,
	isFinalRecoveryFailure,
	RECOVERY_FAILURE_CODES,
	type RecoveryFailureCode,
	recoveryFailureFor,
	recoveryFailureOf,
} from "./recovery-failure";
export {
	createRecoveryCallbacks,
	type RecoveryCallbacks,
	type RecoveryFlowPorts,
	type RecoveryHandle,
} from "./recovery-flow";
export {
	type ConfirmGroups,
	groupMatches,
	groupMismatch,
	groupsConfirmed,
	type KeyConfirmState,
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
