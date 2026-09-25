package org.uclhiking.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.Locale;

/**
 * Edge to edge: the page draws behind the status and navigation bars, the way
 * a native app does, rather than inside a letterbox Android paints around it.
 *
 * The page then has to know how big the bars are. env(safe-area-inset-*) is
 * 0 in most Android WebViews, so the sizes are handed over as CSS custom
 * properties (--android-inset-top/right/bottom/left) on the root element —
 * as a document-start script, so the first paint already has them, and again
 * whenever they change (rotation, the keyboard, a different nav mode).
 *
 * The page tells us whether it is showing its light or dark theme, so the
 * bar icons stay legible over it (setStyle).
 */
@CapacitorPlugin(name = "HikingSystemBars")
public class SystemBarsPlugin extends Plugin {

    private String publishedInsets = null;
    private ScriptHandler insetsAtDocumentStart = null;

    @Override
    public void load() {
        Window window = getActivity().getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        // Ignored from Android 15, where the bars are always transparent.
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Otherwise three-button navigation gets a translucent scrim behind it.
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        // Until the page says which theme it is in, follow the phone's.
        int night = getContext().getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        applyStyle(night == Configuration.UI_MODE_NIGHT_YES);

        WebView webView = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
            int keyboardHeight = keyboard ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;

            // Edge to edge turns off the window resizing for the keyboard, so the
            // WebView makes room for it itself — otherwise a focused field ends up
            // underneath it.
            ViewGroup.MarginLayoutParams layout = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            if (layout.bottomMargin != keyboardHeight) {
                layout.bottomMargin = keyboardHeight;
                view.setLayoutParams(layout);
            }

            float density = view.getResources().getDisplayMetrics().density;
            publishInsets(
                bars.top / density,
                bars.right / density,
                // The keyboard covers the navigation bar, so there is nothing to clear.
                keyboard ? 0 : bars.bottom / density,
                bars.left / density
            );
            // Handled here: letting them through as well would have newer WebViews
            // make room for the keyboard a second time.
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(webView);

        // Belt and braces for WebViews too old for document-start scripts.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                if (publishedInsets != null) view.evaluateJavascript(publishedInsets, null);
            }
        });
    }

    /** Light icons over the dark theme, dark icons over the light one. */
    @PluginMethod
    public void setStyle(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> {
            applyStyle(dark);
            call.resolve();
        });
    }

    private void applyStyle(boolean dark) {
        Window window = getActivity().getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    private void publishInsets(float top, float right, float bottom, float left) {
        String script = String.format(
            Locale.ROOT,
            "(function(s){s.setProperty('--android-inset-top','%.2fpx');s.setProperty('--android-inset-right','%.2fpx');" +
            "s.setProperty('--android-inset-bottom','%.2fpx');s.setProperty('--android-inset-left','%.2fpx');})(document.documentElement.style);",
            top, right, bottom, left
        );
        if (script.equals(publishedInsets)) return;
        publishedInsets = script;

        WebView webView = getBridge().getWebView();
        webView.evaluateJavascript(script, null);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            if (insetsAtDocumentStart != null) insetsAtDocumentStart.remove();
            insetsAtDocumentStart = WebViewCompat.addDocumentStartJavaScript(webView, script, Collections.singleton("*"));
        }
    }
}
