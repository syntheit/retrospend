import AppIntents
import Foundation

/// "Add expense" for Shortcuts, Spotlight, Siri and the Control. It opens the
/// app and leaves a note in the App Group for the composer to read (the app
/// takes it through modules/surfaces). The amount is optional: without one the
/// composer opens empty.
struct AddExpenseIntent: AppIntent {
  static let title: LocalizedStringResource = "Add expense"
  static let description = IntentDescription("Opens Retrospend with a new expense.")
  static let openAppWhenRun = true

  @Parameter(title: "Amount")
  var amount: Double?

  static var parameterSummary: some ParameterSummary {
    Summary("Add expense \(\.$amount)")
  }

  func perform() async throws -> some IntentResult {
    var note: [String: Any] = ["kind": "add"]
    if let amount, amount > 0 {
      // A string with a "." decimal point, never a float in JSON: the app reads it as money.
      note["amount"] = String(format: "%.2f", amount)
    }
    if let group = Bundle.main.object(forInfoDictionaryKey: "RetrospendAppGroup") as? String,
      let defaults = UserDefaults(suiteName: group),
      let data = try? JSONSerialization.data(withJSONObject: note),
      let json = String(data: data, encoding: .utf8)
    {
      defaults.set(json, forKey: "pending")
    }
    // Wakes the app if it is already running; a cold start reads it on launch.
    NotificationCenter.default.post(name: Notification.Name("app.retrospend.pending"), object: nil)
    return .result()
  }
}
