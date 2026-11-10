package com.visaautomator.companion;

import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

final class RelayApi {
    static String origin(String input) throws Exception {
        URL url = new URL(input.trim());
        if (!url.getProtocol().equals("https") || url.getUserInfo()!=null ||
            (!url.getPath().isEmpty() && !url.getPath().equals("/")) || url.getQuery()!=null || url.getRef()!=null)
            throw new IllegalArgumentException("Use an HTTPS relay address without a path or password.");
        return url.getProtocol()+"://"+url.getAuthority();
    }
    static final class Result {
        final int code; final JSONObject body;
        Result(int code, JSONObject body) { this.code=code; this.body=body; }
    }
    static Result request(String base, String path, String method, String token, JSONObject body) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection)new URL(origin(base)+"/api/phone-otp"+path).openConnection();
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Content-Type","application/json");
            connection.setRequestProperty("Cache-Control","no-store");
            if (token!=null && !token.isEmpty()) connection.setRequestProperty("Authorization","Bearer "+token);
            if (body!=null) {
                connection.setDoOutput(true);
                try (java.io.OutputStream out=connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int code = connection.getResponseCode();
            InputStream stream = code>=400 ? connection.getErrorStream() : connection.getInputStream();
            String text="";
            if (stream!=null) try (InputStream in=stream; ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] bytes=new byte[1024]; int count;
                while ((count=in.read(bytes))!=-1) {
                    if (out.size()+count>16384) throw new java.io.IOException("Unexpected relay response.");
                    out.write(bytes,0,count);
                }
                text=out.toString("UTF-8");
            }
            JSONObject data;
            try { data=text.isEmpty()?new JSONObject():new JSONObject(text); }
            catch (Exception error) { throw new java.io.IOException("Relay did not return JSON. Use the published public relay address."); }
            return new Result(code,data);
        } finally { connection.disconnect(); }
    }
    private RelayApi() {}
}
