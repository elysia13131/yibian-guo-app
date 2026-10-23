package com.learning.platform;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String TAG = "AppUpdate";
    private static final String PREFS_NAME = "app_update_prefs";
    private static final String KEY_VERSION = "current_version";
    private static final String KEY_VERSION_CODE = "current_version_code";
    private static final String ASSET_DOMAIN = "appassets.androidplatform.net";
    private static final String ASSET_PATH_PREFIX = "/assets/public/";
    private static final String PUBLIC_DIR = "public";

    @Override
    public void load() {
        super.load();
        initAssets();
        setupWebViewIntercept();
    }

    private void initAssets() {
        Context context = getContext();
        File publicDir = new File(context.getFilesDir(), PUBLIC_DIR);
        if (publicDir.exists() && publicDir.list().length > 0) {
            return;
        }

        try {
            copyAssets(context, "public", publicDir.getAbsolutePath());
            Log.i(TAG, "Assets copied to: " + publicDir.getAbsolutePath());
        } catch (IOException e) {
            Log.e(TAG, "Failed to copy assets", e);
        }
    }

    private void copyAssets(Context context, String assetPath, String outputDir) throws IOException {
        String[] list = context.getAssets().list(assetPath);
        if (list == null || list.length == 0) {
            return;
        }

        File outDir = new File(outputDir);
        if (!outDir.exists()) {
            outDir.mkdirs();
        }

        for (String name : list) {
            String fullAssetPath = assetPath + "/" + name;
            String fullOutputPath = outputDir + "/" + name;

            try {
                String[] subList = context.getAssets().list(fullAssetPath);
                if (subList != null && subList.length > 0) {
                    copyAssets(context, fullAssetPath, fullOutputPath);
                } else {
                    try (InputStream is = context.getAssets().open(fullAssetPath);
                         FileOutputStream os = new FileOutputStream(fullOutputPath)) {
                        byte[] buf = new byte[8192];
                        int len;
                        while ((len = is.read(buf)) != -1) {
                            os.write(buf, 0, len);
                        }
                    }
                }
            } catch (IOException e) {
                Log.w(TAG, "Failed to copy: " + fullAssetPath, e);
            }
        }
    }

    private void setupWebViewIntercept() {
        Bridge bridge = getBridge();
        if (bridge == null) return;

        WebView webView = bridge.getWebView();
        if (webView == null) return;

        final WebViewClient originalClient = webView.getWebViewClient();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                // 1) 旧版 appassets 协议 (兼容)
                if (url.contains(ASSET_DOMAIN) && url.contains(ASSET_PATH_PREFIX)) {
                    String relativePath = url.substring(url.indexOf(ASSET_PATH_PREFIX) + ASSET_PATH_PREFIX.length());
                    File updatedFile = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + relativePath);
                    if (updatedFile.exists() && updatedFile.isFile()) {
                        try {
                            String mimeType = getMimeType(relativePath);
                            WebResourceResponse response = new WebResourceResponse(mimeType, null, new FileInputStream(updatedFile));
                            Map<String, String> headers = new HashMap<>();
                            headers.put("Cache-Control", "no-cache, no-store, must-revalidate");
                            headers.put("Pragma", "no-cache");
                            headers.put("Expires", "0");
                            response.setResponseHeaders(headers);
                            return response;
                        } catch (IOException e) {
                            Log.w(TAG, "Failed to read updated file: " + updatedFile, e);
                        }
                    }
                }

                // 2) Capacitor 6 localhost 协议
                if (url.contains("localhost")) {
                    try {
                        java.net.URI uri = new java.net.URI(url);
                        String path = uri.getPath(); // e.g. "/assets/index.js" or "/index.html"
                        if (path != null && path.startsWith("/")) {
                            path = path.substring(1); // relative path matching manifest keys
                        }
                        if (path != null && !path.isEmpty()) {
                            File updatedFile = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + path);
                            if (updatedFile.exists() && updatedFile.isFile()) {
                                String mimeType = getMimeType(path);
                                WebResourceResponse response = new WebResourceResponse(mimeType, null, new FileInputStream(updatedFile));
                                Map<String, String> headers = new HashMap<>();
                                headers.put("Cache-Control", "no-cache, no-store, must-revalidate");
                                headers.put("Pragma", "no-cache");
                                headers.put("Expires", "0");
                                response.setResponseHeaders(headers);
                                return response;
                            }
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Failed to parse URL: " + url, e);
                    }
                }

                if (originalClient != null) {
                    return originalClient.shouldInterceptRequest(view, request);
                }
                return null;
            }
        });
    }

    private String getMimeType(String path) {
        if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".gif")) return "image/gif";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".ico")) return "image/x-icon";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".ttf")) return "font/ttf";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".map")) return "application/json";
        return "application/octet-stream";
    }

    @PluginMethod
    public void getCurrentVersion(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String version = prefs.getString(KEY_VERSION, "0.0.0");
        int versionCode = prefs.getInt(KEY_VERSION_CODE, 0);
        // 兜底：无 SharedPreferences 时从 APK PackageInfo 读取
        if (version.equals("0.0.0") || versionCode == 0) {
            try {
                android.content.pm.PackageInfo pInfo = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
                if (version.equals("0.0.0") && pInfo.versionName != null) {
                    version = pInfo.versionName;
                }
                if (versionCode == 0) {
                    versionCode = pInfo.versionCode;
                }
            } catch (Exception e) {
                Log.w(TAG, "getCurrentVersion fallback failed", e);
            }
        }
        JSObject ret = new JSObject();
        ret.put("version", version);
        ret.put("versionCode", versionCode);
        call.resolve(ret);
    }

    @PluginMethod
    public void setCurrentVersion(PluginCall call) {
        String version = call.getString("version");
        if (version == null) {
            call.reject("version is required");
            return;
        }
        int versionCode = call.getInt("versionCode", 0);
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_VERSION, version)
            .putInt(KEY_VERSION_CODE, versionCode)
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String path = call.getString("path");
        String base64Content = call.getString("content");

        if (path == null || base64Content == null) {
            call.reject("path and content are required");
            return;
        }

        try {
            File file = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + path);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }

            byte[] data = Base64.decode(base64Content, Base64.DEFAULT);
            try (FileOutputStream os = new FileOutputStream(file)) {
                os.write(data);
            }

            call.resolve();
        } catch (IOException e) {
            Log.e(TAG, "Failed to write file: " + path, e);
            call.reject("Failed to write file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path is required");
            return;
        }

        try {
            File file = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + path);
            if (file.exists() && file.delete()) {
                call.resolve();
            } else {
                call.reject("File not found or delete failed");
            }
        } catch (Exception e) {
            call.reject("Failed to delete file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getFileHash(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path is required");
            return;
        }

        File file = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + path);
        if (!file.exists()) {
            JSObject ret = new JSObject();
            ret.put("exists", false);
            call.resolve(ret);
            return;
        }

        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (FileInputStream fis = new FileInputStream(file)) {
                byte[] buf = new byte[8192];
                int len;
                while ((len = fis.read(buf)) != -1) {
                    digest.update(buf, 0, len);
                }
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest()) {
                hex.append(String.format("%02x", b));
            }
            JSObject ret = new JSObject();
            ret.put("exists", true);
            ret.put("sha256", hex.toString());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to compute hash", e);
            call.reject("Failed to compute hash: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearCacheAndReload(PluginCall call) {
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.post(() -> {
                    webView.clearCache(true);
                    webView.reload();
                });
                Log.i(TAG, "WebView cache clear + reload scheduled");
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to clear cache and reload", e);
            call.reject("Failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String apkPath = call.getString("path");
        if (apkPath == null) {
            call.reject("apk path is required");
            return;
        }

        try {
            File apkFile = new File(apkPath);
            // 如果是相对路径，尝试在 public 目录下查找
            if (!apkFile.exists()) {
                apkFile = new File(getContext().getFilesDir(), PUBLIC_DIR + "/" + apkPath);
            }
            if (!apkFile.exists()) {
                call.reject("APK file not found: " + apkPath);
                return;
            }

            Uri apkUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apkFile
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            Log.i(TAG, "APK install intent launched: " + apkFile.getAbsolutePath());
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to install APK", e);
            call.reject("Failed to install: " + e.getMessage());
        }
    }
}
