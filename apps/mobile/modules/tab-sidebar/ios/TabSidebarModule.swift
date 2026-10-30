import ExpoModulesCore
import ObjectiveC
import UIKit

/// The iPad sidebar as Apple lays it out (HIG, Tab bars: "a tab bar that
/// adapts into a sidebar"): the main destinations sit in the floating tab bar
/// and in the sidebar, the rest in the sidebar only.
///
/// UIKit does this with `UITab.preferredPlacement = .sidebarOnly`.
/// react-native-screens 4.30 builds every tab with the `.fixed` placement and
/// has no prop for it, so this module hooks the one place it sets it:
/// `-[RNSTabBarController disableUserCustomizationOfTab:]` runs once for each
/// new tab, and after it a tab whose identifier (the route name) is configured
/// as sidebar only gets that placement.
///
/// No headings: a `UITabGroup` shows its own view controller for every child
/// (tried on iPadOS 26.5: the children opened blank), and react-native-screens
/// owns the children's controllers, so the extra destinations follow the main
/// five in one list.
///
/// The hook exists only on the UITab path (iPadOS 26.1 and later in
/// react-native-screens). When the class or the selector is missing, as after
/// an upgrade that renames them, `isSupported` is false and the app keeps the
/// phone's five tabs on iPad.
public final class TabSidebarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TabSidebar")

    Function("isSupported") { () -> Bool in
      TabSidebar.isSupported
    }

    // config: { sidebarOnly: [String], openInLandscape: Bool }
    Function("configure") { (config: [String: Any]) in
      TabSidebar.state.update(config)
      TabSidebar.installHooks()
    }
  }
}

private final class SidebarState: @unchecked Sendable {
  private let lock = NSLock()
  private var _sidebarOnly: Set<String> = []
  private var _openInLandscape = false
  private var _opened = false

  func update(_ config: [String: Any]) {
    lock.lock()
    defer { lock.unlock() }
    _sidebarOnly = Set(config["sidebarOnly"] as? [String] ?? [])
    _openInLandscape = config["openInLandscape"] as? Bool ?? false
  }

  var sidebarOnly: Set<String> {
    lock.lock()
    defer { lock.unlock() }
    return _sidebarOnly
  }

  /// True once: the first install may open the sidebar, later ones never do.
  func takeOpenAtLaunch() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard _openInLandscape, !_opened else { return false }
    _opened = true
    return true
  }
}

private enum TabSidebar {
  static let state = SidebarState()
  private static let hooksLock = NSLock()
  nonisolated(unsafe) private static var hooked = false

  private static let controllerClass: AnyClass? = NSClassFromString("RNSTabBarController")
  private static let placementSelector = NSSelectorFromString("disableUserCustomizationOfTab:")
  private static let setTabsSelector = NSSelectorFromString("setTabs:animated:")

  static var isSupported: Bool {
    guard #available(iOS 26.1, *) else { return false }
    guard UIDevice.current.userInterfaceIdiom == .pad, let cls = controllerClass else {
      return false
    }
    return class_getInstanceMethod(cls, placementSelector) != nil
  }

  static func installHooks() {
    guard #available(iOS 26.1, *), isSupported, let cls = controllerClass else { return }
    hooksLock.lock()
    defer { hooksLock.unlock() }
    if hooked { return }
    hooked = true
    hookPlacement(cls)
    hookSetTabs(cls)
    hookSelection(cls)
  }

  /// UIKit puts a selected sidebar-only tab at the end of the floating bar and
  /// leaves it there after the person moves on, which pushes a main tab
  /// behind the bar's chevron in portrait. Reinstalling the tabs once the
  /// selection is back on a bar tab drops it again.
  @available(iOS 26.1, *)
  private static func hookSelection(_ cls: AnyClass) {
    let setter = NSSelectorFromString("setSelectedTab:")
    if let method = class_getInstanceMethod(cls, setter) {
      typealias Original = @convention(c) (AnyObject, Selector, UITab?) -> Void
      let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
      let block: @convention(block) (AnyObject, UITab?) -> Void = { controller, tab in
        original(controller, setter, tab)
        tidyBar(controller as? UITabBarController)
      }
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
    let didSelect = NSSelectorFromString("tabBarController:didSelectTab:previousTab:")
    if let method = class_getInstanceMethod(cls, didSelect) {
      typealias Original = @convention(c) (AnyObject, Selector, UITabBarController, UITab, UITab?)
        -> Void
      let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
      let block: @convention(block) (AnyObject, UITabBarController, UITab, UITab?) -> Void = {
        controller, tabBarController, tab, previous in
        original(controller, didSelect, tabBarController, tab, previous)
        tidyBar(tabBarController)
      }
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
  }

  nonisolated(unsafe) private static var lastWasSidebarOnly = false
  nonisolated(unsafe) private static var tidying = false

  @available(iOS 26.1, *)
  private static func tidyBar(_ controller: UITabBarController?) {
    guard let controller, !tidying else { return }
    let selected = controller.selectedTab
    let sidebarOnly = selected.map { state.sidebarOnly.contains($0.identifier) } ?? false
    let leaving = lastWasSidebarOnly && !sidebarOnly
    lastWasSidebarOnly = sidebarOnly
    guard leaving else { return }
    DispatchQueue.main.async {
      guard !tidying, controller.selectedTab === selected else { return }
      tidying = true
      // UIKit ignores the same list, so the sidebar-only tabs leave for a
      // moment and come back; their screens stay with react-native-screens.
      let tabs = controller.tabs
      let barTabs = tabs.filter { !state.sidebarOnly.contains($0.identifier) }
      UIView.performWithoutAnimation {
        controller.setTabs(barTabs, animated: false)
        controller.setTabs(tabs, animated: false)
      }
      if let selected, controller.selectedTab !== selected { controller.selectedTab = selected }
      tidying = false
    }
  }

  @available(iOS 26.1, *)
  private static func hookPlacement(_ cls: AnyClass) {
    guard let method = class_getInstanceMethod(cls, placementSelector) else { return }
    typealias Original = @convention(c) (AnyObject, Selector, UITab) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
    let selector = placementSelector
    let block: @convention(block) (AnyObject, UITab) -> Void = { controller, tab in
      original(controller, selector, tab)
      if state.sidebarOnly.contains(tab.identifier) {
        tab.preferredPlacement = .sidebarOnly
      }
    }
    method_setImplementation(method, imp_implementationWithBlock(block))
  }

  /// Only to open the sidebar after the first install. RNSTabBarController
  /// does not override `setTabs:animated:`, so the hook is added to that
  /// subclass alone and calls UIKit's implementation.
  @available(iOS 26.1, *)
  private static func hookSetTabs(_ cls: AnyClass) {
    guard let inherited = class_getInstanceMethod(UITabBarController.self, setTabsSelector) else {
      return
    }
    typealias SetTabs = @convention(c) (AnyObject, Selector, NSArray, Bool) -> Void
    let selector = setTabsSelector
    let own = class_getInstanceMethod(cls, setTabsSelector)
    let ownIsInherited = own.map { method_getImplementation($0) == method_getImplementation(inherited) } ?? true
    let next = unsafeBitCast(
      method_getImplementation(ownIsInherited ? inherited : own!), to: SetTabs.self)
    let block: @convention(block) (AnyObject, NSArray, Bool) -> Void = {
      controller, tabs, animated in
      next(controller, selector, tabs, animated)
      openSidebarIfLandscape(controller as? UITabBarController)
    }
    let implementation = imp_implementationWithBlock(block)
    if !class_addMethod(cls, setTabsSelector, implementation, method_getTypeEncoding(inherited)),
      let own
    {
      method_setImplementation(own, implementation)
    }
  }

  /// HIG: the sidebar can start open where there is room: a regular width
  /// window, in portrait or landscape. Only at launch; after that the
  /// person's toggle decides.
  @available(iOS 26.1, *)
  private static func openSidebarIfLandscape(_ controller: UITabBarController?) {
    guard let controller, state.takeOpenAtLaunch() else { return }
    DispatchQueue.main.async {
      // The controller may not be in a window yet on the first install, so
      // the scene says how the iPad is held.
      let scene =
        controller.view.window?.windowScene
        ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
      guard let scene else { return }
      if scene.traitCollection.horizontalSizeClass == .regular {
        controller.sidebar.isHidden = false
      }
    }
  }
}
