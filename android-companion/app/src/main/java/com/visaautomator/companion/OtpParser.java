package com.visaautomator.companion;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Accept only IVACBD's security-sequence template; never forward raw SMS text. */
public final class OtpParser {
    private static final String[] WORDS = {
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"
    };
    private static final Pattern SIGNATURE = Pattern.compile(
        "(?i)(?<![\\p{L}\\p{N}_])IVACBD(?![\\p{L}\\p{N}_])");
    private static final String WORD = "(?:Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine)";
    private static final String SEQUENCE = WORD + "(?:[\\s_]+" + WORD + ")*(?![\\p{L}\\p{N}_])";
    private static final Pattern SECURITY_SEQUENCE = Pattern.compile(
        "(?i)\\bFor\\s+security,\\s+type\\s+the\\s+following\\s+sequence\\s+when\\s+prompted"
        + "\\s*:?\\s*(?:\\[\\s*(" + SEQUENCE + ")\\s*\\]|(" + SEQUENCE + "))");

    public static String extract(String sender, String body) {
        if (body == null) return null;
        // The signature can be the SMS sender/header or appear in the message.
        if (!SIGNATURE.matcher(sender == null ? "" : sender).find()
            && !SIGNATURE.matcher(body).find()) return null;
        Matcher match = SECURITY_SEQUENCE.matcher(body);
        if (!match.find()) return null;
        String sequence = match.group(1) == null ? match.group(2) : match.group(1);
        String[] words = sequence.toLowerCase(Locale.ROOT).split("[\\s_]+");
        if (words.length != 6 || match.find()) return null;
        StringBuilder digits = new StringBuilder(6);
        for (String word : words) {
            int digit = -1;
            for (int i = 0; i < WORDS.length; i++) {
                if (WORDS[i].equals(word)) { digit = i; break; }
            }
            if (digit < 0) return null;
            digits.append(digit);
        }
        // Keep this a string so leading zeroes survive the HTTPS JSON payload.
        return digits.toString();
    }
    private OtpParser() {}
}
