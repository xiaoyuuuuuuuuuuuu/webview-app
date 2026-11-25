// 本项目对 cap add 生成结果的唯一 Android 改动:顶部页面加载进度条。
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
//
// 升级 Capacitor 后要重新验证:BridgeWebChromeClient 是否开始自己处理
// onProgressChanged,以及 capacitor_bridge_layout_main.xml 的根布局有没有换。
package com.example.shop;

import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.WebView;
import android.widget.FrameLayout;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installProgressBar();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
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
}
