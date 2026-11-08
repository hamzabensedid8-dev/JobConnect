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

  /* ------------------------------------------------ paiement d'une demande */

  window.JCOpenPayment = async function (reference, pricing) {
    if (!token) { openModal("login"); return; }

    var overlay = document.createElement("div");
    overlay.className = "jc-overlay";
    overlay.innerHTML =
      '<div class="jc-sheet pay-sheet">' +
      '<div class="jc-sheet-head"><b>Complete your payment</b><button class="jc-x">×</button></div>' +
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

    body.innerHTML =
      '<p class="muted">Reference <b>' + esc(reference) + "</b></p>" +
      '<table class="pay-table">' +
      "<tr><td>JobConnect fee</td><td>" + money(fee, cur) + "</td></tr>" +
      "<tr><td>Recruiter price</td><td>" + money(recr, cur) + "</td></tr>" +
      '<tr class="total"><td>Total</td><td>' + money(total, cur) + "</td></tr>" +
      "</table>" +
      '<p class="pay-note">Payment is processed by Stripe (Visa / Mastercard). ' +
      "JobConnect never stores your card details. Your receipt is e-mailed after confirmation.</p>" +
      '<button class="btn primary wide" id="payStart">Pay ' + money(total, cur) + "</button>" +
      '<p class="pay-error" id="payError"></p>';

    body.querySelector("#payStart").addEventListener("click", async function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = "Redirecting…";
      try {
        var d = await api("/api/payments/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: reference })
        });
        window.location.href = d.checkout_url;
      } catch (err) {
        document.getElementById("payError").textContent = err.message;
        btn.disabled = false;
        btn.textContent = "Pay " + money(total, cur);
      }
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
      var sid = new URLSearchParams(window.location.search).get("session_id");
      notice(
        "Thank you — payment received",
        '<p class="muted">We are confirming your payment with Stripe. This page refreshes automatically.</p>' +
          '<div id="payStatus" class="pay-status">Checking…</div>'
      );

      var attempts = 0;
      var poll = setInterval(async function () {
        attempts++;
        try {
          var d = await api("/api/payments/session?session_id=" + encodeURIComponent(sid || ""));
          var el = document.getElementById("payStatus");
          if (d.payment.status === "paid") {
            clearInterval(poll);
            el.className = "pay-status ok";
            el.innerHTML =
              "<b>Payment confirmed</b><br>Receipt <b>" + esc(d.payment.receipt_number || "") + "</b>" +
              "<br>Total paid: <b>" + fmt(d.payment.total_cents, d.payment.currency) + "</b>" +
              (d.application
                ? "<br>Reference: <b>" + esc(d.application.reference) + "</b> — status " + esc(d.application.status)
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
