package tr.ets2nav.ui;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.text.NumberFormat;
import java.util.Locale;

/** Small helpers for the programmatic, car-style dark screens. */
public final class Ui {
  private Ui() {}

  public static final int BG = 0xff121518;
  public static final int CARD = 0xff1d2228;
  public static final int CARD_PRESSED = 0xff2a3139;
  public static final int TEXT = 0xffe8eaed;
  public static final int TEXT2 = 0xff9aa0a6;
  public static final int ACCENT = 0xff8ab4f8;
  public static final int GREEN = 0xff81c995;
  public static final int YELLOW = 0xfffdd663;
  public static final int RED = 0xfff28b82;
  public static final int TRACK = 0xff2e353d;

  public static final Locale TR = new Locale("tr", "TR");

  public static int dp(Context c, float v) {
    return Math.round(v * c.getResources().getDisplayMetrics().density);
  }

  public static TextView text(Context c, float sp, int color, boolean bold) {
    TextView t = new TextView(c);
    t.setTextSize(sp);
    t.setTextColor(color);
    if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    t.setIncludeFontPadding(false);
    return t;
  }

  public static TextView text(Context c, String s, float sp, int color, boolean bold) {
    TextView t = text(c, sp, color, bold);
    t.setText(s);
    return t;
  }

  public static GradientDrawable rounded(int color, float radiusPx) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(color);
    d.setCornerRadius(radiusPx);
    return d;
  }

  /** Vertical card with padding and rounded corners; clickable cards get a pressed state. */
  public static LinearLayout card(Context c, boolean clickable) {
    LinearLayout l = new LinearLayout(c);
    l.setOrientation(LinearLayout.VERTICAL);
    int p = dp(c, 18);
    l.setPadding(p, p, p, p);
    float r = dp(c, 18);
    if (clickable) {
      StateListDrawable s = new StateListDrawable();
      s.addState(new int[] {android.R.attr.state_pressed}, rounded(CARD_PRESSED, r));
      s.addState(new int[] {}, rounded(CARD, r));
      l.setBackground(s);
      l.setClickable(true);
    } else {
      l.setBackground(rounded(CARD, r));
    }
    return l;
  }

  public static ProgressBar bar(Context c, int color) {
    ProgressBar b = new ProgressBar(c, null, android.R.attr.progressBarStyleHorizontal);
    b.setMax(1000);
    b.setProgressTintList(ColorStateList.valueOf(color));
    b.setProgressBackgroundTintList(ColorStateList.valueOf(TRACK));
    b.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(c, 10)));
    return b;
  }

  public static void setBar(ProgressBar b, double fraction, int color) {
    b.setProgress((int) Math.round(Math.max(0, Math.min(1, fraction)) * 1000));
    b.setProgressTintList(ColorStateList.valueOf(color));
  }

  public static LinearLayout.LayoutParams weight(float w) {
    return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, w);
  }

  public static LinearLayout.LayoutParams hweight(float w) {
    return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, w);
  }

  public static LinearLayout.LayoutParams wrap() {
    return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
  }

  public static LinearLayout.LayoutParams matchWrap() {
    return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
  }

  public static LinearLayout.LayoutParams margins(LinearLayout.LayoutParams lp, Context c, float l, float t, float r, float b) {
    lp.setMargins(dp(c, l), dp(c, t), dp(c, r), dp(c, b));
    return lp;
  }

  public static LinearLayout row(Context c) {
    LinearLayout l = new LinearLayout(c);
    l.setOrientation(LinearLayout.HORIZONTAL);
    l.setGravity(Gravity.CENTER_VERTICAL);
    return l;
  }

  public static LinearLayout column(Context c) {
    LinearLayout l = new LinearLayout(c);
    l.setOrientation(LinearLayout.VERTICAL);
    return l;
  }

  public static View spacer(Context c) {
    View v = new View(c);
    v.setLayoutParams(new LinearLayout.LayoutParams(0, 0, 1));
    return v;
  }

  public static String money(double v, String currency) {
    NumberFormat f = NumberFormat.getIntegerInstance(TR);
    return f.format(Math.round(v)) + " " + currency;
  }

  public static String number(double v) {
    return NumberFormat.getIntegerInstance(TR).format(Math.round(v));
  }

  /** Game minutes (since day 0, Monday) -> "Pzt 14:05". */
  public static String gameClock(long minutes) {
    String[] days = {"Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"};
    long day = (minutes / 1440) % 7;
    long m = minutes % 1440;
    return String.format(TR, "%s %02d:%02d", days[(int) day], m / 60, m % 60);
  }

  /** Duration in game minutes -> "3 sa 20 dk". */
  public static String duration(long minutes) {
    if (minutes < 0) return "süresi doldu";
    long d = minutes / 1440, h = (minutes % 1440) / 60, m = minutes % 60;
    if (d > 0) return d + " g " + h + " sa";
    if (h > 0) return h + " sa " + m + " dk";
    return m + " dk";
  }
}
