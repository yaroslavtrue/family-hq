package com.moyafamily.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import com.moyafamily.app.MainActivity;
import com.moyafamily.app.R;

import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import javax.net.ssl.HttpsURLConnection;

/**
 * Home-screen agenda widget for Moya. Shows the next ~14 days of calendar items
 * (events, tasks, birthdays, recurring, subscriptions) pulled from
 * https://api.moyafamily.com/api/agenda. The list is backed by a RemoteViewsService
 * collection; the network call + parse happens in AgendaRemoteViewsFactory.
 */
public class AgendaWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_REFRESH = "com.moyafamily.app.AGENDA_REFRESH";
    public static final String ACTION_ITEM = "com.moyafamily.app.AGENDA_ITEM";
    public static final String EXTRA_ACTION = "x_action";   // "open" | "toggle"
    public static final String EXTRA_TYPE = "x_type";       // event/task/recurring/birthday/subscription
    public static final String EXTRA_ID = "x_id";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(ctx, mgr, id);
    }

    static void updateWidget(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_agenda);
        rv.setTextViewText(R.id.widget_date,
                new SimpleDateFormat("EEE, d MMM", Locale.getDefault()).format(new Date()));

        // Collection adapter — unique Intent per widget id (Uri data forces distinct extras).
        Intent svc = new Intent(ctx, AgendaWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        rv.setRemoteAdapter(R.id.agenda_list, svc);
        rv.setEmptyView(R.id.agenda_list, R.id.agenda_empty);

        // Template for per-row clicks; each row supplies a fillInIntent (open vs toggle).
        // MUST be mutable so the fillInIntent can be merged in.
        Intent itemTmpl = new Intent(ctx, AgendaWidgetProvider.class).setAction(ACTION_ITEM);
        PendingIntent itemPi = PendingIntent.getBroadcast(ctx, 0, itemTmpl,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        rv.setPendingIntentTemplate(R.id.agenda_list, itemPi);

        // Title → open the app.
        Intent open = new Intent(ctx, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.widget_title, openPi);

        // Sync icon (↻) → refresh the list.
        Intent refresh = new Intent(ctx, AgendaWidgetProvider.class).setAction(ACTION_REFRESH);
        PendingIntent refPi = PendingIntent.getBroadcast(ctx, 0, refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.widget_sync, refPi);

        mgr.updateAppWidget(id, rv);
        mgr.notifyAppWidgetViewDataChanged(id, R.id.agenda_list);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, AgendaWidgetProvider.class));
            for (int id : ids) updateWidget(ctx, mgr, id);
        } else if (ACTION_ITEM.equals(intent.getAction())) {
            String act = intent.getStringExtra(EXTRA_ACTION);
            final int itemId = intent.getIntExtra(EXTRA_ID, 0);
            if ("toggle".equals(act)) {
                // Mark done in the background, then refresh the list (the task drops off).
                final Context app = ctx.getApplicationContext();
                new Thread(() -> {
                    markDone(app, itemId);
                    AppWidgetManager mgr = AppWidgetManager.getInstance(app);
                    int[] ids = mgr.getAppWidgetIds(new ComponentName(app, AgendaWidgetProvider.class));
                    mgr.notifyAppWidgetViewDataChanged(ids, R.id.agenda_list);
                }).start();
            } else if ("open".equals(act)) {
                // Stash a deep-link the web app reads on resume, then bring the app forward
                // onto the matching showCalEv(type, id) detail popup.
                String type = intent.getStringExtra(EXTRA_TYPE);
                ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                        .edit().putString("fhq_open", type + ":" + itemId).apply();
                Intent open = new Intent(ctx, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                ctx.startActivity(open);
            }
        }
    }

    private static void markDone(Context ctx, int id) {
        String token = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .getString("fhq_session", null);
        if (token == null || token.isEmpty() || id <= 0) return;
        HttpsURLConnection c = null;
        try {
            c = (HttpsURLConnection) new URL("https://api.moyafamily.com/api/tasks/" + id + "/done").openConnection();
            c.setRequestMethod("POST");
            c.setRequestProperty("X-Session-Token", token);
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            c.getResponseCode();
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
