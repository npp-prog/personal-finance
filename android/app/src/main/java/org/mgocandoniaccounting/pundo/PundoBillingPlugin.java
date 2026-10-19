package org.mgocandoniaccounting.pundo;

import android.content.Intent;
import android.net.Uri;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Google Play subscriptions for Pundo cloud sync.
 *
 * The app never decides on its own that a purchase is valid: it sends the purchase token to the
 * checkSubscription Cloud Function, which verifies it with Google Play and acknowledges it.
 */
@CapacitorPlugin(name = "PundoBilling")
public class PundoBillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private BillingClient client;
    private PluginCall purchaseCall;
    private String purchaseProductId;
    private final List<Runnable> whenReady = new ArrayList<>();
    private final List<PluginCall> waitingCalls = new ArrayList<>();
    private boolean connecting = false;

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
    }

    /** Runs the task once Google Play Billing is connected, rejecting the call if it can't connect. */
    private synchronized void connected(PluginCall call, Runnable task) {
        if (client.isReady()) { task.run(); return; }
        whenReady.add(task);
        waitingCalls.add(call);
        if (connecting) return;
        connecting = true;
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                List<Runnable> tasks;
                List<PluginCall> calls;
                synchronized (PundoBillingPlugin.this) {
                    connecting = false;
                    tasks = new ArrayList<>(whenReady);
                    calls = new ArrayList<>(waitingCalls);
                    whenReady.clear();
                    waitingCalls.clear();
                }
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    for (Runnable t : tasks) t.run();
                } else {
                    for (PluginCall c : calls) reject(c, result);
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                synchronized (PundoBillingPlugin.this) { connecting = false; }
            }
        });
    }

    private static String codeOf(BillingResult r) {
        switch (r.getResponseCode()) {
            case BillingClient.BillingResponseCode.USER_CANCELED: return "cancelled";
            case BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED: return "owned";
            case BillingClient.BillingResponseCode.BILLING_UNAVAILABLE: return "billing-unavailable";
            case BillingClient.BillingResponseCode.ITEM_UNAVAILABLE: return "item-unavailable";
            case BillingClient.BillingResponseCode.SERVICE_DISCONNECTED:
            case BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE:
            case BillingClient.BillingResponseCode.NETWORK_ERROR: return "unavailable";
            default: return "billing-error-" + r.getResponseCode();
        }
    }

    private static void reject(PluginCall call, BillingResult r) {
        String msg = r.getDebugMessage();
        call.reject(msg == null || msg.isEmpty() ? "Google Play billing error " + r.getResponseCode() : msg, codeOf(r));
    }

    private void productDetails(PluginCall call, String productId, ProductCallback cb) {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(Collections.singletonList(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()))
            .build();
        connected(call, () -> client.queryProductDetailsAsync(params, (result, details) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { reject(call, result); return; }
            List<ProductDetails> list = details.getProductDetailsList();
            if (list == null || list.isEmpty()) {
                call.reject("The subscription is not available in Google Play yet.", "item-unavailable");
                return;
            }
            cb.got(list.get(0));
        }));
    }

    private interface ProductCallback { void got(ProductDetails details); }

    /**
     * The offer to sell: a free trial if Google Play says this user is eligible (Play only lists
     * offers the user qualifies for), otherwise the plain base plan.
     */
    private static ProductDetails.SubscriptionOfferDetails offerOf(ProductDetails d) {
        List<ProductDetails.SubscriptionOfferDetails> offers = d.getSubscriptionOfferDetails();
        if (offers == null || offers.isEmpty()) return null;
        for (ProductDetails.SubscriptionOfferDetails o : offers) if (trialPhase(o) != null) return o;
        for (ProductDetails.SubscriptionOfferDetails o : offers) if (o.getOfferId() == null) return o;
        return offers.get(0);
    }

    /** The free first phase of an offer, or null if the offer has no free trial. */
    private static ProductDetails.PricingPhase trialPhase(ProductDetails.SubscriptionOfferDetails o) {
        List<ProductDetails.PricingPhase> phases = o.getPricingPhases().getPricingPhaseList();
        if (phases.size() < 2) return null;
        ProductDetails.PricingPhase first = phases.get(0);
        return first.getPriceAmountMicros() == 0 ? first : null;
    }

    @PluginMethod
    public void getProduct(PluginCall call) {
        String productId = call.getString("productId", "pundo_sync");
        productDetails(call, productId, (d) -> {
            ProductDetails.SubscriptionOfferDetails offer = offerOf(d);
            JSObject out = new JSObject();
            out.put("productId", d.getProductId());
            out.put("title", d.getName());
            if (offer != null) {
                List<ProductDetails.PricingPhase> phases = offer.getPricingPhases().getPricingPhaseList();
                ProductDetails.PricingPhase recurring = phases.get(phases.size() - 1);
                out.put("price", recurring.getFormattedPrice());
                out.put("period", recurring.getBillingPeriod());
                out.put("basePlanId", offer.getBasePlanId());
                ProductDetails.PricingPhase trial = trialPhase(offer);
                if (trial != null) out.put("trialPeriod", trial.getBillingPeriod());
            }
            call.resolve(out);
        });
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId", "pundo_sync");
        String accountId = call.getString("accountId");
        if (getActivity() == null) { call.reject("The app is not in the foreground.", "unavailable"); return; }
        productDetails(call, productId, (d) -> {
            ProductDetails.SubscriptionOfferDetails offer = offerOf(d);
            if (offer == null) { call.reject("The subscription has no active plan in Google Play.", "item-unavailable"); return; }
            BillingFlowParams.Builder flow = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(d)
                    .setOfferToken(offer.getOfferToken())
                    .build()));
            if (accountId != null && !accountId.isEmpty()) flow.setObfuscatedAccountId(accountId);
            synchronized (this) {
                if (purchaseCall != null) { call.reject("A purchase is already in progress.", "busy"); return; }
                purchaseCall = call;
                purchaseProductId = productId;
            }
            getActivity().runOnUiThread(() -> {
                BillingResult r = client.launchBillingFlow(getActivity(), flow.build());
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    PluginCall c = takePurchaseCall();
                    if (c != null) reject(c, r);
                }
            });
        });
    }

    private synchronized PluginCall takePurchaseCall() {
        PluginCall c = purchaseCall;
        purchaseCall = null;
        return c;
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        PluginCall call = takePurchaseCall();
        if (call == null) return; // a renewal or a purchase finished elsewhere; picked up by getPurchases
        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { reject(call, result); return; }
        if (purchases != null) {
            for (Purchase p : purchases) {
                if (p.getProducts().contains(purchaseProductId)) { call.resolve(toJS(p)); return; }
            }
        }
        call.reject("Google Play did not return the purchase.", "billing-error");
    }

    private static JSObject toJS(Purchase p) {
        JSObject o = new JSObject();
        o.put("purchaseToken", p.getPurchaseToken());
        o.put("productId", p.getProducts().isEmpty() ? null : p.getProducts().get(0));
        o.put("orderId", p.getOrderId());
        o.put("acknowledged", p.isAcknowledged());
        o.put("autoRenewing", p.isAutoRenewing());
        o.put("state", p.getPurchaseState() == Purchase.PurchaseState.PURCHASED ? "purchased"
            : p.getPurchaseState() == Purchase.PurchaseState.PENDING ? "pending" : "unknown");
        return o;
    }

    /** Subscriptions Google Play currently holds for the signed-in Google account on this device. */
    @PluginMethod
    public void getPurchases(PluginCall call) {
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build();
        connected(call, () -> client.queryPurchasesAsync(params, (result, list) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { reject(call, result); return; }
            JSArray arr = new JSArray();
            if (list != null) for (Purchase p : list) arr.put(toJS(p));
            JSObject out = new JSObject();
            out.put("purchases", arr);
            call.resolve(out);
        }));
    }

    /** Opens Google Play's subscription page, where the user can cancel or change payment. */
    @PluginMethod
    public void manage(PluginCall call) {
        String productId = call.getString("productId", "pundo_sync");
        Uri uri = Uri.parse("https://play.google.com/store/account/subscriptions?sku=" + Uri.encode(productId)
            + "&package=" + Uri.encode(getContext().getPackageName()));
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
