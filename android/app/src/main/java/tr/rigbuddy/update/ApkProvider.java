package tr.rigbuddy.update;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Hands a downloaded update (cache/updates/RigBuddy-x.y.z.apk) to Android's package installer, read only, through the
 * one-time permission the install intent grants. Since Android 7 a file:// address cannot be given to another app; the
 * project has no AndroidX, so this is the few lines of FileProvider it needs.
 */
public final class ApkProvider extends ContentProvider {
  static final String AUTHORITY = "tr.rigbuddy.apk";
  static final String MIME = "application/vnd.android.package-archive";

  static File dir(Context c) {
    return new File(c.getCacheDir(), "updates");
  }

  static Uri uriFor(File f) {
    return Uri.parse("content://" + AUTHORITY + "/" + Uri.encode(f.getName()));
  }

  private File fileOf(Uri uri) throws FileNotFoundException {
    String name = uri.getLastPathSegment();
    // only an update file of ours, never a path: nothing else in the app's storage can be reached this way
    if (name == null || !name.matches("RigBuddy-[0-9.]+\\.apk")) throw new FileNotFoundException(String.valueOf(name));
    File f = new File(dir(getContext()), name);
    if (!f.isFile()) throw new FileNotFoundException(name);
    return f;
  }

  @Override
  public boolean onCreate() {
    return true;
  }

  @Override
  public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    if (!"r".equals(mode)) throw new SecurityException("read only");
    return ParcelFileDescriptor.open(fileOf(uri), ParcelFileDescriptor.MODE_READ_ONLY);
  }

  @Override
  public String getType(Uri uri) {
    return MIME;
  }

  /** The installer may ask for the name and size (OpenableColumns). */
  @Override
  public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
    File f;
    try {
      f = fileOf(uri);
    } catch (FileNotFoundException e) {
      return null;
    }
    MatrixCursor c = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
    c.addRow(new Object[] {f.getName(), f.length()});
    return c;
  }

  @Override
  public Uri insert(Uri uri, ContentValues values) {
    throw new UnsupportedOperationException();
  }

  @Override
  public int delete(Uri uri, String selection, String[] selectionArgs) {
    throw new UnsupportedOperationException();
  }

  @Override
  public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
    throw new UnsupportedOperationException();
  }
}
