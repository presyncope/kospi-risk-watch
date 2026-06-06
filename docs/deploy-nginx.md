# nginx deployment for `/kospi-risk-watch`

Target URL: `https://nukim.dyndns.org/kospi-risk-watch/`

## Current app assumptions

- App listens on `127.0.0.1:4173` through the Node server.
- Browser assets use relative URLs, and API calls derive `/kospi-risk-watch` from the script URL when served behind nginx.
- Default data source remains the unavailable KRX placeholder. Do not enable mock data for public monitoring unless the page is clearly treated as a fixture/demo.

## Root commands

Run from the repository root with root/sudo access:

```sh
sudo install -m 0644 deploy/systemd/kospi-risk-watch.service /etc/systemd/system/kospi-risk-watch.service
sudo systemctl daemon-reload
sudo systemctl enable --now kospi-risk-watch.service
sudo systemctl status kospi-risk-watch.service --no-pager
```

If an HTTPS `server { ... }` block for `nukim.dyndns.org` already exists, paste or include `deploy/nginx/kospi-risk-watch-location.conf` inside that block.

If no HTTPS block exists yet, install a valid certificate first, then use `deploy/nginx/kospi-risk-watch-site.conf` as a site template:

```sh
sudo install -m 0644 deploy/nginx/kospi-risk-watch-site.conf /etc/nginx/sites-available/kospi-risk-watch
sudo ln -sf /etc/nginx/sites-available/kospi-risk-watch /etc/nginx/sites-enabled/kospi-risk-watch
sudo nginx -t
sudo systemctl reload nginx
```

## Validation

```sh
curl -f http://127.0.0.1:4173/api/health
curl -k -I https://127.0.0.1/kospi-risk-watch/ -H 'Host: nukim.dyndns.org'
curl -I https://nukim.dyndns.org/kospi-risk-watch/
```

Expected public result: `HTTP/2 200` or `HTTP/1.1 200` for `/kospi-risk-watch/`, and JavaScript requests to `/kospi-risk-watch/api/dashboard?force=true`.
