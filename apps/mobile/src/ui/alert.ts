import { Alert, type AlertButton } from "react-native";

export type { AlertButton };

/**
 * A short confirmation or choice: a title, at most one line under it and the
 * buttons. On iOS it is the system alert (destructive style for a delete);
 * on Android it is the Material 3 dialog (alert.android.tsx). Every screen
 * asks through this, never through `Alert.alert` itself, so Android never
 * shows the old uppercase dialog.
 */
export function showAlert(
	title: string,
	message?: string,
	buttons?: AlertButton[],
): void {
	Alert.alert(title, message, buttons);
}

/** The system alert needs no host; Android mounts its dialog here. */
export function AlertHost() {
	return null;
}
