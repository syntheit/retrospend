const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** A size as a number and its unit (1024 steps), for the number formatter. */
export function sizeParts(bytes: number): {
	value: number;
	unit: (typeof BYTE_UNITS)[number];
} {
	let value = Math.max(0, bytes);
	let at = 0;
	while (value >= 1024 && at < BYTE_UNITS.length - 1) {
		value /= 1024;
		at++;
	}
	return { value, unit: BYTE_UNITS[at] ?? "B" };
}

/** Uptime as whole days, hours and minutes. */
export function uptimeParts(seconds: number): {
	days: number;
	hours: number;
	minutes: number;
} {
	const total = Math.max(0, Math.floor(seconds));
	return {
		days: Math.floor(total / 86_400),
		hours: Math.floor((total % 86_400) / 3600),
		minutes: Math.floor((total % 3600) / 60),
	};
}

/** What the backup sidecar says, as one state the screen can name. */
export type BackupState =
	| "unavailable"
	| "running"
	| "neverRun"
	| "failed"
	| "healthy";

export function backupState(status: {
	available: boolean;
	running?: boolean;
	lastBackup?: { success: boolean };
}): BackupState {
	if (!status.available) return "unavailable";
	if (status.running) return "running";
	if (!status.lastBackup) return "neverRun";
	return status.lastBackup.success ? "healthy" : "failed";
}

/** A share of a quota as a whole percent; none when there is no quota. */
export function quotaPercent(used: number, quota: number): number | null {
	if (quota <= 0) return null;
	return Math.round((used / quota) * 100);
}

/** The token-quota choices: a short ladder (0 means no cap), plus the server's own value if off it. */
export function quotaChoices(current: number): number[] {
	const ladder = [
		0, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000,
		10_000_000,
	];
	return ladder.includes(current)
		? ladder
		: [...ladder, current].sort((a, b) => a - b);
}

/** The month before or after a yyyy-mm one. */
export function shiftMonth(yearMonth: string, by: number): string {
	const [y = 1970, m = 1] = yearMonth.split("-").map(Number);
	const at = y * 12 + (m - 1) + by;
	const year = Math.floor(at / 12);
	return `${year}-${String((at % 12) + 1).padStart(2, "0")}`;
}
