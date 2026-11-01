import { NotificationsScreen } from "@/features/notifications/NotificationsScreen";

// The inbox opens inside Home's stack (the bell), for the same reason.
export default function HomeInboxRoute() {
	return <NotificationsScreen />;
}
