// Stand-in for the three third-party services, so the demo runs fully offline.
import http from "node:http";

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/authorize") { // login provider: send the user straight back
    res.writeHead(302, { location: `${url.searchParams.get("redirect_uri")}?code=demo-code&state=${url.searchParams.get("state")}` });
    return res.end();
  }
  if (url.pathname === "/token") return json(200, { email: "buyer@example.com" });
  if (url.pathname === "/track") return json(200, { status: "in_transit" });
  if (url.pathname === "/sales") return json(200, { total: 12840, orders: 37 });
  json(404, { error: "not_found" });
});

server.listen(Number(process.env.EXTERNAL_PORT ?? 8090), "127.0.0.1", () => console.log("listening on :" + server.address().port));
