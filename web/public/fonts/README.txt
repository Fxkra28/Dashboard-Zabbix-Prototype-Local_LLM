The portal's two typefaces, served from this site (tracker IN-22). Before this, every page load fetched
them from fonts.googleapis.com and fonts.gstatic.com, a third party on each visit to a confidential portal.

Inter                 variable, one file per subset, covers weights 400 to 700
IBM Plex Mono         static, weights 400, 500 and 600

Both are licensed under the SIL Open Font License 1.1, copied beside this file (OFL-Inter.txt and
OFL-IBM-Plex.txt). That licence lets them be served with an application, and asks that it travel with them.

Where they came from: the files Google Fonts serves for the stylesheet this page used to load,
  https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700
taken on 12 October 2026, over HTTPS, WOFF2 signature checked. Only the "latin" and "latin-ext" subsets are kept,
which cover English, Indonesian and most European names. Text in another script (Cyrillic, Greek, Vietnamese)
falls back to the system font, as the stylesheet's font stacks say.

  ibm-plex-mono-400-latin-ext.woff2  IBM Plex Mono, latin-ext, weight 400  (8860 bytes, sha256 f1050dc5317b4343...)
  ibm-plex-mono-400-latin.woff2      IBM Plex Mono, latin, weight 400  (10052 bytes, sha256 c36f509c0a8f9f85...)
  ibm-plex-mono-500-latin-ext.woff2  IBM Plex Mono, latin-ext, weight 500  (8848 bytes, sha256 77f03e26f981c582...)
  ibm-plex-mono-500-latin.woff2      IBM Plex Mono, latin, weight 500  (10060 bytes, sha256 a76f53ca6612e7b3...)
  ibm-plex-mono-600-latin-ext.woff2  IBM Plex Mono, latin-ext, weight 600  (8960 bytes, sha256 1b6b18fd0fd240bc...)
  ibm-plex-mono-600-latin.woff2      IBM Plex Mono, latin, weight 600  (10120 bytes, sha256 ad4580d8cb4b5f62...)
  inter-latin-ext.woff2              Inter, latin-ext  (85272 bytes, sha256 a28eb6d3ccb534ae...)
  inter-latin.woff2                  Inter, latin  (48432 bytes, sha256 c940764593d0fe5d...)

To change one, replace the file, keep the name, and update the @font-face rule in src/styles.css if the range or
weights changed. nginx caches /fonts/ for 30 days, not for ever, because the names are not content-hashed.
