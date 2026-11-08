# coturn TLS material

Place `cert.pem` and `key.pem` here (a certificate for the hostname in `TURN_URLS`) to serve TURN over TLS on 5349/tcp, for the optional `turn` compose profile.

Without them coturn logs a TLS warning and still serves 3478 udp/tcp, which is enough for most networks.

These files are deployment secrets: keep them out of Git (see `docker-compose.yml` and `docs/self-hosting.md`).
