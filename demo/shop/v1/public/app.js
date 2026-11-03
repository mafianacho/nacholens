// Browser client of the demo shop. Same-origin calls only; the gateway forwards /api/*.
const $ = (id) => document.getElementById(id);

async function api(path, options) {
  const res = await fetch("/api" + path, { credentials: "same-origin", ...options });
  if (res.status === 401) { $("login").hidden = false; throw new Error("signed out"); }
  return res.json();
}

async function loadOrders() {
  const { orders } = await api("/orders");
  $("login").hidden = true;
  $("orders").replaceChildren(...orders.map((o) => {
    const li = document.createElement("li");
    li.textContent = `#${o.id} ${o.item} × ${o.qty}`;
    return li;
  }));
}

$("order-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  await api("/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item: form.get("item"), qty: Number(form.get("qty")) }),
  });
  await loadOrders();
});

loadOrders().catch(() => {});
api("/reports/sales").then((s) => { $("sales").textContent = `Sales ${s.total} (${s.orders} orders)`; }).catch(() => {});
