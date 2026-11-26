package com.terraguard.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private ActivityResultLauncher<String> notificationPermissionLauncher;
    private Runnable notificationPermissionCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom native plugins must be registered explicitly (they are not in
        // capacitor.plugins.json because they have no npm package). Without
        // this, JS FCMPlugin.* calls never resolve — the UI sits at "Checking…".
        registerPlugin(FCMPlugin.class);
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher = registerForActivityResult(
                    new ActivityResultContracts.RequestPermission(),
                    isGranted -> {
                        Runnable cb = notificationPermissionCallback;
                        notificationPermissionCallback = null;
                        if (cb != null) cb.run();
                    });
        }
        MessagingService.ensureNotificationChannels(getApplicationContext());
    }

    /**
     * Ask the system for POST_NOTIFICATIONS (Android 13+). {@code onResult} runs
     * after the user answers, so the caller can read the real grant state
     * instead of the value from before the dialog appeared.
     */
    public void requestNotificationPermission(Runnable onResult) {
        if (notificationPermissionLauncher == null) {
            if (onResult != null) onResult.run();
            return;
        }
        notificationPermissionCallback = onResult;
        notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS);
    }

    /** Open this app's system settings screen (for denied permissions). */
    public void openAppSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getPackageName(), null));
        startActivity(intent);
    }
}
