package com.jobconnect.app;

import android.content.Context;
import android.content.SharedPreferences;

/** Small wrapper around SharedPreferences shared by the UI and the background worker. */
public final class Prefs {
    private static final String FILE = "jobconnect";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_LAST_NOTIF = "last_notif_id";
    private static final String KEY_ROLE = "role";
    private static final String KEY_NAME = "name";

    private Prefs() {}

    private static SharedPreferences sp(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public static String token(Context ctx) { return sp(ctx).getString(KEY_TOKEN, ""); }

    public static void setToken(Context ctx, String token) {
        sp(ctx).edit().putString(KEY_TOKEN, token == null ? "" : token).apply();
    }

    public static long lastNotifId(Context ctx) { return sp(ctx).getLong(KEY_LAST_NOTIF, 0L); }

    public static void setLastNotifId(Context ctx, long id) {
        sp(ctx).edit().putLong(KEY_LAST_NOTIF, id).apply();
    }

    public static String role(Context ctx) { return sp(ctx).getString(KEY_ROLE, ""); }

    public static void setRole(Context ctx, String role) {
        sp(ctx).edit().putString(KEY_ROLE, role == null ? "" : role).apply();
    }

    public static String name(Context ctx) { return sp(ctx).getString(KEY_NAME, ""); }

    public static void setName(Context ctx, String name) {
        sp(ctx).edit().putString(KEY_NAME, name == null ? "" : name).apply();
    }

    public static void clear(Context ctx) { sp(ctx).edit().clear().apply(); }
}
