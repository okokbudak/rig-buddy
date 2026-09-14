// Builds a small MapLibre spritesheet containing only the icons the head-unit
// style uses (the full sheet is ~21 MB of GPU texture).
// usage: java SpriteSubset.java <sprites.json> <sprites.png> <outDir> name1 name2 ...
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SpriteSubset {
  record Entry(String name, int x, int y, int w, int h, int ratio) {}

  static int field(String body, String key) {
    Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*(\\d+)").matcher(body);
    if (!m.find()) throw new IllegalStateException("missing " + key + " in " + body);
    return Integer.parseInt(m.group(1));
  }

  public static void main(String[] args) throws Exception {
    String json = Files.readString(Path.of(args[0]));
    BufferedImage sheet = ImageIO.read(new File(args[1]));
    Path outDir = Path.of(args[2]);
    Files.createDirectories(outDir);

    Pattern block = Pattern.compile("\"([^\"]+)\"\\s*:\\s*\\{([^}]*)\\}");
    Map<String, Entry> all = new LinkedHashMap<>();
    Matcher m = block.matcher(json);
    while (m.find()) {
      String body = m.group(2);
      all.put(m.group(1), new Entry(m.group(1), field(body, "x"), field(body, "y"),
          field(body, "width"), field(body, "height"), field(body, "pixelRatio")));
    }
    if (all.isEmpty()) throw new IllegalStateException("could not parse sprite json (unexpected key order?)");

    List<Entry> picked = new ArrayList<>();
    for (int i = 3; i < args.length; i++) {
      Entry e = all.get(args[i]);
      if (e == null) System.err.println("missing sprite: " + args[i]);
      else picked.add(e);
    }

    // simple shelf packing, 512px wide
    int width = 512, x = 0, y = 0, rowH = 0;
    List<int[]> pos = new ArrayList<>();
    for (Entry e : picked) {
      if (x + e.w > width) { x = 0; y += rowH + 1; rowH = 0; }
      pos.add(new int[] {x, y});
      x += e.w + 1;
      rowH = Math.max(rowH, e.h);
    }
    int height = y + rowH;
    BufferedImage out = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    StringBuilder sb = new StringBuilder("{\n");
    for (int i = 0; i < picked.size(); i++) {
      Entry e = picked.get(i);
      int[] q = pos.get(i);
      out.getGraphics().drawImage(sheet.getSubimage(e.x, e.y, e.w, e.h), q[0], q[1], null);
      sb.append(String.format("  \"%s\": {\"x\": %d, \"y\": %d, \"width\": %d, \"height\": %d, \"pixelRatio\": %d}%s\n",
          e.name, q[0], q[1], e.w, e.h, e.ratio, i < picked.size() - 1 ? "," : ""));
    }
    sb.append("}\n");
    for (String suffix : new String[] {"", "@2x"}) {
      ImageIO.write(out, "png", outDir.resolve("sprites" + suffix + ".png").toFile());
      Files.writeString(outDir.resolve("sprites" + suffix + ".json"), sb.toString());
    }
    System.out.printf("wrote %d sprites, sheet %dx%d%n", picked.size(), width, height);
  }
}
