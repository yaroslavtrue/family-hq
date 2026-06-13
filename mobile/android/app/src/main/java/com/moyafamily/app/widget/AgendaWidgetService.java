package com.moyafamily.app.widget;

import android.content.Intent;
import android.widget.RemoteViewsService;

/** Hosts the agenda list factory for the home-screen widget. */
public class AgendaWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new AgendaRemoteViewsFactory(getApplicationContext());
    }
}
