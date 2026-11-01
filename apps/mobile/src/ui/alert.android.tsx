import {
	AlertDialog,
	Column,
	Text as ComposeText,
	TextButton,
} from "@expo/ui/jetpack-compose";
import { useSyncExternalStore } from "react";
import type { AlertButton } from "react-native";
import { useTheme } from "@/theme";
import { dialogSlots } from "./alertSlots";
import { NativeHost } from "./NativeHost";

export type { AlertButton };

interface Request {
	title: string;
	message?: string;
	buttons: AlertButton[];
}

let current: Request | null = null;
const listeners = new Set<() => void>();

function set(next: Request | null) {
	current = next;
	for (const listener of listeners) listener();
}

/**
 * The Material 3 dialog for a short confirmation: the title, at most one line,
 * a text button to cancel at the end and the confirm button after it, in
 * danger for a destructive one. One dialog at a time; a second ask replaces
 * the first. Mounted once by `AlertHost` at the root.
 */
export function showAlert(
	title: string,
	message?: string,
	buttons?: AlertButton[],
): void {
	set({ title, message, buttons: buttons?.length ? buttons : [{ text: "OK" }] });
}

export function AlertHost() {
	const request = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => current,
	);
	const { color } = useTheme();
	if (!request) return null;
	const { cancel, confirm, choices } = dialogSlots(request.buttons);
	const answer = (button: AlertButton) => {
		set(null);
		button.onPress?.();
	};
	const label = (button: AlertButton) => (
		<TextButton
			colors={{
				contentColor: button.style === "destructive" ? color.danger : color.brand,
			}}
			onClick={() => answer(button)}
		>
			<ComposeText>{button.text ?? ""}</ComposeText>
		</TextButton>
	);
	return (
		<NativeHost>
			<AlertDialog
				colors={{
					containerColor: color.surface,
					titleContentColor: color.fg,
					textContentColor: color.fg2,
				}}
				onDismissRequest={() => set(null)}
			>
				<AlertDialog.Title>
					<ComposeText>{request.title}</ComposeText>
				</AlertDialog.Title>
				{request.message || choices.length > 0 ? (
					<AlertDialog.Text>
						<Column>
							{request.message ? (
								<ComposeText>{request.message}</ComposeText>
							) : null}
							{choices.map((button) => (
								<TextButton
									colors={{ contentColor: color.fg }}
									key={button.text}
									onClick={() => answer(button)}
								>
									<ComposeText>{button.text ?? ""}</ComposeText>
								</TextButton>
							))}
						</Column>
					</AlertDialog.Text>
				) : null}
				{confirm ? (
					<AlertDialog.ConfirmButton>{label(confirm)}</AlertDialog.ConfirmButton>
				) : null}
				{cancel ? (
					<AlertDialog.DismissButton>{label(cancel)}</AlertDialog.DismissButton>
				) : null}
			</AlertDialog>
		</NativeHost>
	);
}
