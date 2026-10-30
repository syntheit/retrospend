import { Switch } from "@expo/ui";

/**
 * The system switch. iOS draws its own (SwiftUI); Android has a twin that
 * passes token colors to the Compose switch (NativeSwitch.android.tsx).
 */
export function NativeSwitch({
	value,
	onChange,
	disabled,
}: {
	value: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
}) {
	return <Switch disabled={disabled} onValueChange={onChange} value={value} />;
}
