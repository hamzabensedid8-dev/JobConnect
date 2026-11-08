package com.jobconnect.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/**
 * Polls /api/notifications and raises local notifications.
 *
 * Uses the signed-in session token, so the same code covers candidates,
 * recruiters and the admin console.
 */
public class NotifyWorker extends Worker {

    public NotifyWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** Registers the periodic check (15 minutes is the platform minimum). */
    public static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                NotifyWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "jobconnect-notifications",
                ExistingPeriodicWorkPolicy.UPDATE,
                request);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        String token = Prefs.token(ctx);
        if (token == null || token.isEmpty()) return Result.success();

        try {
            JSONObject payload = Api.getJson(BuildConfig.SITE_URL + "/api/notifications", token);
            JSONArray items = payload.optJSONArray("notifications");
            if (items == null) return Result.success();

            long lastSeen = Prefs.lastNotifId(ctx);
            long maxId = lastSeen;
            boolean isAdmin = "admin".equals(Prefs.role(ctx));

            // Oldest first so the newest lands on top of the shade.
            for (int i = items.length() - 1; i >= 0; i--) {
                JSONObject n = items.optJSONObject(i);
                if (n == null) continue;
                long id = n.optLong("id");
                if (id <= lastSeen) continue;

                String title = n.optString("title", "JobConnect");
                String body = n.optString("body", "");
                NotificationHelper.show(ctx, (int) (id % Integer.MAX_VALUE), title, body, isAdmin);
                if (id > maxId) maxId = id;
            }

            if (maxId > lastSeen) Prefs.setLastNotifId(ctx, maxId);
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }
}
