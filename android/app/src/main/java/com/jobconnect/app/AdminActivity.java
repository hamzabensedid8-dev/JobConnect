package com.jobconnect.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;

/**
 * Admin console.
 *
 * The whole console is an HTML asset compiled into the APK and served from
 * appassets.androidplatform.net — there is no admin page on the server, no
 * admin URL to discover, and the API refuses admin logins that do not carry
 * the client key this app injects.
 */
public class AdminActivity extends AppCompatActivity {

    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String CONSOLE_URL = "https://" + ASSET_HOST + "/assets/admin.html";
    private static final int NOTIF_PERMISSION = 2001;

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_admin);

        NotificationHelper.ensureChannel(this);
        askNotificationPermission();

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = findViewById(R.id.webview);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.addJavascriptInterface(new Bridge(), "JCAndroid");
        webView.loadUrl(CONSOLE_URL);
    }

    /** Exposes the client key + session storage to the bundled console. */
    private class Bridge {
        @JavascriptInterface
        public String clientKey() {
            return BuildConfig.ADMIN_CLIENT_KEY;
        }

        @JavascriptInterface
        public String apiBase() {
            return BuildConfig.SITE_URL;
        }

        @JavascriptInterface
        public void saveSession(String token, String role, String name) {
            Prefs.setToken(AdminActivity.this, token);
            Prefs.setRole(AdminActivity.this, role);
            Prefs.setName(AdminActivity.this, name);
            NotifyWorker.schedule(AdminActivity.this);
        }

        @JavascriptInterface
        public void clearSession() {
            Prefs.clear(AdminActivity.this);
        }

        @JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(AdminActivity.this, message, Toast.LENGTH_SHORT).show());
        }
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIF_PERMISSION);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
