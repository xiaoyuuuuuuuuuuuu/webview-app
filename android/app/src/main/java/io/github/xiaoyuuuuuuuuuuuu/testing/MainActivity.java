// 本项目对 cap add 生成结果的 Android 改动,六项,都集中在这个文件:
//   1. 顶部页面加载进度条
//   2. 文件下载(WebView 自己不会下载,点下载链接完全没反应)
//   3. 强制更新提示(做在原生侧,因为 WebView 崩了的时候网页提示也显示不出来)
//   4. 状态栏图标深浅(Capacitor 自带的 SystemBars 会盖掉配置,见 applySystemBarIcons)
//   5. 支付跳转:intent:// 链接(东南亚电子钱包常用),Capacitor 自己处理不了,
//      见 PaymentAwareWebViewClient
//   6. 打印:网页的 window.print() 在 WebView 里什么都不做,用一个本地插件
//      ShellPrintPlugin 接到系统打印,见文件末尾
//
// 为什么做在原生侧:server.url 模式下跨页导航会销毁整个 JS 环境,新页面的脚本要等
// HTML 到达才执行 —— 而等 HTML 的那几百毫秒到几秒正是需要显示进度的时间段,
// 只有原生层知道"请求发出了,还没回来"。另外 bridge 只注入 server.url 一个 origin,
// 网站跳到别的域名后 app-shell.js 全部失效,JS 方案在那些页面上也不存在。
//
// 为什么这样改是安全的:Capacitor 的 BridgeWebChromeClient 没有 override
// onProgressChanged(已核对 8.6.2 源码),所以继承它、只补这一个方法、并且第一行
// 调 super 不会吞掉任何 Capacitor 行为。承载本地资源服务 / bridge 注入 / 错误页
// 跳转的是 BridgeWebViewClient,是另一个对象 —— 对它只做了一处继承(第 5 项):
// shouldOverrideUrlLoading 里只拦 scheme 是 intent 的链接,其余一律走 super。
// 下载用的 WebView.setDownloadListener 是另一个回调,Capacitor 完全没碰过。
//
// 升级 Capacitor 后要重新验证:BridgeWebChromeClient 是否开始自己处理
// onProgressChanged,以及 capacitor_bridge_layout_main.xml 的根布局有没有换。
package io.github.xiaoyuuuuuuuuuuuu.testing;

import android.Manifest;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.URLUtil;
import android.view.Gravity;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URISyntaxException;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends BridgeActivity {

    /** 进度条高度 */
    private static final int BAR_HEIGHT_DP = 3;
    /** 延迟出现:缓存命中的页面瞬间加载完,闪一下比没有更难看 */
    private static final long APPEAR_DELAY_MS = 150;
    private static final long FADE_OUT_MS = 200;
    private static final long GROW_ANIM_MS = 180;

    private final Handler handler = new Handler(Looper.getMainLooper());

    private FrameLayout progressHost;   // 整条宽度的容器,靠 visibility 控制显隐
    private View progressFill;          // 满宽的填充块,用 scaleX 表示进度(pivot 在左边)
    private Runnable appearTask;
    private int lastProgress;

    /** 下载通知权限的请求码。Capacitor 的插件走 AndroidX 的 ActivityResultLauncher,不占用请求码 */
    private static final int REQ_POST_NOTIFICATIONS = 0x5744;

    private final Set<Long> myDownloads = new HashSet<>();
    private BroadcastReceiver downloadReceiver;
    private boolean notificationPermissionAsked;

    /** 版本接口地址。由 scripts/configure.mjs 从 app.config.json 的 updateCheckUrl 同步,别手改 */
    private static final String UPDATE_CHECK_URL = "";  // configure.mjs:updateCheckUrl
    private static final int UPDATE_TIMEOUT_MS = 8000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 本地插件必须在 super.onCreate 之前注册:registerPlugin 只是往 builder 里加,
        // 真正加载发生在 super.onCreate → load() 里(BridgeActivity.java:45-55)
        registerPlugin(ShellPrintPlugin.class);
        super.onCreate(savedInstanceState);
        installProgressBar();
        installDownloadListener();
        installPaymentRedirects();
        checkForRequiredUpdate();
        // 插件在 super.onCreate 里同步 load,SystemBars 在 load 里 post 了一次 setStyle;
        // 同一个主线程队列先进先出,这里 post 的就排在它后面
        handler.post(this::applySystemBarIcons);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);   // SystemBars 在这里面同步再设一次
        applySystemBarIcons();
    }

    /**
     * 状态栏和底部导航条的图标深浅,按 app.config.json 的 statusBarStyle
     * (configure.mjs 算好写进 R.bool.statusBarDarkIcons)。
     *
     * 为什么要在这里补设:Capacitor 8 核心自带的 SystemBars 插件默认 style DEFAULT
     * (跟系统深浅色),load 时设一次、每次配置变化(比如切深色模式)再设一次,
     * 会盖掉 StatusBar 插件和主题里的设置。真机实测:配置的 statusBarStyle "light"
     * 在深色模式下没生效,图标跟着系统变成了白的。
     * 底色不在这里管:它是主题的 windowBackground,见 styles.xml。
     */
    private void applySystemBarIcons() {
        boolean darkIcons = getResources().getBoolean(R.bool.statusBarDarkIcons);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(darkIcons);
        controller.setAppearanceLightNavigationBars(darkIcons);
    }

    // BridgeActivity.onDestroy() 是 public,Java 不允许重写时收窄可见性,
    // 写成 protected 会编译失败(attempting to assign weaker access privileges)。
    // 注意 onCreate 在 BridgeActivity 里是 protected,所以上面那个保持 protected 是对的。
    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (downloadReceiver != null) {
            unregisterReceiver(downloadReceiver);
            downloadReceiver = null;
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------- 安装

    private void installProgressBar() {
        WebView webView = bridge.getWebView();
        if (!(webView.getParent() instanceof ViewGroup)) return;
        ViewGroup parent = (ViewGroup) webView.getParent();

        int height = Math.round(BAR_HEIGHT_DP * getResources().getDisplayMetrics().density);

        // 进度用 scaleX 而不是改宽度:不触发布局、转屏自动跟着变、动画也更顺。
        // pivotX = 0 让它从左边长出来。
        progressFill = new View(this);
        progressFill.setBackgroundColor(getResources().getColor(R.color.colorPrimary, getTheme()));
        progressFill.setPivotX(0f);
        progressFill.setScaleX(0f);

        progressHost = new FrameLayout(this);
        progressHost.setVisibility(View.GONE);
        progressHost.addView(
                progressFill,
                new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 不自己构造 LayoutParams 类型,让父布局生成 —— 这样根布局是
        // CoordinatorLayout 还是别的都不用改代码。默认 gravity 在这些布局里
        // 都是左上角,正好是要的位置。最后 addView = 画在 WebView 之上。
        parent.addView(progressHost);
        ViewGroup.LayoutParams lp = progressHost.getLayoutParams();
        lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
        lp.height = height;
        progressHost.setLayoutParams(lp);

        // Android 15+ 强制 edge-to-edge,父布局顶部可能落在状态栏下面。
        // 把状态栏 inset 当上边距;inset 是 0 时这段等于没做。
        progressHost.setOnApplyWindowInsetsListener((v, insets) -> {
            if (v.getLayoutParams() instanceof ViewGroup.MarginLayoutParams) {
                int top = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                        ? insets.getInsets(WindowInsets.Type.statusBars()).top
                        : insets.getSystemWindowInsetTop();
                ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
                if (mlp.topMargin != top) {
                    mlp.topMargin = top;
                    v.setLayoutParams(mlp);
                }
            }
            return insets;
        });
        progressHost.requestApplyInsets();

        // 只换 WebChromeClient。WebViewClient 不动 —— 换掉它会废掉 bridge。
        webView.setWebChromeClient(new ProgressChromeClient(bridge));
    }

    // ---------------------------------------------------------------- 进度

    private class ProgressChromeClient extends BridgeWebChromeClient {
        ProgressChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onProgressChanged(WebView view, int progress) {
            super.onProgressChanged(view, progress);   // 必须:别吞掉 Capacitor 的行为
            onWebProgress(progress);
        }
    }

    private void onWebProgress(int progress) {
        if (progressHost == null) return;

        if (progress >= 100) {
            cancelAppear();
            lastProgress = 100;
            if (progressHost.getVisibility() == View.VISIBLE) {
                setProgress(100, false);
                progressHost
                        .animate()
                        .alpha(0f)
                        .setDuration(FADE_OUT_MS)
                        .withEndAction(() -> {
                            progressHost.setVisibility(View.GONE);
                            lastProgress = 0;
                            setProgress(0, false);
                        })
                        .start();
            }
            return;
        }

        // 进度回落 = 换页了,把条瞬间拉回起点,不要从右边倒着爬回来
        boolean restarted = progress < lastProgress;
        lastProgress = progress;

        if (progressHost.getVisibility() == View.VISIBLE) {
            // 可能正在淡出:取消掉,否则新一轮加载的进度条是透明的
            // (ViewPropertyAnimator 被 cancel 时 withEndAction 不会执行,所以不会被置 GONE)
            progressHost.animate().cancel();
            progressHost.setAlpha(1f);
            setProgress(progress, !restarted);
        } else {
            if (restarted) setProgress(progress, false);
            scheduleAppear();
        }
    }

    private void scheduleAppear() {
        if (appearTask != null) return;
        appearTask = () -> {
            appearTask = null;
            if (lastProgress >= 100) return;        // 秒开的页面:到点了也不显示
            progressHost.animate().cancel();
            progressHost.setAlpha(1f);
            progressHost.setVisibility(View.VISIBLE);
            setProgress(lastProgress, false);
        };
        handler.postDelayed(appearTask, APPEAR_DELAY_MS);
    }

    private void cancelAppear() {
        if (appearTask != null) {
            handler.removeCallbacks(appearTask);
            appearTask = null;
        }
    }

    private void setProgress(int progress, boolean animate) {
        if (progressFill == null) return;
        float scale = Math.min(Math.max(progress, 0), 100) / 100f;
        progressFill.animate().cancel();
        if (animate) {
            progressFill.animate().scaleX(scale).setDuration(GROW_ANIM_MS).start();
        } else {
            progressFill.setScaleX(scale);
        }
    }

    // ---------------------------------------------------------------- 下载

    // WebView 自己不会下载:点 PDF / 导出报表这种链接完全没反应,用户以为 app 坏了。
    // setDownloadListener 是 WebView 的原生回调,Capacitor 没有碰过,所以这里是安全的。
    // 真正的下载交给系统 DownloadManager —— 进度在通知栏、断点续传和重试都是系统管的,
    // 自己写 HTTP 下载只会更差。
    //
    // iOS 不走这条路:那边 navigationDelegate 被 Capacitor 占着,WKDownloadDelegate
    // 拿不到,所以 iOS 在 website/app-shell.js 里拦下载链接交给 Browser.open()。
    private void installDownloadListener() {
        bridge
                .getWebView()
                .setDownloadListener(
                        (url, userAgent, contentDisposition, mimeType, contentLength) ->
                                startDownload(url, userAgent, contentDisposition, mimeType));
    }

    private void startDownload(String url, String userAgent, String contentDisposition, String mimeType) {
        Uri uri;
        try {
            uri = Uri.parse(url);
        } catch (Exception e) {
            Logger.error("下载地址解析失败: " + url, e);
            return;
        }

        // DownloadManager 只认 http/https,blob: / data: 传进去会直接抛
        // IllegalArgumentException。这类链接丢给系统处理,处理不了就明确告诉用户。
        String scheme = uri.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            if (!bridge.launchIntent(uri)) {
                Toast.makeText(this, R.string.download_unsupported, Toast.LENGTH_LONG).show();
            }
            return;
        }

        String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);

        try {
            DownloadManager.Request request = new DownloadManager.Request(uri);

            // 最容易漏的一步:要登录才能下的文件,不带 cookie 会下到一个登录页 HTML,
            // 而且因为 HTTP 状态码是 200,看起来还像"下载成功了"。
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) {
                request.addRequestHeader("Cookie", cookie);
            }
            if (userAgent != null) {
                request.addRequestHeader("User-Agent", userAgent);
            }
            if (mimeType != null) {
                request.setMimeType(mimeType);
            }
            request.setTitle(fileName);
            request.setDescription(getString(R.string.app_name));
            request.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            // Android 10+ 写公共 Downloads 目录不需要存储权限
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show();
                return;
            }

            long id = manager.enqueue(request);
            myDownloads.add(id);
            registerDownloadReceiver();
            ensureNotificationPermission();
            Toast.makeText(this, getString(R.string.download_started, fileName), Toast.LENGTH_SHORT)
                    .show();
        } catch (Exception e) {
            // 同名文件、目录建不出来、URL 不合法都会走到这里
            Logger.error("下载失败: " + url, e);
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show();
        }
    }

    private void registerDownloadReceiver() {
        if (downloadReceiver != null) return;
        downloadReceiver =
                new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                        if (!myDownloads.remove(id)) return;   // 别的 app 的下载,不管
                        Toast.makeText(
                                        MainActivity.this,
                                        isDownloadSuccessful(id)
                                                ? R.string.download_done
                                                : R.string.download_failed,
                                        Toast.LENGTH_LONG)
                                .show();
                    }
                };
        // ACTION_DOWNLOAD_COMPLETE 是系统广播,所以必须注册成 EXPORTED(Android 14+ 强制要指定)
        ContextCompat.registerReceiver(
                this,
                downloadReceiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_EXPORTED);
    }

    /** 广播在下载失败时也会发,所以要查一下状态,别把失败说成完成 */
    private boolean isDownloadSuccessful(long id) {
        DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return false;
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) return false;
            int column = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            if (column < 0) return false;
            return cursor.getInt(column) == DownloadManager.STATUS_SUCCESSFUL;
        } catch (Exception e) {
            Logger.error("查下载状态失败", e);
            return false;
        }
    }

    /**
     * Android 13+ 没有这个权限的话下载进度通知不显示(下载本身照样进行)。
     * 所以只在用户真的点了下载之后才请求 —— 一进 app 就弹权限是最招人烦的做法。
     */
    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (notificationPermissionAsked) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        notificationPermissionAsked = true;
        requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_POST_NOTIFICATIONS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        // 这个权限拒了也不影响下载,只是没有通知,所以不往下传给 Capacitor
        if (requestCode == REQ_POST_NOTIFICATIONS) return;
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    // ---------------------------------------------------------------- 强制更新

    // 为什么做在原生侧:WebView 自己崩了、或者网站整个打不开的时候,网页里的提示
    // 也显示不出来 —— 而"版本太旧导致前后端对不上"恰恰经常以这种形式表现。
    //
    // 安全性质:拿不到、解析不了、字段缺失、网络超时 —— 任何一种情况都【什么都不做】。
    // 一个会因为接口挂了就把用户锁在遮罩后面的强制更新,比没有强制更新糟得多。
    private void checkForRequiredUpdate() {
        if (UPDATE_CHECK_URL == null || UPDATE_CHECK_URL.trim().isEmpty()) return;

        new Thread(() -> {
            try {
                JSONObject root = fetchJson(UPDATE_CHECK_URL);
                if (root == null) return;

                JSONObject android = root.optJSONObject("android");
                if (android == null) return;

                long minVersionCode = android.optLong("minVersionCode", -1);
                if (minVersionCode < 0 || currentVersionCode() >= minVersionCode) return;

                String storeUrl = android.optString("storeUrl", "");
                String message = root.optString("message", getString(R.string.update_required_message));
                runOnUiThread(() -> showUpdateGate(message, storeUrl));
            } catch (Exception e) {
                // 故意只记日志:检查更新失败绝不能影响 app 正常使用
                Logger.debug("检查更新失败: " + e.getMessage());
            }
        }).start();
    }

    private JSONObject fetchJson(String urlString) throws Exception {
        URL url = new URL(urlString);
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            Logger.error("updateCheckUrl 必须是 https: " + urlString);
            return null;
        }
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(UPDATE_TIMEOUT_MS);
            conn.setReadTimeout(UPDATE_TIMEOUT_MS);
            conn.setRequestProperty("Accept", "application/json");
            if (conn.getResponseCode() != 200) return null;
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            return new JSONObject(body.toString());
        } finally {
            conn.disconnect();
        }
    }

    private long currentVersionCode() throws Exception {
        PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return info.getLongVersionCode();
        }
        return info.versionCode;
    }

    /** 不可关闭的全屏遮罩。只有去更新这一条出路 */
    private void showUpdateGate(String message, String storeUrl) {
        float density = getResources().getDisplayMetrics().density;
        int pad = Math.round(28 * density);

        LinearLayout gate = new LinearLayout(this);
        gate.setOrientation(LinearLayout.VERTICAL);
        gate.setGravity(Gravity.CENTER);
        gate.setPadding(pad, pad, pad, pad);
        // 不透明背景 + clickable:把下面的 WebView 彻底盖住,触摸也拿不到
        gate.setBackgroundColor(ContextCompat.getColor(this, R.color.splashBackground));
        gate.setClickable(true);
        gate.setFocusable(true);

        TextView title = new TextView(this);
        title.setText(R.string.update_required_title);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);
        title.setTextColor(Color.parseColor("#18181B"));

        TextView body = new TextView(this);
        body.setText(message);
        body.setTextSize(15);
        body.setGravity(Gravity.CENTER);
        body.setTextColor(Color.parseColor("#52525B"));
        LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        bodyParams.topMargin = Math.round(10 * density);
        bodyParams.bottomMargin = Math.round(24 * density);
        body.setLayoutParams(bodyParams);

        gate.addView(title);
        gate.addView(body);

        if (!storeUrl.isEmpty()) {
            Button go = new Button(this);
            go.setText(R.string.update_required_action);
            go.setAllCaps(false);
            go.setOnClickListener(v -> bridge.launchIntent(Uri.parse(storeUrl)));
            gate.addView(go);
        }

        addContentView(
                gate,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // 返回键也要挡住,否则一按就退回 WebView。最后注册的 callback 优先级最高,
        // 所以这个会盖住 App 插件注册的那个。
        getOnBackPressedDispatcher()
                .addCallback(this, new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        // 刻意什么都不做
                    }
                });
    }

    // ---------------------------------------------------------------- 支付跳转

    // 东南亚的支付网关(还有很多"唤起 App"的链接)用 intent:// 把用户送到电子钱包 app:
    //
    //   intent://pay?token=…#Intent;scheme=tngdwallet;package=my.com.tngdigital.ewallet;
    //       S.browser_fallback_url=https%3A%2F%2F…;end
    //
    // Chrome 认识这种写法,WebView 不认识。Capacitor 8.6.2 的 Bridge.launchIntent 会直接拿
    // 这串原始链接 new Intent(ACTION_VIEW, url) —— 系统里没有任何 app 处理 "intent" 这个
    // scheme,于是抛 ActivityNotFoundException,而它接住异常的地方只写了
    // "// TODO - trigger an event"。结果:用户在结算页点"用电子钱包付款",什么都不发生,
    // 也不报错。
    //
    // 这里照 Chrome 的规则补上:解析 intent → 能打开就打开 → 打不开先走网关给的
    // browser_fallback_url → 再没有就去应用商店装那个 app → 都不行才提示。
    //
    // 为什么这样扩展是安全的:继承 BridgeWebViewClient,只覆盖 shouldOverrideUrlLoading,
    // 而且只拦 scheme 是 intent 的那一种,其余一律走 super —— 本地资源服务、bridge 注入、
    // 错误页跳转、插件的 shouldOverrideLoad 钩子全都不受影响。BUILD_SPEC 第 0.2 节说的
    // "要扩展必须 extends BridgeWebViewClient 并在每个 override 里调 super"就是这个。
    //
    // 不需要 <queries>:这里只用 startActivity + 接异常,不用 resolveActivity 去"先问一下
    // 装没装"。Android 11+ 的软件包可见性只限制后者,所以不用多声明任何东西。
    private void installPaymentRedirects() {
        bridge.setWebViewClient(new PaymentAwareWebViewClient(bridge));
    }

    private class PaymentAwareWebViewClient extends BridgeWebViewClient {
        PaymentAwareWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (url != null && "intent".equalsIgnoreCase(url.getScheme())) {
                return openIntentUrl(view, url.toString());
            }
            return super.shouldOverrideUrlLoading(view, request);
        }
    }

    /** 返回 true = 这次导航已经处理掉了,WebView 不要再加载它 */
    private boolean openIntentUrl(WebView view, String raw) {
        Intent intent;
        try {
            intent = Intent.parseUri(raw, Intent.URI_INTENT_SCHEME);
        } catch (URISyntaxException e) {
            Logger.error("intent:// 链接解析失败: " + raw, e);
            // 吞掉:不然 WebView 会把它当网页去加载,显示 ERR_UNKNOWN_URL_SCHEME 错误页
            return true;
        }

        // 安全加固(和 Chrome 一样):网页给的 intent 只能打开"浏览器能打开"的界面,
        // 不能点名某个组件。不清掉的话,恶意页面可以拼一个 intent 去唤起任意导出的 Activity。
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.setComponent(null);
        intent.setSelector(null);

        if (tryStart(intent)) return true;

        // 那个 app 没装。1) 网关给的备用网址:自己站的留在 app 里,别的站交给系统浏览器 ——
        //    和外链分流是同一个规则(launchIntent 返回 false 表示"这是允许在 app 里打开的")
        String fallback = intent.getStringExtra("browser_fallback_url");
        if (fallback != null && (fallback.startsWith("https://") || fallback.startsWith("http://"))) {
            if (!bridge.launchIntent(Uri.parse(fallback))) {
                view.loadUrl(fallback);
            }
            return true;
        }

        // 2) 指定了包名就去应用商店装它。包名先校验一下格式,别把网页给的任意字符串拼进去
        String pkg = intent.getPackage();
        if (pkg != null && pkg.matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+")) {
            if (tryStart(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)))
                    || tryStart(new Intent(Intent.ACTION_VIEW,
                            Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)))) {
                return true;
            }
        }

        // 3) 都不行:至少告诉用户,别让"点了没反应"再出现
        Toast.makeText(this, R.string.open_link_no_app, Toast.LENGTH_LONG).show();
        return true;
    }

    private boolean tryStart(Intent intent) {
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- 打印

    // 电商站常有「打印订单 / 打印发票」按钮,调的是 window.print()。浏览器里会弹打印
    // 对话框,但 Android WebView 收到它什么都不做 —— 按钮点了没反应。
    //
    // 修法是一个本地插件:app-shell.js 在 app 里把 window.print 换成调这个插件,
    // 这里用 WebView 自己的 createPrintDocumentAdapter 交给系统打印(PrintManager),
    // 用户可以选打印机,也可以「存为 PDF」。网站一行不用改。
    //
    // 嵌在 MainActivity 里而不是单独一个文件:原生改动集中在一个文件(BUILD_SPEC 1.2)。
    // 必须是 public static,Capacitor 用反射建实例。
    @CapacitorPlugin(name = "ShellPrint")
    public static class ShellPrintPlugin extends Plugin {

        @PluginMethod
        public void print(PluginCall call) {
            getActivity().runOnUiThread(() -> {
                try {
                    WebView webView = getBridge().getWebView();
                    PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    if (manager == null) {
                        call.reject("这台设备不支持打印", "UNAVAILABLE");
                        return;
                    }
                    String jobName = call.getString("jobName");
                    if (jobName == null || jobName.trim().isEmpty()) jobName = webView.getTitle();
                    if (jobName == null || jobName.trim().isEmpty()) {
                        jobName = getActivity().getString(R.string.app_name);
                    }
                    PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                    manager.print(jobName, adapter, new PrintAttributes.Builder().build());
                    call.resolve();
                } catch (Exception e) {
                    call.reject("打印失败: " + e.getMessage(), e);
                }
            });
        }
    }
}
