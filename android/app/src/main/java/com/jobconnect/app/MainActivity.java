package com.jobconnect.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/** The public site, wrapped for Android. */
public class MainActivity extends AppCompatActivity {

    private static final int NOTIF_PERMISSION = 1001;
    private WebView webView;
    private SwipeRefreshLayout swipe;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        NotificationHelper.ensureChannel(this);
        askNotificationPermission();
        NotifyWorker.schedule(this);

        webView = findViewById(R.id.webview);
        swipe = findViewById(R.id.swipe);
        Button adminButton = findViewById(R.id.adminButton);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                swipe.setRefreshing(false);
                syncSessionToBackground();
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new SessionBridge(), "JCApp");
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        swipe.setOnRefreshListener(webView::reload);
        adminButton.setOnClickListener(v ->
                startActivity(new Intent(MainActivity.this, AdminActivity.class)));

        webView.loadUrl(BuildConfig.SITE_URL);
    }

    /**
     * The website keeps its session in localStorage. Copying it into
     * SharedPreferences lets the background worker raise notifications even
     * when the WebView is not running.
     */
    private void syncSessionToBackground() {
        webView.evaluateJavascript(
            "(function(){try{var t=localStorage.getItem('jc_token')||'';var u=JSON.parse(localStorage.getItem('jc_user')||'null');" +
            "window.JCApp&&window.JCApp.setSession(t,u?u.role:'',u?u.name:'');return t;}catch(e){return '';}})();",
            value -> { /* bridging happens through JCApp below */ });
    }

    /** Exposed to the page. */
    private class SessionBridge {
        @android.webkit.JavascriptInterface
        public void setSession(String token, String role, String name) {
            if (token == null) return;
            Prefs.setToken(MainActivity.this, token);
            Prefs.setRole(MainActivity.this, role);
            Prefs.setName(MainActivity.this, name);
            NotifyWorker.schedule(MainActivity.this);
        }

        @android.webkit.JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIF_PERMISSION);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == NOTIF_PERMISSION && results.length > 0
                && results[0] != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Notifications are disabled. You can enable them in Settings.",
                    Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) syncSessionToBackground();
    }
}
