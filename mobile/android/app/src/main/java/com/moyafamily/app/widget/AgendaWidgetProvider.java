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

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Home-screen agenda widget for Moya. Shows the next ~14 days of calendar items
 * (events, tasks, birthdays, recurring, subscriptions) pulled from
 * https://api.moyafamily.com/api/agenda. The list is backed by a RemoteViewsService
 * collection; the network call + parse happens in AgendaRemoteViewsFactory.
 */
public class AgendaWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_REFRESH = "com.moyafamily.app.AGENDA_REFRESH";

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

        // Title → open the app.
        Intent open = new Intent(ctx, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.widget_title, openPi);

        // Date → refresh the list.
        Intent refresh = new Intent(ctx, AgendaWidgetProvider.class).setAction(ACTION_REFRESH);
        PendingIntent refPi = PendingIntent.getBroadcast(ctx, 0, refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.widget_date, refPi);

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
        }
    }
}
