package site.sc27c.zhican;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** 智蚕卫士 WebView 壳：全屏加载线上仪表盘。 */
public class MainActivity extends Activity {

    private static final String HOME_URL = "https://sc.27c.site/";
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        WebSettings st = web.getSettings();
        st.setJavaScriptEnabled(true);
        st.setDomStorageEnabled(true);          // 界面状态与上传表单需要
        st.setUseWideViewPort(true);
        st.setLoadWithOverviewMode(true);
        st.setSupportZoom(true);
        st.setBuiltInZoomControls(true);
        st.setDisplayZoomControls(false);
        st.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient()); // 站内导航留在壳内
        setContentView(web);

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(HOME_URL);
        }
    }

    /** 返回键：WebView 有历史则后退，否则退出。 */
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }
}
