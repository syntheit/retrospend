import ExpoModulesCore

/// The app's end of the hand-off. The share extension and the App Intents
/// cannot talk to the running app, so they write one JSON string under
/// "pending" in the App Group's defaults; JS asks for it when the app comes
/// to the front (src/surfaces/useSurfaceLinks.ts). The group id is in the
/// Info.plist (RetrospendAppGroup, written by plugins/with-system-surfaces.js).
public final class RetrospendSurfacesModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("RetrospendSurfaces")

    Events("onPending")

    // An App Intent runs inside this process (openAppWhenRun) and posts this
    // after it writes its note, so a running app does not have to wait for
    // the next time it comes to the front.
    OnCreate {
      self.observer = NotificationCenter.default.addObserver(
        forName: Notification.Name("app.retrospend.pending"), object: nil, queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onPending", [:])
      }
    }

    OnDestroy {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
    }

    Function("consumePending") { () -> String? in
      guard
        let group = Bundle.main.object(forInfoDictionaryKey: "RetrospendAppGroup") as? String,
        let defaults = UserDefaults(suiteName: group),
        let pending = defaults.string(forKey: "pending")
      else { return nil }
      defaults.removeObject(forKey: "pending")
      return pending
    }
  }
}
