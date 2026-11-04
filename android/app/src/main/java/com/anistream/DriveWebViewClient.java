package com.anistream;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves `https://localhost/__drive/<fileId>?type=<mime>` inside the APK — the URL scheme the web
 * build's service worker uses — for the small Drive files the page loads itself: episode
 * thumbnails, subtitle files and fonts (JASSUB). The downloaded copy when there is one (so
 * downloaded episodes keep their subtitles offline), otherwise Drive with the native token
 * (DriveAuth; a 401 gets one fresh token). Everything else goes to Capacitor's own handler.
 *
 * shouldInterceptRequest runs on a WebView background thread, so blocking I/O is fine here.
 * Video never comes through here: ExoPlayer streams it (AniPlayerPlugin).
 */
public class DriveWebViewClient extends BridgeWebViewClient {

    private final Context ctx;

    public DriveWebViewClient(Bridge bridge) {
        super(bridge);
        this.ctx = bridge.getContext().getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if ("GET".equalsIgnoreCase(request.getMethod()) && "localhost".equals(url.getHost()) && path != null && path.startsWith("/__drive/")) {
            return drive(url);
        }
        return super.shouldInterceptRequest(view, request);
    }

    @NonNull
    private WebResourceResponse drive(Uri url) {
        String id = url.getLastPathSegment();
        String type = url.getQueryParameter("type");
        if (type == null || type.isEmpty()) type = "application/octet-stream";
        File stored = id == null ? null : Offline.file(ctx, id);
        if (stored == null) return status(400, "Bad Request");
        try {
            if (stored.isFile()) return ok(type, new FileInputStream(stored), stored.length());
            for (int attempt = 0; attempt < 2; attempt++) {
                String token = DriveAuth.getToken(ctx);
                if (token == null) return status(401, "Unauthorized");
                HttpURLConnection conn = (HttpURLConnection) new URL("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media").openConnection();
                conn.setConnectTimeout(15_000);
                conn.setReadTimeout(30_000);
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("User-Agent", "ani.stream");
                int code = conn.getResponseCode();
                if (code == 401 && attempt == 0) {
                    conn.disconnect();
                    DriveAuth.invalidate(ctx, token);
                    continue;
                }
                if (code != 200) {
                    conn.disconnect();
                    return status(code, code == 404 ? "Not Found" : "Drive error");
                }
                return ok(type, new Closing(conn.getInputStream(), conn), conn.getContentLengthLong());
            }
            return status(401, "Unauthorized");
        } catch (IOException e) {
            return status(502, "Bad Gateway");
        }
    }

    private static WebResourceResponse ok(String type, InputStream body, long length) {
        Map<String, String> headers = new HashMap<>();
        // thumbnails / fonts don't change for a file id: let the WebView cache them
        headers.put("Cache-Control", "private, max-age=86400");
        if (length > 0) headers.put("Content-Length", String.valueOf(length));
        return new WebResourceResponse(type, null, 200, "OK", headers, body);
    }

    private static WebResourceResponse status(int code, String reason) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", code, reason, headers, new ByteArrayInputStream(new byte[0]));
    }

    /** Disconnects the Drive connection when the WebView is done reading. */
    private static final class Closing extends FilterInputStream {
        @Nullable private HttpURLConnection conn;

        Closing(InputStream in, HttpURLConnection conn) {
            super(in);
            this.conn = conn;
        }

        @Override
        public void close() throws IOException {
            try {
                super.close();
            } finally {
                if (conn != null) conn.disconnect();
                conn = null;
            }
        }
    }
}
