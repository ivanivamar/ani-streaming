package com.anistream;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.view.Window;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native side of the Android app (PLAN.md Step 8). JS: src/app/shared/infrastructure/native.ts
 * (AniNative). Ported from the music app's PelagicNativePlugin.
 *
 * Google sign-in: a WebView can't run Google's web OAuth flow, so the app asks Play services for a
 * drive.readonly access token (AuthorizationClient). Play services remembers the grant and mints a
 * new token silently whenever asked — no refresh token is stored by the app. The OAuth client is
 * matched by package name + signing-key SHA-1 (the "ani.stream Android" client in Google Cloud),
 * so no client id appears here.
 *
 *   authorize({ interactive })        → { accessToken, expiresInSec, scope }
 *   clearToken({ token })             forget a cached token (401 / sign-out)
 *   setAuth({ email, token, expiresAt }) / clearAuth()   the web session's token for DriveAuth
 *   appInfo()                         → { versionName, versionCode }
 *   openUrl({ url })                  open outside the app (an update's APK)
 *   setImmersive({ on })              hide / show the status and navigation bars (player)
 */
@CapacitorPlugin(name = "AniNative")
public class AniNativePlugin extends Plugin {

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<IntentSenderRequest> consentLauncher;
    private PluginCall consentCall;

    @Override
    public void load() {
        // Registered while the activity is being created (required by the Activity Result API).
        consentLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                PluginCall call = consentCall;
                consentCall = null;
                if (call == null) return;
                Intent data = result.getData();
                if (result.getResultCode() != Activity.RESULT_OK || data == null) {
                    call.reject("Sign-in was cancelled.", "cancelled");
                    return;
                }
                try {
                    AuthorizationResult auth = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data);
                    resolveToken(call, auth);
                } catch (ApiException e) {
                    call.reject("Google sign-in failed (" + e.getStatusCode() + ").", "failed", e);
                }
            }
        );
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(DriveAuth.DRIVE_SCOPE)))
            .build();
        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (!result.hasResolution()) {
                    resolveToken(call, result);
                    return;
                }
                PendingIntent pending = result.getPendingIntent();
                if (!interactive || pending == null) {
                    call.reject("Google needs you to sign in again.", "needs_consent");
                    return;
                }
                if (consentCall != null) consentCall.reject("Replaced by a newer sign-in.", "cancelled");
                consentCall = call;
                consentLauncher.launch(new IntentSenderRequest.Builder(pending.getIntentSender()).build());
            })
            .addOnFailureListener(e -> call.reject(describe(e), "failed", e));
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.resolve();
            return;
        }
        io.execute(() -> {
            try {
                GoogleAuthUtil.clearToken(getContext(), token);
            } catch (Exception ignored) {
                // nothing cached / Play services busy: the token will simply expire
            }
            DriveAuth.invalidate(getContext(), token);
            call.resolve();
        });
    }

    @PluginMethod
    public void setAuth(PluginCall call) {
        DriveAuth.setFromJs(getContext(), call.getString("email"), call.getString("token"), Args.longOf(call, "expiresAt", 0));
        call.resolve();
    }

    @PluginMethod
    public void clearAuth(PluginCall call) {
        DriveAuth.clear(getContext());
        call.resolve();
    }

    @PluginMethod
    public void appInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            JSObject out = new JSObject();
            out.put("versionName", info.versionName);
            out.put("versionCode", code);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not read the app version.", e);
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("No URL.");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this link.", e);
        }
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
            if (on) {
                bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                bars.show(WindowInsetsCompat.Type.systemBars());
            }
            call.resolve();
        });
    }

    private void resolveToken(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty()) {
            call.reject("Google didn't return a Drive token.", "failed");
            return;
        }
        List<String> scopes = result.getGrantedScopes();
        if (!scopes.contains(DriveAuth.DRIVE_SCOPE)) {
            call.reject("ani.stream needs read access to Google Drive to stream your episodes. Allow Drive when Google asks.", "no_drive");
            return;
        }
        // Play services may hand out a cached token with less than an hour left: ask Google how long
        io.execute(() -> {
            JSObject out = new JSObject();
            out.put("accessToken", token);
            out.put("expiresInSec", lifetimeSec(token));
            out.put("scope", String.join(" ", scopes));
            call.resolve(out);
        });
    }

    /** Seconds left on a token (Google's tokeninfo); 50 min when it can't be asked. */
    private static long lifetimeSec(String token) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL("https://oauth2.googleapis.com/tokeninfo?access_token="
                + URLEncoder.encode(token, "UTF-8")).openConnection();
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(8_000);
            if (conn.getResponseCode() != 200) return 3000;
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                int n;
                while ((n = in.read(chunk)) >= 0) buf.write(chunk, 0, n);
                JSONObject j = new JSONObject(buf.toString(StandardCharsets.UTF_8.name()));
                long left = Long.parseLong(j.optString("expires_in", "3000"));
                return left > 0 ? left : 3000;
            }
        } catch (Exception e) {
            return 3000;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String describe(Exception e) {
        if (e instanceof ApiException) {
            int code = ((ApiException) e).getStatusCode();
            // 10 = DEVELOPER_ERROR: the Android OAuth client (package + SHA-1) is missing or wrong
            if (code == 10) return "Google sign-in isn't set up for this build (Android OAuth client / SHA-1).";
            if (code == 7) return "No connection to Google. Check the network and try again.";
            return "Google sign-in failed (" + code + ").";
        }
        return e.getMessage() != null ? e.getMessage() : "Google sign-in failed.";
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdown();
    }
}
