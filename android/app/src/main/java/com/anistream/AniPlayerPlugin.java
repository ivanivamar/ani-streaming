package com.anistream;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;
import java.util.Collections;

/**
 * The Android player (PLAN.md Step 8). JS: src/app/shared/infrastructure/native.ts (AniPlayer) →
 * playback/infrastructure/native-player.ts → the watch page's NativeVideo element.
 *
 * Media3 ExoPlayer plays the episode's MP4 on a PlayerView (SurfaceView) placed *under* the
 * Capacitor WebView, which turns transparent while it plays. The web player keeps all its own
 * controls, CC (JASSUB on a canvas), skip buttons and progress tracking; this plugin only plays,
 * pauses, seeks and reports.
 *
 * Streaming: Drive `files/<id>?alt=media` with the session's OAuth header (DriveAuth), the file size
 * as a URI fragment for KnownLengthDataSource (seeks are range requests). A downloaded copy (Offline)
 * plays from the phone instead. Drive 401 → fresh token and one retry.
 *
 *   open({ fileId, sizeBytes, startMs, play })   play({}) pause({}) seek({ positionMs }) close({})
 *   getState() → { positionMs, durationMs, bufferedMs, playing, buffering, ended, videoWidth, videoHeight }
 *   decoderInfo({ codec, bitDepth, width, height }) → { supported, hardware, decoder }
 * Events: "state" (on every change and every 250 ms while playing), "error" { code, message }.
 * `playing` is the intent (playWhenReady): paused = !playing, like an HTML video.
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "AniPlayer")
public class AniPlayerPlugin extends Plugin {

    private static final long TICK_MS = 250;
    /** the page's background, put back on the WebView when the player closes */
    private static final int PAGE_BG = Color.parseColor("#0A0B0D");

    private final Handler main = new Handler(Looper.getMainLooper());
    @Nullable private ExoPlayer player;
    @Nullable private PlayerView view;
    private int authRetries = 0;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            ExoPlayer p = player;
            if (p == null) return;
            emitState();
            if (p.getPlayWhenReady() && p.getPlaybackState() != Player.STATE_ENDED) main.postDelayed(this, TICK_MS);
        }
    };

    /* ── methods ─────────────────────────────────── */

    @PluginMethod
    public void open(PluginCall call) {
        String fileId = call.getString("fileId");
        if (fileId == null || Offline.file(getContext(), fileId) == null) {
            call.reject("Bad Drive file id.");
            return;
        }
        long size = Args.longOf(call, "sizeBytes", 0);
        long startMs = Args.longOf(call, "startMs", 0);
        boolean play = Boolean.TRUE.equals(call.getBoolean("play", false));
        main.post(() -> {
            try {
                ExoPlayer p = ensurePlayer();
                ensureView(p);
                String uri = "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media" + (size > 0 ? "#size=" + size : "");
                MediaItem item = new MediaItem.Builder().setUri(Uri.parse(uri)).setMimeType(MimeTypes.VIDEO_MP4).build();
                authRetries = 0;
                p.setMediaItem(item, Math.max(0, startMs));
                p.setPlayWhenReady(play);
                p.prepare();
                emitState();
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Couldn't start the player.", e);
            }
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        main.post(() -> {
            ExoPlayer p = player;
            if (p != null) {
                if (p.getPlaybackState() == Player.STATE_ENDED) p.seekTo(0);
                if (p.getPlaybackState() == Player.STATE_IDLE) p.prepare();
                p.play();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        main.post(() -> {
            if (player != null) player.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        long ms = Math.max(0, Args.longOf(call, "positionMs", 0));
        main.post(() -> {
            if (player != null) player.seekTo(ms);
            emitState();
            call.resolve();
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        main.post(() -> {
            release();
            call.resolve();
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        main.post(() -> call.resolve(snapshot()));
    }

    /** Is there a decoder for this codec + bit depth (+ size), and is it hardware? */
    @PluginMethod
    public void decoderInfo(PluginCall call) {
        boolean hevc = "hevc".equals(call.getString("codec", "hevc"));
        boolean tenBit = Args.longOf(call, "bitDepth", 8) >= 10;
        int width = (int) Args.longOf(call, "width", 1920);
        int height = (int) Args.longOf(call, "height", 1080);
        String mime = hevc ? MimeTypes.VIDEO_H265 : MimeTypes.VIDEO_H264;
        int profile = hevc
            ? (tenBit ? MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10 : MediaCodecInfo.CodecProfileLevel.HEVCProfileMain)
            : (tenBit ? MediaCodecInfo.CodecProfileLevel.AVCProfileHigh10 : MediaCodecInfo.CodecProfileLevel.AVCProfileHigh);

        String software = null;
        String hardware = null;
        for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.ALL_CODECS).getCodecInfos()) {
            if (info.isEncoder()) continue;
            boolean handles = false;
            for (String t : info.getSupportedTypes()) if (t.equalsIgnoreCase(mime)) handles = true;
            if (!handles) continue;
            try {
                MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(mime);
                boolean profileOk = !tenBit;
                for (MediaCodecInfo.CodecProfileLevel pl : caps.profileLevels) if (pl.profile == profile) profileOk = true;
                MediaCodecInfo.VideoCapabilities video = caps.getVideoCapabilities();
                boolean sizeOk = video == null || video.isSizeSupported(width, height);
                if (!profileOk || !sizeOk) continue;
            } catch (Exception e) {
                continue;
            }
            if (isHardware(info)) {
                if (hardware == null) hardware = info.getName();
            } else if (software == null) {
                software = info.getName();
            }
        }
        JSObject out = new JSObject();
        out.put("supported", hardware != null || software != null);
        out.put("hardware", hardware != null);
        out.put("decoder", hardware != null ? hardware : software);
        call.resolve(out);
    }

    /* ── player ──────────────────────────────────── */

    private ExoPlayer ensurePlayer() {
        if (player != null) return player;
        Context ctx = getContext();
        DataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent("ani.stream")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000);
        // DefaultDataSource: http(s) through `http`, plus file:// for downloaded copies
        DataSource.Factory any = new DefaultDataSource.Factory(ctx, http);
        DataSource.Factory drive = new ResolvingDataSource.Factory(any, new ResolvingDataSource.Resolver() {
            @NonNull
            @Override
            public DataSpec resolveDataSpec(@NonNull DataSpec spec) throws IOException {
                String host = spec.uri.getHost();
                if (host == null || !host.endsWith("googleapis.com")) return spec;
                // a downloaded copy of this Drive file plays from the phone
                File local = Offline.localFile(ctx, spec.uri);
                if (local != null) return spec.withUri(Uri.fromFile(local));
                String token = DriveAuth.getToken(ctx);
                if (token == null) throw new IOException("Not signed in to Google Drive");
                return spec.withAdditionalHeaders(Collections.singletonMap("Authorization", "Bearer " + token));
            }
        });

        ExoPlayer p = new ExoPlayer.Builder(ctx)
            // Drive may send no Content-Length; without the file size the episode wouldn't be seekable
            .setMediaSourceFactory(new DefaultMediaSourceFactory(new KnownLengthDataSource.Factory(drive)))
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(), /* handleAudioFocus= */ true)
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build();
        p.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) authRetries = 0;
                changed();
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                changed();
            }

            @Override
            public void onVideoSizeChanged(@NonNull VideoSize videoSize) {
                emitState();
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                handleError(error);
            }
        });
        player = p;
        return p;
    }

    /** The PlayerView goes under the WebView (index 0 of its parent), the WebView turns see-through. */
    private void ensureView(ExoPlayer p) {
        Activity activity = getActivity();
        WebView web = getBridge().getWebView();
        if (view == null && activity != null && web != null && web.getParent() instanceof ViewGroup) {
            PlayerView v = new PlayerView(activity);
            v.setUseController(false);
            v.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
            v.setShutterBackgroundColor(Color.BLACK);
            v.setBackgroundColor(Color.BLACK);
            v.setKeepContentOnPlayerReset(false);
            ((ViewGroup) web.getParent()).addView(v, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            view = v;
        }
        if (web != null) web.setBackgroundColor(Color.TRANSPARENT);
        if (view != null) view.setPlayer(p);
    }

    private void release() {
        main.removeCallbacks(ticker);
        if (player != null) {
            player.release();
            player = null;
        }
        if (view != null) {
            view.setPlayer(null);
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
            view = null;
        }
        WebView web = getBridge().getWebView();
        if (web != null) web.setBackgroundColor(PAGE_BG);
    }

    private void changed() {
        ExoPlayer p = player;
        if (view != null && p != null) view.setKeepScreenOn(p.getPlayWhenReady() && p.getPlaybackState() != Player.STATE_ENDED);
        emitState();
        main.removeCallbacks(ticker);
        if (p != null && p.getPlayWhenReady()) main.postDelayed(ticker, TICK_MS);
    }

    private void handleError(PlaybackException error) {
        ExoPlayer p = player;
        Throwable cause = error.getCause();
        int status = cause instanceof HttpDataSource.InvalidResponseCodeException
            ? ((HttpDataSource.InvalidResponseCodeException) cause).responseCode : 0;
        if (status == 401 && authRetries < 1 && p != null) {
            // the token Drive refused: drop it, the resolver asks Play services for a fresh one
            authRetries++;
            DriveAuth.invalidate(getContext(), null);
            long at = p.getCurrentPosition();
            p.seekTo(at);
            p.prepare();
            return;
        }
        String code;
        String message;
        if (status == 401) {
            code = "auth";
            message = "Google Drive refused the sign-in. Sign in again.";
        } else if (status == 403 || status == 404 || status == 410) {
            code = "source";
            message = "Drive couldn't find this episode's file (" + status + ").";
        } else if (error.errorCode >= PlaybackException.ERROR_CODE_DECODER_INIT_FAILED
            && error.errorCode < PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED) {
            code = "decoder";
            message = "This phone couldn't decode the video (" + error.getErrorCodeName() + ").";
        } else if (error.errorCode >= PlaybackException.ERROR_CODE_IO_UNSPECIFIED
            && error.errorCode < PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED) {
            code = "network";
            message = "The connection dropped while streaming from Drive.";
        } else {
            code = "other";
            message = error.getMessage() != null ? error.getMessage() : "Playback failed.";
        }
        JSObject e = new JSObject();
        e.put("code", code);
        e.put("message", message);
        notifyListeners("error", e);
        emitState();
    }

    private JSObject snapshot() {
        JSObject s = new JSObject();
        ExoPlayer p = player;
        long duration = p != null ? p.getDuration() : C.TIME_UNSET;
        VideoSize size = p != null ? p.getVideoSize() : VideoSize.UNKNOWN;
        int state = p != null ? p.getPlaybackState() : Player.STATE_IDLE;
        s.put("positionMs", p != null ? Math.max(0, p.getCurrentPosition()) : 0);
        s.put("durationMs", duration == C.TIME_UNSET ? 0 : duration);
        s.put("bufferedMs", p != null ? Math.max(0, p.getBufferedPosition()) : 0);
        s.put("playing", p != null && p.getPlayWhenReady());
        s.put("buffering", state == Player.STATE_BUFFERING || (p != null && state == Player.STATE_IDLE && p.getMediaItemCount() > 0 && p.getPlayerError() == null));
        s.put("ended", state == Player.STATE_ENDED);
        s.put("videoWidth", size.width);
        s.put("videoHeight", size.height);
        return s;
    }

    private void emitState() {
        notifyListeners("state", snapshot());
    }

    private static boolean isHardware(MediaCodecInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return info.isHardwareAccelerated();
        String n = info.getName().toLowerCase();
        return !(n.startsWith("omx.google.") || n.startsWith("c2.android.") || n.contains(".sw."));
    }

    /* ── lifecycle ───────────────────────────────── */

    /** App to the background (Home, screen off, another app): pause, the web page saves progress. */
    @Override
    protected void handleOnPause() {
        main.post(() -> {
            if (player != null && player.getPlayWhenReady()) player.pause();
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.post(this::release);
    }
}
