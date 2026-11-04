package com.anistream;

import com.getcapacitor.PluginCall;

/** Numbers from JS: JSON gives Integer, Long or Double depending on the value; take any of them. */
final class Args {
    private Args() {}

    static long longOf(PluginCall call, String key, long fallback) {
        Object v = call.getData().opt(key);
        return v instanceof Number ? ((Number) v).longValue() : fallback;
    }
}
