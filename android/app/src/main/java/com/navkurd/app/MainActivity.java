
package com.navkurd.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NavKurdNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
