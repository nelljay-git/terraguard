package com.terraguard.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Minimal Capacitor plugin for TerraGuard push notifications:
 *  - getToken() — FCM registration token (the app registers the device in
 *    the fcm_tokens table via PostgREST).
 *  - requestNotificationPermission() / checkPermission()
 *  - openAppSettings() — deep-link into this app's system settings (denied case).
 */
@CapacitorPlugin
public class FCMPlugin extends Plugin {

    @PluginMethod
    public void getToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        JSObject r = new JSObject();
                        r.put("token", task.getResult());
                        call.resolve(r);
                    } else {
                        call.reject("TOKEN_FAILED",
                                task.getException() != null ? task.getException().getMessage() : "unknown");
                    }
                });
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            // Resolve only after the user answers the system dialog.
            ((MainActivity) activity).requestNotificationPermission(
                    () -> call.resolve(permissionStatus()));
        } else {
            call.resolve(permissionStatus());
        }
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        call.resolve(permissionStatus());
    }

    /** Start/stop the optional on-device shake detector. */
    @PluginMethod
    public void startShakeDetection(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        Intent intent = new Intent(ctx, ShakeDetectionService.class);
        intent.putExtra("testMode", ShakeDetectionService.isTestMode());
        intent.putExtra("sensitivity", 1);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent);
        else ctx.startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void setMotionTestMode(PluginCall call) {
        ShakeDetectionService.setTestMode(call.getBoolean("enabled", true));
        call.resolve();
    }

    @PluginMethod
    public void setMotionSensitivity(PluginCall call) {
        ShakeDetectionService.setSensitivity(call.getInt("level", 1));
        call.resolve();
    }

    @PluginMethod
    public void setMotionNotifications(PluginCall call) {
        ShakeDetectionService.setNotificationsEnabled(call.getBoolean("enabled", true));
        call.resolve();
    }

    @PluginMethod
    public void stopShakeDetection(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        ctx.stopService(new Intent(ctx, ShakeDetectionService.class));
        call.resolve();
    }

    @PluginMethod
    public void isShakeDetectionRunning(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", ShakeDetectionService.isRunning());
        r.put("samples", ShakeDetectionService.sampleCount);
        r.put("lastMotion", ShakeDetectionService.lastMotion);
        r.put("lastWindowPeak", ShakeDetectionService.lastWindowPeak);
        r.put("lastWindowRms", ShakeDetectionService.lastWindowRms);
        r.put("lastReversals", ShakeDetectionService.lastReversals);
        r.put("lastFrequencyHz", ShakeDetectionService.lastFrequencyHz);
        r.put("ax", ShakeDetectionService.lastAx);
        r.put("ay", ShakeDetectionService.lastAy);
        r.put("az", ShakeDetectionService.lastAz);
        r.put("magnitude", ShakeDetectionService.lastMagnitude);
        r.put("measuredHz", ShakeDetectionService.measuredHz);
        r.put("state", ShakeDetectionService.lastState);
        r.put("classification", ShakeDetectionService.lastClassificationStatic);
        r.put("confidence", ShakeDetectionService.lastConfidenceStatic);
        r.put("accepted", ShakeDetectionService.acceptedCount);
        r.put("rejected", ShakeDetectionService.rejectedCount);
        r.put("testMode", ShakeDetectionService.isTestMode());
        r.put("dropped", ShakeDetectionService.droppedSamples);
        call.resolve(r);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).openAppSettings();
        }
        call.resolve();
    }

    private JSObject permissionStatus() {
        JSObject r = new JSObject();
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Activity activity = getActivity();
            granted = activity != null
                    && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                            == PackageManager.PERMISSION_GRANTED;
        } else {
            granted = true; // Android < 13: no runtime permission
        }
        r.put("state", granted ? 0 : -1);
        return r;
    }
}
