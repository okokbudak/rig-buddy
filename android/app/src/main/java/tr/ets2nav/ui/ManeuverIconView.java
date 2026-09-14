package tr.ets2nav.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

import tr.ets2nav.nav.Route;

/**
 * Draws Google-Maps-style maneuver arrows for navigation-server BranchTypes,
 * in a 100x100 design space scaled to the view.
 */
public final class ManeuverIconView extends View {
  private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint faint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint hole = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path path = new Path();
  private final RectF oval = new RectF();
  private int direction = Route.THROUGH;

  public ManeuverIconView(Context context, AttributeSet attrs) {
    super(context, attrs);
    for (Paint p : new Paint[] {stroke, faint}) {
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeCap(Paint.Cap.ROUND);
      p.setStrokeJoin(Paint.Join.ROUND);
    }
    fill.setStyle(Paint.Style.FILL);
    hole.setColor(0x55000000);
    setColor(0xffffffff);
  }

  public void setColor(int color) {
    stroke.setColor(color);
    fill.setColor(color);
    faint.setColor((color & 0x00ffffff) | 0x66000000);
    invalidate();
  }

  public void setDirection(int direction) {
    if (this.direction != direction) {
      this.direction = direction;
      invalidate();
    }
  }

  @Override
  protected void onDraw(Canvas canvas) {
    float s = Math.min(getWidth(), getHeight()) / 100f;
    canvas.save();
    canvas.translate((getWidth() - 100 * s) / 2, (getHeight() - 100 * s) / 2);
    canvas.scale(s, s);
    stroke.setStrokeWidth(11);
    faint.setStrokeWidth(11);
    switch (direction) {
      case Route.SLIGHT_LEFT: turn(canvas, -45); break;
      case Route.LEFT: turn(canvas, -90); break;
      case Route.SHARP_LEFT: turn(canvas, -135); break;
      case Route.SLIGHT_RIGHT: turn(canvas, 45); break;
      case Route.RIGHT: turn(canvas, 90); break;
      case Route.SHARP_RIGHT: turn(canvas, 135); break;
      case Route.U_TURN_LEFT: uTurn(canvas, true); break;
      case Route.U_TURN_RIGHT: uTurn(canvas, false); break;
      case Route.MERGE: merge(canvas); break;
      case Route.ARRIVE: pin(canvas); break;
      case Route.FERRY: ferry(canvas); break;
      default:
        if (direction >= Route.ROUND_BR && direction <= Route.ROUND_B) roundabout(canvas, direction);
        else turn(canvas, 0); // THROUGH, DEPART, ROUND_EXIT
    }
    canvas.restore();
  }

  /** Stem up from the bottom, then a leg at `deg` (0 = straight on, + = right). */
  private void turn(Canvas c, float deg) {
    float jx = 50, jy = deg == 0 ? 24 : Math.abs(deg) > 100 ? 42 : 52;
    path.reset();
    path.moveTo(50, 92);
    path.lineTo(jx, jy);
    float ex = jx, ey = jy;
    if (deg != 0) {
      double r = Math.toRadians(deg);
      ex = (float) (jx + Math.sin(r) * 30);
      ey = (float) (jy - Math.cos(r) * 30);
      path.lineTo(ex, ey);
    }
    c.drawPath(path, stroke);
    arrowHead(c, ex, ey, deg);
  }

  private void uTurn(Canvas c, boolean left) {
    float from = left ? 64 : 36, to = left ? 36 : 64;
    oval.set(36, 22, 64, 50);
    path.reset();
    path.moveTo(from, 92);
    path.lineTo(from, 36);
    // over the top of the 28px circle to the other side
    path.arcTo(oval, left ? 0 : 180, left ? -180 : 180, false);
    path.lineTo(to, 58);
    c.drawPath(path, stroke);
    arrowHead(c, to, 60, 180);
  }

  private void merge(Canvas c) {
    path.reset();
    path.moveTo(30, 92);
    path.quadTo(30, 62, 50, 46);
    c.drawPath(path, faint);
    path.reset();
    path.moveTo(70, 92);
    path.quadTo(70, 62, 50, 46);
    path.lineTo(50, 26);
    c.drawPath(path, stroke);
    arrowHead(c, 50, 24, 0);
  }

  /** Right-hand traffic: enter from the bottom, go counter-clockwise, exit at `deg`. */
  private void roundabout(Canvas c, int dir) {
    float deg;
    switch (dir) {
      case Route.ROUND_BR: deg = 135; break;
      case Route.ROUND_R: deg = 90; break;
      case Route.ROUND_TR: deg = 45; break;
      case Route.ROUND_T: deg = 0; break;
      case Route.ROUND_TL: deg = -45; break;
      case Route.ROUND_L: deg = -90; break;
      case Route.ROUND_BL: deg = -135; break;
      default: deg = 180; break;
    }
    float cx = 50, cy = 48, r = 17;
    oval.set(cx - r, cy - r, cx + r, cy + r);
    c.drawOval(oval, faint);
    double a = Math.toRadians(deg);
    // Android arc angles: 0 = +x (right), 90 = +y (down); the entry point is at 90.
    float exitAngle = (float) Math.toDegrees(Math.atan2(-Math.cos(a), Math.sin(a)));
    float sweep = 90 - exitAngle;
    while (sweep <= 0) sweep += 360;
    while (sweep > 360) sweep -= 360;
    path.reset();
    path.moveTo(cx, 94);
    path.lineTo(cx, cy + r);
    path.arcTo(oval, 90, -sweep, false);
    float ex = (float) (cx + Math.sin(a) * (r + 20)), ey = (float) (cy - Math.cos(a) * (r + 20));
    path.lineTo(ex, ey);
    c.drawPath(path, stroke);
    arrowHead(c, ex, ey, deg);
  }

  private void pin(Canvas c) {
    oval.set(26, 12, 74, 60);
    path.reset();
    path.moveTo(50, 94);
    path.cubicTo(36, 74, 26, 56, 26, 36);
    path.arcTo(oval, 180, 180, false);
    path.cubicTo(74, 56, 64, 74, 50, 94);
    path.close();
    c.drawPath(path, fill);
    c.drawCircle(50, 36, 9, hole);
  }

  private void ferry(Canvas c) {
    path.reset();
    path.moveTo(18, 58);
    path.lineTo(82, 58);
    path.lineTo(72, 78);
    path.lineTo(28, 78);
    path.close();
    c.drawPath(path, fill);
    c.drawRect(38, 38, 62, 58, fill);
    c.drawRect(47, 26, 53, 38, fill);
    stroke.setStrokeWidth(5);
    path.reset();
    path.moveTo(14, 88);
    path.quadTo(24, 82, 34, 88);
    path.quadTo(44, 94, 54, 88);
    path.quadTo(64, 82, 74, 88);
    path.quadTo(80, 92, 86, 88);
    c.drawPath(path, stroke);
  }

  private void arrowHead(Canvas c, float x, float y, float deg) {
    double r = Math.toRadians(deg);
    float fx = (float) Math.sin(r), fy = (float) -Math.cos(r); // forward
    float px = -fy, py = fx;                                   // perpendicular
    path.reset();
    path.moveTo(x + fx * 14, y + fy * 14);
    path.lineTo(x - px * 15 - fx * 4, y - py * 15 - fy * 4);
    path.lineTo(x + px * 15 - fx * 4, y + py * 15 - fy * 4);
    path.close();
    c.drawPath(path, fill);
  }
}
