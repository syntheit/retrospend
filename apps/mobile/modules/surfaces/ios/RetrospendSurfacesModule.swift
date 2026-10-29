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
      self.sweepShared()
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

    // The share extension copies a shared file into shared/ in the App
    // Group. Once the app has taken the note in, the copy goes. Only files in
    // that folder are ever removed.
    Function("releaseShared") { (uri: String) in
      guard
        let url = URL(string: uri), url.isFileURL,
        let folder = self.sharedFolder(),
        url.resolvingSymlinksInPath().deletingLastPathComponent().path
          == folder.resolvingSymlinksInPath().path
      else { return }
      try? FileManager.default.removeItem(at: url)
    }
  }

  private var group: String? {
    Bundle.main.object(forInfoDictionaryKey: "RetrospendAppGroup") as? String
  }

  private func sharedFolder() -> URL? {
    guard
      let group,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent("shared", isDirectory: true)
  }

  /// At launch: removes copies older than a day that nothing released (a
  /// share the app never opened, a note replaced by a newer one). The
  /// extension dates each copy when it makes it; the file of the note still
  /// waiting is kept whatever its age.
  private func sweepShared() {
    let manager = FileManager.default
    guard
      let folder = sharedFolder(),
      let files = try? manager.contentsOfDirectory(
        at: folder, includingPropertiesForKeys: [.contentModificationDateKey])
    else { return }
    let waiting = group
      .flatMap { UserDefaults(suiteName: $0)?.string(forKey: "pending") }
      .flatMap { $0.data(using: .utf8) }
      .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      .flatMap { ($0["file"] as? [String: Any])?["uri"] as? String }
      .flatMap { URL(string: $0)?.lastPathComponent }
    let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
    for file in files where file.lastPathComponent != waiting {
      let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?
        .contentModificationDate
      if let modified, modified < cutoff { try? manager.removeItem(at: file) }
    }
  }
}
