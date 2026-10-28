import AppIntents

/// Puts "Add expense" in the Shortcuts app and Spotlight without the person
/// building anything, and lets Siri run it by name.
struct RetrospendShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AddExpenseIntent(),
      phrases: [
        "Add an expense in \(.applicationName)",
        "New expense in \(.applicationName)",
      ],
      shortTitle: "Add expense",
      systemImageName: "plus"
    )
  }
}
