const MAX_ENTRIES = 10_000;

/**
 * In-memory sliding window rate limiter.
 * Each instance maintains its own map and cleanup counter.
 */
export class InMemoryRateLimiter {
	private map = new Map<string, { count: number; lastReset: number }>();
	private cleanupCounter = 0;

	/**
	 * Returns true if the request is allowed, false if rate-limited.
	 */
	check(key: string, limit: number, windowMs: number): boolean {
		this.cleanupCounter++;
		if (this.cleanupCounter % 100 === 0) {
			this.cleanup(windowMs);
		}

		const now = Date.now();
		const record = this.map.get(key);
		if (!record) {
			this.map.set(key, { count: 1, lastReset: now });
			return true;
		}
		if (now - record.lastReset > windowMs) {
			record.count = 1;
			record.lastReset = now;
			return true;
		}
		if (record.count >= limit) return false;
		record.count++;
		return true;
	}

	private cleanup(windowMs: number) {
		const now = Date.now();
		for (const [key, record] of this.map) {
			if (now - record.lastReset > windowMs) this.map.delete(key);
		}
		if (this.map.size > MAX_ENTRIES) {
			const entries = [...this.map.entries()].sort(
				(a, b) => a[1].lastReset - b[1].lastReset,
			);
			const toRemove = this.map.size - MAX_ENTRIES;
			for (let i = 0; i < toRemove; i++) {
				const entry = entries[i];
				if (entry) this.map.delete(entry[0]);
			}
		}
	}
}

/**
 * Extract the client IP from request headers.
 * Uses the last IP in x-forwarded-for (closest to reverse proxy).
 */
export function getClientIp(headers: Headers): string {
	const forwarded = headers.get("x-forwarded-for");
	if (forwarded) {
		const ips = forwarded.split(",").map((ip) => ip.trim());
		return ips[ips.length - 1] ?? "unknown";
	}
	return headers.get("x-real-ip") ?? "unknown";
}
