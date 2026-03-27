// Paths to saved auth state (reused across tests)
export const USER_STORAGE_STATE = "playwright/.auth/user.json";
export const ADMIN_STORAGE_STATE = "playwright/.auth/admin.json";

// Test user credentials — seeded by global-setup.ts
export const TEST_USER = {
	email: "e2e-test@retrospend.app",
	password: "TestPassword123!",
	name: "E2E Test User",
	username: "e2etest",
} as const;

export const ADMIN_USER = {
	email: "e2e-admin@retrospend.app",
	password: "AdminPassword123!",
	name: "E2E Admin User",
	username: "e2eadmin",
} as const;
