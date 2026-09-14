package tr.ets2nav.agent;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Finds the PC running Rig Buddy on the local network: broadcasts "RIGBUDDY?"
 * on UDP 62846 and takes the first "RIGBUDDY &lt;name&gt;" reply (pc/host
 * Discovery.cs). The callback runs on the main thread.
 */
public final class PcFinder {
  private static final String TAG = "PcFinder";
  private static final int PORT = 62846;
  private static final int WAIT_MS = 2000;

  public interface Callback {
    /** host is null when nothing answered. */
    void onResult(String host, String name);
  }

  private PcFinder() {}

  public static void find(Callback cb) {
    Handler main = new Handler(Looper.getMainLooper());
    new Thread(() -> {
      String host = null, name = null;
      try (DatagramSocket s = new DatagramSocket()) {
        s.setBroadcast(true);
        s.setSoTimeout(300);
        byte[] ask = "RIGBUDDY?".getBytes(StandardCharsets.UTF_8);
        long deadline = System.currentTimeMillis() + WAIT_MS;
        long nextSend = 0;
        byte[] buf = new byte[256];
        while (host == null && System.currentTimeMillis() < deadline) {
          if (System.currentTimeMillis() >= nextSend) { // resend: UDP may drop the first one
            for (InetAddress a : broadcastAddresses()) {
              try {
                s.send(new DatagramPacket(ask, ask.length, a, PORT));
              } catch (Exception e) {
                Log.d(TAG, "send to " + a + " failed: " + e);
              }
            }
            nextSend = System.currentTimeMillis() + 700;
          }
          try {
            DatagramPacket p = new DatagramPacket(buf, buf.length);
            s.receive(p);
            String msg = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8).trim();
            if (msg.startsWith("RIGBUDDY ")) {
              host = p.getAddress().getHostAddress();
              name = msg.substring("RIGBUDDY ".length());
            }
          } catch (SocketTimeoutException ignored) {
          }
        }
      } catch (Exception e) {
        Log.w(TAG, "discovery failed", e);
      }
      final String h = host, n = name;
      Log.i(TAG, "discovery: " + (h != null ? h + " (" + n + ")" : "no answer"));
      main.post(() -> cb.onResult(h, n));
    }, "pc-finder").start();
  }

  /** The global broadcast address plus each IPv4 interface's subnet broadcast. */
  private static Set<InetAddress> broadcastAddresses() throws Exception {
    Set<InetAddress> out = new LinkedHashSet<>();
    out.add(InetAddress.getByName("255.255.255.255"));
    for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
      if (!ni.isUp() || ni.isLoopback()) continue;
      for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
        if (ia.getBroadcast() != null) out.add(ia.getBroadcast());
      }
    }
    return out;
  }
}
