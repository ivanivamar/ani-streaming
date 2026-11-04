package com.anistream;

import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Makes Drive streams seekable.
 *
 * Ported from the music app (D:\material-music). Google Drive may serve `alt=media` downloads
 * without a Content-Length, so ExoPlayer sees a stream of unknown length; the MP4 extractor then
 * can't jump to the `moov`/sample offsets it needs for a seek and the episode becomes unseekable.
 *
 * The app knows each episode's size from the catalogue (`sizeBytes`) and appends it to the URI as a
 * fragment (`…?alt=media#size=123456`; fragments are never sent to the server). When the server doesn't say
 * how long the response is, this reports the remaining length from that size instead. Range requests
 * for the seeks themselves work as usual (Drive supports them).
 */
@UnstableApi
final class KnownLengthDataSource implements DataSource {

    static final class Factory implements DataSource.Factory {
        private final DataSource.Factory upstream;

        Factory(DataSource.Factory upstream) {
            this.upstream = upstream;
        }

        @NonNull
        @Override
        public DataSource createDataSource() {
            return new KnownLengthDataSource(upstream.createDataSource());
        }
    }

    private final DataSource upstream;

    private KnownLengthDataSource(DataSource upstream) {
        this.upstream = upstream;
    }

    @Override
    public void addTransferListener(@NonNull TransferListener transferListener) {
        upstream.addTransferListener(transferListener);
    }

    @Override
    public long open(@NonNull DataSpec dataSpec) throws IOException {
        long length = upstream.open(dataSpec);
        if (length != C.LENGTH_UNSET || dataSpec.length != C.LENGTH_UNSET) return length;
        long size = sizeFrom(dataSpec.uri);
        return size > dataSpec.position ? size - dataSpec.position : length;
    }

    @Override
    public int read(@NonNull byte[] buffer, int offset, int length) throws IOException {
        return upstream.read(buffer, offset, length);
    }

    @Nullable
    @Override
    public Uri getUri() {
        return upstream.getUri();
    }

    @NonNull
    @Override
    public Map<String, List<String>> getResponseHeaders() {
        return upstream.getResponseHeaders();
    }

    @Override
    public void close() throws IOException {
        upstream.close();
    }

    /** `size=<bytes>` from the URI fragment, or -1. */
    private static long sizeFrom(Uri uri) {
        String fragment = uri.getFragment();
        if (fragment == null) return -1;
        for (String part : fragment.split("&")) {
            if (part.startsWith("size=")) {
                try {
                    return Long.parseLong(part.substring(5));
                } catch (NumberFormatException e) {
                    return -1;
                }
            }
        }
        return -1;
    }
}
