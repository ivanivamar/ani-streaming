package com.anistream;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.StatFs;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Offline downloads (ported from the music app): the files stored on the phone and the list of files the app wants.
 *
 * Files are Drive files saved under their Drive file id in the app's private storage
 * (files/offline/<fileId>; `<fileId>.part` while downloading). The web app decides WHAT should be
 * offline (the episodes picked on the Downloads page: video, subtitles, thumbnail, fonts) and sends the full list of Drive files with
 * sync(); everything else on disk is deleted, and DownloadWorker fetches what's missing.
 *
 * Playback needs nothing from the web app: AniPlayerPlugin and DriveWebViewClient ask for every Drive
 * file and use the stored copy when there is one.
 */
final class Offline {
    static final String WORK = "ani-downloads";
    private static final String PREFS = "ani.downloads";
    private static final String WANTED = "offline-wanted.json";
    private static final Pattern DRIVE_FILE = Pattern.compile("^/drive/v3/files/([A-Za-z0-9_-]+)$");
    private static final Pattern SAFE_ID = Pattern.compile("^[A-Za-z0-9_-]{1,200}$");

    private Offline() {}

    /* ── Wanted list ─────────────────────────────── */

    static final class Item {
        final String id;
        final long size;
        final String title;

        Item(String id, long size, String title) {
            this.id = id;
            this.size = size;
            this.title = title;
        }
    }

    private static List<Item> wanted;

    static synchronized List<Item> wanted(Context ctx) {
        if (wanted != null) return wanted;
        List<Item> out = new ArrayList<>();
        File f = new File(ctx.getApplicationContext().getFilesDir(), WANTED);
        if (f.exists()) {
            try (FileInputStream in = new FileInputStream(f)) {
                byte[] buf = new byte[(int) f.length()];
                int n = 0;
                while (n < buf.length) {
                    int r = in.read(buf, n, buf.length - n);
                    if (r < 0) break;
                    n += r;
                }
                JSONArray arr = new JSONArray(new String(buf, 0, n, StandardCharsets.UTF_8));
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    String id = o.optString("id", "");
                    if (SAFE_ID.matcher(id).matches()) out.add(new Item(id, o.optLong("size", 0), o.optString("title", "")));
                }
            } catch (Exception ignored) {
                // unreadable: start empty (the app sends the list again on launch)
            }
        }
        wanted = Collections.unmodifiableList(out);
        return wanted;
    }

    static synchronized void setWanted(Context ctx, List<Item> items) throws Exception {
        JSONArray arr = new JSONArray();
        for (Item it : items) {
            JSONObject o = new JSONObject();
            o.put("id", it.id);
            o.put("size", it.size);
            o.put("title", it.title);
            arr.put(o);
        }
        File dir = ctx.getApplicationContext().getFilesDir();
        File tmp = new File(dir, WANTED + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(arr.toString().getBytes(StandardCharsets.UTF_8));
        }
        File dest = new File(dir, WANTED);
        if (!tmp.renameTo(dest)) throw new Exception("Couldn't save the download list");
        wanted = Collections.unmodifiableList(new ArrayList<>(items));
    }

    /* ── Files ───────────────────────────────────── */

    static File dir(Context ctx) {
        File d = new File(ctx.getApplicationContext().getFilesDir(), "offline");
        if (!d.exists()) //noinspection ResultOfMethodCallIgnored
            d.mkdirs();
        return d;
    }

    @Nullable
    static File file(Context ctx, String fileId) {
        if (fileId == null || !SAFE_ID.matcher(fileId).matches()) return null;
        return new File(dir(ctx), fileId);
    }

    static File part(Context ctx, String fileId) {
        return new File(dir(ctx), fileId + ".part");
    }

    /** The stored copy of a Drive `files/<id>?alt=media` URL, or null. */
    @Nullable
    static File localFile(Context ctx, @Nullable Uri uri) {
        if (uri == null) return null;
        String host = uri.getHost();
        String path = uri.getPath();
        if (host == null || path == null || !host.endsWith("googleapis.com")) return null;
        Matcher m = DRIVE_FILE.matcher(path);
        if (!m.matches()) return null;
        File f = file(ctx, m.group(1));
        return f != null && f.isFile() ? f : null;
    }

    /** Stored files (complete ones only) → size. */
    static Map<String, Long> stored(Context ctx) {
        Map<String, Long> out = new LinkedHashMap<>();
        File[] files = dir(ctx).listFiles();
        if (files == null) return out;
        for (File f : files) {
            String name = f.getName();
            if (f.isFile() && SAFE_ID.matcher(name).matches()) out.put(name, f.length());
        }
        return out;
    }

    /** Delete every stored or partial file that isn't wanted any more. */
    static int prune(Context ctx, List<Item> keep) {
        Map<String, Boolean> ids = new HashMap<>();
        for (Item it : keep) ids.put(it.id, true);
        int removed = 0;
        File[] files = dir(ctx).listFiles();
        if (files == null) return 0;
        for (File f : files) {
            String name = f.getName();
            String id = name.endsWith(".part") ? name.substring(0, name.length() - 5) : name;
            if (!ids.containsKey(id) && f.delete()) removed++;
        }
        return removed;
    }

    /** Wanted items not on disk yet (and not given up on this run). */
    static List<Item> missing(Context ctx) {
        Map<String, Long> have = stored(ctx);
        List<Item> out = new ArrayList<>();
        for (Item it : wanted(ctx)) {
            if (!have.containsKey(it.id) && !failed.containsKey(it.id)) out.add(it);
        }
        return out;
    }

    /* ── Settings ────────────────────────────────── */

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean wifiOnly(Context ctx) {
        return prefs(ctx).getBoolean("wifiOnly", true);
    }

    /** → true if it changed */
    static boolean setWifiOnly(Context ctx, boolean v) {
        if (wifiOnly(ctx) == v) return false;
        prefs(ctx).edit().putBoolean("wifiOnly", v).apply();
        return true;
    }

    static boolean paused(Context ctx) {
        return prefs(ctx).getBoolean("paused", false);
    }

    static void setPaused(Context ctx, boolean v) {
        prefs(ctx).edit().putBoolean("paused", v).apply();
    }

    /* ── Scheduling ──────────────────────────────── */

    /**
     * Start (or keep) the download worker if anything is missing. `restart` replaces a running worker,
     * e.g. after the Wi-Fi-only setting changed (its network constraint is fixed at enqueue time);
     * the interrupted file resumes from its .part.
     */
    static void schedule(Context ctx, boolean restart) {
        WorkManager wm = WorkManager.getInstance(ctx.getApplicationContext());
        if (paused(ctx) || missing(ctx).isEmpty()) {
            if (restart) wm.cancelUniqueWork(WORK);
            return;
        }
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(DownloadWorker.class)
            .setConstraints(new Constraints.Builder()
                .setRequiredNetworkType(wifiOnly(ctx) ? NetworkType.UNMETERED : NetworkType.CONNECTED)
                .setRequiresStorageNotLow(true)
                .build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build();
        // APPEND_OR_REPLACE: a running worker finishes its loop (it re-reads the list after every file),
        // the appended one then finds nothing left and ends — no gap where new items are missed.
        wm.enqueueUniqueWork(WORK, restart ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.APPEND_OR_REPLACE, req);
    }

    static void cancel(Context ctx) {
        WorkManager.getInstance(ctx.getApplicationContext()).cancelUniqueWork(WORK);
    }

    /* ── Live status (worker → plugin → web app) ── */

    interface Listener {
        /** bytes of the file being downloaded; called a few times a second */
        void onProgress(String id, String title, long bytes, long total);

        /** stored set, running state, errors or the network changed */
        void onChanged();
    }

    static volatile Listener listener;
    static volatile boolean running;
    @Nullable static volatile String currentId;
    @Nullable static volatile String currentTitle;
    static volatile long currentBytes;
    static volatile long currentTotal;
    /** worker-level problem: "storage", "auth" or null */
    @Nullable static volatile String error;
    /** files Drive refused (gone / forbidden) → reason; skipped until retryFailed() or the app restarts */
    static final Map<String, String> failed = Collections.synchronizedMap(new LinkedHashMap<>());

    static void changed() {
        Listener l = listener;
        if (l != null) l.onChanged();
    }

    static void progress() {
        Listener l = listener;
        String id = currentId;
        if (l != null && id != null) l.onProgress(id, currentTitle, currentBytes, currentTotal);
    }

    /* ── Device ──────────────────────────────────── */

    /** "wifi" (unmetered), "cellular" (metered) or "none". */
    @NonNull
    static String network(Context ctx) {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return "none";
        Network n = cm.getActiveNetwork();
        NetworkCapabilities caps = n != null ? cm.getNetworkCapabilities(n) : null;
        if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return "none";
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) ? "wifi" : "cellular";
    }

    static long[] storage(Context ctx) {
        StatFs fs = new StatFs(ctx.getApplicationContext().getFilesDir().getPath());
        return new long[] { fs.getAvailableBytes(), fs.getTotalBytes() };
    }
}
