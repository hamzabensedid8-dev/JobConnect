/* ==========================================================================
   JobConnect — paiements (Stripe Checkout) et pages de retour
   Le site n'encaisse jamais de carte : la saisie se fait chez Stripe.
   ========================================================================== */
(function () {
  function fmt(c, cur) {
    return "$" + (Number(c || 0) / 100).toFixed(2) + " " + (cur || "USD");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(c, cur) { return fmt(c, cur); }

  /* ------------------------------------- chargement de Stripe.js (à la demande) */

  var stripeJsPromise = null;
  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (stripeJsPromise) return stripeJsPromise;
    stripeJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.async = true;
      s.onload = function () { resolve(window.Stripe); };
      s.onerror = function () { reject(new Error("Stripe.js could not be loaded.")); };
      document.head.appendChild(s);
    });
    return stripeJsPromise;
  }

  /* ------------------------------------------------ paiement d'une demande */

  window.JCOpenPayment = async function (reference, pricing) {
    if (!token) { openModal("login"); return; }

    var overlay = document.createElement("div");
    overlay.className = "jc-overlay";
    overlay.innerHTML =
      '<div class="jc-sheet pay-sheet">' +
      '<div class="jc-sheet-head"><b>Secure checkout</b><button class="jc-x">×</button></div>' +
      '<div class="pay-body" id="payBody"></div>' +
      "</div>";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.classList.contains("jc-x")) overlay.remove();
    });

    var body = overlay.querySelector("#payBody");
    var fee = pricing && pricing.fee_cents != null ? pricing.fee_cents : 0;
    var recr = pricing && pricing.recruiter_price_cents != null ? pricing.recruiter_price_cents : 0;
    var total = pricing && pricing.total_cents != null ? pricing.total_cents : fee + recr;
    var cur = (pricing && pricing.currency) || "USD";

    function summary() {
      return (
        '<p class="muted small">Reference <b>' + esc(reference) + "</b></p>" +
        '<table class="pay-table">' +
        "<tr><td>JobConnect fee</td><td>" + money(fee, cur) + "</td></tr>" +
        "<tr><td>Recruiter price</td><td>" + money(recr, cur) + "</td></tr>" +
        '<tr class="total"><td>Total</td><td>' + money(total, cur) + "</td></tr>" +
        "</table>"
      );
    }

    body.innerHTML =
      summary() +
      '<div class="pay-loading"><span class="spinner"></span> Preparing secure card form…</div>' +
      '<p class="pay-error" id="payError"></p>';

    var errEl = body.querySelector("#payError");

    /* 1) Créer l'intention de paiement côté serveur */
    var intent;
    try {
      intent = await api("/api/payments/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: reference })
      });
    } catch (err) {
      body.innerHTML =
        summary() +
        '<p class="pay-error">' + esc(err.message) + "</p>" +
        '<p class="pay-note">Card payment is unavailable right now. Your request stays Pending and nothing was charged.</p>';
      return;
    }

    total = intent.total_cents;
    cur = intent.currency;
    body.innerHTML =
      summary() +
      '<form id="payForm" class="card-form" autocomplete="on">' +
      '<div class="card-form-head">' +
      '<span class="card-brands" aria-hidden="true">VISA</span>' +
      '<span class="card-brands alt" aria-hidden="true">Mastercard</span>' +
      '<span class="lock">🔒 Secure</span>' +
      "</div>" +
      '<div id="paymentElement" class="payment-element"><span class="spinner"></span></div>' +
      '<button class="btn primary wide" id="paySubmit" type="submit">Pay ' + money(total, cur) + "</button>" +
      '<p class="pay-error" id="payError"></p>' +
      '<p class="pay-note">Card data is typed directly into Stripe\'s secured fields: it never touches ' +
      "JobConnect servers and is never stored here. Your receipt arrives by e-mail within a few minutes.</p>" +
      "</form>";

    errEl = body.querySelector("#payError");
    var submit = body.querySelector("#paySubmit");
    var elementHost = body.querySelector("#paymentElement");

    /* 2) Monter le Payment Element (saisie carte type e-commerce) */
    var stripe, elements;
    try {
      if (!intent.publishable_key || !intent.client_secret) throw new Error("missing publishable key");
      var StripeCtor = await loadStripeJs();
      stripe = StripeCtor(intent.publishable_key);
      elements = stripe.elements({
        clientSecret: intent.client_secret,
        appearance: {
          theme: "stripe",
          variables: { colorPrimary: "#1d4ed8", borderRadius: "12px", fontFamily: "inherit" }
        }
      });
      var paymentElement = elements.create("payment", { layout: "tabs" });
      paymentElement.mount(elementHost);
      elementHost.classList.add("mounted");
    } catch (err) {
      // Repli : redirection vers la page Stripe hébergée (même compte encaisseur).
      elementHost.innerHTML =
        '<p class="pay-note">Inline card form unavailable here. Continue on the secure Stripe page.</p>';
      submit.textContent = "Continue to secure payment — " + money(total, cur);
      submit.dataset.fallback = "1";
    }

    /* 3) Payer */
    body.querySelector("#payForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      errEl.textContent = "";
      submit.disabled = true;
      submit.textContent = "Processing…";

      if (submit.dataset.fallback === "1") {
        try {
          var d = await api("/api/payments/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference: reference })
          });
          window.location.href = d.checkout_url;
          return;
        } catch (err2) {
          errEl.textContent = err2.message;
          submit.disabled = false;
          submit.textContent = "Pay " + money(total, cur);
          return;
        }
      }

      var res = await stripe.confirmPayment({
        elements: elements,
        confirmParams: {
          return_url: window.location.origin + "/payment/success?reference=" + encodeURIComponent(reference)
        },
        redirect: "if_required"
      });

      if (res.error) {
        errEl.textContent = res.error.message || "The card was declined.";
        submit.disabled = false;
        submit.textContent = "Pay " + money(total, cur);
        return;
      }

      if (res.paymentIntent && res.paymentIntent.status === "succeeded") {
        body.innerHTML =
          summary() +
          '<div class="pay-status ok"><b>Payment confirmed</b><br>Reference <b>' + esc(reference) +
          "</b><br>Your receipt is on its way by e-mail.</div>" +
          '<a class="btn light wide" href="/#suivi">Track my request</a>';
        if (window.refreshPaymentsList) window.refreshPaymentsList();
        return;
      }

      window.location.href = "/payment/success?reference=" + encodeURIComponent(reference);
    });
  };

  document.addEventListener("click", function (e) {
    var b = e.target.closest(".pay-now");
    if (!b) return;
    e.preventDefault();
    JCOpenPayment(b.dataset.ref, {
      fee_cents: Number(b.dataset.fee || 0),
      recruiter_price_cents: Number(b.dataset.recruiter || 0),
      total_cents: Number(b.dataset.total || 0),
      currency: b.dataset.currency || "USD"
    });
  });

  /* ----------------------------------------------------------- pages retour */

  function notice(title, html) {
    var main = document.querySelector("main");
    if (!main) return;
    main.innerHTML =
      '<section class="section"><div class="panel pay-page">' +
      "<h2>" + title + "</h2>" + html +
      '<a class="btn primary" href="/#suivi">Track my request</a> ' +
      '<a class="btn light" href="/">Back to home</a>' +
      "</div></section>";
  }

  async function handleReturn() {
    var path = window.location.pathname;

    if (path === "/payment/success" || path === "/billing/success") {
      var params = new URLSearchParams(window.location.search);
      var sid = params.get("session_id");
      var pref = params.get("payment_intent") ? null : params.get("reference");
      notice(
        "Thank you — payment received",
        '<p class="muted">We are confirming your payment with Stripe. This page refreshes automatically.</p>' +
          '<div id="payStatus" class="pay-status">Checking…</div>'
      );

      var attempts = 0;
      var poll = setInterval(async function () {
        attempts++;
        try {
          var d = await api(
            sid
              ? "/api/payments/session?session_id=" + encodeURIComponent(sid)
              : "/api/payments/by-reference?reference=" + encodeURIComponent(pref || "")
          );
          var el = document.getElementById("payStatus");
          if (d.payment.status === "paid") {
            clearInterval(poll);
            el.className = "pay-status ok";
            var appRef = d.application ? d.application.reference : pref;
            el.innerHTML =
              "<b>Payment confirmed</b><br>Receipt <b>" + esc(d.payment.receipt_number || "") + "</b>" +
              "<br>Total paid: <b>" + fmt(d.payment.total_cents, d.payment.currency) + "</b>" +
              (appRef
                ? "<br>Reference: <b>" + esc(appRef) + "</b>" +
                  (d.application ? " — status " + esc(d.application.status) : "")
                : "") +
              '<br><br><a class="btn light" href="/api/payments/' +
              encodeURIComponent(d.payment.reference) +
              '/receipt.pdf">Download receipt (PDF)</a>';
          } else if (attempts > 40) {
            clearInterval(poll);
            el.textContent = "Payment confirmation is taking longer than usual. Check your dashboard in a few minutes.";
          }
        } catch (err) {
          if (attempts > 40) clearInterval(poll);
        }
      }, 3000);
      return;
    }

    if (path === "/payment/cancel") {
      var ref = new URLSearchParams(window.location.search).get("reference");
      notice(
        "Payment cancelled",
        '<p class="muted">No card was charged. Your request ' + esc(ref || "") +
          " is saved and stays Pending until payment is completed.</p>"
      );
      return;
    }

    if (path === "/billing/cancel") {
      notice("Subscription cancelled", '<p class="muted">No card was charged. Your recruiter account stays inactive for publishing.</p>');
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handleReturn);
  } else {
    handleReturn();
  }
})();
