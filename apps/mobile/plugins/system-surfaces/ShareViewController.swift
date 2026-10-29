import UIKit
import UniformTypeIdentifiers

/// Share into Retrospend. It takes the first receipt image or PDF and the
/// first text from the share sheet, leaves them in the App Group (a file in
/// the container, one JSON note in the defaults), then opens the app on
/// retrospend://share, which opens the composer. No screen of its own: the
/// composer is the confirmation.
final class ShareViewController: UIViewController {
  private var group: String? {
    Bundle.main.object(forInfoDictionaryKey: "RetrospendAppGroup") as? String
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    Task { await handOff() }
  }

  private func handOff() async {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
      .flatMap { $0.attachments ?? [] }
    var note: [String: Any] = ["kind": "share"]
    for provider in providers {
      if note["file"] == nil, let file = await copyFile(provider) {
        note["file"] = file
      } else if note["text"] == nil, let text = await readText(provider) {
        note["text"] = text
      }
    }
    if note["file"] != nil || note["text"] != nil, let group,
      let defaults = UserDefaults(suiteName: group),
      let data = try? JSONSerialization.data(withJSONObject: note),
      let json = String(data: data, encoding: .utf8)
    {
      defaults.set(json, forKey: "pending")
      openApp()
    }
    extensionContext?.completeRequest(returningItems: nil)
  }

  private func readText(_ provider: NSItemProvider) async -> String? {
    let id = UTType.plainText.identifier
    guard provider.hasItemConformingToTypeIdentifier(id) else { return nil }
    let item = try? await provider.loadItem(forTypeIdentifier: id)
    return (item as? String) ?? (item as? URL)?.absoluteString
  }

  /// The image or PDF, copied into the App Group container (the system's
  /// temporary copy is gone when this returns). Returns the note's file entry.
  private func copyFile(_ provider: NSItemProvider) async -> [String: String]? {
    guard
      let id = provider.registeredTypeIdentifiers.first(where: {
        guard let type = UTType($0) else { return false }
        return type.conforms(to: .image) || type.conforms(to: .pdf)
      }),
      let type = UTType(id),
      let group,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    let folder = container.appendingPathComponent("shared", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let name = provider.suggestedName ?? "receipt"
    let ext = type.preferredFilenameExtension ?? "bin"
    let target = folder.appendingPathComponent("\(UUID().uuidString).\(ext)")
    return await withCheckedContinuation { continuation in
      provider.loadFileRepresentation(forTypeIdentifier: id) { url, _ in
        guard let url, (try? FileManager.default.copyItem(at: url, to: target)) != nil else {
          continuation.resume(returning: nil)
          return
        }
        // The copy keeps the original's dates; the app's sweep of shared/
        // goes by when it was shared (RetrospendSurfacesModule.swift).
        try? FileManager.default.setAttributes(
          [.modificationDate: Date()], ofItemAtPath: target.path)
        continuation.resume(returning: [
          "uri": target.absoluteString,
          "mime": type.preferredMIMEType ?? "application/octet-stream",
          "name": "\(name).\(ext)",
        ])
      }
    }
  }

  /// A share extension may not call UIApplication.shared; the responder chain
  /// leads to the host's application, which opens our scheme. If it does not,
  /// the note waits and the app takes it the next time it comes to the front.
  private func openApp() {
    guard let url = URL(string: "retrospend://share") else { return }
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication {
        application.open(url, options: [:], completionHandler: nil)
        return
      }
      responder = current.next
    }
  }
}
