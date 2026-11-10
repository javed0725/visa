package com.visaautomator.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.widget.*;
import org.json.JSONObject;
import java.util.Locale;

public final class MainActivity extends Activity {
    private EditText relay, key;
    private TextView status, permissions;
    private Button pair, unpair;
    private boolean busy=false;
    private final int green=Color.rgb(110,231,183);
    private int dp(int size) {return (int)(size*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(12,13,18));
        getWindow().setNavigationBarColor(Color.rgb(12,13,18));
        ScrollView scroll=new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(12,13,18));
        LinearLayout layout=new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(24),dp(24),dp(24),dp(24)); scroll.addView(layout); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((view,insets)-> {
            if (android.os.Build.VERSION.SDK_INT>=30) {
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());
                scroll.setPadding(bars.left,bars.top,bars.right,bars.bottom);
            }
            return insets;
        });
        text(layout,"VISA AUTOMATOR · COMPANION",12,green);
        TextView title=text(layout,"Phone OTP\nAuto-Fill",30,Color.WHITE); title.setTypeface(null,Typeface.BOLD);
        text(layout,"Pair once. Receive your visa OTP directly in Chrome.",15,Color.LTGRAY);
        text(layout,"1  CONNECT YOUR BROWSER",12,green);
        text(layout,"Use the same public HTTPS relay address as the extension's Relay setup.",13,Color.LTGRAY);
        relay=field(layout,"https://your-relay.example",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        text(layout,"CLIENT KEY",12,green);
        key=field(layout,"99JP-GCDG",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        key.setTypeface(Typeface.MONOSPACE); key.setSingleLine(true);
        pair=button(layout,"Pair phone",v->pairPhone());
        status=text(layout,"Not paired",14,Color.WHITE);
        text(layout,"2  ALLOW INCOMING VISA OTPs",12,green);
        text(layout,"With your permission, this app checks incoming SMS on this phone for IVAC/visa OTPs. It sends only the six-digit code and delivery metadata to your chosen relay. No SMS history, full message text, phone number, or unrelated messages are uploaded.",13,Color.LTGRAY);
        permissions=text(layout,"SMS access not yet granted",13,green);
        button(layout,"Grant SMS access",v->new AlertDialog.Builder(this).setTitle("Allow visa OTP forwarding?")
            .setMessage("Enable only on a phone you own. Incoming SMS will be filtered locally for visa OTPs. Only matching six-digit codes are forwarded to your paired browser. You can stop this at any time by unpairing or revoking SMS access in Android settings.")
            .setNegativeButton("Not now",null).setPositiveButton("Continue",(d,w)->requestPermissions(
                new String[]{Manifest.permission.RECEIVE_SMS,Manifest.permission.READ_SMS},42)).show());
        button(layout,"Check connection",v->checkConnection());
        unpair=button(layout,"Unpair & stop forwarding",v->new AlertDialog.Builder(this).setTitle("Unpair this phone?")
            .setMessage("This revokes the phone/browser pairing and erases queued codes. You will need a new Client Key to pair again.")
            .setNegativeButton("Cancel",null).setPositiveButton("Unpair",(d,w)->unpair()).show());
        text(layout,"Keep Phone OTP auto-fill enabled and the IVAC OTP tab active in Chrome. A paired session lasts 24 hours. Internet and Android SMS permission are required; force-stopping the app prevents delivery until you reopen it.",12,Color.GRAY);
        render();
    }
    private TextView text(LinearLayout parent,String value,int size,int color) {
        TextView text=new TextView(this);text.setText(value);text.setTextSize(size);text.setTextColor(color);
        text.setPadding(0,dp(10),0,dp(10));parent.addView(text);return text;
    }
    private EditText field(LinearLayout parent,String hint,int type) {
        EditText input=new EditText(this);input.setHint(hint);input.setInputType(type);
        input.setTextColor(Color.WHITE);input.setHintTextColor(Color.GRAY);input.setTextSize(16);
        input.setSingleLine(true);parent.addView(input,new LinearLayout.LayoutParams(-1,dp(54)));return input;
    }
    private Button button(LinearLayout parent,String label,View.OnClickListener listener) {
        Button button=new Button(this);button.setText(label);button.setTextColor(Color.rgb(8,25,18));
        button.setBackgroundTintList(android.content.res.ColorStateList.valueOf(green));
        LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,dp(52));params.topMargin=dp(10);
        parent.addView(button,params);button.setOnClickListener(listener);return button;
    }
    private void render() {
        try {
            JSONObject state=SecureStore.read(this);
            boolean paired=!state.optString("deviceToken").isEmpty() && state.optLong("expiresAt")>System.currentTimeMillis();
            if (relay.getText().length()==0) relay.setText(state.optString("relayURL"));
            if (key.getText().length()==0) key.setText(state.optString("clientKey"));
            relay.setEnabled(!paired && !busy);key.setEnabled(!paired && !busy);
            pair.setEnabled(!paired && !busy);unpair.setEnabled(paired && !busy);
            status.setText(state.optString("status",paired?"Phone paired. Waiting for a visa OTP.":"Not paired"));
            boolean receive=checkSelfPermission(Manifest.permission.RECEIVE_SMS)==PackageManager.PERMISSION_GRANTED;
            boolean read=checkSelfPermission(Manifest.permission.READ_SMS)==PackageManager.PERMISSION_GRANTED;
            permissions.setText(receive?(read?"SMS access granted":"Incoming SMS allowed; history access not granted"):
                "SMS access not granted. Android must allow RECEIVE_SMS before forwarding can work.");
        } catch (Exception error) { status.setText("Secure storage unavailable. Clear app data and pair again."); }
    }
    @Override public void onResume() { super.onResume(); if (status!=null) {render();DeliveryJob.schedule(this);} }
    @Override public void onRequestPermissionsResult(int request,String[] names,int[] granted) {
        super.onRequestPermissionsResult(request,names,granted);render();
    }
    private void pairPhone() {
        if (busy) return;
        try {
            final String base=RelayApi.origin(relay.getText().toString());
            final String clientKey=key.getText().toString().trim().toUpperCase(Locale.ROOT);
            if (!clientKey.matches("[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}")) throw new IllegalArgumentException("Enter the exact Client Key, including the hyphen.");
            busy=true;render();status.setText("Pairing securely…");
            new Thread(()-> {
                String errorText=null;
                try {
                    RelayApi.Result result=RelayApi.request(base,"/pair","POST",null,new JSONObject().put("clientKey",clientKey));
                    if (result.code!=200) throw new IllegalStateException(result.body.optString("error","Pairing rejected. Generate a new key in Chrome."));
                    SecureStore.write(this,new JSONObject().put("relayURL",base).put("clientKey",clientKey)
                        .put("deviceToken",result.body.getString("deviceToken")).put("expiresAt",result.body.getLong("expiresAt"))
                        .put("status","Phone paired. Enable auto-fill in Chrome and grant SMS access."));
                } catch (Exception error) { errorText=error.getMessage(); }
                final String failure=errorText;
                runOnUiThread(()->{busy=false;render();if (failure!=null) status.setText(failure);});
            },"visa-pair-phone").start();
        } catch (Exception error) {status.setText(error.getMessage());}
    }
    private void checkConnection() {
        if (busy) return;
        busy=true;render();status.setText("Checking relay…");
        new Thread(()-> {
            String message;
            try {
                JSONObject state=SecureStore.read(this);
                if (state.optString("deviceToken").isEmpty()) throw new IllegalStateException("Pair this phone first.");
                RelayApi.Result result=RelayApi.request(state.getString("relayURL"),"/pairing","GET",state.getString("deviceToken"),null);
                if (result.code==401) {SecureStore.clear(this,"Pairing expired or revoked. Generate a new key in Chrome.");message="Pair again with a new key.";}
                else if (result.code!=200) throw new IllegalStateException(result.body.optString("error","Relay unavailable."));
                else {message=result.body.optBoolean("enabled")?"Connected. Chrome auto-fill is on.":"Connected. Enable Phone OTP auto-fill in Chrome.";SecureStore.status(this,message);}
            } catch (Exception error) {message=error.getMessage();}
            final String result=message;runOnUiThread(()->{busy=false;render();status.setText(result);DeliveryJob.schedule(this);});
        },"visa-check-relay").start();
    }
    private void unpair() {
        if (busy) return;
        busy=true;render();status.setText("Revoking pairing…");
        new Thread(()-> {
            boolean remoteRevoked=false;
            try {
                JSONObject state=SecureStore.read(this);
                RelayApi.Result result=RelayApi.request(state.getString("relayURL"),"/pairing","DELETE",state.getString("deviceToken"),null);
                remoteRevoked=result.code==204 || result.code==401;
            } catch (Exception ignored) {}
            try {SecureStore.clear(this,remoteRevoked?"Unpaired. Forwarding stopped.":"Forwarding stopped locally. Relay unreachable; regenerate the key in Chrome too.");}
            catch (Exception ignored) {}
            runOnUiThread(()->{busy=false;key.setText("");render();});
        },"visa-unpair").start();
    }
}
