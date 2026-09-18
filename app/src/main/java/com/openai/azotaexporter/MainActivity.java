package com.openai.azotaexporter;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public class MainActivity extends Activity {
    private static final String START_URL = "https://azota.vn";
    private static final String EXPORT_DIR = Environment.DIRECTORY_DOWNLOADS + "/AzotaExporter";

    private LinearLayout root;
    private EditText urlInput;
    private TextView status;
    private TextView detectedValue;
    private TextView extractedValue;
    private TextView missingValue;
    private ProgressBar scanProgress;
    private Button scanButton;
    private Button pdfButton;
    private Button docxButton;
    private WebView webView;
    private JSONObject extracted;
    private ExecutorService executor;
    private String scannerScript;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        executor = Executors.newSingleThreadExecutor();

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        setContentView(root);

        buildTopBar();
        buildStatus();
        buildWebView();
        buildBottomBar();
        scannerScript = readAsset("azota_scan.js");

        urlInput.setText(START_URL);
        webView.loadUrl(START_URL);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private Button makeButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(14);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackgroundResource(com.openai.azotaexporter.R.drawable.btn_bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48));
        lp.setMargins(dp(4), dp(4), dp(4), dp(4));
        b.setLayoutParams(lp);
        return b;
    }

    private Button makeSecondaryButton(String text) {
        Button b = makeButton(text);
        b.setTextColor(Color.rgb(42, 61, 105));
        b.setBackgroundResource(com.openai.azotaexporter.R.drawable.btn_secondary_bg);
        return b;
    }

    private void buildTopBar() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(10), dp(12), dp(4));

        TextView title = new TextView(this);
        title.setText("AZOTA EXTRACTOR");
        title.setTextSize(20);
        title.setTextColor(Color.rgb(28, 38, 61));
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        box.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Mở đề trong app • Quét câu đang được hiển thị • Xuất PDF / DOCX");
        subtitle.setTextSize(12);
        subtitle.setTextColor(Color.rgb(98, 108, 128));
        subtitle.setPadding(0, dp(2), 0, dp(8));
        box.addView(subtitle);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        urlInput = new EditText(this);
        urlInput.setSingleLine(true);
        urlInput.setTextSize(14);
        urlInput.setHint("Dán link đề Azota...");
        urlInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        urlInput.setBackgroundResource(com.openai.azotaexporter.R.drawable.url_bg);
        row.addView(urlInput, new LinearLayout.LayoutParams(0, dp(48), 1f));

        Button open = makeButton("Mở đề");
        open.setOnClickListener(v -> openEnteredUrl());
        row.addView(open);
        box.addView(row);
        root.addView(box);
    }

    private void buildStatus() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(8), dp(12), dp(8));
        card.setBackgroundResource(com.openai.azotaexporter.R.drawable.card_bg);
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardLp.setMargins(dp(12), dp(4), dp(12), dp(8));

        LinearLayout stats = new LinearLayout(this);
        stats.setOrientation(LinearLayout.HORIZONTAL);

        detectedValue = makeStatBlock(stats, "Đã phát hiện", "—");
        extractedValue = makeStatBlock(stats, "Đã trích", "0");
        missingValue = makeStatBlock(stats, "Còn thiếu", "—");
        card.addView(stats, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        scanProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        scanProgress.setMax(100);
        scanProgress.setProgress(0);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(6));
        pp.setMargins(0, dp(8), 0, dp(6));
        card.addView(scanProgress, pp);

        status = new TextView(this);
        status.setText("Mở đề trong ứng dụng, đăng nhập nếu cần, rồi bấm Quét đề.");
        status.setTextSize(12);
        status.setTextColor(Color.rgb(83, 94, 116));
        card.addView(status);
        root.addView(card, cardLp);
    }

    private TextView makeStatBlock(LinearLayout parent, String label, String initial) {
        LinearLayout cell = new LinearLayout(this);
        cell.setOrientation(LinearLayout.VERTICAL);
        cell.setGravity(Gravity.CENTER);
        TextView value = new TextView(this);
        value.setText(initial);
        value.setTextSize(18);
        value.setTextColor(Color.rgb(49, 94, 245));
        value.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        TextView caption = new TextView(this);
        caption.setText(label);
        caption.setTextSize(11);
        caption.setTextColor(Color.rgb(98, 108, 128));
        cell.addView(value);
        cell.addView(caption);
        parent.addView(cell, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        return value;
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void buildWebView() {
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new JsBridge(), "AzotaNative");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    String host = uri.getHost();
                    if (isAzotaHost(host)) return false;
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {}
                    return true;
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                urlInput.setText(url);
                status.setText("Trang đã tải. App đang theo dõi các câu khi bạn cuộn.");
                injectScanner();
            }
        });

        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    }

    private void buildBottomBar() {
        HorizontalScrollView hsv = new HorizontalScrollView(this);
        hsv.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(dp(8), dp(4), dp(8), dp(10));

        scanButton = makeButton("Quét đề");
        scanButton.setOnClickListener(v -> startScan());
        row.addView(scanButton);

        pdfButton = makeButton("Xuất PDF");
        pdfButton.setOnClickListener(v -> exportPdf());
        row.addView(pdfButton);

        docxButton = makeButton("Xuất DOCX");
        docxButton.setOnClickListener(v -> exportDocx());
        row.addView(docxButton);

        Button clear = makeSecondaryButton("Quét lại từ đầu");
        clear.setOnClickListener(v -> {
            extracted = null;
            extractedValue.setText("0");
            missingValue.setText("—");
            scanProgress.setProgress(0);
            status.setText("Đã xóa bản chụp xuất file. Tải lại trang nếu muốn xóa cả bộ nhớ quét trong WebView.");
            webView.evaluateJavascript("try{if(window.AZX_APP){window.AZX_APP.state.q={};window.AZX_APP.state.total=0;window.AZX_APP.scanVisible();}}catch(e){}", null);
        });
        row.addView(clear);

        hsv.addView(row);
        root.addView(hsv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(66)));
    }

    private boolean isAzotaHost(String host) {
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.equals("azota.vn") || host.endsWith(".azota.vn");
    }

    private void openEnteredUrl() {
        String raw = urlInput.getText().toString().trim();
        if (raw.isEmpty()) return;
        if (!raw.startsWith("http://") && !raw.startsWith("https://")) raw = "https://" + raw;
        try {
            Uri uri = Uri.parse(raw);
            if (!isAzotaHost(uri.getHost())) {
                Toast.makeText(this, "Ứng dụng này chỉ mở link thuộc azota.vn", Toast.LENGTH_LONG).show();
                return;
            }
            extracted = null;
            webView.loadUrl(raw);
        } catch (Exception e) {
            Toast.makeText(this, "Link không hợp lệ", Toast.LENGTH_SHORT).show();
        }
    }

    private void startScan() {
        Uri current = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
        if (!isAzotaHost(current.getHost())) {
            Toast.makeText(this, "Hãy mở trang đề Azota trước.", Toast.LENGTH_SHORT).show();
            return;
        }
        injectScanner();
        status.setText("Đang quét... app sẽ tự cuộn qua đề. Không đóng trang.");
        scanButton.setEnabled(false);
        scanProgress.setIndeterminate(true);
        webView.evaluateJavascript("try{window.AZX_APP.startScan()}catch(e){window.AzotaNative.onError(String(e))}", null);
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    private void injectScanner() {
        if (scannerScript == null || scannerScript.isEmpty()) scannerScript = readAsset("azota_scan.js");
        if (scannerScript == null || scannerScript.isEmpty()) {
            status.setText("Không đọc được bộ quét tích hợp trong app.");
            return;
        }
        webView.evaluateJavascript(scannerScript, null);
    }

    private void updateProgressUi(int count, int total, String missing, String message) {
        extractedValue.setText(String.valueOf(count));
        detectedValue.setText(total > 0 ? String.valueOf(total) : "—");
        missingValue.setText(missing == null || missing.isEmpty() ? (total > 0 && count >= total ? "0" : "—") : missing);
        if (total > 0) {
            scanProgress.setIndeterminate(false);
            scanProgress.setMax(total);
            scanProgress.setProgress(Math.min(count, total));
        }
        if (message != null && !message.isEmpty()) status.setText(message + " • " + count + (total > 0 ? "/" + total : "") + " câu");
    }

    private class JsBridge {
        @JavascriptInterface
        public void onProgress(final String json) {
            runOnUiThread(() -> {
                try {
                    JSONObject o = new JSONObject(json);
                    int count = o.optInt("count", 0);
                    int total = o.optInt("total", 0);
                    JSONArray missingArr = o.optJSONArray("missing");
                    StringBuilder missing = new StringBuilder();
                    if (missingArr != null) {
                        int limit = Math.min(missingArr.length(), 8);
                        for (int i = 0; i < limit; i++) {
                            if (i > 0) missing.append(",");
                            missing.append(missingArr.optInt(i));
                        }
                        if (missingArr.length() > limit) missing.append("…");
                    }
                    updateProgressUi(count, total, missing.toString(), o.optString("message", ""));
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public void onResult(final String json) {
            runOnUiThread(() -> {
                try {
                    extracted = new JSONObject(json);
                    JSONArray questions = extracted.optJSONArray("questions");
                    int count = questions == null ? 0 : questions.length();
                    int total = extracted.optInt("total", count);
                    JSONArray missingArr = extracted.optJSONArray("missing");
                    String missing = "";
                    if (missingArr != null && missingArr.length() > 0) {
                        StringBuilder sb = new StringBuilder();
                        int limit = Math.min(missingArr.length(), 8);
                        for (int i = 0; i < limit; i++) { if (i > 0) sb.append(","); sb.append(missingArr.optInt(i)); }
                        if (missingArr.length() > limit) sb.append("…");
                        missing = sb.toString();
                    }
                    updateProgressUi(count, total, missing, missing.isEmpty() ? "Quét xong" : "Quét xong nhưng còn thiếu: " + missing);
                    scanButton.setEnabled(true);
                    scanProgress.setIndeterminate(false);
                    Toast.makeText(MainActivity.this, "Đã quét " + count + (total > 0 ? "/" + total : "") + " câu", Toast.LENGTH_SHORT).show();
                } catch (JSONException e) {
                    scanButton.setEnabled(true);
                    scanProgress.setIndeterminate(false);
                    status.setText("Không đọc được dữ liệu quét. Hãy thử Quét lại.");
                }
            });
        }

        @JavascriptInterface
        public void onError(final String message) {
            runOnUiThread(() -> {
                scanButton.setEnabled(true);
                scanProgress.setIndeterminate(false);
                status.setText("Lỗi quét: " + message);
                Toast.makeText(MainActivity.this, "Lỗi quét: " + message, Toast.LENGTH_LONG).show();
            });
        }
    }

    private boolean hasExtracted() {
        JSONArray q = extracted == null ? null : extracted.optJSONArray("questions");
        if (q == null || q.length() == 0) {
            Toast.makeText(this, "Chưa có dữ liệu. Hãy bấm Quét đề trước.", Toast.LENGTH_SHORT).show();
            return false;
        }
        return true;
    }

    private String timestamp() {
        return new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
    }

    private String safeTitle() {
        String t = extracted == null ? "De_Azota" : extracted.optString("title", "De_Azota");
        t = t.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (t.length() > 60) t = t.substring(0, 60);
        return t.isEmpty() ? "De_Azota" : t;
    }

    private Uri createDownload(String fileName, String mime) {
        ContentValues v = new ContentValues();
        v.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
        v.put(MediaStore.Downloads.MIME_TYPE, mime);
        v.put(MediaStore.Downloads.RELATIVE_PATH, EXPORT_DIR);
        v.put(MediaStore.Downloads.IS_PENDING, 1);
        return getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
    }

    private void finishDownload(Uri uri) {
        if (uri == null) return;
        ContentValues v = new ContentValues();
        v.put(MediaStore.Downloads.IS_PENDING, 0);
        getContentResolver().update(uri, v, null, null);
    }

    private void failDownload(Uri uri) {
        if (uri != null) getContentResolver().delete(uri, null, null);
    }

    private void exportPdf() {
        if (!hasExtracted()) return;
        status.setText("Đang tạo PDF...");
        final String html = buildExportHtml();
        final WebView printWeb = new WebView(this);
        printWeb.setVisibility(View.INVISIBLE);
        printWeb.getSettings().setJavaScriptEnabled(true);
        printWeb.getSettings().setDomStorageEnabled(true);
        printWeb.getSettings().setLoadsImagesAutomatically(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(printWeb, true);
        root.addView(printWeb, new LinearLayout.LayoutParams(1, 1));

        printWeb.setWebViewClient(new WebViewClient() {
            private boolean started = false;
            @Override
            public void onPageFinished(WebView view, String url) {
                if (started) return;
                started = true;
                view.postDelayed(() -> writePdfFromWebView(printWeb), 1800);
            }
        });
        String base = extracted.optString("url", START_URL);
        printWeb.loadDataWithBaseURL(base, html, "text/html", "UTF-8", null);
    }

    private String buildExportHtml() {
        StringBuilder css = new StringBuilder();
        JSONArray styles = extracted.optJSONArray("styles");
        if (styles != null) {
            for (int i = 0; i < styles.length(); i++) {
                String href = styles.optString(i, "");
                if (!href.isEmpty()) css.append("<link rel=\"stylesheet\" href=\"").append(htmlEscape(href)).append("\">\n");
            }
        }
        StringBuilder body = new StringBuilder();
        JSONArray qs = extracted.optJSONArray("questions");
        for (int i = 0; qs != null && i < qs.length(); i++) {
            JSONObject q = qs.optJSONObject(i);
            if (q == null) continue;
            body.append("<section class=\"azx-question\">").append(q.optString("html", "")).append("</section>\n");
        }
        return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                css + "<style>@page{size:A4;margin:13mm}html,body{background:#fff!important;color:#111!important}body{font-family:Arial,'Times New Roman',sans-serif;line-height:1.5}main{max-width:900px;margin:auto}.azx-title{text-align:center;font-weight:700;font-size:20px;margin:0 0 14px}.azx-question{break-inside:avoid;page-break-inside:avoid;margin:0 0 16px;padding:10px 12px;border:1px solid #ddd;border-radius:8px;background:#fff!important}img,svg,mjx-container{max-width:100%!important;height:auto!important}button,input,textarea,select{display:none!important}</style></head><body><main><div class=\"azx-title\">" +
                htmlEscape(extracted.optString("title", "Đề Azota")) + "</div>" + body + "</main></body></html>";
    }


    private void writePdfFromWebView(WebView printWeb) {
        String name = safeTitle() + "_" + timestamp() + ".pdf";
        Uri uri = createDownload(name, "application/pdf");

        if (uri == null) {
            status.setText("Không tạo được file PDF.");
            root.removeView(printWeb);
            printWeb.destroy();
            return;
        }

        android.graphics.pdf.PdfDocument document =
                new android.graphics.pdf.PdfDocument();

        try {
            final int pageWidth = 595;
            final int pageHeight = 842;
            final int margin = 28;

            int viewWidth = printWeb.getWidth();
            if (viewWidth <= 0) {
                viewWidth = Math.max(1080, root.getWidth());
                int widthSpec = View.MeasureSpec.makeMeasureSpec(
                        viewWidth, View.MeasureSpec.EXACTLY);
                int heightSpec = View.MeasureSpec.makeMeasureSpec(
                        1, View.MeasureSpec.UNSPECIFIED);

                printWeb.measure(widthSpec, heightSpec);
                printWeb.layout(
                        0,
                        0,
                        viewWidth,
                        Math.max(printWeb.getMeasuredHeight(), 1)
                );
            }

            float webScale = printWeb.getScale();
            if (webScale <= 0f) webScale = 1f;

            int contentHeight = Math.max(
                    printWeb.getHeight(),
                    Math.round(printWeb.getContentHeight() * webScale)
            );

            float pdfScale =
                    (pageWidth - 2f * margin) / (float) viewWidth;

            int sliceHeight = Math.max(
                    1,
                    (int) ((pageHeight - 2f * margin) / pdfScale)
            );

            int pageCount = Math.max(
                    1,
                    (int) Math.ceil(contentHeight / (double) sliceHeight)
            );

            for (int i = 0; i < pageCount; i++) {
                android.graphics.pdf.PdfDocument.PageInfo pageInfo =
                        new android.graphics.pdf.PdfDocument.PageInfo.Builder(
                                pageWidth,
                                pageHeight,
                                i + 1
                        ).create();

                android.graphics.pdf.PdfDocument.Page page =
                        document.startPage(pageInfo);

                android.graphics.Canvas canvas = page.getCanvas();

                canvas.drawColor(Color.WHITE);
                canvas.save();

                canvas.translate(margin, margin);
                canvas.scale(pdfScale, pdfScale);

                canvas.clipRect(
                        0,
                        0,
                        viewWidth,
                        sliceHeight
                );

                canvas.translate(
                        0,
                        -(i * sliceHeight)
                );

                printWeb.draw(canvas);

                canvas.restore();
                document.finishPage(page);
            }

            try (OutputStream out =
                         getContentResolver().openOutputStream(uri)) {

                if (out == null) {
                    throw new Exception("Không mở được file PDF đầu ra");
                }

                document.writeTo(out);
                out.flush();
            }

            finishDownload(uri);

            status.setText(
                    "Đã lưu PDF vào Download/AzotaExporter"
            );

            Toast.makeText(
                    this,
                    "Đã xuất PDF: " + name,
                    Toast.LENGTH_LONG
            ).show();

        } catch (Exception e) {
            failDownload(uri);

            status.setText(
                    "Xuất PDF thất bại: " + e.getMessage()
            );

            Toast.makeText(
                    this,
                    "Xuất PDF thất bại: " + e.getMessage(),
                    Toast.LENGTH_LONG
            ).show();

        } finally {
            try {
                document.close();
            } catch (Exception ignored) {}

            try {
                root.removeView(printWeb);
            } catch (Exception ignored) {}

            try {
                printWeb.destroy();
            } catch (Exception ignored) {}
        }
    }


    private void exportDocx() {
        if (!hasExtracted()) return;
        status.setText("Đang tạo DOCX... hình ảnh có thể mất vài giây.");
        final JSONObject snapshot;
        try {
            snapshot = new JSONObject(extracted.toString());
        } catch (JSONException e) {
            Toast.makeText(this, "Không đọc được dữ liệu quét", Toast.LENGTH_SHORT).show();
            return;
        }

        executor.submit(() -> {
            String name = safeTitle() + "_" + timestamp() + ".docx";
            Uri uri = createDownload(name, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            if (uri == null) {
                runOnUiThread(() -> status.setText("Không tạo được file DOCX."));
                return;
            }
            try (OutputStream raw = getContentResolver().openOutputStream(uri); ZipOutputStream zos = new ZipOutputStream(raw)) {
                List<DocQuestion> questions = buildDocQuestions(snapshot);
                writeDocx(zos, snapshot.optString("title", "Đề Azota"), questions);
                zos.finish();
                finishDownload(uri);
                runOnUiThread(() -> {
                    status.setText("Đã lưu DOCX vào Download/AzotaExporter");
                    Toast.makeText(MainActivity.this, "Đã xuất DOCX", Toast.LENGTH_LONG).show();
                });
            } catch (Exception e) {
                failDownload(uri);
                runOnUiThread(() -> status.setText("Lỗi DOCX: " + e.getMessage()));
            }
        });
    }

    private List<DocQuestion> buildDocQuestions(JSONObject data) {
        List<DocQuestion> out = new ArrayList<>();
        JSONArray qs = data.optJSONArray("questions");
        Set<String> downloaded = new HashSet<>();
        for (int i = 0; qs != null && i < qs.length(); i++) {
            JSONObject q = qs.optJSONObject(i);
            if (q == null) continue;
            DocQuestion dq = new DocQuestion();
            dq.number = q.optInt("n", i + 1);
            dq.text = q.optString("text", "");
            JSONArray imgs = q.optJSONArray("images");
            if (imgs != null) {
                for (int j = 0; j < imgs.length(); j++) {
                    String url = imgs.optString(j, "");
                    if (url.isEmpty() || downloaded.contains(url)) continue;
                    downloaded.add(url);
                    DocImage di = downloadImage(url);
                    if (di != null) dq.images.add(di);
                }
            }
            out.add(dq);
            final int count = i + 1;
            runOnUiThread(() -> status.setText("Đang tạo DOCX: xử lý câu " + count + "/" + (qs == null ? 0 : qs.length())));
        }
        return out;
    }

    private DocImage downloadImage(String urlString) {
        HttpURLConnection c = null;
        try {
            if (urlString != null && urlString.startsWith("data:image/")) {
                int comma = urlString.indexOf(',');
                if (comma > 0) {
                    byte[] bytes = Base64.decode(urlString.substring(comma + 1), Base64.DEFAULT);
                    Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    if (bmp == null) return null;
                    return bitmapToDocImage(bmp);
                }
            }
            URL u = new URL(urlString);
            c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(12000);
            c.setRequestProperty("User-Agent", webView.getSettings().getUserAgentString());
            String cookie = CookieManager.getInstance().getCookie(urlString);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            c.connect();
            if (c.getResponseCode() < 200 || c.getResponseCode() >= 300) return null;
            byte[] bytes = readAll(c.getInputStream(), 12 * 1024 * 1024);
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) return null;
            return bitmapToDocImage(bmp);
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private DocImage bitmapToDocImage(Bitmap bmp) {
        int w = bmp.getWidth(), h = bmp.getHeight();
        int max = 1400;
        Bitmap use = bmp;
        if (w > max) {
            int nh = Math.max(1, Math.round(h * (max / (float) w)));
            use = Bitmap.createScaledBitmap(bmp, max, nh, true);
            w = max; h = nh;
        }
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        use.compress(Bitmap.CompressFormat.PNG, 92, bos);
        if (use != bmp) use.recycle();
        bmp.recycle();
        DocImage di = new DocImage();
        di.bytes = bos.toByteArray();
        di.width = w;
        di.height = h;
        return di;
    }

    private byte[] readAll(InputStream in, int maxBytes) throws Exception {
        try (InputStream input = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int total = 0, n;
            while ((n = input.read(buf)) != -1) {
                total += n;
                if (total > maxBytes) throw new Exception("Ảnh quá lớn");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private void writeDocx(ZipOutputStream z, String title, List<DocQuestion> questions) throws Exception {
        List<DocImage> allImages = new ArrayList<>();
        for (DocQuestion q : questions) allImages.addAll(q.images);

        putText(z, "[Content_Types].xml", contentTypesXml());
        putText(z, "_rels/.rels", rootRelsXml());
        putText(z, "docProps/core.xml", coreXml(title));
        putText(z, "docProps/app.xml", appXml());
        putText(z, "word/styles.xml", stylesXml());

        StringBuilder rel = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>");
        int rid = 2;
        for (DocImage image : allImages) {
            image.relId = "rId" + rid;
            image.fileName = "image" + (rid - 1) + ".png";
            rel.append("<Relationship Id=\"").append(image.relId).append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/").append(image.fileName).append("\"/>");
            rid++;
        }
        rel.append("</Relationships>");
        putText(z, "word/_rels/document.xml.rels", rel.toString());

        int imageIndex = 1;
        for (DocImage image : allImages) {
            putBytes(z, "word/media/" + image.fileName, image.bytes);
            image.docPrId = imageIndex++;
        }

        StringBuilder body = new StringBuilder();
        body.append(paragraph(title, true, true));
        body.append(paragraph("Xuất từ nội dung được hiển thị trong Azota", false, true));
        for (DocQuestion q : questions) {
            body.append(paragraph("Câu " + q.number, true, false));
            String[] lines = q.text.replace("\r", "").split("\n");
            for (String line : lines) {
                String t = line.trim();
                if (t.isEmpty()) continue;
                if (t.matches("(?i)^(Câu|Cau)\\s*" + q.number + "\\s*[:.]?$")) continue;
                body.append(paragraph(t, false, false));
            }
            for (DocImage image : q.images) body.append(imageParagraph(image));
            body.append(paragraph("", false, false));
        }
        body.append("<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"850\" w:right=\"850\" w:bottom=\"850\" w:left=\"850\"/></w:sectPr>");

        String doc = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><w:body>" + body + "</w:body></w:document>";
        putText(z, "word/document.xml", doc);
    }

    private String paragraph(String text, boolean bold, boolean center) {
        return "<w:p>" + (center ? "<w:pPr><w:jc w:val=\"center\"/></w:pPr>" : "") + "<w:r>" + (bold ? "<w:rPr><w:b/></w:rPr>" : "") + "<w:t xml:space=\"preserve\">" + xmlEscape(text) + "</w:t></w:r></w:p>";
    }

    private String imageParagraph(DocImage i) {
        long cx = Math.max(1, (long) i.width * 9525L);
        long cy = Math.max(1, (long) i.height * 9525L);
        long maxCx = 5_500_000L;
        if (cx > maxCx) {
            double scale = maxCx / (double) cx;
            cx = maxCx;
            cy = Math.max(1, Math.round(cy * scale));
        }
        return "<w:p><w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"" + cx + "\" cy=\"" + cy + "\"/><wp:docPr id=\"" + i.docPrId + "\" name=\"Image " + i.docPrId + "\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:nvPicPr><pic:cNvPr id=\"0\" name=\"" + i.fileName + "\"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed=\"" + i.relId + "\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"" + cx + "\" cy=\"" + cy + "\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>";
    }

    private void putText(ZipOutputStream z, String name, String text) throws Exception {
        putBytes(z, name, text.getBytes(StandardCharsets.UTF_8));
    }

    private void putBytes(ZipOutputStream z, String name, byte[] bytes) throws Exception {
        ZipEntry e = new ZipEntry(name);
        z.putNextEntry(e);
        z.write(bytes);
        z.closeEntry();
    }

    private String contentTypesXml() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"png\" ContentType=\"image/png\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/><Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/><Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/></Types>";
    }

    private String rootRelsXml() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/><Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/></Relationships>";
    }

    private String coreXml(String title) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>" + xmlEscape(title) + "</dc:title><dc:creator>Azota Exporter</dc:creator></cp:coreProperties>";
    }

    private String appXml() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\"><Application>Azota Exporter</Application></Properties>";
    }

    private String stylesXml() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Times New Roman\" w:hAnsi=\"Times New Roman\"/><w:sz w:val=\"24\"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style></w:styles>";
    }

    private String htmlEscape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private String xmlEscape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
    }

    private static class DocQuestion {
        int number;
        String text;
        List<DocImage> images = new ArrayList<>();
    }

    private static class DocImage {
        byte[] bytes;
        int width;
        int height;
        String relId;
        String fileName;
        int docPrId;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (executor != null) executor.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
