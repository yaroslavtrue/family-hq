package com.moyafamily.app.widget;

import android.content.Context;
import android.content.Intent;
import android.graphics.Paint;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.moyafamily.app.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import javax.net.ssl.HttpsURLConnection;

/**
 * Fetches the agenda feed and turns each item into a widget row. onDataSetChanged()
 * runs on a background (binder) thread, so the synchronous network call is allowed.
 * The session token is read from Capacitor's "CapacitorStorage" SharedPreferences,
 * where the web app mirrors `fhq_session` (see frontend/auth.js _setSess).
 */
public class AgendaRemoteViewsFactory implements RemoteViewsService.RemoteViewsFactory {
    private static final String API = "https://api.moyafamily.com/api/agenda?days=14";
    private final Context ctx;
    private final List<JSONObject> items = new ArrayList<>();

    AgendaRemoteViewsFactory(Context ctx) {
        this.ctx = ctx;
    }

    @Override public void onCreate() {}
    @Override public void onDestroy() { items.clear(); }
    @Override public int getCount() { return items.size(); }
    @Override public long getItemId(int p) { return p; }
    @Override public boolean hasStableIds() { return true; }
    @Override public int getViewTypeCount() { return 1; }
    @Override public RemoteViews getLoadingView() { return null; }

    @Override
    public void onDataSetChanged() {
        items.clear();
        String token = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .getString("fhq_session", null);
        if (token == null || token.isEmpty()) return;
        HttpsURLConnection c = null;
        try {
            c = (HttpsURLConnection) new URL(API).openConnection();
            c.setRequestProperty("X-Session-Token", token);
            c.setRequestProperty("Accept", "application/json");
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            if (c.getResponseCode() == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();
                JSONArray arr = new JSONObject(sb.toString()).optJSONArray("items");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) items.add(arr.getJSONObject(i));
                }
            }
        } catch (Exception ignored) {
            // Network/parse failure → leave the list empty (the empty view shows).
        } finally {
            if (c != null) c.disconnect();
        }
    }

    @Override
    public RemoteViews getViewAt(int pos) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_agenda_row);
        if (pos < 0 || pos >= items.size()) return rv;
        JSONObject it = items.get(pos);
        String type = it.optString("type", "");
        int id = it.optInt("id", 0);
        boolean done = it.optBoolean("done", false);
        rv.setTextViewText(R.id.row_emoji, it.optString("emoji", "•"));
        rv.setTextViewText(R.id.row_title, it.optString("title", ""));
        rv.setTextViewText(R.id.row_sub, formatWhen(it.optString("date", ""), it.optString("time", "")));

        // Completed → strike-through + dimmed; otherwise normal. Set BOTH branches —
        // rows are recycled, so stale paint/colour must be cleared each time.
        if (done) {
            rv.setInt(R.id.row_title, "setPaintFlags", Paint.STRIKE_THRU_TEXT_FLAG | Paint.ANTI_ALIAS_FLAG);
            rv.setTextColor(R.id.row_title, 0xFF9A8C7C);
        } else {
            rv.setInt(R.id.row_title, "setPaintFlags", Paint.ANTI_ALIAS_FLAG);
            rv.setTextColor(R.id.row_title, 0xFF2A1D12);
        }

        // Whole row → open the in-app detail popup (showCalEv) for this item.
        Intent open = new Intent()
                .putExtra(AgendaWidgetProvider.EXTRA_ACTION, "open")
                .putExtra(AgendaWidgetProvider.EXTRA_TYPE, type)
                .putExtra(AgendaWidgetProvider.EXTRA_ID, id);
        rv.setOnClickFillInIntent(R.id.row_root, open);

        // Tasks → a checkbox that toggles done in the background (no app open).
        // Checked tasks show a ✓ in the square; unchecked show an empty box.
        if ("task".equals(type)) {
            rv.setViewVisibility(R.id.row_check, View.VISIBLE);
            rv.setTextViewText(R.id.row_check, done ? "✓" : "");
            Intent toggle = new Intent()
                    .putExtra(AgendaWidgetProvider.EXTRA_ACTION, "toggle")
                    .putExtra(AgendaWidgetProvider.EXTRA_ID, id);
            rv.setOnClickFillInIntent(R.id.row_check, toggle);
        } else {
            rv.setViewVisibility(R.id.row_check, View.GONE);
            rv.setTextViewText(R.id.row_check, "");
        }
        return rv;
    }

    private String formatWhen(String date, String time) {
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            Date d = in.parse(date);
            Calendar c0 = midnight(Calendar.getInstance());
            Calendar cd = Calendar.getInstance();
            cd.setTime(d);
            cd = midnight(cd);
            long diff = Math.round((cd.getTimeInMillis() - c0.getTimeInMillis()) / 86400000.0);
            String label;
            if (diff == 0) label = "Today";
            else if (diff == 1) label = "Tomorrow";
            else label = new SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(d);
            if (time != null && !time.isEmpty()) label += " · " + time;
            return label;
        } catch (Exception e) {
            return date;
        }
    }

    private static Calendar midnight(Calendar c) {
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c;
    }
}
