package tr.ets2nav.ui;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.util.AttributeSet;
import android.view.View;

/**
 * The navigation chevron. In follow mode it sits at the camera's focal point
 * as a plain overlay (the map rotates under it), so it costs the map nothing.
 */
public final class TruckArrowView extends View {
  private final Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint shadow = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path path = new Path();

  public TruckArrowView(Context context, AttributeSet attrs) {
    super(context, attrs);
    body.setColor(0xff1a73e8);
    border.setColor(0xffffffff);
    border.setStyle(Paint.Style.STROKE);
    border.setStrokeJoin(Paint.Join.ROUND);
    shadow.setColor(0x40000000);
  }

  @Override
  protected void onDraw(Canvas canvas) {
    draw(canvas, getWidth(), getHeight(), path, body, border, shadow);
  }

  /** Same chevron as a bitmap, for the map symbol used in free-pan mode. */
  public static Bitmap bitmap(int size) {
    Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
    Paint b = new Paint(Paint.ANTI_ALIAS_FLAG);
    b.setColor(0xff1a73e8);
    Paint o = new Paint(Paint.ANTI_ALIAS_FLAG);
    o.setColor(0xffffffff);
    o.setStyle(Paint.Style.STROKE);
    o.setStrokeJoin(Paint.Join.ROUND);
    Paint sh = new Paint(Paint.ANTI_ALIAS_FLAG);
    sh.setColor(0x40000000);
    draw(new Canvas(bmp), size, size, new Path(), b, o, sh);
    return bmp;
  }

  private static void draw(Canvas c, int w, int h, Path path, Paint body, Paint border, Paint shadow) {
    float s = Math.min(w, h) / 100f;
    c.save();
    c.translate((w - 100 * s) / 2, (h - 100 * s) / 2);
    c.scale(s, s);
    c.drawCircle(50, 54, 40, shadow);
    path.reset();
    path.moveTo(50, 10);
    path.lineTo(82, 86);
    path.lineTo(50, 70);
    path.lineTo(18, 86);
    path.close();
    border.setStrokeWidth(9);
    c.drawPath(path, border);
    c.drawPath(path, body);
    c.restore();
  }
}
