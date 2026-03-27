export function getInitials(name: string): string {
	return name
		.split(" ")
		.slice(0, 2)
		.map((n) => n[0] ?? "")
		.join("")
		.toUpperCase();
}

export function downloadCsv(csv: string, filename: string): void {
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

export function downloadPdf(base64: string, filename: string): void {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	const blob = new Blob([bytes], { type: "application/pdf" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
}

export function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (days > 0) {
		return `${days}d ${hours}h ${minutes}m`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

/**
 * Formats an expense date as "Today", "Yesterday", "Tomorrow", or "MMM d, yyyy".
 * Compares calendar dates only (ignores time).
 */
export function formatExpenseDate(date: Date): string {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	// Math.round handles DST transitions where midnight-to-midnight != exactly 24h
	const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
	if (diff === 0) return "Today";
	if (diff === -1) return "Yesterday";
	if (diff === 1) return "Tomorrow";
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

/**
 * Returns a verbose relative time string: "2 hours ago", "yesterday", "Oct 24, 2026".
 * Use for timestamps where readability matters (tooltips, indicators).
 */
export function formatRelativeTime(date: Date | string): string {
	const d = typeof date === "string" ? new Date(date) : date;
	const diffMs = Date.now() - d.getTime();
	const diffMinutes = Math.floor(diffMs / 60_000);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays >= 7)
		return d.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
	if (diffDays >= 2) return `${diffDays} days ago`;
	if (diffDays === 1) return "yesterday";
	if (diffHours >= 1)
		return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	if (diffMinutes >= 1)
		return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
	return "just now";
}

/**
 * Returns a compact relative time string: "2h ago", "3d ago".
 * Use for tight spaces like notification lists.
 */
export function formatRelativeTimeCompact(date: Date | string): string {
	const d = typeof date === "string" ? new Date(date) : date;
	const diffMs = Date.now() - d.getTime();
	const diffMin = Math.floor(diffMs / 60_000);

	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 7) return `${diffDay}d ago`;
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
