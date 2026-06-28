package kr.co.eatspay.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String PUSH_CHANNEL_ID = "eatspay_talk_v2";
    private String pendingPushScript;

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
            PUSH_CHANNEL_ID,
            "eats PAY Talk",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("eats PAY push and Eats Talk message notifications.");
        channel.enableVibration(true);
        channel.enableLights(true);

        Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.eatspay_talk);
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(soundUri, audioAttributes);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private void evalIfBridgeReady(String script) {
        if (getBridge() != null) {
            getBridge().eval(script, null);
        } else {
            pendingPushScript = script;
        }
    }

    private void handlePushIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Bundle extras = intent.getExtras();
        if (!"EATSPAY_PUSH_CLICK".equals(action) && extras == null) return;

        try {
            JSONObject data = new JSONObject();
            if (extras != null) {
                for (String key : extras.keySet()) {
                    Object value = extras.get(key);
                    if (value != null) data.put(key, String.valueOf(value));
                }
            }
            if (action != null) data.put("action", action);
            String script = "(function(){"
                + "var data=" + data.toString() + ";"
                + "window.EATSPAY_NATIVE_PUSH=data;"
                + "try{sessionStorage.setItem('eatspay.pendingPushRoute',JSON.stringify(data));}catch(e){}"
                + "if(window.EATSPAY_HANDLE_PUSH_ROUTE){window.EATSPAY_HANDLE_PUSH_ROUTE(data);}"
                + "})();";
            evalIfBridgeReady(script);
        } catch (Exception ignored) {
            // Push routing should never block app launch.
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        super.onCreate(savedInstanceState);
        ensureNotificationChannel();
        handlePushIntent(getIntent());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                evalIfBridgeReady(
                    "window.EATSPAY_HANDLE_ANDROID_BACK && window.EATSPAY_HANDLE_ANDROID_BACK();"
                );
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handlePushIntent(intent);
    }

    @Override
    public void onPause() {
        evalIfBridgeReady("window.EATSPAY_PERSIST_APP_SESSION && window.EATSPAY_PERSIST_APP_SESSION();");
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingPushScript != null && getBridge() != null) {
            getBridge().eval(pendingPushScript, null);
            pendingPushScript = null;
        }
        evalIfBridgeReady("window.EATSPAY_RESTORE_APP_SESSION && window.EATSPAY_RESTORE_APP_SESSION();");
    }
}
