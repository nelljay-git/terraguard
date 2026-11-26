package com.terraguard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Data-only FCM message handler — shows a system notification and, on tap,
 * opens the app at the /details/:id page (deep link: terraguard://details/{eqId}).
 *
 * Foreground and background behavior is identical: this service is invoked by
 * Firebase for data-only messages, so notifications appear whether the app is
 * open, in the background, or closed.
 */
public class MessagingService extends com.google.firebase.messaging.FirebaseMessagingService {

    // New IDs: Android locks a channel's sound at creation time, so we need
    // fresh channels to apply the bundled alert.mp3 on existing installs.
    private static final String CHANNEL_NEW = "terraguard_new_v2";
    private static final String CHANNEL_SIGNIFICANT = "terraguard_significant_v2";
    private static final String CHANNEL_NEARBY = "terraguard_nearby_v2";
    private static final String CHANNEL_UPDATES = "terraguard_updates_v2";
    private static final String CHANNEL_CONCERN = "terraguard_concern_v2";
    private static final String CHANNEL_VOLCANO = "terraguard_volcano_v2";
    private static final String CHANNEL_TSUNAMI = "terraguard_tsunami_v2";

    private static Uri alertSoundUri(@NonNull Context context) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/raw/alert");
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        ensureNotificationChannels(getApplicationContext());

        Map<String, String> data = message.getData();
        String nid = data.get("nid");
        if (TextUtils.isEmpty(nid)) return;

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;

        NotificationCompat.Builder builder =
                new NotificationCompat.Builder(getApplicationContext(), channelIdFor(data.get("category")));
        // Admin messages get a chat-bubble icon; quake alerts keep the wave.
        int smallIcon = "admin".equals(data.get("category"))
                ? R.drawable.ic_notification_message
                : R.drawable.ic_notification;
        builder.setSmallIcon(smallIcon);
        builder.setContentTitle(data.get("title"));
        builder.setContentText(data.get("body"));
        builder.setAutoCancel(true);
        builder.setPriority(priorityFor(data.get("category")));
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // On older Android there are no channels; set the sound directly.
            builder.setSound(alertSoundUri(getApplicationContext()));
        }

        Intent open = null;
        String link = data.get("link");
        if (!TextUtils.isEmpty(link)) {
            if (link.startsWith("http://") || link.startsWith("https://")) {
                // External web link — open in the browser.
                open = new Intent(Intent.ACTION_VIEW, Uri.parse(link));
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            } else if (link.startsWith("/")) {
                // In-app route — route it through the custom scheme.
                open = new Intent(getApplicationContext(), MainActivity.class);
                open.setAction(Intent.ACTION_VIEW);
                open.setData(Uri.parse("terraguard://open" + link));
            }
        }
        if (open == null) {
            String eqId = data.get("eq_id");
            if (!TextUtils.isEmpty(eqId)) {
                open = new Intent(getApplicationContext(), MainActivity.class);
                open.setAction(Intent.ACTION_VIEW);
                open.setData(Uri.parse("terraguard://details/" + eqId));
            }
        }
        if (open != null) {
            builder.setContentIntent(PendingIntent.getActivity(
                    getApplicationContext(), 0, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }

        // Stable id — a later update for the same event (same nid) replaces this.
        manager.notify(nid, 0, builder.build());
    }

    @Override
    public void onDeletedMessages() {
        super.onDeletedMessages();
    }

    static void ensureNotificationChannels(@NonNull Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;

        // The channel sound cannot be changed after creation — always create
        // fresh channels with the bundled alert.mp3.
        Uri sound = alertSoundUri(context);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        NotificationChannel newQuake = new NotificationChannel(
                CHANNEL_NEW, "New Earthquakes", NotificationManager.IMPORTANCE_HIGH);
        newQuake.setSound(sound, attrs);
        manager.createNotificationChannel(newQuake);

        NotificationChannel significant = new NotificationChannel(
                CHANNEL_SIGNIFICANT, "Significant Earthquakes", NotificationManager.IMPORTANCE_HIGH);
        significant.setSound(sound, attrs);
        manager.createNotificationChannel(significant);

        NotificationChannel nearby = new NotificationChannel(
                CHANNEL_NEARBY, "Nearby Earthquakes", NotificationManager.IMPORTANCE_DEFAULT);
        nearby.setSound(sound, attrs);
        manager.createNotificationChannel(nearby);

        NotificationChannel updates = new NotificationChannel(
                CHANNEL_UPDATES, "Earthquake Updates", NotificationManager.IMPORTANCE_DEFAULT);
        updates.setSound(sound, attrs);
        manager.createNotificationChannel(updates);

        NotificationChannel concern = new NotificationChannel(
                CHANNEL_CONCERN, "Strong Quake Near You", NotificationManager.IMPORTANCE_HIGH);
        concern.setSound(sound, attrs);
        manager.createNotificationChannel(concern);

        NotificationChannel volcano = new NotificationChannel(
                CHANNEL_VOLCANO, "Volcano Bulletins", NotificationManager.IMPORTANCE_DEFAULT);
        volcano.setSound(sound, attrs);
        manager.createNotificationChannel(volcano);

        NotificationChannel tsunami = new NotificationChannel(
                CHANNEL_TSUNAMI, "Tsunami Advisories", NotificationManager.IMPORTANCE_DEFAULT);
        tsunami.setSound(sound, attrs);
        manager.createNotificationChannel(tsunami);

        // Drop the pre-_v2 channels (they kept the OS default sound).
        for (String old : new String[]{
                "terraguard_new", "terraguard_significant",
                "terraguard_nearby", "terraguard_updates"}) {
            manager.deleteNotificationChannel(old);
        }
    }

    private static String channelIdFor(@Nullable String category) {
        switch (category != null ? category : "") {
            case "significant": return CHANNEL_SIGNIFICANT;
            case "nearby":      return CHANNEL_NEARBY;
            case "update":      return CHANNEL_UPDATES;
            case "concern":     return CHANNEL_CONCERN;
            case "volcano":     return CHANNEL_VOLCANO;
            case "tsunami":     return CHANNEL_TSUNAMI;
            default:            return CHANNEL_NEW;
        }
    }

    private static int priorityFor(@Nullable String category) {
        switch (category != null ? category : "") {
            case "update":
            case "volcano":
            case "tsunami":    return Notification.PRIORITY_DEFAULT;
            default:           return Notification.PRIORITY_HIGH;
        }
    }
}
