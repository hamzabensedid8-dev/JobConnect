package com.jobconnect.app;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/** Minimal HTTP helper for the background notification poll. */
public final class Api {
    private Api() {}

    public static String get(String url, String bearer) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestProperty("Accept", "application/json");
        if (bearer != null && !bearer.isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + bearer);
        }
        int code = conn.getResponseCode();
        BufferedReader reader = new BufferedReader(
                new InputStreamReader(code >= 400 ? conn.getErrorStream() : conn.getInputStream(), "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line);
        reader.close();
        conn.disconnect();
        if (code >= 400) throw new Exception("HTTP " + code + ": " + sb);
        return sb.toString();
    }

    public static JSONObject getJson(String url, String bearer) throws Exception {
        return new JSONObject(get(url, bearer));
    }
}
