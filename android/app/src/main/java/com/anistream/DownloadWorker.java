package com.anistream;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.app.PendingIntent;
import android.content.pm.ServiceInfo;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

/**
 * Offline downloads (ported from the music app): fetches the wanted Drive files that aren't on the phone yet, one at a
 * time, in the order the app listed them (an episode's subtitles, thumbnail and fonts, then its video).
 *
 * Runs as a long-running WorkManager job with its own foreground notification, so a big batch keeps
 * going with the app closed and the screen off. WorkManager holds it back until the network matches
 * the Wi-Fi-only setting and storage isn't low, and retries with backoff after network errors.
 * Interrupted files resume from their `.part` with a Range request.
 *
 * Auth: the same Drive token as playback (DriveAuth; silent renewal through Play services while the
 * app is asleep). 401 → fresh token once; 403/404 → the file is skipped (listed as failed).
 */
public class DownloadWorker extends Worker {
    private static final String CHANNEL = "downloads";
    private static final int NOTIFICATION_ID = 7201;
    private static final int BUFFER = 256 * 1024;
    private static final long PROGRESS_EVERY_MS = 400;

    public DownloadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        Offline.running = true;
        Offline.error = null;
        Offline.changed();
        try {
            int authRetries = 0;
            while (!isStopped()) {
                if (Offline.paused(ctx)) return Result.success();
                List<Offline.Item> missing = Offline.missing(ctx);
                if (missing.isEmpty()) return Result.success();
                Offline.Item item = missing.get(0);
                foreground(item, missing.size());

                String token = DriveAuth.getToken(ctx);
                if (token == null) {
                    Offline.error = "auth";
                    return Result.retry();
                }
                int code;
                try {
                    code = fetch(item, token);
                } catch (IOException e) {
                    if (isStopped()) return Result.retry();
                    if (isNoSpace(e)) {
                        Offline.error = "storage";
                        return Result.failure();
                    }
                    return Result.retry(); // network: WorkManager backs off and runs again
                }
                if (code == 401) {
                    DriveAuth.invalidate(ctx, token);
                    if (++authRetries > 1) {
                        Offline.error = "auth";
                        return Result.retry();
                    }
                    continue;
                }
                authRetries = 0;
                if (code == 403 || code == 404 || code == 410) {
                    Offline.failed.put(item.id, code == 404 || code == 410 ? "missing" : "forbidden");
                } else if (code != 200 && code != 206 && code != 0) {
                    return Result.retry(); // 429 / 5xx
                }
                Offline.changed();
            }
            return Result.retry();
        } finally {
            Offline.running = false;
            Offline.currentId = null;
            Offline.currentTitle = null;
            Offline.currentBytes = 0;
            Offline.currentTotal = 0;
            Offline.changed();
        }
    }

    /**
     * Download one file to <id>.part (resuming), then rename it. → 0 when stored, else the HTTP code
     * that stopped it (or 200/206 when the worker was stopped half-way).
     */
    private int fetch(Offline.Item item, String token) throws IOException {
        Context ctx = getApplicationContext();
        File dest = Offline.file(ctx, item.id);
        if (dest == null) return 404;
        File part = Offline.part(ctx, item.id);
        long have = part.isFile() ? part.length() : 0;
        if (item.size > 0 && have > item.size) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            have = 0;
        }

        Offline.currentId = item.id;
        Offline.currentTitle = item.title;
        Offline.currentBytes = have;
        Offline.currentTotal = item.size;
        Offline.progress();

        if (item.size > 0 && have == item.size) return finish(part, dest, item);

        HttpURLConnection conn = (HttpURLConnection) new URL("https://www.googleapis.com/drive/v3/files/" + item.id + "?alt=media").openConnection();
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(30_000);
        conn.setRequestProperty("Authorization", "Bearer " + token);
        conn.setRequestProperty("User-Agent", "ani.stream");
        if (have > 0) conn.setRequestProperty("Range", "bytes=" + have + "-");
        try {
            int code = conn.getResponseCode();
            if (code == 416 && item.size > 0 && have >= item.size) return finish(part, dest, item);
            if (code != 200 && code != 206) return code;
            boolean append = code == 206 && have > 0;
            if (!append) have = 0;
            long total = item.size > 0 ? item.size : Math.max(0, conn.getContentLengthLong()) + have;
            Offline.currentBytes = have;
            Offline.currentTotal = total;

            long lastEmit = 0;
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part, append)) {
                byte[] buf = new byte[BUFFER];
                int n;
                while ((n = in.read(buf)) >= 0) {
                    if (isStopped()) return code;
                    out.write(buf, 0, n);
                    have += n;
                    Offline.currentBytes = have;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= PROGRESS_EVERY_MS) {
                        lastEmit = now;
                        Offline.progress();
                    }
                }
                out.getFD().sync();
            }
            if (item.size > 0 && have != item.size) {
                // truncated or a different file than the catalogue says: start this one over next time
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                throw new IOException("Size mismatch for " + item.id + ": " + have + " of " + item.size);
            }
            return finish(part, dest, item);
        } finally {
            conn.disconnect();
        }
    }

    private int finish(File part, File dest, Offline.Item item) throws IOException {
        if (!part.renameTo(dest)) throw new IOException("Couldn't store " + item.id);
        Offline.currentBytes = Offline.currentTotal = dest.length();
        Offline.progress();
        return 0;
    }

    private static boolean isNoSpace(IOException e) {
        String m = e.getMessage();
        return m != null && (m.contains("ENOSPC") || m.contains("No space left"));
    }

    /* ── Foreground notification ─────────────────── */

    private void foreground(Offline.Item item, int left) {
        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Episodes being saved for offline viewing");
            nm.createNotificationChannel(ch);
        }
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent tap = open == null ? null : PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(left == 1 ? "Downloading 1 file" : "Downloading " + left + " files")
            .setContentText(item.title == null || item.title.isEmpty() ? "Saving episodes for offline" : item.title)
            .setContentIntent(tap)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(0, 0, true)
            .build();
        ForegroundInfo info = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? new ForegroundInfo(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            : new ForegroundInfo(NOTIFICATION_ID, n);
        try {
            setForegroundAsync(info);
        } catch (Exception ignored) {
            // Android 12+ may refuse to start a foreground service from the background; the job still runs
            // (just without the notification, and Android may stop it sooner — it is retried then).
        }
    }
}
