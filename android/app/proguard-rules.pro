# MapLibre native code calls back into these via JNI.
-keep class com.mapbox.** { *; }
-keep class org.maplibre.** { *; }
-dontwarn com.mapbox.**
-dontwarn okhttp3.**
-dontwarn okio.**
