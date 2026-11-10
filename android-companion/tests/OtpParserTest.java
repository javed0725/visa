package com.visaautomator.companion;
public final class OtpParserTest {
    static int count=0;
    private static void check(String expected,String sender,String body) {
        String actual=OtpParser.extract(sender,body);
        if (!java.util.Objects.equals(expected,actual)) throw new AssertionError("Parser case "+count+" failed");
        count++;
    }
    public static void main(String[] args) {
        check("123456","IVAC","Your OTP is 123456.");
        check("234567","IVAC-BD","234567 is your verification code.");
        check("345678","INFO","Indian Visa appointment OTP: 345678 valid for 2 minutes.");
        check(null,"BANK","Visa card OTP 123456 for online payment.");
        check(null,"BANK","Your OTP is 123456.");
        check(null,"IVAC","Your application number is 123456.");
        check(null,"IVAC","OTP is 12345.");
        check(null,"IVAC","OTP is 1234567.");
        check("567890","IVAC","Application 123456. Your OTP is 567890.");
        check(null,"IVAC","Verify numbers 123456 and 654321.");
        check(null,null,null);
        check(null,"IVAC","OTP for application 123456 is 654321.");
        check("456789","IVAC","Your OTP code is: 456789.");
        System.out.println("Passed "+count+" SMS parser checks.");
    }
}
