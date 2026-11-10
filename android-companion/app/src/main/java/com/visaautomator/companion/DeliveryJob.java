package com.visaautomator.companion;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.app.job.JobWorkItem;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import org.json.JSONArray;
import org.json.JSONObject;

public final class DeliveryJob extends JobService {
    private static final int JOB_ID=4106;
    private final java.util.concurrent.atomic.AtomicInteger generation=new java.util.concurrent.atomic.AtomicInteger();
    static void schedule(Context context) {
        try {
            JSONArray queue=SecureStore.read(context).optJSONArray("queue");
            if (queue==null || queue.length()==0) return;
            JobScheduler scheduler=(JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            // enqueue appends to an existing job without replacing its in-flight work.
            // Work items contain no SMS/code; the actual queue is Keystore-encrypted.
            int result=scheduler.enqueue(new JobInfo.Builder(JOB_ID,new ComponentName(context,DeliveryJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setBackoffCriteria(10000,JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .setOverrideDeadline(0).build(),new JobWorkItem(new Intent()));
            if (result!=JobScheduler.RESULT_SUCCESS) SecureStore.status(context,"Android delayed delivery. Open the app and check connection.");
        } catch (Exception ignored) {}
    }
    @Override public boolean onStartJob(JobParameters parameters) {
        final int run=generation.incrementAndGet();
        new Thread(()-> {
            boolean retry=false;
            try {
              JobWorkItem work;
              while (run==generation.get() && (work=parameters.dequeueWork())!=null) {
                for (int i=0;i<10 && run==generation.get();i++) {
                    JSONObject state=SecureStore.read(this);
                    JSONArray queue=state.optJSONArray("queue");
                    if (queue==null || queue.length()==0) break;
                    JSONObject message=queue.getJSONObject(0);
                    String id=message.getString("messageId");
                    if (state.optString("deviceToken").isEmpty() || state.optLong("expiresAt")<=System.currentTimeMillis()) {
                        SecureStore.clear(this,"Pairing expired. Generate a new key in the extension and pair again."); break;
                    }
                    if (message.getLong("receivedAt")<System.currentTimeMillis()-120000) {
                        SecureStore.drop(this,id,"An undelivered code expired. Waiting for the next visa OTP."); continue;
                    }
                    JSONObject payload=new JSONObject(message.toString()).put("clientKey",state.getString("clientKey"));
                    RelayApi.Result result=RelayApi.request(state.getString("relayURL"),"/messages","POST",state.getString("deviceToken"),payload);
                    if (result.code==202) SecureStore.drop(this,id,"Visa OTP delivered securely. Waiting for the next message.");
                    else if (result.code==401) { SecureStore.clear(this,"Phone unpaired or expired. Generate a new key and pair again."); break; }
                    else if (result.code==409) SecureStore.drop(this,id,"Extension auto-fill is off. Enable it before the next OTP.");
                    else if (result.code==429 || result.code>=500) { retry=true; break; }
                    else SecureStore.drop(this,id,result.body.optString("error","Delivery rejected. Check the relay address and phone clock."));
                }
                if (retry || run!=generation.get()) break;
                parameters.completeWork(work);
              }
            } catch (Exception error) {
                retry=true;
                try { SecureStore.status(this,"Relay unreachable. Retrying automatically until the code expires."); }
                catch (Exception ignored) {}
            }
            if (run==generation.get()) jobFinished(parameters,retry);
        },"visa-otp-delivery").start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters parameters) { generation.incrementAndGet(); return true; }
}
