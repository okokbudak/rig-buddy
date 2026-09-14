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

import tr.ets2nav.R;

import java.text.NumberFormat;
import java.util.Locale;

/** Small helpers for the programmatic, car-style screens (light or dark theme). */
public final class Ui {
  private Ui() {}

  // Palette of the current theme; set by applyTheme() before any screen is built.
  public static int BG, CARD, CARD_PRESSED, TEXT, TEXT2, ACCENT, ON_ACCENT;
  public static int GREEN, GREEN_BG, YELLOW, RED, PURPLE, TRACK;
  public static boolean dark;

  static {
    applyTheme(true);
  }

  public static void applyTheme(boolean darkTheme) {
    dark = darkTheme;
    if (darkTheme) {
      BG = 0xff121518;
      CARD = 0xff1d2228;
      CARD_PRESSED = 0xff2a3139;
      TEXT = 0xffe8eaed;
      TEXT2 = 0xff9aa0a6;
      ACCENT = 0xff8ab4f8;
      ON_ACCENT = 0xff101316;
      GREEN = 0xff81c995;
      GREEN_BG = 0xff1e3a2b;
      YELLOW = 0xfffdd663;
      RED = 0xfff28b82;
      PURPLE = 0xffc58af9;
      TRACK = 0xff2e353d;
    } else {
      BG = 0xfff1f3f4;
      CARD = 0xffffffff;
      CARD_PRESSED = 0xffe8eaed;
      TEXT = 0xff202124;
      TEXT2 = 0xff5f6368;
      ACCENT = 0xff1a73e8;
      ON_ACCENT = 0xffffffff;
      GREEN = 0xff188038;
      GREEN_BG = 0xffe6f4ea;
      YELLOW = 0xffb06000;
      RED = 0xffd93025;
      PURPLE = 0xff9334e6;
      TRACK = 0xffdadce0;
    }
  }

  /** Theme setting: "system" (default), "light" or "dark". */
  public static String themeSetting(android.content.SharedPreferences prefs) {
    return prefs.getString("theme", "system");
  }

  /**
   * Resolves the setting against the device. Android before 10 has no system
   * dark mode; those (mostly head units) get the dark, car-style theme.
   */
  public static boolean resolveDark(Context c, String setting) {
    if ("light".equals(setting)) return false;
    if ("dark".equals(setting)) return true;
    if (android.os.Build.VERSION.SDK_INT < 29) return true;
    int night = c.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
    return night != android.content.res.Configuration.UI_MODE_NIGHT_NO;
  }

  /** Resources and locale of the current (possibly in-app overridden) language; set by init(). */
  public static android.content.res.Resources res;
  public static Locale LOCALE = Locale.getDefault();

  public static void init(Context c) {
    res = c.getResources();
    LOCALE = res.getConfiguration().locale;
  }

  public static String s(int id) {
    return res.getString(id);
  }

  public static String s(int id, Object... args) {
    return res.getString(id, args);
  }

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
    NumberFormat f = NumberFormat.getIntegerInstance(LOCALE);
    return f.format(Math.round(v)) + " " + currency;
  }

  public static String number(double v) {
    return NumberFormat.getIntegerInstance(LOCALE).format(Math.round(v));
  }

  /** Game minutes (since day 0, Monday) -> "Mon 14:05". */
  public static String gameClock(long minutes) {
    String[] days = s(R.string.days_short).split(",");
    long day = (minutes / 1440) % 7;
    long m = minutes % 1440;
    return String.format(LOCALE, "%s %02d:%02d", days[(int) day], m / 60, m % 60);
  }

  /** Duration in game minutes -> "3 h 20 min". */
  public static String duration(long minutes) {
    if (minutes < 0) return s(R.string.dur_expired);
    long d = minutes / 1440, h = (minutes % 1440) / 60, m = minutes % 60;
    if (d > 0) return s(R.string.dur_d_h, (int) d, (int) h);
    if (h > 0) return s(R.string.dur_h_min, (int) h, (int) m);
    return s(R.string.dur_min, (int) m);
  }
}
