package com.terraguard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * Native mirror of the TypeScript motion engine (src/lib/motion/*).
 *
 * EXPERIMENTAL ONLY. This class classifies phone motion patterns; it cannot
 * determine whether motion came from an earthquake. It MUST NOT be presented
 * as an earthquake detector, predictor, or early-warning system.
 *
 * Kept native so detection continues when the WebView is suspended. The TS
 * engine is the source of truth for the algorithms and the Diagnostics Lab.
 */
public class ShakeDetectionService extends Service implements SensorEventListener {

    private static final String CHANNEL_STATUS = "terraguard_shake_status_v2";
    private static final String CHANNEL_ALERT = "terraguard_motion_experimental_v3";
    private static final int STATUS_ID = 101;

    private static final int TARGET_HZ = 50;
    private static final long WINDOW_MS = 3000;
    private static final float GRAVITY_ALPHA = 0.006f;
    private static final float DEADBAND = 0.55f;
    private static final float CALM_PEAK_MAX = 1.5f;

    // Sensitivity presets mirror SENSITIVITY_PRESETS in config.ts.
    private static final float[][] THRESHOLDS = {
        {4.2f, 2.0f, 10, 2200, 0.50f, 0.75f}, // low
        {2.8f, 1.2f, 6, 1500, 0.38f, 0.62f},  // medium
        {2.2f, 0.9f, 5, 1100, 0.30f, 0.55f},  // high
    };

    private static class Sample {
        long t;
        float dx, dy, dz;
        float gx, gy, gz;
        boolean gyro;
        boolean degraded;
    }

    private SensorManager sensorManager;
    private Sensor accelerometer;
    private Sensor gyroscope;
    private final float[] gravity = new float[3];
    private boolean gravityInitialized = false;
    private final List<Sample> buffer = new ArrayList<>();

    private long windowStart = 0;
    private long lastAlertAt = Long.MIN_VALUE;
    private long lastSignatureTime = -1;
    private int qualifyingWindows = 0;
    private int sensitivity = 1;
    private static boolean running = false;
    private static boolean testMode = false; // dev/test mode: never notify

    private String state = "IDLE";
    private String lastClassification = "UNKNOWN";
    private float lastConfidence = 0f;
    private String lastReason = "No classification yet";

    // Diagnostics for FCMPlugin / Lab.
    public static int sampleCount = 0;
    public static int droppedSamples = 0;
    public static float lastMotion = 0f;
    public static float lastWindowPeak = 0f;
    public static float lastWindowRms = 0f;
    public static int lastReversals = 0;
    public static float lastFrequencyHz = 0f;
    public static float lastAx = 0f;
    public static float lastAy = 0f;
    public static float lastAz = 0f;
    public static float lastMagnitude = 0f;
    public static float measuredHz = 0f;
    public static String lastState = "IDLE";
    public static String lastClassificationStatic = "UNKNOWN";
    public static float lastConfidenceStatic = 0f;
    public static int acceptedCount = 0;
    public static int rejectedCount = 0;

    public static boolean isRunning() { return running; }
    public static boolean isTestMode() { return testMode; }
    public static void setTestMode(boolean value) { testMode = value; }
    public static void setSensitivity(int level) {
        if (level >= 0 && level <= 2) {
            // Instance reads this via static getter below.
            sensitivityStatic = level;
        }
    }
    private static int sensitivityStatic = 1;
    private static boolean notificationsEnabled = true;
    public static void setNotificationsEnabled(boolean value) { notificationsEnabled = value; }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        createChannels();
        startForeground(STATUS_ID, statusNotification());

        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        accelerometer = sensorManager != null
                ? sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) : null;
        gyroscope = sensorManager != null
                ? sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE) : null;
        if (accelerometer != null) {
            sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME);
        }
        if (gyroscope != null) {
            sensorManager.registerListener(this, gyroscope, SensorManager.SENSOR_DELAY_GAME);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.hasExtra("sensitivity")) {
            sensitivity = intent.getIntExtra("sensitivity", 1);
        }
        if (intent != null && intent.hasExtra("testMode")) {
            testMode = intent.getBooleanExtra("testMode", false);
        }
        sensitivity = sensitivityStatic;
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        running = false;
        if (sensorManager != null) sensorManager.unregisterListener(this);
        super.onDestroy();
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    private float[] gyro = new float[3];
    private boolean gyroFresh = false;

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() == Sensor.TYPE_GYROSCOPE) {
            gyro[0] = event.values[0];
            gyro[1] = event.values[1];
            gyro[2] = event.values[2];
            gyroFresh = true;
            return;
        }
        if (event.sensor.getType() != Sensor.TYPE_ACCELEROMETER) return;

        long now = event.timestamp / 1_000_000L; // nanos -> ms
        if (now <= 0) now = System.currentTimeMillis();

        if (!gravityInitialized) {
            gravity[0] = event.values[0];
            gravity[1] = event.values[1];
            gravity[2] = event.values[2];
            gravityInitialized = true;
        }
        float dx = 0, dy = 0, dz = 0;
        for (int i = 0; i < 3; i++) {
            gravity[i] += (event.values[i] - gravity[i]) * GRAVITY_ALPHA;
        }
        dx = event.values[0] - gravity[0];
        dy = event.values[1] - gravity[1];
        dz = event.values[2] - gravity[2];

        float deviation = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (!Float.isFinite(deviation)) {
            droppedSamples++;
            return;
        }
        if (deviation > 80f) {
            float scale = 80f / deviation;
            dx *= scale; dy *= scale; dz *= scale;
            deviation = 80f;
        }

        Sample s = new Sample();
        s.t = now;
        s.dx = dx; s.dy = dy; s.dz = dz;
        s.gyro = gyroFresh;
        s.gx = gyro[0]; s.gy = gyro[1]; s.gz = gyro[2];
        gyroFresh = false;
        long prev = sampleCount > 0 ? buffer.isEmpty() ? now : buffer.get(buffer.size() - 1).t : now;
        s.degraded = sampleCount > 0 && (now - prev) > (1000f / TARGET_HZ) * 3;

        sampleCount++;
        lastMotion = deviation;
        lastAx = event.values[0]; lastAy = event.values[1]; lastAz = event.values[2];
        lastMagnitude = (float) Math.sqrt(event.values[0] * event.values[0]
                + event.values[1] * event.values[1] + event.values[2] * event.values[2]);
        if (prev != now) measuredHz = 1000f / Math.max(1, now - prev);
        lastState = state;

        buffer.add(s);
        while (!buffer.isEmpty() && now - buffer.get(0).t > WINDOW_MS) buffer.remove(0);

        if (buffer.size() >= TARGET_HZ * 2 && now - windowStart >= 1000) {
            evaluate(now);
            windowStart = now;
            // Slide half a window forward.
            long cutoff = now - WINDOW_MS / 2;
            while (!buffer.isEmpty() && buffer.get(0).t < cutoff) buffer.remove(0);
        }
    }

    private void evaluate(long now) {
        int n = buffer.size();
        if (n < 8) return;
        float[] magnitudes = new float[n];
        float sum = 0, sumSq = 0, peak = 0;
        for (int i = 0; i < n; i++) {
            Sample s = buffer.get(i);
            magnitudes[i] = (float) Math.sqrt(s.dx * s.dx + s.dy * s.dy + s.dz * s.dz);
            sum += magnitudes[i];
            sumSq += magnitudes[i] * magnitudes[i];
            if (magnitudes[i] > peak) peak = magnitudes[i];
        }
        float mean = sum / n;
        float variance = sumSq / n - mean * mean;
        float rms = (float) Math.sqrt(sumSq / n);

        int[] reversals = new int[3];
        int[] signs = new int[3];
        for (Sample s : buffer) {
            float[] vals = {s.dx, s.dy, s.dz};
            for (int a = 0; a < 3; a++) {
                int sign = vals[a] > DEADBAND ? 1 : vals[a] < -DEADBAND ? -1 : 0;
                if (sign != 0) {
                    if (signs[a] != 0 && sign != signs[a]) reversals[a]++;
                    signs[a] = sign;
                }
            }
        }
        int totalReversals = reversals[0] + reversals[1] + reversals[2];
        float seconds = Math.max((now - buffer.get(0).t) / 1000f, 0.001f);
        float frequency = (totalReversals / 3f / seconds) / 2f;

        // Local peak consistency.
        float std = (float) Math.sqrt(Math.max(0, variance));
        float threshold = mean + 0.5f * std;
        List<Float> peaks = new ArrayList<>();
        for (int i = 1; i < n - 1; i++) {
            if (magnitudes[i] > magnitudes[i - 1] && magnitudes[i] >= magnitudes[i + 1]
                    && magnitudes[i] > threshold) peaks.add(magnitudes[i]);
        }
        float consistency = 0;
        if (peaks.size() >= 3) {
            float pm = 0;
            for (float p : peaks) pm += p;
            pm /= peaks.size();
            if (pm > 0) {
                float pv = 0;
                for (float p : peaks) pv += (p - pm) * (p - pm);
                consistency = Math.max(0, 1f - (float) Math.sqrt(pv / peaks.size()) / pm);
            }
        }

        // Motion duration (runs above the noise floor).
        long duration = 0;
        long runStart = -1;
        for (Sample s : buffer) {
            float m = (float) Math.sqrt(s.dx * s.dx + s.dy * s.dy + s.dz * s.dz);
            boolean moving = m > Math.max(DEADBAND, CALM_PEAK_MAX * 0.6f);
            if (moving && runStart < 0) runStart = s.t;
            if ((!moving || s == buffer.get(buffer.size() - 1)) && runStart >= 0) {
                duration += s.t - runStart;
                runStart = -1;
            }
        }

        float angular = 0;
        int gyroCount = 0;
        for (Sample s : buffer) {
            if (s.gyro) {
                angular += Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz);
                gyroCount++;
            }
        }
        if (gyroCount > 0) angular /= gyroCount;

        int degraded = 0;
        for (Sample s : buffer) if (s.degraded) degraded++;
        String quality = degraded > n * 0.5 ? "POOR" : degraded > n * 0.2 ? "DEGRADED" : "GOOD";

        lastWindowPeak = peak;
        lastWindowRms = rms;
        lastReversals = totalReversals;
        lastFrequencyHz = frequency;

        float[] t = THRESHOLDS[sensitivity];
        int oscillatingAxes = 0;
        for (int r : reversals) if (r >= 2) oscillatingAxes++;
        boolean calmBefore = lastWindowPeakBefore < CALM_PEAK_MAX
                && lastWindowPeakBefore2 < CALM_PEAK_MAX;
        boolean quakeLike = peak >= t[0] && rms >= t[1]
                && totalReversals >= t[2] && oscillatingAxes >= 2
                && frequency >= 0.8f && frequency <= 12f && consistency >= t[4]
                && duration >= t[3];

        if (quality.equals("POOR") || !Float.isFinite(peak)) {
            classify("UNKNOWN", 0.2f, "Insufficient or poor-quality sensor data", false, now);
            lastWindowPeakBefore2 = lastWindowPeakBefore;
            lastWindowPeakBefore = peak;
            return;
        }

        // Impact: isolated spike with short duration.
        if (peak >= 9.8f && duration < t[3]) {
            classify("SUDDEN_IMPACT", 0.85f, "Sharp impulse followed by settling, not sustained motion", false, now);
        } else if (frequency >= 6f && frequency <= 22f && consistency >= 0.72f) {
            classify("PERIODIC_VIBRATION", 0.8f, "High-frequency, highly consistent oscillation", false, now);
        } else if (peak < 9.8f && frequency > 0.5f && frequency < 4f && angular > 0.6f) {
            classify("NORMAL_ACTIVITY", 0.72f, "Regular low-frequency motion with strong rotational component", false, now);
        } else if (quakeLike) {
            qualify(now, calmBefore);
        } else {
            qualifyReset(now);
        }

        lastWindowPeakBefore2 = lastWindowPeakBefore;
        lastWindowPeakBefore = peak;
    }

    private float lastWindowPeakBefore = 0f;
    private float lastWindowPeakBefore2 = 0f;

    private void qualify(long now, boolean calmBefore) {
        state = "SUSTAINED_MOTION_CANDIDATE";
        qualifyingWindows++;
        float[] t = THRESHOLDS[sensitivity];
        boolean cooldownOk = now - lastAlertAt >= 30_000L;
        boolean duplicate = lastSignatureTime >= 0 && (now / 30_000L) == lastSignatureTime;
        if (qualifyingWindows >= 2 && cooldownOk && !duplicate) {
            lastAlertAt = now;
            lastSignatureTime = now / 30_000L;
            qualifyingWindows = 0;
            classify("SUSTAINED_OSCILLATION", 0.88f,
                    "Sustained multi-axis oscillation confirmed across consecutive windows", true, now);
            state = "COOLDOWN";
            lastState = state;
            showExperimentalAlert();
        } else {
            classify("SUSTAINED_OSCILLATION", 0.88f,
                    cooldownOk ? "Candidate awaiting additional evidence" : "Cooldown active — duplicate suppressed",
                    false, now);
        }
    }

    private void qualifyReset(long now) {
        qualifyingWindows = 0;
        classify("UNKNOWN", 0.3f, "Evidence did not meet sustained-motion criteria", false, now);
    }

    private void classify(String name, float confidence, String reason, boolean accepted, long now) {
        lastClassification = name;
        lastConfidence = confidence;
        lastReason = reason;
        lastClassificationStatic = name;
        lastConfidenceStatic = confidence;
        if (!accepted) rejectedCount++;
        if (!name.equals("UNKNOWN") && !name.equals("NORMAL_ACTIVITY")) {
            state = name.equals("SUDDEN_IMPACT") ? "IMPACT_DETECTED"
                    : name.equals("PERIODIC_VIBRATION") ? "VIBRATION_DETECTED" : state;
        }
        if (accepted) acceptedCount++;
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;

        NotificationChannel status = new NotificationChannel(
                CHANNEL_STATUS, "Shake monitoring", NotificationManager.IMPORTANCE_LOW);
        status.setSound(null, null);
        manager.createNotificationChannel(status);

        NotificationChannel alert = new NotificationChannel(
                CHANNEL_ALERT, "Experimental Motion", NotificationManager.IMPORTANCE_HIGH);
        Uri sound = Uri.parse("android.resource://" + getPackageName() + "/raw/alert");
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        alert.setSound(sound, attrs);
        manager.createNotificationChannel(alert);
        manager.deleteNotificationChannel("terraguard_shake_alert_v2");
    }

    private PendingIntent openApp() {
        Intent open = new Intent(getApplicationContext(), MainActivity.class);
        open.setAction(Intent.ACTION_VIEW);
        open.setData(Uri.parse("terraguard://open/alerts?tab=settings"));
        return PendingIntent.getActivity(getApplicationContext(), 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification statusNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_STATUS)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Watching for strong shaking")
                .setContentText("Experimental motion monitoring is active. Tap to stop.")
                .setContentIntent(openApp())
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void showExperimentalAlert() {
        if (testMode || !notificationsEnabled) return; // TEST MODE / user opt-out never notify.
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        String text = "Your device detected sustained movement. This does not confirm an earthquake. Check official earthquake information for verified reports.";
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ALERT)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Experimental Motion Detected")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openApp())
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build();
        manager.notify((int) (System.currentTimeMillis() % 100000), n);
    }
}
