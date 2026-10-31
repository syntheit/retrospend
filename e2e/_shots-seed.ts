import { seedE2eDatabase } from "./fixtures/seed";

const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error("E2E_DATABASE_URL");
await seedE2eDatabase(url);
console.log("seeded");
