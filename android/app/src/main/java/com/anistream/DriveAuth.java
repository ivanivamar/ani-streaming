package com.anistream;

import android.accounts.Account;
import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

import com.google.android.gms.auth.GoogleAuthUtil;

/**
 * Drive access tokens for the native side (player, downloads, the /__drive/ proxy). Ported from
 * the music app's DriveAuth.
 *
 * The web app pushes its current token (setFromJs, via AniNative.setAuth) whenever it gets a new
 * one. Downloads also run while the app is closed and its JavaScript is asleep, so when the pushed
 * token is missing or about to expire this asks Play services directly for the same Drive grant
 * (GoogleAuthUtil.getToken, silent once the user has consented in the app).
 *
 * getToken() blocks: call it from a loader / background thread only.
 */
final class DriveAuth {
    static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
    private static final String PREFS = "ani.auth";
    private static final long MARGIN_MS = 2 * 60_000;

    private static String token;
    private static long expiresAt;

    private DriveAuth() {}

    static synchronized void setFromJs(Context ctx, @Nullable String email, @Nullable String jsToken, long jsExpiresAt) {
        if (email != null && !email.isEmpty()) {
            ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("email", email).apply();
        }
        if (jsToken != null && !jsToken.isEmpty() && jsExpiresAt > System.currentTimeMillis() + MARGIN_MS) {
            token = jsToken;
            expiresAt = jsExpiresAt;
        }
    }

    static synchronized void clear(Context ctx) {
        token = null;
        expiresAt = 0;
        ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("email").apply();
    }

    @Nullable
    static String getToken(Context ctx) {
        synchronized (DriveAuth.class) {
            if (token != null && expiresAt > System.currentTimeMillis() + MARGIN_MS) return token;
        }
        SharedPreferences prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String email = prefs.getString("email", null);
        if (email == null) return null;
        try {
            String fresh = GoogleAuthUtil.getToken(ctx.getApplicationContext(), new Account(email, "com.google"), "oauth2:" + DRIVE_SCOPE);
            synchronized (DriveAuth.class) {
                token = fresh;
                // Play services doesn't say how long it's valid; renew well before the usual hour
                expiresAt = System.currentTimeMillis() + 40 * 60_000;
            }
            return fresh;
        } catch (Exception e) {
            return null;
        }
    }

    /** Drive answered 401: forget this token everywhere so the next request gets a new one. */
    static void invalidate(Context ctx, @Nullable String bad) {
        synchronized (DriveAuth.class) {
            if (bad == null || bad.equals(token)) {
                bad = token;
                token = null;
                expiresAt = 0;
            }
        }
        if (bad == null) return;
        try {
            GoogleAuthUtil.clearToken(ctx.getApplicationContext(), bad);
        } catch (Exception ignored) {
            // nothing cached
        }
    }
}
