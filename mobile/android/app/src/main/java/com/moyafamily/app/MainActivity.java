package com.moyafamily.app;

import android.content.Intent;

import com.getcapacitor.BridgeActivity;
import com.moyafamily.app.widget.AgendaWidgetProvider;

public class MainActivity extends BridgeActivity {
    // Keep the home-screen agenda widget in sync with the app: refresh it when the app
    // comes to the foreground and when it leaves (e.g. after saving a change and going
    // back to the home screen). The widget re-fetches from the server, so it always
    // shows the latest state.
    @Override
    protected void onResume() {
        super.onResume();
        refreshAgendaWidget();
    }

    @Override
    protected void onStop() {
        super.onStop();
        refreshAgendaWidget();
    }

    private void refreshAgendaWidget() {
        try {
            sendBroadcast(new Intent(this, AgendaWidgetProvider.class)
                    .setAction(AgendaWidgetProvider.ACTION_REFRESH));
        } catch (Exception ignored) {
        }
    }
}
