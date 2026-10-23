package com.learning.platform;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import androidx.core.content.FileProvider;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LlamaPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(IntentHandlerPlugin.class);
        super.onCreate(savedInstanceState);
        IntentHandlerPlugin.init(this);
        IntentHandlerPlugin.handleIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        IntentHandlerPlugin.handleIntent(this, intent);
    }
}
