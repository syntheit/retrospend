import { Switch } from "@expo/ui/jetpack-compose";
import { useTheme } from "@/theme";
import { switchColors } from "./m3Colors";

/**
 * The Compose switch with token track and thumb colors, not the tints the
 * brand seed generates (see m3Colors).
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
	const { color } = useTheme();
	return (
		<Switch
			colors={switchColors(color)}
			enabled={!disabled}
			onCheckedChange={disabled ? undefined : onChange}
			value={value}
		/>
	);
}
