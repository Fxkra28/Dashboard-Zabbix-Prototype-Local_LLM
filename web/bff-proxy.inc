# Shared by the /bff locations in default.conf.

# /bff/api/hosts -> /api/hosts on the BFF. `break` stops the rewrite here, and a
# proxy_pass with a variable and no path sends the rewritten path, with the
# query string kept. $bff_upstream is set in default.conf, with its resolver.
rewrite ^/bff/(.*)$ /$1 break;
proxy_pass $bff_upstream;

proxy_http_version 1.1;
# The Host the browser sent, port included ($host drops the port). The BFF
# compares it with the Origin of every cookie POST (auth.ts),
# so a TLS proxy in front must keep the browser's Host as well.
proxy_set_header Host $http_host;
proxy_set_header X-Real-IP $remote_addr;
# Appended, as proxies do. The BFF trusts one hop (TRUST_PROXY=true), so it
# reads the right-most entry, the one nginx wrote here, and anything a client
# put in front is ignored. With a TLS proxy in front of
# nginx, set TRUST_PROXY=2 so the BFF reads that proxy's entry instead.
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

# nginx's own id for this request, in place of whatever the client sent. The BFF logs it as
# `reqId`, returns it as X-Request-Id and puts it in every error body, and the access log
# below carries it too, so one id finds the request in both.
proxy_set_header X-Request-Id $request_id;

# The four security headers are the server's (default.conf), on a reply nginx makes itself as well as on this one.
# The copies the BFF's helmet sends are dropped, so that each header is sent once.
proxy_hide_header X-Frame-Options;
proxy_hide_header X-Content-Type-Options;
proxy_hide_header Referrer-Policy;
proxy_hide_header Content-Security-Policy;

# No Connection header to the BFF, so the connection can stay open (the streams need that).
# Buffering and the read timeout are set per location in default.conf: only the
# streams run unbuffered with a long timeout.
proxy_set_header Connection '';
gzip off;
