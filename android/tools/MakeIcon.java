// Renders the launcher icon (blue disc, white navigation chevron) as PNGs.
// usage: java MakeIcon.java <res dir>
import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.image.BufferedImage;
import java.io.File;

public class MakeIcon {
  public static void main(String[] args) throws Exception {
    String[][] sizes = {{"mdpi", "48"}, {"hdpi", "72"}, {"xhdpi", "96"}, {"xxhdpi", "144"}, {"xxxhdpi", "192"}};
    for (String[] s : sizes) {
      int n = Integer.parseInt(s[1]);
      BufferedImage img = new BufferedImage(n, n, BufferedImage.TYPE_INT_ARGB);
      Graphics2D g = img.createGraphics();
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      double k = n / 100.0;
      g.setColor(new Color(0x1a73e8));
      g.fill(new Ellipse2D.Double(4 * k, 4 * k, 92 * k, 92 * k));
      Path2D p = new Path2D.Double();
      p.moveTo(50 * k, 18 * k);
      p.lineTo(76 * k, 80 * k);
      p.lineTo(50 * k, 66 * k);
      p.lineTo(24 * k, 80 * k);
      p.closePath();
      g.setColor(Color.WHITE);
      g.fill(p);
      g.setStroke(new BasicStroke((float) (2 * k)));
      g.dispose();
      File dir = new File(args[0], "mipmap-" + s[0]);
      dir.mkdirs();
      ImageIO.write(img, "png", new File(dir, "ic_launcher.png"));
    }
    System.out.println("icons written");
  }
}
