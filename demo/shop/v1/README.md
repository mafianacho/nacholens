# demo shop (v1)

Tiny zero-dependency Node app used as the public example for `nacholens`:
browser (`public/`) → gateway (`gateway.js`) → API (`api.js`) → SQLite (`db.js`),
plus three third-party services (`mock-external.js`).

    node mock-external.js & node api.js & node gateway.js    # Node >= 22.13
