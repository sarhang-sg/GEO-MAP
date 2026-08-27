
package com.navkurd.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "NavKurdNative")
public class NavKurdNativePlugin extends Plugin {
    private long sizeOf(File file) {
        if (file == null || !file.exists()) return 0L;
        if (file.isFile()) return file.length();
        long total = 0L;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) total += sizeOf(child);
        return total;
    }
    private void deleteChildren(File directory) {
        if (directory == null || !directory.exists()) return;
        File[] children = directory.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.isDirectory()) deleteChildren(child);
            child.delete();
        }
    }
    @PluginMethod
    public void cacheStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("memoryBytes", 0);
        result.put("diskBytes", sizeOf(getContext().getCacheDir()) + sizeOf(getContext().getCodeCacheDir()));
        call.resolve(result);
    }
    @PluginMethod
    public void clearTransientCache(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getBridge().getWebView().clearCache(false);
            deleteChildren(getContext().getCacheDir());
            deleteChildren(getContext().getCodeCacheDir());
            JSObject result = new JSObject(); result.put("cleared", true); call.resolve(result);
        });
    }
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getContext().startActivity(intent); call.resolve();
    }
    @PluginMethod
    public void showError(PluginCall call) {
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle(call.getString("title", "NAV KURD"))
            .setMessage(call.getString("message", "The map could not be opened."))
            .setPositiveButton(call.getString("retryLabel", "Retry"), (dialog, which) -> getBridge().getWebView().reload())
            .setNegativeButton(call.getString("settingsLabel", "Settings"), (dialog, which) -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                getContext().startActivity(intent);
            }).setOnDismissListener(dialog -> call.resolve()).show());
    }
    @PluginMethod
    public void safeAreaInsets(PluginCall call) {
        View view = getBridge().getWebView();
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(view);
        Insets safe = insets == null ? Insets.NONE : insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        float density = getContext().getResources().getDisplayMetrics().density;
        JSObject result = new JSObject();
        result.put("top", safe.top / density); result.put("right", safe.right / density);
        result.put("bottom", safe.bottom / density); result.put("left", safe.left / density);
        call.resolve(result);
    }
}
