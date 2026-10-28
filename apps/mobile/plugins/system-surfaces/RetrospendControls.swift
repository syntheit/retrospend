import AppIntents
import SwiftUI
import WidgetKit

/// The iOS 18 Control for Control Center, the lock screen and the Action
/// button: one button that opens the composer.
struct AddExpenseControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "app.retrospend.controls.add-expense") {
      ControlWidgetButton(action: AddExpenseIntent()) {
        Label("Add expense", systemImage: "plus")
      }
    }
    .displayName("Add expense")
    .description("Opens Retrospend with a new expense.")
  }
}

@main
struct RetrospendControls: WidgetBundle {
  var body: some Widget {
    AddExpenseControl()
  }
}
