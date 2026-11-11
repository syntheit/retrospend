/**
 * Whether sealing user text is released for production (E2EE D11, plan
 * docs/roadmap/e2ee-d11-pr4.md section 3). Until PR 5 (searches follow the
 * epoch with every key), PR 6 (the sidecar's recurring job posts through the
 * app) and PR 8 (JSON copies are sealed) land, a production server would
 * store text those paths cannot read or would write plaintext beside it. So
 * DATA_KEYS_WRITE seals only in development and tests, and a production
 * server with it set refuses to start. PR 9 flips this.
 */
export const SEALING_RELEASED = false;
