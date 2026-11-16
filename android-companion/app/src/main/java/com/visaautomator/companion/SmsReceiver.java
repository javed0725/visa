package com.visaautomator.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public final class SmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                // Join multipart messages before filtering/extracting; never save SMS text.
                Map<String,StringBuilder> bodies = new LinkedHashMap<>();
                Map<String,Long> timestamps = new LinkedHashMap<>();
                for (SmsMessage sms: Telephony.Sms.Intents.getMessagesFromIntent(intent)) {
                    String sender=sms.getDisplayOriginatingAddress()==null?"":sms.getDisplayOriginatingAddress();
                    bodies.computeIfAbsent(sender, ignored->new StringBuilder()).append(sms.getMessageBody());
                    timestamps.putIfAbsent(sender,sms.getTimestampMillis());
                }
                for (Map.Entry<String,StringBuilder> message:bodies.entrySet()) {
                    String code=OtpParser.extract(message.getKey(),message.getValue().toString());
                    long at=timestamps.get(message.getKey());
                    if (code==null || at<System.currentTimeMillis()-120000 || at>System.currentTimeMillis()+30000) continue;
                    SecureStore.enqueue(context,new JSONObject().put("otp",code).put("messageId",UUID.randomUUID().toString()).put("receivedAt",at));
                }
                // Try the authenticated HTTPS push immediately while the SMS
                // broadcast is active. JobScheduler remains the offline retry.
                DeliveryJob.deliverImmediately(context);
                DeliveryJob.schedule(context);
            } catch (Exception error) {
                // No SMS, code, sender, credentials or exception payload in logs.
                try { SecureStore.status(context,"Secure SMS processing failed. Open the app to check pairing."); }
                catch (Exception ignored) {}
            } finally { pending.finish(); }
        },"visa-sms-receiver").start();
    }
}
