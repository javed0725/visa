package com.visaautomator.companion;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureStore {
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        String alias = "visa_otp_companion_v1";
        if (!store.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey)store.getKey(alias, null);
    }
    static synchronized JSONObject read(Context context) throws Exception {
        String saved = context.getSharedPreferences("secure", Context.MODE_PRIVATE).getString("state", "");
        if (saved.isEmpty()) return new JSONObject();
        String[] parts = saved.split("\\.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
    }
    static synchronized void write(Context context, JSONObject state) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." +
            Base64.encodeToString(cipher.doFinal(state.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!context.getSharedPreferences("secure", Context.MODE_PRIVATE).edit().putString("state", value).commit())
            throw new java.io.IOException("Unable to save securely");
    }
    static synchronized void enqueue(Context context, JSONObject message) throws Exception {
        JSONObject state = read(context);
        if (state.optString("deviceToken").isEmpty() || state.optLong("expiresAt") <= System.currentTimeMillis()) return;
        JSONArray old = state.optJSONArray("queue"), queue = new JSONArray();
        if (old != null) for (int i = Math.max(0, old.length()-4); i < old.length(); i++) {
            JSONObject item = old.getJSONObject(i);
            if (item.optLong("receivedAt") > System.currentTimeMillis()-120000) queue.put(item);
        }
        queue.put(message);
        state.put("queue", queue).put("status", "Visa OTP detected. Waiting for secure delivery.");
        write(context, state);
    }
    static synchronized void drop(Context context, String id, String status) throws Exception {
        JSONObject state = read(context);
        JSONArray old = state.optJSONArray("queue"), queue = new JSONArray();
        if (old != null) for (int i=0; i<old.length(); i++)
            if (!old.getJSONObject(i).optString("messageId").equals(id)) queue.put(old.getJSONObject(i));
        state.put("queue", queue).put("status", status);
        write(context, state);
    }
    static synchronized void status(Context context, String text) throws Exception {
        JSONObject state = read(context);
        state.put("status", text);
        write(context, state);
    }
    static synchronized void clear(Context context, String text) throws Exception {
        JSONObject old = read(context);
        write(context, new JSONObject().put("relayURL", old.optString("relayURL")).put("status", text));
    }
    private SecureStore() {}
}
