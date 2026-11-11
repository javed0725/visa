package com.visaautomator.companion;
public final class OtpParserTest {
    static int count=0;
    private static void check(String expected,String sender,String body) {
        String actual=OtpParser.extract(sender,body);
        if (!java.util.Objects.equals(expected,actual)) throw new AssertionError("Parser case "+count+" failed");
        count++;
    }
    public static void main(String[] args) {
        String prompt="For security, type the following sequence when prompted ";
        check("027922","IVACBD",prompt+"Zero_Two_Seven_Nine_Two_Two");
        check("027922","INFO","(IVACBD) "+prompt+"Zero Two Seven Nine Two Two.");
        check("012345","IVACBD",prompt+"[Zero_One_Two_Three_Four_Five]");
        check("678901","IVACBD",prompt+"Six Seven Eight Nine Zero One");
        check("000000","IVACBD",prompt+"Zero Zero Zero Zero Zero Zero");
        check("999999","IVACBD",prompt+"Nine_Nine_Nine_Nine_Nine_Nine");
        check("027922","ivacbd",prompt.toUpperCase()+"zero_TWO_seven_NINE_two_TWO");
        check("027922","IVACBD",prompt+"Zero_Two Seven\tNine\nTwo_Two");
        check("027922",null,prompt+"Zero Two Seven Nine Two Two\n(IVACBD)");
        check("027922","IVACBD",prompt+": [ Zero Two Seven Nine Two Two ].");
        check(null,"BANK",prompt+"Zero Two Seven Nine Two Two");
        check(null,"IVAC",prompt+"Zero Two Seven Nine Two Two");
        check(null,"NOTIVACBD",prompt+"Zero Two Seven Nine Two Two");
        check(null,"IVACBDFAKE",prompt+"Zero Two Seven Nine Two Two");
        check(null,"INFO","NOTIVACBD "+prompt+"Zero Two Seven Nine Two Two");
        check(null,"BANK","Visa card OTP 123456 for online payment.");
        check(null,"IVACBD","Your OTP is 123456.");
        check(null,"IVACBD",prompt+"027922");
        check(null,"IVACBD","Zero Two Seven Nine Two Two");
        check(null,"IVACBD",prompt+"Zero Two Seven Nine Two");
        check(null,"IVACBD",prompt+"Zero Two Seven Nine Two Two One");
        check(null,"IVACBD",prompt+"Zero_Two_Seven_Nine_Two_Two_One");
        check(null,"IVACBD",prompt+"Zero Two Seven Nine Two Banana");
        check(null,"IVACBD",prompt+"Zero_Two_Seven_Nine_Two_Two_Banana");
        check(null,"IVACBD",prompt+"Zero Two Seven Nine Two Two1");
        check(null,"IVACBD",prompt+"Zero Two Seven Nine Two Twos");
        check(null,"IVACBD",prompt+"Zero-Two-Seven-Nine-Two-Two");
        check(null,"IVACBD",prompt+"[Zero Two Seven Nine Two Two");
        check(null,"IVACBD",prompt+"Zero Two Seven Nine Two Two. "+prompt+"One Two Three Four Five Six");
        check(null,null,null);
        check(null,"IVACBD","");
        System.out.println("Passed "+count+" SMS parser checks.");
    }
}
