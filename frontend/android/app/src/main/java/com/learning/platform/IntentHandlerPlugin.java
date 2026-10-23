package com.learning.platform;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "IntentHandler")
public class IntentHandlerPlugin extends Plugin {
    private static final String TAG = "IntentHandler";
    private static String pendingFilePath = null;
    private static String pendingFileName = null;
    private static String pendingFileMime = null;
    private static Context appContext = null;

    public static void init(Context ctx) {
        appContext = ctx.getApplicationContext();
    }

    public static void handleIntent(Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_VIEW.equals(action)) return;

        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) {
            // Some apps pass file path in data URI for ACTION_VIEW
            uri = intent.getData();
        }
        if (uri == null) return;

        try {
            String fileName = getFileName(ctx, uri);
            String mimeType = intent.getType();
            if (mimeType == null) {
                mimeType = ctx.getContentResolver().getType(uri);
            }
            if (mimeType == null) mimeType = "application/octet-stream";

            // Copy shared file to internal storage
            File dir = new File(ctx.getFilesDir(), "shared");
            if (!dir.exists()) dir.mkdirs();
            File outFile = new File(dir, sanitizeFileName(fileName));

            try (InputStream is = ctx.getContentResolver().openInputStream(uri);
                 FileOutputStream os = new FileOutputStream(outFile)) {
                byte[] buf = new byte[8192];
                int len;
                while ((len = is.read(buf)) != -1) {
                    os.write(buf, 0, len);
                }
            }

            pendingFilePath = outFile.getAbsolutePath();
            pendingFileName = fileName;
            pendingFileMime = mimeType;
            Log.i(TAG, "Shared file saved: " + pendingFilePath + " (" + pendingFileMime + ")");
        } catch (Exception e) {
            Log.e(TAG, "Failed to handle shared file", e);
            clear();
        }
    }

    @PluginMethod
    public void getPendingSharedFile(PluginCall call) {
        if (pendingFilePath == null) {
            JSObject ret = new JSObject();
            ret.put("hasFile", false);
            call.resolve(ret);
            return;
        }

        JSObject ret = new JSObject();
        ret.put("hasFile", true);
        ret.put("path", pendingFilePath);
        ret.put("name", pendingFileName != null ? pendingFileName : "shared_file");
        ret.put("mimeType", pendingFileMime != null ? pendingFileMime : "application/octet-stream");
        call.resolve(ret);
    }

    @PluginMethod
    public void readSharedFile(PluginCall call) {
        if (pendingFilePath == null) {
            call.reject("No pending shared file");
            return;
        }
        try {
            File f = new File(pendingFilePath);
            byte[] bytes = new byte[(int) f.length()];
            try (FileInputStream fis = new FileInputStream(f)) {
                fis.read(bytes);
            }
            String base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
            JSObject ret = new JSObject();
            ret.put("data", base64);
            ret.put("name", pendingFileName != null ? pendingFileName : "shared_file");
            ret.put("mimeType", pendingFileMime != null ? pendingFileMime : "application/octet-stream");
            ret.put("size", f.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read shared file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearPendingSharedFile(PluginCall call) {
        clear();
        call.resolve();
    }

    @PluginMethod
    public void openFileExternally(PluginCall call) {
        String filePath = call.getString("path");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (filePath == null || filePath.isEmpty()) {
            call.reject("No file path provided");
            return;
        }
        try {
            File file = new File(filePath);
            if (!file.exists()) {
                call.reject("File not found: " + filePath);
                return;
            }
            Uri uri = androidx.core.content.FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mimeType);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open file: " + e.getMessage());
        }
    }

    private static void clear() {
        pendingFilePath = null;
        pendingFileName = null;
        pendingFileMime = null;
    }

    private static String getFileName(Context ctx, Uri uri) {
        String name = null;
        if (uri.getScheme() != null && uri.getScheme().equals("content")) {
            try (Cursor cursor = ctx.getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) name = cursor.getString(idx);
                }
            }
        }
        if (name == null) {
            name = Uri.decode(uri.getLastPathSegment());
            if (name == null) name = "shared_file";
        }
        return name;
    }

    private static String sanitizeFileName(String name) {
        // Remove path separators and special chars
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }
}
