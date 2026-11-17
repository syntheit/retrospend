// Unit tests only (vitest.config.ts; the pg config has its own setup): fake
// clients may open user transactions. The real-Postgres suite and production
// refuse a client db.ts did not build (db-tx.ts).
import { allowUnregisteredClientsForTests } from "~/server/db-tx";

allowUnregisteredClientsForTests();
