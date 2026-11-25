// 本项目对 cap add 生成结果的 iOS 改动(另一处是 SceneDelegate 里换成这个类):
// 顶部页面加载进度条 + 侧滑返回。
//
// 为什么只能这样扩展:Capacitor 的 WebViewDelegationHandler 占着 navigationDelegate
// 和 uiDelegate,而且它在 bridge 里是 public private(set) var —— 外部替换不了。
// 硬把 webView.navigationDelegate 指向自己的对象会连带废掉 errorPath(离线页)、
// 页面加载状态和 bridge 的清理逻辑。所以这里只用 CAPBridgeViewController 的官方
// 钩子(webView(with:configuration:)、capacitorDidLoad())加 KVO —— KVO 不抢
// delegate,所以这条路是安全的。
//
// 升级 Capacitor 后要重新验证:这两个钩子还是不是 open,view 是不是仍然等于 webView。

import UIKit
import WebKit
import Capacitor

class MainViewController: CAPBridgeViewController {

    // configure.mjs 会把 app.config.json 的 themeColor 同步到下面这一行,
    // 别手改 —— 跑一次 npm run configure 就会被覆盖回去。
    private static let themeColorHex = "#1565C0"  // configure.mjs:themeColor

    private static let barHeight: CGFloat = 3
    /// 延迟出现:缓存命中的页面瞬间加载完,闪一下比没有更难看
    private static let appearDelay: TimeInterval = 0.15
    private static let fadeOutDuration: TimeInterval = 0.2

    // NSKeyValueObservation 必须存成属性,否则创建完立刻被释放,回调永远不触发。
    // iOS 进度条不动十有八九就是这个原因。
    private var progressObservation: NSKeyValueObservation?

    private let progressView = UIProgressView(progressViewStyle: .bar)
    private var appearWorkItem: DispatchWorkItem?
    private var lastProgress: Double = 0

    // MARK: - Capacitor 钩子

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = super.webView(with: frame, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true   // 侧滑返回
        return webView
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        installProgressView()
        observeProgress()
    }

    deinit {
        appearWorkItem?.cancel()
        progressObservation?.invalidate()
    }

    // MARK: - 安装

    private func installProgressView() {
        // 注意:CAPBridgeViewController 把 view 直接设成了 webView,所以这里是
        // 往 WKWebView 上加子视图。它不在 scrollView 里,所以不会跟着页面滚。
        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressView.progressTintColor = UIColor(hex: Self.themeColorHex)
        progressView.trackTintColor = .clear
        progressView.isHidden = true
        progressView.alpha = 0
        view.addSubview(progressView)

        NSLayoutConstraint.activate([
            progressView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progressView.heightAnchor.constraint(equalToConstant: Self.barHeight)
        ])
    }

    private func observeProgress() {
        guard let webView = webView else { return }
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
            guard let self = self, let value = change.newValue else { return }
            DispatchQueue.main.async { self.handleProgress(value) }
        }
    }

    // MARK: - 进度

    private func handleProgress(_ value: Double) {
        if value >= 1.0 {
            cancelAppear()
            lastProgress = 1
            guard !progressView.isHidden else { return }
            progressView.setProgress(1, animated: true)
            UIView.animate(
                withDuration: Self.fadeOutDuration,
                animations: { self.progressView.alpha = 0 },
                completion: { finished in
                    // 被新一轮加载打断时 completion 也会调用,这时别把条藏掉
                    guard finished else { return }
                    self.progressView.isHidden = true
                    self.progressView.setProgress(0, animated: false)
                    self.lastProgress = 0
                })
            return
        }

        // 进度回落 = 换页了,把条瞬间拉回起点,不要从右边倒着爬回来
        let restarted = value < lastProgress
        lastProgress = value

        if progressView.isHidden {
            if restarted { progressView.setProgress(Float(value), animated: false) }
            scheduleAppear()
        } else {
            // 可能正在淡出:打断它,否则新一轮加载的进度条是透明的
            progressView.layer.removeAllAnimations()
            progressView.alpha = 1
            progressView.setProgress(Float(value), animated: !restarted)
        }
    }

    private func scheduleAppear() {
        guard appearWorkItem == nil else { return }
        let item = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.appearWorkItem = nil
            if self.lastProgress >= 1 { return }      // 秒开的页面:到点了也不显示
            self.progressView.layer.removeAllAnimations()
            self.progressView.setProgress(Float(self.lastProgress), animated: false)
            self.progressView.isHidden = false
            self.progressView.alpha = 1
        }
        appearWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.appearDelay, execute: item)
    }

    private func cancelAppear() {
        appearWorkItem?.cancel()
        appearWorkItem = nil
    }
}

private extension UIColor {
    /// "#RRGGBB" → UIColor。格式不对就退回系统蓝,不崩。
    convenience init(hex: String) {
        let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else {
            self.init(red: 0, green: 0.48, blue: 1, alpha: 1)
            return
        }
        self.init(
            red: CGFloat((value & 0xFF0000) >> 16) / 255,
            green: CGFloat((value & 0x00FF00) >> 8) / 255,
            blue: CGFloat(value & 0x0000FF) / 255,
            alpha: 1)
    }
}
