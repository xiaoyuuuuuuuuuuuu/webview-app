// 本项目对 cap add 生成结果的 Android 改动,三项,都集中在这个文件:
//   1. 顶部页面加载进度条
//   2. 文件下载(WebView 自己不会下载,点下载链接完全没反应)
//   3. 强制更新提示(做在原生侧,因为 WebView 崩了的时候网页提示也显示不出来)
//
// 为什么做在原生侧:server.url 模式下跨页导航会销毁整个 JS 环境,新页面的脚本要等
// HTML 到达才执行 —— 而等 HTML 的那几百毫秒到几秒正是需要显示进度的时间段,
// 只有原生层知道"请求发出了,还没回来"。另外 bridge 只注入 server.url 一个 origin,
// 网站跳到别的域名后 app-shell.js 全部失效,JS 方案在那些页面上也不存在。
//
// 为什么这样改是安全的:Capacitor 的 BridgeWebChromeClient 没有 override
// onProgressChanged(已核对 8.6.2 源码),所以继承它、只补这一个方法、并且第一行
// 调 super 不会吞掉任何 Capacitor 行为。承载本地资源服务 / bridge 注入 / 错误页
// 跳转的是 BridgeWebViewClient,是另一个对象,这里完全没碰。
// 下载用的 WebView.setDownloadListener 是另一个回调,Capacitor 完全没碰过。
//
// 升级 Capacitor 后要重新验证:BridgeWebChromeClient 是否开始自己处理
// onProgressChanged,以及 capacitor_bridge_layout_main.xml 的根布局有没有换。
package com.example.shop;

import android.Manifest;
import android.app.DownloadManager;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
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

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.Logger;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
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
        super.onCreate(savedInstanceState);
        installProgressBar();
        installDownloadListener();
        checkForRequiredUpdate();
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
}
