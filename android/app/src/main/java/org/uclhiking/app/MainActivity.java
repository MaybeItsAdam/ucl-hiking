package org.uclhiking.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins have to be registered before the bridge starts.
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
