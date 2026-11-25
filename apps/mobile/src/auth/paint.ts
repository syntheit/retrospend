/** Two frames, so a busy label ("Making your keys") shows before Argon2id blocks the JS thread. */
export const paintFrames = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);
