import ExpoModulesCore
import UIKit

/// Cmd shortcuts for a hardware keyboard. React Native has no key command API
/// and Expo UI has no SwiftUI `keyboardShortcut`, so this puts UIKeyCommands on
/// the root view controller: UIKit offers them to the responder chain (the
/// focused field, the screen, the root) and lists them in the overlay that
/// appears when Cmd is held. JS decides what each one does.
public final class HardwareKeysModule: Module {
  private static let selector = NSSelectorFromString("retrospendKeyCommand:")
  private var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?

  public func definition() -> ModuleDefinition {
    Name("HardwareKeys")

    Events("onKeyCommand")

    // commands: [{ id, input, title }]; every one is Cmd + input.
    Function("setCommands") { (commands: [[String: String]]) in
      DispatchQueue.main.async { self.install(commands, attempts: 20) }
    }

    OnDestroy {
      DispatchQueue.main.async { self.remove() }
    }
  }

  private func rootViewController() -> UIViewController? {
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      if let root = windowScene.windows.first(where: { $0.isKeyWindow })?.rootViewController
        ?? windowScene.windows.first?.rootViewController {
        return root
      }
    }
    return nil
  }

  private func install(_ commands: [[String: String]], attempts: Int) {
    guard let root = rootViewController() else {
      // The scene may not have a window yet at startup.
      if attempts > 0 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
          self.install(commands, attempts: attempts - 1)
        }
      }
      return
    }
    remove()
    // The action is a selector sent up the responder chain, so the root view
    // controller's class gets a method for it that forwards to JS.
    let block: @convention(block) (AnyObject, AnyObject) -> Void = { [weak self] _, sender in
      guard let command = sender as? UIKeyCommand, let id = command.propertyList as? String else {
        return
      }
      self?.sendEvent("onKeyCommand", ["id": id])
    }
    class_addMethod(type(of: root), Self.selector, imp_implementationWithBlock(block), "v@:@")
    for entry in commands {
      guard let id = entry["id"], let input = entry["input"], let title = entry["title"] else {
        continue
      }
      let command = UIKeyCommand(
        title: title, image: nil, action: Self.selector, input: input,
        modifierFlags: .command, propertyList: id)
      // Wins over a focused text field's own handling of the same keys.
      command.wantsPriorityOverSystemBehavior = true
      root.addKeyCommand(command)
      installed.append(command)
    }
    host = root
  }

  private func remove() {
    for command in installed { host?.removeKeyCommand(command) }
    installed = []
  }
}
