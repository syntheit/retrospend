/**
 * A counting gate: at most `max` calls to `run` are in flight, the rest wait
 * in order. A finishing call hands its slot straight to the next waiter, so
 * the count never overshoots between the release and the resume.
 */
export function createLimiter(max: number) {
	let active = 0;
	const waiting: Array<() => void> = [];

	return async function run<T>(work: () => Promise<T>): Promise<T> {
		if (active < max) active++;
		else await new Promise<void>((resolve) => waiting.push(resolve));
		try {
			return await work();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	};
}
