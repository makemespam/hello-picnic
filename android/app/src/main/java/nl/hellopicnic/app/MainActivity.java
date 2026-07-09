package nl.hellopicnic.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int CAMERA_PERMISSION_REQUEST = 1001;

    // The scan flow (src/app/(shell)/meer/scannen) uses a plain
    // <input type="file" capture="environment">, not the @capacitor/camera plugin. Once
    // android.permission.CAMERA is declared in AndroidManifest.xml (required for the
    // WebView's file-chooser to offer a camera-capture option at all), the WebView
    // refuses to show that option until the app also holds the *runtime* grant — so it
    // is requested eagerly here instead of leaving the family stuck with only "kies
    // bestand" and no visible reason why (deploy/ANDROID.md "Camera-toestemming").
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.CAMERA }, CAMERA_PERMISSION_REQUEST);
        }
    }
}
