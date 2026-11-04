package com.anistream;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Offline downloads bridge (ported from the music app). JS: src/app/shared/infrastructure/native.ts
 * (AniDownloads) → playback/infrastructure/offline-store.ts.
 *
 *   sync({ items: [{ id, size, title }], wifiOnly })  the complete list of Drive files to keep offline;
 *                                                     unlisted files are deleted, missing ones queued
 *   state()                                           what's stored, the current download, network, storage
 *   setPaused({ paused })                             hold / resume the queue
 *   retryFailed()                                     try the files Drive refused again
 *   askNotifications()                                Android 13+: ask once to show the progress notification
 *
 * Events: "progress" { id, title, bytes, total } a few times a second while a file downloads,
 * "changed" {} when the stored set, the worker or the network changed (the app then calls state()).
 * Disk work runs on one background thread so calls never block the WebView.
 */
@CapacitorPlugin(name = "AniDownloads")
public class AniDownloadsPlugin extends Plugin {

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private ConnectivityManager.NetworkCallback netCallback;
    private boolean changePosted = false;

    @Override
    public void load() {
        Offline.listener = new Offline.Listener() {
            @Override
            public void onProgress(String id, String title, long bytes, long total) {
                JSObject o = new JSObject();
                o.put("id", id);
                o.put("title", title);
                o.put("bytes", bytes);
                o.put("total", total);
                notifyListeners("progress", o);
            }

            @Override
            public void onChanged() {
                postChanged();
            }
        };
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            netCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(@NonNull Network network) {
                    postChanged();
                }

                @Override
                public void onLost(@NonNull Network network) {
                    postChanged();
                }

                @Override
                public void onCapabilitiesChanged(@NonNull Network network, @NonNull NetworkCapabilities caps) {
                    postChanged();
                }
            };
            try {
                cm.registerDefaultNetworkCallback(netCallback);
            } catch (Exception e) {
                netCallback = null;
            }
        }
        // a launch after an update / reboot: pick up anything left over
        io.execute(() -> Offline.schedule(getContext(), false));
    }

    /** Coalesce bursts (network callbacks fire several times per switch). */
    private void postChanged() {
        main.post(() -> {
            if (changePosted) return;
            changePosted = true;
            main.postDelayed(() -> {
                changePosted = false;
                notifyListeners("changed", new JSObject());
            }, 250);
        });
    }

    @PluginMethod
    public void sync(PluginCall call) {
        JSArray arr = call.getArray("items", new JSArray());
        Boolean wifiOnly = call.getBoolean("wifiOnly", null);
        List<Offline.Item> items = new ArrayList<>();
        try {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                String id = o.optString("id", "");
                if (Offline.file(getContext(), id) == null) continue;
                items.add(new Offline.Item(id, o.optLong("size", 0), o.optString("title", "")));
            }
        } catch (Exception e) {
            call.reject("Bad download list", e);
            return;
        }
        io.execute(() -> {
            try {
                Context ctx = getContext();
                boolean wifiChanged = wifiOnly != null && Offline.setWifiOnly(ctx, wifiOnly);
                Offline.setWanted(ctx, items);
                Offline.prune(ctx, items);
                Offline.schedule(ctx, wifiChanged);
                call.resolve(snapshot());
                postChanged();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Couldn't update downloads", e);
            }
        });
    }

    @PluginMethod
    public void state(PluginCall call) {
        io.execute(() -> call.resolve(snapshot()));
    }

    @PluginMethod
    public void setPaused(PluginCall call) {
        boolean paused = Boolean.TRUE.equals(call.getBoolean("paused", false));
        io.execute(() -> {
            Context ctx = getContext();
            Offline.setPaused(ctx, paused);
            if (paused) Offline.cancel(ctx);
            else Offline.schedule(ctx, false);
            call.resolve(snapshot());
            postChanged();
        });
    }

    @PluginMethod
    public void retryFailed(PluginCall call) {
        io.execute(() -> {
            Offline.failed.clear();
            Offline.error = null;
            Offline.schedule(getContext(), false);
            call.resolve(snapshot());
            postChanged();
        });
    }

    /** Without it the downloads still run, just without their notification. Asked on the first download. */
    @PluginMethod
    public void askNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getActivity() != null
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7202);
        }
        call.resolve();
    }

    private JSObject snapshot() {
        Context ctx = getContext();
        JSObject out = new JSObject();
        JSArray stored = new JSArray();
        long used = 0;
        for (Map.Entry<String, Long> e : Offline.stored(ctx).entrySet()) {
            JSObject f = new JSObject();
            f.put("id", e.getKey());
            f.put("size", e.getValue());
            stored.put(f);
            used += e.getValue();
        }
        out.put("stored", stored);
        out.put("pending", Offline.missing(ctx).size());

        JSArray failed = new JSArray();
        synchronized (Offline.failed) {
            for (Map.Entry<String, String> e : Offline.failed.entrySet()) {
                JSObject f = new JSObject();
                f.put("id", e.getKey());
                f.put("reason", e.getValue());
                failed.put(f);
            }
        }
        out.put("failed", failed);

        String cur = Offline.currentId;
        if (cur != null && Offline.running) {
            JSObject c = new JSObject();
            c.put("id", cur);
            c.put("title", Offline.currentTitle);
            c.put("bytes", Offline.currentBytes);
            c.put("total", Offline.currentTotal);
            out.put("current", c);
        } else {
            out.put("current", JSONObject.NULL);
        }
        out.put("running", Offline.running);
        out.put("paused", Offline.paused(ctx));
        out.put("wifiOnly", Offline.wifiOnly(ctx));
        out.put("network", Offline.network(ctx));
        out.put("error", Offline.error != null ? Offline.error : JSONObject.NULL);
        long[] fs = Offline.storage(ctx);
        out.put("used", used);
        out.put("free", fs[0]);
        out.put("total", fs[1]);
        return out;
    }

    @Override
    protected void handleOnDestroy() {
        Offline.listener = null;
        if (netCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            try {
                if (cm != null) cm.unregisterNetworkCallback(netCallback);
            } catch (Exception ignored) {
                // already gone
            }
            netCallback = null;
        }
        io.shutdown();
    }
}
