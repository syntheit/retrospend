/** A date as YYYY-MM-DD text: the server's own date format, checked for a real day. */
export function isIsoDay(text: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
	const d = new Date(`${text}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}
