// 本项目对 cap add 生成结果的 iOS 改动(另一处是 SceneDelegate 里换成这个类):
// 顶部页面加载进度条 + 侧滑返回 + 强制更新提示。
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

    // 版本接口地址。由 scripts/configure.mjs 从 app.config.json 的 updateCheckUrl 同步,
    // 别手改 —— 跑一次 npm run configure 就会被覆盖回去。
    private static let updateCheckUrl = ""  // configure.mjs:updateCheckUrl

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
        checkForRequiredUpdate()
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

// MARK: - 强制更新

extension MainViewController {

    /// 为什么做在原生侧:WebView 自己崩了、或者网站整个打不开的时候,网页里的提示
    /// 也显示不出来 —— 而"版本太旧导致前后端对不上"恰恰经常以这种形式表现。
    ///
    /// 安全性质:拿不到、解析不了、字段缺失、超时 —— 任何一种情况都【什么都不做】。
    /// 一个会因为接口挂了就把用户锁在遮罩后面的强制更新,比没有强制更新糟得多。
    func checkForRequiredUpdate() {
        let raw = Self.updateCheckUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, let url = URL(string: raw), url.scheme?.lowercased() == "https" else { return }

        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self = self,
                  let data = data,
                  let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let ios = root["ios"] as? [String: Any],
                  let minVersion = ios["minVersion"] as? String
            else { return }

            guard let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
                  Self.isVersion(current, olderThan: minVersion)
            else { return }

            let storeUrl = ios["storeUrl"] as? String
            let message = (root["message"] as? String) ?? "这个版本太旧了,请更新后继续使用。"
            DispatchQueue.main.async { self.showUpdateGate(message: message, storeUrl: storeUrl) }
        }.resume()
    }

    /// 按点分段逐段比数字。段数不一样时短的那个当补 0("1.2" < "1.2.1")。
    /// 任何一段不是数字就当做"不旧",宁可不提示也别误锁用户。
    static func isVersion(_ current: String, olderThan minimum: String) -> Bool {
        let a = current.split(separator: ".").map { Int($0) }
        let b = minimum.split(separator: ".").map { Int($0) }
        // 空字符串在 Swift 里 split 出来是空数组,不加这一条会被当成 0 → 误判成"旧"
        if a.isEmpty || b.isEmpty { return false }
        if a.contains(where: { $0 == nil }) || b.contains(where: { $0 == nil }) { return false }
        let lhs = a.compactMap { $0 }
        let rhs = b.compactMap { $0 }
        for index in 0..<max(lhs.count, rhs.count) {
            let l = index < lhs.count ? lhs[index] : 0
            let r = index < rhs.count ? rhs[index] : 0
            if l != r { return l < r }
        }
        return false
    }

    /// 不可关闭的全屏遮罩。只有去更新这一条出路。
    func showUpdateGate(message: String, storeUrl: String?) {
        guard view.subviews.first(where: { $0.tag == Self.updateGateTag }) == nil else { return }

        let gate = UIView()
        gate.tag = Self.updateGateTag
        gate.backgroundColor = .systemBackground          // 不透明,把 WebView 彻底盖住
        gate.isUserInteractionEnabled = true              // 触摸也不会漏到下面
        gate.translatesAutoresizingMaskIntoConstraints = false

        let title = UILabel()
        title.text = "需要更新"
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        title.textAlignment = .center

        let body = UILabel()
        body.text = message
        body.font = .systemFont(ofSize: 15)
        body.textColor = .secondaryLabel
        body.numberOfLines = 0
        body.textAlignment = .center

        let stack = UIStackView(arrangedSubviews: [title, body])
        stack.axis = .vertical
        stack.spacing = 10
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false

        if let storeUrl = storeUrl, let target = URL(string: storeUrl) {
            let button = UIButton(type: .system)
            button.setTitle("去更新", for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
            button.addAction(UIAction { _ in UIApplication.shared.open(target) }, for: .touchUpInside)
            stack.addArrangedSubview(button)
            stack.setCustomSpacing(24, after: body)
        }

        gate.addSubview(stack)
        view.addSubview(gate)

        NSLayoutConstraint.activate([
            gate.topAnchor.constraint(equalTo: view.topAnchor),
            gate.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            gate.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            gate.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: gate.safeAreaLayoutGuide.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: gate.safeAreaLayoutGuide.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: gate.safeAreaLayoutGuide.trailingAnchor, constant: -28)
        ])

        // 侧滑返回也要挡住,否则一划就能看到后面的页面
        webView?.allowsBackForwardNavigationGestures = false
    }

    static var updateGateTag: Int { 0x5547 }
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
