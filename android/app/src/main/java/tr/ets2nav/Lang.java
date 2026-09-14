package tr.ets2nav;

import android.content.SharedPreferences;

import java.util.Locale;

/**
 * In-app language choice. "system" (default) follows the device language;
 * Android then picks res/values-xx, English for unsupported languages.
 */
public final class Lang {
  private Lang() {}

  public static final String[] CODES = {"system", "tr", "en", "de", "ru", "pt", "es", "fr"};
  /** Language names in their own language (index 0, "system", comes from resources). */
  public static final String[] NAMES = {null, "Türkçe", "English", "Deutsch", "Русский", "Português", "Español", "Français"};

  public static String setting(SharedPreferences prefs) {
    return prefs.getString("lang", "system");
  }

  /** The locale to force, or null to follow the device. */
  public static Locale locale(SharedPreferences prefs) {
    String code = setting(prefs);
    return "system".equals(code) ? null : new Locale(code);
  }
}
