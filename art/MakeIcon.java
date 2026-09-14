// Renders the Rig Buddy icon (a friendly truck cab: headlight eyes, grille
// smile, route arrow in the windshield) from one drawing, same as rigbuddy.svg:
//   - Android launcher PNGs:  <repo>/android/app/src/main/res/mipmap-*/ic_launcher.png
//   - Windows icon:           <repo>/pc/host/rigbuddy.ico (16..256 px, PNG entries)
// usage (from the repo root): java art/MakeIcon.java
import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

public class MakeIcon {
  static final Color BLUE = new Color(0x185FA5);
  static final Color AMBER = new Color(0xEF9F27);
  static final Color NAVY = new Color(0x042C53);

  /** Draws the icon into an n x n image; all coordinates are in a 100 x 100 box. */
  static BufferedImage render(int n) {
    BufferedImage img = new BufferedImage(n, n, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g = img.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
    g.scale(n / 100.0, n / 100.0);

    g.setColor(BLUE); // background tile
    g.fill(new RoundRectangle2D.Double(2, 2, 96, 96, 44, 44));

    Path2D cab = new Path2D.Double();
    cab.moveTo(20, 82);
    cab.lineTo(20, 38);
    cab.quadTo(20, 22, 36, 20);
    cab.lineTo(64, 20);
    cab.quadTo(80, 22, 80, 38);
    cab.lineTo(80, 82);
    cab.closePath();
    g.setColor(AMBER);
    g.fill(cab);

    Path2D windshield = new Path2D.Double();
    windshield.moveTo(28, 44);
    windshield.quadTo(28, 30, 40, 29);
    windshield.lineTo(60, 29);
    windshield.quadTo(72, 30, 72, 44);
    windshield.lineTo(72, 48);
    windshield.lineTo(28, 48);
    windshield.closePath();
    g.setColor(NAVY);
    g.fill(windshield);

    Path2D arrow = new Path2D.Double();
    arrow.moveTo(50, 32);
    arrow.lineTo(57, 45);
    arrow.lineTo(50, 41.5);
    arrow.lineTo(43, 45);
    arrow.closePath();
    g.setColor(Color.WHITE);
    g.fill(arrow);

    g.fill(new Ellipse2D.Double(27, 54, 12, 12)); // headlight eyes
    g.fill(new Ellipse2D.Double(61, 54, 12, 12));
    g.setColor(NAVY);
    g.fill(new Ellipse2D.Double(31.5, 58.5, 5, 5));
    g.fill(new Ellipse2D.Double(63.5, 58.5, 5, 5));

    Path2D smile = new Path2D.Double();
    smile.moveTo(38, 70);
    smile.quadTo(50, 79, 62, 70);
    // thicker at tiny sizes so the smile survives downscaling
    g.setStroke(new BasicStroke(n < 40 ? 4.5f : 3.5f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
    g.draw(smile);

    g.dispose();
    return img;
  }

  static byte[] png(BufferedImage img) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    ImageIO.write(img, "png", out);
    return out.toByteArray();
  }

  static void le16(DataOutputStream o, int v) throws Exception { o.write(v & 0xff); o.write((v >> 8) & 0xff); }
  static void le32(DataOutputStream o, int v) throws Exception { le16(o, v & 0xffff); le16(o, (v >>> 16) & 0xffff); }

  public static void main(String[] args) throws Exception {
    File root = new File(args.length > 0 ? args[0] : ".");

    String[][] densities = {{"mdpi", "48"}, {"hdpi", "72"}, {"xhdpi", "96"}, {"xxhdpi", "144"}, {"xxxhdpi", "192"}};
    for (String[] d : densities) {
      File dir = new File(root, "android/app/src/main/res/mipmap-" + d[0]);
      dir.mkdirs();
      ImageIO.write(render(Integer.parseInt(d[1])), "png", new File(dir, "ic_launcher.png"));
    }

    int[] sizes = {16, 24, 32, 48, 64, 256};
    List<byte[]> images = new ArrayList<>();
    for (int s : sizes) images.add(png(render(s)));
    try (DataOutputStream o = new DataOutputStream(new FileOutputStream(new File(root, "pc/host/rigbuddy.ico")))) {
      le16(o, 0); le16(o, 1); le16(o, sizes.length); // ICONDIR: reserved, type=icon, count
      int offset = 6 + 16 * sizes.length;
      for (int i = 0; i < sizes.length; i++) {
        o.write(sizes[i] % 256); o.write(sizes[i] % 256); // 256 is stored as 0
        o.write(0); o.write(0);                           // palette, reserved
        le16(o, 1); le16(o, 32);                          // planes, bpp
        le32(o, images.get(i).length); le32(o, offset);
        offset += images.get(i).length;
      }
      for (byte[] b : images) o.write(b);
    }
    System.out.println("icons written: android mipmaps + pc/host/rigbuddy.ico");
  }
}
