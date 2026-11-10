package com.visaautomator.companion;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Pure parser: never accepts a bank-card OTP merely because it mentions Visa. */
public final class OtpParser {
    private static final Pattern SIX = Pattern.compile("(?<![0-9])([0-9]{6})(?![0-9])");
    private static final Pattern VISA = Pattern.compile("\\b(?:ivac|indian\\s+visa|visa\\s+(?:application|appointment|verification|otp))\\b");
    private static final Pattern CONTEXT = Pattern.compile("\\b(?:otp|one[ -]?time|verification\\s+code|verify|security\\s+code)\\b");
    private static final Pattern LABELED = Pattern.compile(
        "(?i)(?:otp(?:\\s+code)?|one[ -]?time(?:\\s+(?:password|code))?|verification\\s+code|security\\s+code)[\\s:=\\-]*(?:is\\s*[:=\\-]?\\s*)?([0-9]{6})(?![0-9])");
    public static String extract(String sender, String body) {
        if (body == null) return null;
        String context = ((sender == null ? "" : sender) + " " + body).toLowerCase(Locale.ROOT);
        if (!VISA.matcher(context).find() || !CONTEXT.matcher(body.toLowerCase(Locale.ROOT)).find()) return null;
        Matcher labeled = LABELED.matcher(body);
        if (labeled.find()) return labeled.group(1);
        Matcher all = SIX.matcher(body);
        if (!all.find()) return null;
        String code = all.group(1);
        // Ambiguous SMS with two unlabelled six-digit numbers fails closed.
        return all.find() ? null : code;
    }
    private OtpParser() {}
}
